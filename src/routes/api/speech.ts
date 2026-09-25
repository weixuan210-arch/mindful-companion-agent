import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/speech")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireUser } = await import("@/lib/request-user.server");
        if (!(await requireUser(request))) return new Response("Unauthorized", { status: 401 });

        const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
        const text = typeof body?.text === "string" ? body.text.trim() : "";
        if (!text) return new Response("Text is required", { status: 400 });

        const passThrough = (upstream: Response) =>
          new Response(upstream.body, {
            status: upstream.status,
            headers: {
              "Content-Type": upstream.ok
                ? (upstream.headers.get("Content-Type") ?? "audio/wav")
                : "text/plain",
              "Cache-Control": "no-cache",
            },
          });

        // Piper first: tiny, near-instant synthesis on low-power hardware.
        // Its HTTP server takes {"text": "..."} and returns a complete WAV.
        const piperUrl = process.env["LOCAL_PIPER_URL"];
        if (piperUrl) {
          const upstream = await fetch(piperUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: text.slice(0, 4000) }),
            signal: request.signal,
          }).catch(() => null);
          if (upstream?.ok) return passThrough(upstream);
          // Otherwise fall through to Kokoro / cloud below.
        }

        // Local Kokoro (OpenAI-style /v1/audio/speech) when LOCAL_TTS_URL is set.
        const localUrl = process.env["LOCAL_TTS_URL"];
        if (localUrl) {
          const upstream = await fetch(localUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: process.env["LOCAL_TTS_MODEL"] ?? "kokoro",
              input: text.slice(0, 4000),
              voice: process.env["LOCAL_TTS_VOICE"] ?? "af_heart",
              response_format: "wav",
            }),
            signal: request.signal,
          }).catch(() => null);
          if (!upstream) return new Response("Local voice server unreachable", { status: 502 });
          return passThrough(upstream);
        }


        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

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
