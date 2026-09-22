import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  completeCalendarConnection,
  disconnectCalendar,
  getCalendarStatus,
  startCalendarConnect,
} from "@/lib/calendar.functions";

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
        (event.data as { connectorId?: string })?.connectorId !== "google_calendar" ||
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

export function CalendarCard({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const status = useServerFn(getCalendarStatus);
  const start = useServerFn(startCalendarConnect);
  const complete = useServerFn(completeCalendarConnection);
  const disconnect = useServerFn(disconnectCalendar);

  const statusQuery = useQuery({
    queryKey: ["calendar-status", userId],
    queryFn: () => status(),
  });

  const connect = useMutation({
    mutationFn: async () => {
      const popup = window.open("", "billy-google-calendar", "width=600,height=720");
      if (!popup) {
        throw new Error("Your browser blocked the Google window. Allow pop-ups and retry.");
      }
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
      return { ok: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-status", userId] });
      queryClient.invalidateQueries({ queryKey: ["calendar-events", userId] });
      toast.success("Google Calendar connected — Billy can see your day and add events.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const unlink = useMutation({
    mutationFn: () => disconnect(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-status", userId] });
      queryClient.invalidateQueries({ queryKey: ["calendar-events", userId] });
      toast.success("Google Calendar disconnected. Your events stay where they are.");
    },
    onError: () => toast.error("Couldn't disconnect just now."),
  });

  const data = statusQuery.data;
  const busy = connect.isPending || unlink.isPending;
  const connected = data?.connected === true && data?.reconnectRequired !== true;

  return (
    <section className="paper-card p-4">
      <h2 className="text-sm font-medium">Your Google Calendar</h2>

      {statusQuery.isLoading ? (
        <p className="mt-2 text-xs text-muted-foreground">Checking...</p>
      ) : connected ? (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            Billy can talk through your day and add events
            {data?.email ? ` to ${data.email}` : ""}.
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
              ? "Your calendar access needs to be renewed."
              : "Let Billy see what's on today and put new plans straight on your calendar."}
          </p>
          <Button size="sm" className="mt-3" disabled={busy} onClick={() => connect.mutate()}>
            {busy
              ? "Opening Google..."
              : data?.reconnectRequired
                ? "Reconnect Google Calendar"
                : "Connect Google Calendar"}
          </Button>
        </>
      )}
    </section>
  );
}
