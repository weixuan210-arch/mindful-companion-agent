// Mirrors captured thoughts and tasks into the person's own Google Drive.
// No-ops safely when they have not connected Drive yet.
import type { CompanionContext } from "@/lib/companion.server";
import { callAsAppUser } from "@/integrations/lovable/appUserConnector";
import {
  DRIVE_CONNECTOR_ID,
  DRIVE_FOLDER_NAME,
  DRIVE_SCOPES,
  GATEWAY_BASE_URL,
} from "@/lib/driveShared";

/** Finds the Billy folder in the person's Drive, creating it if needed. */
export async function ensureBillyFolder(connectionKey: string): Promise<string | null> {
  const query = encodeURIComponent(
    `name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const found = await callAsAppUser({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectionAPIKey: connectionKey,
    connectorId: DRIVE_CONNECTOR_ID,
    path: `/drive/v3/files?q=${query}&fields=files(id,name)&pageSize=1`,
    requiredScopes: DRIVE_SCOPES,
  });

  if (found.ok) {
    const body = (await found.json()) as { files?: { id?: string }[] };
    const existing = body.files?.[0]?.id;
    if (existing) return existing;
  } else {
    console.error(`[billy] Drive folder lookup failed [${found.status}]: ${await found.text()}`);
  }

  const created = await callAsAppUser({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectionAPIKey: connectionKey,
    connectorId: DRIVE_CONNECTOR_ID,
    path: "/drive/v3/files?fields=id",
    requiredScopes: DRIVE_SCOPES,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: DRIVE_FOLDER_NAME,
        mimeType: "application/vnd.google-apps.folder",
      }),
    },
  });

  if (!created.ok) {
    console.error(`[billy] Drive folder create failed [${created.status}]: ${await created.text()}`);
    return null;
  }
  const folder = (await created.json()) as { id?: string };
  return folder.id ?? null;
}

export async function mirrorToDrive(
  ctx: CompanionContext,
  kind: "thought" | "task",
  recordId: string,
  content: string,
): Promise<boolean> {
  try {
    const { getDriveConnection } = await import("@/lib/driveConnection.server");
    const connection = await getDriveConnection(ctx.userId);
    if (!connection) return false;

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const metadata: Record<string, unknown> = {
      name: `billy-${kind}-${stamp}.txt`,
      mimeType: "text/plain",
    };
    if (connection.folderId) metadata["parents"] = [connection.folderId];

    const boundary = `billy${Math.random().toString(36).slice(2)}`;
    const multipart =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n` +
      `${content}\r\n--${boundary}--`;

    const res = await callAsAppUser({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectionAPIKey: connection.connectionKey,
      connectorId: DRIVE_CONNECTOR_ID,
      path: "/upload/drive/v3/files?uploadType=multipart&fields=id",
      requiredScopes: DRIVE_SCOPES,
      init: {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body: multipart,
      },
    });

    if (!res.ok) {
      console.error(`[billy] Drive mirror failed [${res.status}]: ${await res.text()}`);
      return false;
    }

    const file = (await res.json()) as { id?: string };
    if (file.id) {
      const table = kind === "thought" ? "thoughts" : "tasks";
      await ctx.supabase.from(table).update({ drive_file_id: file.id }).eq("id", recordId);
    }
    return true;
  } catch (error) {
    console.error("[billy] Drive mirror error", error);
    return false;
  }
}
