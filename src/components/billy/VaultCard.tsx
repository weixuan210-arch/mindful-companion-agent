import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { syncObsidianVault } from "@/lib/drive.functions";
import { VAULT_DEFAULT_FOLDER } from "@/lib/driveShared";

export function VaultCard({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const sync = useServerFn(syncObsidianVault);
  const [folderName, setFolderName] = useState(VAULT_DEFAULT_FOLDER);

  const run = useMutation({
    mutationFn: () => sync({ data: { folderName } }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["tasks", userId] });
      queryClient.invalidateQueries({ queryKey: ["projects", userId] });

      if (result.needsReconnect) {
        toast.error("Billy needs permission to read your vault — reconnect Google Drive above.");
        return;
      }
      if (result.folderMissing) {
        toast.error(`Couldn't find a folder called “${folderName}” in your Drive.`);
        return;
      }
      if (!result.ok) {
        toast.error(result.message ?? "Couldn't read your vault just now.");
        return;
      }
      if (result.notesImported === 0) {
        toast(`Nothing new in “${folderName}” — everything's already with Billy.`);
        return;
      }
      toast.success(
        `Brought in ${result.notesImported} note${result.notesImported === 1 ? "" : "s"}` +
          (result.tasksCreated > 0
            ? ` and ${result.tasksCreated} to-do${result.tasksCreated === 1 ? "" : "s"}.`
            : "."),
      );
    },
    onError: () => toast.error("Couldn't read your vault just now."),
  });

  return (
    <section className="paper-card p-4">
      <h2 className="text-sm font-medium">Your Obsidian vault</h2>
      <p className="mt-2 text-xs text-muted-foreground">
        Billy reads new notes from this folder in your Drive and keeps a copy with your thoughts.
        Checkbox lines become to-dos.
      </p>
      <div className="mt-3 flex gap-2">
        <Input
          value={folderName}
          onChange={(event) => setFolderName(event.target.value)}
          placeholder="Vault folder name"
          aria-label="Vault folder name"
          className="h-9 text-sm"
        />
        <Button size="sm" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? "Reading..." : "Sync"}
        </Button>
      </div>
    </section>
  );
}
