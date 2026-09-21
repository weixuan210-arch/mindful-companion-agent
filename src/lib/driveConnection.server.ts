// Server-only storage for each person's own Google Drive connection.
const CONNECTOR_ID = "google_drive";

export type DriveConnection = { connectionKey: string; folderId: string | null };

export async function getDriveConnection(userId: string): Promise<DriveConnection | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptConnectionKey } = await import("@/lib/connectionKeyCrypto.server");

    const { data, error } = await supabaseAdmin
      .from("app_user_connections")
      .select("connection_key_ciphertext, folder_id")
      .eq("user_id", userId)
      .eq("connector_id", CONNECTOR_ID)
      .maybeSingle();

    if (error || !data) return null;
    return {
      connectionKey: decryptConnectionKey(data.connection_key_ciphertext),
      folderId: data.folder_id ?? null,
    };
  } catch (error) {
    console.error("[billy] could not load Drive connection", error);
    return null;
  }
}

export async function saveDriveConnection(
  userId: string,
  connectionKey: string,
  folderId: string | null,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { encryptConnectionKey } = await import("@/lib/connectionKeyCrypto.server");

  const { error } = await supabaseAdmin.from("app_user_connections").upsert(
    {
      user_id: userId,
      connector_id: CONNECTOR_ID,
      connection_key_ciphertext: encryptConnectionKey(connectionKey),
      folder_id: folderId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,connector_id" },
  );
  if (error) throw error;
}

export async function deleteDriveConnection(userId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("app_user_connections")
    .delete()
    .eq("user_id", userId)
    .eq("connector_id", CONNECTOR_ID);
}
