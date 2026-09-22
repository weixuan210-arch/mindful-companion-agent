import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DRIVE_CONNECTOR_ID,
  DRIVE_FOLDER_NAME,
  DRIVE_SCOPES,
  GATEWAY_BASE_URL,
} from "@/lib/driveShared";

function clientApiKey(): string {
  const key = process.env["GOOGLE_DRIVE_APP_USER_CONNECTOR_CLIENT_API_KEY"];
  if (!key) throw new Error("GOOGLE_DRIVE_APP_USER_CONNECTOR_CLIENT_API_KEY is not set");
  return key;
}

/** Is this person's Drive connected, and does it still work? */
export const getDriveStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getDriveConnection } = await import("@/lib/driveConnection.server");
    const connection = await getDriveConnection(context.userId);
    if (!connection) return { connected: false, reconnectRequired: false, email: null };

    const { callAsAppUser, appUserReconnectRequired } = await import(
      "@/integrations/lovable/appUserConnector"
    );
    const res = await callAsAppUser({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectionAPIKey: connection.connectionKey,
      connectorId: DRIVE_CONNECTOR_ID,
      path: "/drive/v3/about?fields=user(emailAddress)",
      requiredScopes: DRIVE_SCOPES,
    });

    if (await appUserReconnectRequired(res)) {
      return { connected: false, reconnectRequired: true, email: null };
    }
    if (!res.ok) {
      console.error(`[billy] Drive status check failed [${res.status}]: ${await res.text()}`);
      return { connected: true, reconnectRequired: false, email: null };
    }
    const body = (await res.json()) as { user?: { emailAddress?: string } };
    return {
      connected: true,
      reconnectRequired: false,
      email: body.user?.emailAddress ?? null,
      folderName: DRIVE_FOLDER_NAME,
    };
  });

/** Starts Google consent for this person and returns the URL to open in a popup. */
export const startDriveConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const request = getRequest();
    if (!request) throw new Error("Connecting Drive must start from an app request.");

    const url = new URL(request.url);
    const sandboxHost =
      url.hostname === "localhost" ? request.headers.get("x-forwarded-host") : null;
    const origin = sandboxHost ? `https://${sandboxHost}` : url.origin;
    const returnUrl = new URL("/oauth/google-drive/return", origin).toString();

    const { getDriveConnection } = await import("@/lib/driveConnection.server");
    const { authorizeAppUserOAuth } = await import("@/integrations/lovable/appUserConnector");

    const existing = await getDriveConnection(context.userId);

    const { authorizationUrl } = await authorizeAppUserOAuth({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectorId: DRIVE_CONNECTOR_ID,
      appUserId: context.userId,
      clientAPIKey: clientApiKey(),
      returnUrl,
      ...(existing ? { connectionAPIKey: existing.connectionKey } : {}),
      credentialsConfiguration: { scopes: DRIVE_SCOPES },
    });

    return { authorizationUrl };
  });

/** Exchanges the one-time code for this person's connection and stores it. */
export const completeDriveConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { code: string }) => {
    if (!input?.code || typeof input.code !== "string") throw new Error("Missing code");
    return { code: input.code };
  })
  .handler(async ({ data, context }) => {
    const { exchangeAppUserOAuthCode } = await import("@/integrations/lovable/appUserConnector");
    const { connectionAPIKey, connectorId } = await exchangeAppUserOAuthCode(
      GATEWAY_BASE_URL,
      data.code,
    );
    if (connectorId !== DRIVE_CONNECTOR_ID) {
      throw new Error("Connection returned the wrong service");
    }

    const { ensureBillyFolder } = await import("@/lib/drive.server");
    const folderId = await ensureBillyFolder(connectionAPIKey);

    const { saveDriveConnection } = await import("@/lib/driveConnection.server");
    await saveDriveConnection(context.userId, connectionAPIKey, folderId);

    return { connected: true, folderName: DRIVE_FOLDER_NAME };
  });

/** Copies everything saved so far into the person's Drive folder. */
export const backfillDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getDriveConnection } = await import("@/lib/driveConnection.server");
    const connection = await getDriveConnection(context.userId);
    if (!connection) return { copied: 0 };

    const { mirrorToDrive } = await import("@/lib/drive.server");
    const ctx = { supabase: context.supabase, userId: context.userId };

    const [{ data: thoughts }, { data: tasks }] = await Promise.all([
      context.supabase
        .from("thoughts")
        .select("id, content, tags, mood, created_at")
        .eq("user_id", context.userId)
        .is("drive_file_id", null)
        .limit(100),
      context.supabase
        .from("tasks")
        .select("id, title, details, due_at, created_at")
        .eq("user_id", context.userId)
        .is("drive_file_id", null)
        .limit(100),
    ]);

    const { mirrorThoughtToDrive, mirrorTaskToDrive } = await import("@/lib/drive.server");

    let copied = 0;
    for (const thought of thoughts ?? []) {
      const ok = await mirrorThoughtToDrive(ctx, thought.id, {
        content: thought.content,
        tags: thought.tags ?? [],
        mood: thought.mood,
        createdAt: thought.created_at,
      });
      if (ok) copied += 1;
    }
    for (const task of tasks ?? []) {
      const ok = await mirrorTaskToDrive(ctx, task.id, {
        title: task.title,
        details: task.details,
        dueAt: task.due_at,
        status: "open",
        createdAt: task.created_at,
      });
      if (ok) copied += 1;
    }
    return { copied };
  });

/** Disconnects Drive for this person. */
export const disconnectDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getDriveConnection, deleteDriveConnection } = await import(
      "@/lib/driveConnection.server"
    );
    const connection = await getDriveConnection(context.userId);
    if (connection) {
      const { disconnectAppUser } = await import("@/integrations/lovable/appUserConnector");
      try {
        await disconnectAppUser({
          gatewayBaseUrl: GATEWAY_BASE_URL,
          connectionAPIKey: connection.connectionKey,
          connectorId: DRIVE_CONNECTOR_ID,
        });
      } catch (error) {
        console.error("[billy] Drive disconnect failed", error);
      }
    }
    await deleteDriveConnection(context.userId);
    return { connected: false };
  });
