// Browser-safe voice helpers: record the mic as WAV, stream transcripts,
// and play Billy's spoken replies (24 kHz PCM over SSE).
import { createParser } from "eventsource-parser";

import { supabase } from "@/integrations/supabase/client";

async function authHeaders(): Promise<Headers> {
  const { data } = await supabase.auth.getSession();
  const headers = new Headers();
  if (data.session?.access_token) {
    headers.set("Authorization", `Bearer ${data.session.access_token}`);
  }
  return headers;
}

// ---------- Recording ----------

export function encodeWav(chunks: readonly Float32Array[], sampleRate: number): Blob {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new ArrayBuffer(44 + length * 2);
  const view = new DataView(bytes);
  const tag = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const chunk of chunks)
    for (const value of chunk) {
      const sample = Math.max(-1, Math.min(1, value));
      view.setInt16(offset, sample * (sample < 0 ? 32768 : 32767), true);
      offset += 2;
    }
  return new Blob([bytes], { type: "audio/wav" });
}

export type Recorder = { stop: () => Promise<File> };

export async function recordWav(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  let context: AudioContext | undefined;
  try {
    context = new AudioContext();
    await context.resume();
    const audioContext = context;
    const source = audioContext.createMediaStreamSource(stream);
    const node = audioContext.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    node.onaudioprocess = (event) =>
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    source.connect(node);
    node.connect(audioContext.destination);
    let stopped = false;
    return {
      async stop() {
        if (stopped) throw new Error("Recording already stopped");
        stopped = true;
        stream.getTracks().forEach((track) => track.stop());
        node.disconnect();
        source.disconnect();
        node.onaudioprocess = null;
        const blob = encodeWav(chunks, audioContext.sampleRate);
        await audioContext.close();
        if (blob.size < 2048) throw new Error("That was too short — try again.");
        return new File([blob], "recording.wav", { type: "audio/wav" });
      },
    };
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    await context?.close();
    throw error;
  }
}

// ---------- Transcription ----------

export async function transcribeRecording(file: File): Promise<string> {
  const headers = await authHeaders();
  const form = new FormData();
  form.append("file", file, file.name);
  const response = await fetch("/api/transcribe", {
    method: "POST",
    headers,
    body: form,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Couldn't hear that (${response.status}). Try again?`);
  }
  // Local Whisper replies with plain JSON rather than a stream.
  if (response.headers.get("Content-Type")?.includes("application/json")) {
    const json = (await response.json()) as { text?: string };
    const text = (json.text ?? "").trim();
    if (!text) throw new Error("Billy couldn't make out any words — try again?");
    return text;
  }


  let finalText = "";
  let streamed = "";
  let completed = false;
  const parser = createParser({
    onEvent(event) {
      const payload = JSON.parse(event.data) as {
        type?: string;
        delta?: string;
        text?: string;
        error?: unknown;
      };
      if (payload.type === "error" || payload.error) {
        throw new Error(`Transcription failed: ${event.data}`);
      }
      if (payload.type === "transcript.text.delta" && payload.delta) streamed += payload.delta;
      if (payload.type === "transcript.text.done") {
        completed = true;
        finalText = payload.text ?? streamed;
      }
    },
  });
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      parser.feed(next.value);
    }
    parser.reset({ consume: true });
  } finally {
    reader.releaseLock();
  }
  const text = (finalText || streamed).trim();
  if (!completed && !text) throw new Error("The transcript came back empty. Try again?");
  if (!text) throw new Error("Billy couldn't make out any words — try again?");
  return text;
}

// ---------- Speech playback ----------

