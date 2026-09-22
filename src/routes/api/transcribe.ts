import { createFileRoute } from "@tanstack/react-router";

const MAX_REQUEST_BYTES = 15 * 1024 * 1024; // headroom above the 14 MB Gemini file cap

async function requireUser(request: Request): Promise<boolean> {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return false;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  return !error && !!data.user;
}

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await requireUser(request))) return new Response("Unauthorized", { status: 401 });

        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const declared = Number(request.headers.get("content-length") ?? "0");
        if (declared > MAX_REQUEST_BYTES) {
          return new Response("That recording is too long — keep it under a minute.", {
            status: 413,
          });
        }

        const form = await request.formData().catch(() => null);
        const file = form?.get("file");
        if (!(file instanceof File) || !file.size) {
          return new Response("A recording is required", { status: 400 });
        }

        const { transcribe, BILLY_TRANSCRIPTION } = await import("@/lib/transcribe.server");
        const upstream = await transcribe({ ...BILLY_TRANSCRIPTION, apiKey }, file, {
          signal: request.signal,
        });

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
