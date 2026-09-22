import { createFileRoute } from "@tanstack/react-router";

async function requireUser(request: Request): Promise<boolean> {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return false;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  return !error && !!data.user;
}

export const Route = createFileRoute("/api/speech")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await requireUser(request))) return new Response("Unauthorized", { status: 401 });

        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
        const text = typeof body?.text === "string" ? body.text.trim() : "";
        if (!text) return new Response("Text is required", { status: 400 });

        const { requestSpeech, BILLY_SPEECH } = await import("@/lib/speech.server");
        const spoken = `Say this in a warm, gentle, friendly tone: ${text.slice(0, 4000)}`;
        const upstream = await requestSpeech(
          { ...BILLY_SPEECH, apiKey },
          spoken,
          false,
          request.signal,
        );

        return new Response(upstream.body, {
          status: upstream.status,
          headers: {
            "Content-Type": upstream.headers.get("Content-Type") ?? "text/event-stream",
            "Cache-Control": "no-cache",
          },
        });
      },
    },
  },
});