function decodePCM(pending: Uint8Array, incoming: Uint8Array) {
  const bytes = new Uint8Array(pending.length + incoming.length);
  bytes.set(pending);
  bytes.set(incoming, pending.length);
  const usable = bytes.length - (bytes.length % 2);
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(usable / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
  return { samples, pending: bytes.slice(usable) };
}

// Split into speakable chunks so synthesis can start on a few words instead of
// the whole message. The first chunk stays short for the fastest possible start.
function splitForSpeech(text: string): string[] {
  const pieces = text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((piece) => piece.trim())
    .filter(Boolean);
  if (!pieces.length) return [];
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const limit = chunks.length === 0 ? 90 : 220;
    if (!current) {
      current = piece;
    } else if (current.length + piece.length + 1 <= limit) {
      current = `${current} ${piece}`;
    } else {
      chunks.push(current);
      current = piece;
    }
    if (current.length >= limit) {
      chunks.push(current);
      current = "";
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function streamSpeech(text: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const chunks = splitForSpeech(text);
  if (!chunks.length) return;

  const context = new AudioContext({ sampleRate: 24000 });
  const sources = new Set<AudioBufferSourceNode>();
  let playhead = 0;
  let playback: Promise<void> = Promise.resolve();
  const controller = new AbortController();
  const abort = () => {
    controller.abort(signal?.reason);
    for (const source of sources) source.stop();
  };
  signal?.addEventListener("abort", abort, { once: true });

  const schedule = (buffer: AudioBuffer) => {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    sources.add(source);
    playback = new Promise<void>((resolve) => {
      source.onended = () => {
        sources.delete(source);
        resolve();
      };
    });
    playhead = Math.max(playhead, context.currentTime + 0.05);
    source.start(playhead);
    playhead += buffer.duration;
  };

  const request = async (chunk: string) => {
    const headers = await authHeaders();
    headers.set("Content-Type", "application/json");
    return fetch("/api/speech", {
      method: "POST",
      headers,
      body: JSON.stringify({ text: chunk }),
      signal: controller.signal,
    });
  };

  try {
    if (context.state === "suspended") await context.resume();
    // Kick off the first chunk immediately; later chunks are fetched while
    // earlier audio is still playing so playback never waits on synthesis.
    let inflight = request(chunks[0]!);
    for (let index = 0; index < chunks.length; index++) {
      const response = await inflight;
      if (index + 1 < chunks.length) inflight = request(chunks[index + 1]!);
      if (!response.ok || !response.body) {
        throw new Error(`Billy lost his voice (${response.status}). Try again?`);
      }

      // Local Kokoro returns a complete audio file per chunk.
      if (response.headers.get("Content-Type")?.startsWith("audio/")) {
        const audio = await context.decodeAudioData(await response.arrayBuffer());
        signal?.throwIfAborted();
        schedule(audio);
        continue;
      }

      // Cloud voice streams raw PCM deltas over server-sent events.
      let pending = new Uint8Array(0);
      let completed = false;
      let samplesPlayed = 0;
      const parser = createParser({
        onEvent(event) {
          const payload = JSON.parse(event.data) as {
            type: string;
            audio?: string;
            error?: unknown;
          };
          if (payload.type === "error" || payload.error) {
            throw new Error(`Speech failed: ${event.data}`);
          }
          if (payload.type === "speech.audio.done") {
            completed = true;
            return;
          }
          if (payload.type !== "speech.audio.delta") return;
          if (completed || !payload.audio) throw new Error("Invalid speech audio event");
          const decoded = decodePCM(
            pending,
            Uint8Array.from(atob(payload.audio), (c) => c.charCodeAt(0)),
          );
          pending = new Uint8Array(decoded.pending);
          if (!decoded.samples.length) return;
          samplesPlayed += decoded.samples.length;
          const buffer = context.createBuffer(1, decoded.samples.length, 24000);
          buffer.copyToChannel(decoded.samples, 0);
          schedule(buffer);
        },
      });
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          parser.feed(next.value);
        }
        parser.reset({ consume: true });
      } finally {
        reader.releaseLock();
      }
      if (!completed || !samplesPlayed || pending.length) {
        throw new Error("Incomplete speech stream");
      }
    }
    await playback;
    signal?.throwIfAborted();
  } finally {
    signal?.removeEventListener("abort", abort);
    controller.abort();
    for (const source of sources) source.stop();
    await context.close();
  }
}

