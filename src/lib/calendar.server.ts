// Server-only Google Calendar access for Billy, on behalf of each person.
import { CALENDAR_CONNECTOR_ID, CALENDAR_SCOPES } from "@/lib/calendarShared";
import { GATEWAY_BASE_URL } from "@/lib/driveShared";

export type CalendarEvent = {
  id: string;
  title: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  location: string | null;
  htmlLink: string | null;
};

type GoogleEvent = {
  id?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

function normalise(event: GoogleEvent): CalendarEvent {
  const allDay = !event.start?.dateTime;
  return {
    id: event.id ?? "",
    title: event.summary ?? "(no title)",
    start: event.start?.dateTime ?? event.start?.date ?? null,
    end: event.end?.dateTime ?? event.end?.date ?? null,
    allDay,
    location: event.location ?? null,
    htmlLink: event.htmlLink ?? null,
  };
}

async function call(connectionKey: string, path: string, init?: RequestInit) {
  const { callAsAppUser } = await import("@/integrations/lovable/appUserConnector");
  return callAsAppUser({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectionAPIKey: connectionKey,
    connectorId: CALENDAR_CONNECTOR_ID,
    path,
    requiredScopes: CALENDAR_SCOPES,
    ...(init ? { init } : {}),
  });
}

export type CalendarResult<T> =
  | { ok: true; data: T }
  | { ok: false; needsReconnect: boolean; message: string };

/** The email address of the connected calendar account. */
export async function calendarAccountEmail(
  connectionKey: string,
): Promise<CalendarResult<string | null>> {
  const res = await call(connectionKey, "/calendar/v3/users/me/calendarList/primary");
  const { appUserReconnectRequired } = await import("@/integrations/lovable/appUserConnector");
  if (await appUserReconnectRequired(res)) {
    return { ok: false, needsReconnect: true, message: "Calendar access needs renewing." };
  }
  if (!res.ok) {
    const text = await res.text();
    console.error(`[billy] calendar lookup failed [${res.status}]: ${text}`);
    return { ok: false, needsReconnect: false, message: `Calendar error ${res.status}` };
  }
  const body = (await res.json()) as { id?: string; summary?: string };
  return { ok: true, data: body.id ?? body.summary ?? null };
}

/** Events between two instants, soonest first. */
export async function listCalendarEvents(
  connectionKey: string,
  timeMin: string,
  timeMax: string,
  maxResults = 50,
): Promise<CalendarResult<CalendarEvent[]>> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(Math.min(Math.max(maxResults, 1), 250)),
  });
  const res = await call(connectionKey, `/calendar/v3/calendars/primary/events?${params}`);
  const { appUserReconnectRequired } = await import("@/integrations/lovable/appUserConnector");
  if (await appUserReconnectRequired(res)) {
    return { ok: false, needsReconnect: true, message: "Calendar access needs renewing." };
  }
  if (!res.ok) {
    const text = await res.text();
    console.error(`[billy] calendar list failed [${res.status}]: ${text}`);
    return { ok: false, needsReconnect: false, message: `Calendar error ${res.status}` };
  }
  const body = (await res.json()) as { items?: GoogleEvent[] };
  return { ok: true, data: (body.items ?? []).map(normalise) };
}

export type NewEvent = {
  title: string;
  description?: string | null;
  location?: string | null;
  /** RFC3339 instant, or YYYY-MM-DD for an all-day event. */
  start: string;
  end: string;
  timeZone: string;
};

/** Creates an event on the person's primary calendar. */
export async function createCalendarEvent(
  connectionKey: string,
  event: NewEvent,
): Promise<CalendarResult<CalendarEvent>> {
  const allDay = !event.start.includes("T");
  const body = {
    summary: event.title,
    ...(event.description ? { description: event.description } : {}),
    ...(event.location ? { location: event.location } : {}),
    start: allDay
      ? { date: event.start }
      : { dateTime: event.start, timeZone: event.timeZone },
    end: allDay ? { date: event.end } : { dateTime: event.end, timeZone: event.timeZone },
  };

  const res = await call(connectionKey, "/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const { appUserReconnectRequired } = await import("@/integrations/lovable/appUserConnector");
  if (await appUserReconnectRequired(res)) {
    return { ok: false, needsReconnect: true, message: "Calendar access needs renewing." };
  }
  if (!res.ok) {
    const text = await res.text();
    console.error(`[billy] calendar create failed [${res.status}]: ${text}`);
    return { ok: false, needsReconnect: false, message: `Calendar error ${res.status}` };
  }
  return { ok: true, data: normalise((await res.json()) as GoogleEvent) };
}
