import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  backfillDrive,
  completeDriveConnection,
  disconnectDrive,
  getDriveStatus,
  startDriveConnect,
} from "@/lib/drive.functions";

function waitForOAuthCompletion(popup: Window) {
  return new Promise<string | null>((resolve, reject) => {
    let poll: number | undefined;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      if (poll !== undefined) window.clearInterval(poll);
    };
    const onMessage = (event: MessageEvent) => {
      const type = (event.data as { type?: string })?.type;
      if (
        event.origin !== window.location.origin ||
        event.source !== popup ||
        (event.data as { connectorId?: string })?.connectorId !== "google_drive" ||
        (type !== "appUserConnectorOAuthComplete" && type !== "appUserConnectorOAuthFailed")
      ) {
        return;
      }
      cleanup();
      if (type === "appUserConnectorOAuthComplete") {
        const code = (event.data as { code?: unknown }).code;
        resolve(typeof code === "string" ? code : null);
        return;
      }
      popup.close();
      reject(new Error("The Google window closed without finishing."));
    };
    window.addEventListener("message", onMessage);
    poll = window.setInterval(() => {
      if (!popup.closed) return;
      cleanup();
      reject(new Error("The Google window was closed before finishing."));
    }, 500);
  });
}

export function DriveCard({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const status = useServerFn(getDriveStatus);
  const start = useServerFn(startDriveConnect);
  const complete = useServerFn(completeDriveConnection);
  const backfill = useServerFn(backfillDrive);
  const disconnect = useServerFn(disconnectDrive);

  const statusQuery = useQuery({
    queryKey: ["drive-status", userId],
    queryFn: () => status(),
  });

  const connect = useMutation({
    mutationFn: async () => {
      const popup = window.open("", "billy-google-drive", "width=600,height=720");
      if (!popup) throw new Error("Your browser blocked the Google window. Allow pop-ups and retry.");
      let code: string | null;
      try {
        const { authorizationUrl } = await start();
        const completion = waitForOAuthCompletion(popup);
        popup.location.href = authorizationUrl;
        code = await completion;
      } catch (error) {
        popup.close();
        throw error;
      }
      if (code) await complete({ data: { code } });
      return backfill();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["drive-status", userId] });
      toast.success(
        result?.copied
          ? `Google Drive connected — ${result.copied} item${result.copied === 1 ? "" : "s"} copied into your Billy folder.`
          : "Google Drive connected. New thoughts and tasks will appear in your Billy folder.",
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const unlink = useMutation({
    mutationFn: () => disconnect(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drive-status", userId] });
      toast.success("Google Drive disconnected. Your files stay where they are.");
    },
    onError: () => toast.error("Couldn't disconnect just now."),
  });

  const data = statusQuery.data;
  const busy = connect.isPending || unlink.isPending;
  const connected = data?.connected === true;

  return (
    <section className="paper-card p-4">
      <h2 className="text-sm font-medium">Your Google Drive</h2>

      {statusQuery.isLoading ? (
        <p className="mt-2 text-xs text-muted-foreground">Checking...</p>
      ) : connected ? (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            Saving a copy of every thought and task to your <strong>Billy</strong> folder
            {data?.email ? ` in ${data.email}` : ""}.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 px-0"
            disabled={busy}
            onClick={() => unlink.mutate()}
          >
            Disconnect
          </Button>
        </>
      ) : (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            {data?.reconnectRequired
              ? "Your Google Drive access needs to be renewed."
              : "Keep your own copy: Billy can save each thought and task as a file in your Drive."}
          </p>
          <Button size="sm" className="mt-3" disabled={busy} onClick={() => connect.mutate()}>
            {busy
              ? "Opening Google..."
              : data?.reconnectRequired
                ? "Reconnect Google Drive"
                : "Connect Google Drive"}
          </Button>
        </>
      )}
    </section>
  );
}
