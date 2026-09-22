// Browser-safe shared constants for the Google Calendar connection.
export const CALENDAR_CONNECTOR_ID = "google_calendar";

export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  // Read the person's calendar and create events on it.
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];
