import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CALENDAR_CONNECTOR_ID, CALENDAR_SCOPES } from "@/lib/calendarShared";
import { GATEWAY_BASE_URL } from "@/lib/driveShared";

function clientApiKey(): string {
  const key = process.env["GOOGLE_CALENDAR_APP_USER_CONNECTOR_CLIENT_API_KEY"];
  if (!key) throw new Error("GOOGLE_CALENDAR_APP_USER_CONNECTOR_CLIENT_API_KEY is not set");
  return key;
}

/** Is this person's Google Calendar connected, and does it still work? */
export const getCalendarStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getCalendarConnection } = await import("@/lib/calendarConnection.server");
    const connection = await getCalendarConnection(context.userId);
    if (!connection) return { connected: false, reconnectRequired: false, email: null };

    const { calendarAccountEmail } = await import("@/lib/calendar.server");
    const result = await calendarAccountEmail(connection.connectionKey);
    if (!result.ok) {
      return {
        connected: !result.needsReconnect,
        reconnectRequired: result.needsReconnect,
        email: null,
      };
    }
    return { connected: true, reconnectRequired: false, email: result.data };
  });

/** Starts Google consent for the calendar and returns the URL to open in a popup. */
export const startCalendarConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const request = getRequest();
    if (!request) throw new Error("Connecting the calendar must start from an app request.");

    const url = new URL(request.url);
    const sandboxHost =
      url.hostname === "localhost" ? request.headers.get("x-forwarded-host") : null;
    const origin = sandboxHost ? `https://${sandboxHost}` : url.origin;
    const returnUrl = new URL("/oauth/google-calendar/return", origin).toString();

    const { getCalendarConnection } = await import("@/lib/calendarConnection.server");
    const { authorizeAppUserOAuth } = await import("@/integrations/lovable/appUserConnector");

    const existing = await getCalendarConnection(context.userId);

    const { authorizationUrl } = await authorizeAppUserOAuth({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectorId: CALENDAR_CONNECTOR_ID,
      appUserId: context.userId,
      clientAPIKey: clientApiKey(),
      returnUrl,
      ...(existing ? { connectionAPIKey: existing.connectionKey } : {}),
      credentialsConfiguration: { scopes: CALENDAR_SCOPES },
    });

    return { authorizationUrl };
  });

/** Exchanges the one-time code for this person's calendar connection and stores it. */
export const completeCalendarConnection = createServerFn({ method: "POST" })
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
    if (connectorId !== CALENDAR_CONNECTOR_ID) {
      throw new Error("Connection returned the wrong service");
    }
    const { saveCalendarConnection } = await import("@/lib/calendarConnection.server");
    await saveCalendarConnection(context.userId, connectionAPIKey);
    return { connected: true };
  });

/** Disconnects the calendar for this person. */
export const disconnectCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getCalendarConnection, deleteCalendarConnection } = await import(
      "@/lib/calendarConnection.server"
    );
    const connection = await getCalendarConnection(context.userId);
    if (connection) {
      const { disconnectAppUser } = await import("@/integrations/lovable/appUserConnector");
      try {
        await disconnectAppUser({
          gatewayBaseUrl: GATEWAY_BASE_URL,
          connectionAPIKey: connection.connectionKey,
          connectorId: CALENDAR_CONNECTOR_ID,
        });
      } catch (error) {
        console.error("[billy] calendar disconnect failed", error);
      }
    }
    await deleteCalendarConnection(context.userId);
    return { connected: false };
  });

/** Events in a window, for the calendar view. */
export const fetchCalendarEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { from: string; to: string }) => {
    if (!input?.from || !input?.to) throw new Error("A date range is required");
    return { from: input.from, to: input.to };
  })
  .handler(async ({ data, context }) => {
    const { getCalendarConnection } = await import("@/lib/calendarConnection.server");
    const connection = await getCalendarConnection(context.userId);
    if (!connection) return { connected: false, events: [] };

    const { listCalendarEvents } = await import("@/lib/calendar.server");
    const result = await listCalendarEvents(connection.connectionKey, data.from, data.to, 250);
    if (!result.ok) {
      return { connected: !result.needsReconnect, reconnectRequired: result.needsReconnect, events: [] };
    }
    return { connected: true, events: result.data };
  });
