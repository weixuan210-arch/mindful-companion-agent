import { createFileRoute } from "@tanstack/react-router";

const MAX_REQUEST_BYTES = 15 * 1024 * 1024; // headroom above the 14 MB Gemini file cap

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireUser } = await import("@/lib/request-user.server");
        if (!(await requireUser(request))) return new Response("Unauthorized", { status: 401 });

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

        // Local Whisper (OpenAI-style /v1/audio/transcriptions) when LOCAL_STT_URL is set.
        const localUrl = process.env["LOCAL_STT_URL"];
        if (localUrl) {
          const out = new FormData();
          out.append("file", file, file.name);
          out.append("model", process.env["LOCAL_STT_MODEL"] ?? "whisper-1");
          out.append("response_format", "json");
          const upstream = await fetch(localUrl, {
            method: "POST",
            body: out,
            signal: request.signal,
          }).catch(() => null);
          if (!upstream) return new Response("Local transcription server unreachable", { status: 502 });
          if (!upstream.ok) return new Response(await upstream.text(), { status: upstream.status });
          const json = (await upstream.json().catch(() => ({}))) as { text?: string };
          return Response.json({ text: json.text ?? "" });
        }

        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

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
