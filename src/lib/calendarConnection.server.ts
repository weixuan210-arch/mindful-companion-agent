// Server-only storage for each person's own Google Calendar connection.
const CONNECTOR_ID = "google_calendar";

export type CalendarConnection = { connectionKey: string };

export async function getCalendarConnection(userId: string): Promise<CalendarConnection | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptConnectionKey } = await import("@/lib/connectionKeyCrypto.server");

    const { data, error } = await supabaseAdmin
      .from("app_user_connections")
      .select("connection_key_ciphertext")
      .eq("user_id", userId)
      .eq("connector_id", CONNECTOR_ID)
      .maybeSingle();

    if (error || !data) return null;
    return { connectionKey: decryptConnectionKey(data.connection_key_ciphertext) };
  } catch (error) {
    console.error("[billy] could not load Calendar connection", error);
    return null;
  }
}

export async function saveCalendarConnection(
  userId: string,
  connectionKey: string,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { encryptConnectionKey } = await import("@/lib/connectionKeyCrypto.server");

  const { error } = await supabaseAdmin.from("app_user_connections").upsert(
    {
      user_id: userId,
      connector_id: CONNECTOR_ID,
      connection_key_ciphertext: encryptConnectionKey(connectionKey),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,connector_id" },
  );
  if (error) throw error;
}

export async function deleteCalendarConnection(userId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("app_user_connections")
    .delete()
    .eq("user_id", userId)
    .eq("connector_id", CONNECTOR_ID);
}
