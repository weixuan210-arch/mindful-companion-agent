// Mirrors captured thoughts and tasks into the person's own Google Drive.
// No-ops safely when they have not connected Drive yet.
import type { CompanionContext } from "@/lib/companion.server";

const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";
const CONNECTOR_ID = "google_drive";

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

    const lovableApiKey = process.env["LOVABLE_API_KEY"];
    if (!lovableApiKey) return false;

    const name = `billy-${kind}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
    const metadata: Record<string, unknown> = { name, mimeType: "text/plain" };
    if (connection.folderId) metadata["parents"] = [connection.folderId];

    const boundary = `billy${Math.random().toString(36).slice(2)}`;
    const multipart =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n` +
      `${content}\r\n--${boundary}--`;

    const res = await fetch(
      `${GATEWAY_BASE_URL}/api/v1/app-users/proxy/${CONNECTOR_ID}/upload/drive/v3/files?uploadType=multipart`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableApiKey}`,
          "X-Connection-Api-Key": connection.connectionKey,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: multipart,
      },
    );

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
