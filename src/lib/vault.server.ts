// Reads the person's Obsidian vault folder out of their own Google Drive and
// brings new or changed notes into Billy (as thoughts, plus tasks for any
// unchecked checkbox lines), mirroring each one into the Billy folder.
import { callAsAppUser } from "@/integrations/lovable/appUserConnector";
import type { CompanionContext } from "@/lib/companion.server";
import { DRIVE_CONNECTOR_ID, DRIVE_SCOPES, GATEWAY_BASE_URL } from "@/lib/driveShared";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const MAX_FILES = 200;
const MAX_CONTENT = 8000;

type DriveFile = { id: string; name: string; mimeType: string; modifiedTime?: string };

async function driveGet(connectionKey: string, path: string) {
  return callAsAppUser({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectionAPIKey: connectionKey,
    connectorId: DRIVE_CONNECTOR_ID,
    path,
    requiredScopes: DRIVE_SCOPES,
  });
}

export type VaultSyncResult = {
  ok: boolean;
  needsReconnect?: boolean;
  folderMissing?: boolean;
  message?: string;
  notesImported: number;
  tasksCreated: number;
  skipped: number;
};

/** Finds a top-level-ish folder by name anywhere in the person's Drive. */
async function findFolder(connectionKey: string, name: string): Promise<string | null> {
  const escaped = name.replace(/'/g, "\\'");
  const q = encodeURIComponent(
    `name='${escaped}' and mimeType='${FOLDER_MIME}' and trashed=false`,
  );
  const res = await driveGet(connectionKey, `/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=5`);
  if (!res.ok) {
    console.error(`[billy] vault folder lookup failed [${res.status}]: ${await res.text()}`);
    return null;
  }
  const body = (await res.json()) as { files?: { id?: string }[] };
  return body.files?.[0]?.id ?? null;
}

/** Walks the vault folder tree and collects markdown files. */
async function listMarkdown(connectionKey: string, rootId: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  const queue = [rootId];
  const seen = new Set<string>();

  while (queue.length > 0 && files.length < MAX_FILES) {
    const folderId = queue.shift()!;
    if (seen.has(folderId)) continue;
    seen.add(folderId);

    let pageToken: string | undefined;
    do {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
      const page = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
      const res = await driveGet(
        connectionKey,
        `/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,modifiedTime)&pageSize=200${page}`,
      );
      if (!res.ok) {
        console.error(`[billy] vault listing failed [${res.status}]: ${await res.text()}`);
        return files;
      }
      const body = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };
      for (const file of body.files ?? []) {
        if (file.mimeType === FOLDER_MIME) {
          queue.push(file.id);
        } else if (/\.md$/i.test(file.name) || file.mimeType === "text/markdown") {
          files.push(file);
        }
      }
      pageToken = body.nextPageToken;
    } while (pageToken && files.length < MAX_FILES);
  }

  return files.slice(0, MAX_FILES);
}

/** Pulls checkbox lines out of a note: "- [ ] thing" becomes an open task. */
function parseTasks(markdown: string): string[] {
  const titles: string[] = [];
  for (const line of markdown.split("\n")) {
    const match = /^\s*[-*]\s*\[\s\]\s+(.+?)\s*$/.exec(line);
    if (match?.[1]) titles.push(match[1].slice(0, 200));
    if (titles.length >= 20) break;
  }
  return titles;
}

/** Strips YAML frontmatter so the saved thought reads as plain note text. */
function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---")) return markdown;
  const end = markdown.indexOf("\n---", 3);
  return end === -1 ? markdown : markdown.slice(end + 4).replace(/^\s+/, "");
}

export async function syncVaultFolder(
  ctx: CompanionContext,
  folderName: string,
): Promise<VaultSyncResult> {
  const empty = { notesImported: 0, tasksCreated: 0, skipped: 0 };

  const { getDriveConnection } = await import("@/lib/driveConnection.server");
  const connection = await getDriveConnection(ctx.userId);
  if (!connection) {
    return { ok: false, ...empty, message: "Connect your Google Drive first." };
  }

  const { appUserReconnectRequired } = await import("@/integrations/lovable/appUserConnector");

  // A cheap read that fails when the wider read permission hasn't been granted.
  const probe = await driveGet(connection.connectionKey, "/drive/v3/about?fields=user(emailAddress)");
  if (await appUserReconnectRequired(probe)) {
    return { ok: false, needsReconnect: true, ...empty };
  }

  const folderId = await findFolder(connection.connectionKey, folderName);
  if (!folderId) {
    return { ok: false, folderMissing: true, ...empty };
  }

  const notes = await listMarkdown(connection.connectionKey, folderId);
  if (notes.length === 0) {
    return { ok: true, ...empty, message: `No notes found in “${folderName}”.` };
  }

  const { data: known } = await ctx.supabase
    .from("vault_notes")
    .select("source_file_id, modified_time")
    .eq("user_id", ctx.userId);
  const knownMap = new Map((known ?? []).map((r) => [r.source_file_id, r.modified_time]));

  const { mirrorThoughtToDrive, mirrorTaskToDrive } = await import("@/lib/drive.server");

  let notesImported = 0;
  let tasksCreated = 0;
  let skipped = 0;

  for (const note of notes) {
    const previous = knownMap.get(note.id);
    if (
      knownMap.has(note.id) &&
      (!note.modifiedTime ||
        (previous && new Date(previous).getTime() >= new Date(note.modifiedTime).getTime()))
    ) {
      skipped += 1;
      continue;
    }

    const res = await driveGet(connection.connectionKey, `/drive/v3/files/${note.id}?alt=media`);
    if (!res.ok) {
      console.error(`[billy] vault note download failed [${res.status}]: ${await res.text()}`);
      continue;
    }
    const raw = await res.text();
    const title = note.name.replace(/\.md$/i, "");
    const body = stripFrontmatter(raw).trim().slice(0, MAX_CONTENT);
    if (!body) {
      skipped += 1;
      continue;
    }

    const { data: thought, error } = await ctx.supabase
      .from("thoughts")
      .insert({
        user_id: ctx.userId,
        content: `${title}\n\n${body}`,
        tags: ["obsidian", folderName.toLowerCase()],
      })
      .select("id, created_at")
      .maybeSingle();
    if (error || !thought) {
      console.error("[billy] vault note save failed", error);
      continue;
    }
    notesImported += 1;

    await mirrorThoughtToDrive(ctx, thought.id, {
      content: `${title}\n\n${body}`,
      tags: ["obsidian", folderName.toLowerCase()],
      createdAt: thought.created_at,
    });

    for (const taskTitle of parseTasks(raw)) {
      const { data: task } = await ctx.supabase
        .from("tasks")
        .insert({
          user_id: ctx.userId,
          title: taskTitle,
          details: `From your Obsidian note “${title}”.`,
        })
        .select("id, created_at")
        .maybeSingle();
      if (!task) continue;
      tasksCreated += 1;
      await mirrorTaskToDrive(ctx, task.id, {
        title: taskTitle,
        details: `From your Obsidian note “${title}”.`,
        status: "open",
        createdAt: task.created_at,
      });
    }

    await ctx.supabase.from("vault_notes").upsert(
      {
        user_id: ctx.userId,
        source_file_id: note.id,
        name: note.name,
        modified_time: note.modifiedTime ?? null,
        thought_id: thought.id,
      },
      { onConflict: "user_id,source_file_id" },
    );
  }

  return { ok: true, notesImported, tasksCreated, skipped };
}
