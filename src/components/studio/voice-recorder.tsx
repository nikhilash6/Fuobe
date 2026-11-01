"use client";

import { Loader2, Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { uploadFile, useAskBeforeUpload } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import type { SlotValue } from "./media-slot";

/** Decode any recording the browser made and re-encode it as 16-bit mono WAV — every voice API takes WAV. */
export async function toWav(blob: Blob): Promise<File> {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const rate = buf.sampleRate;
    const mono = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels;
    }
    const out = new DataView(new ArrayBuffer(44 + mono.length * 2));
    const str = (o: number, s: string) => [...s].forEach((ch, i) => out.setUint8(o + i, ch.charCodeAt(0)));
    str(0, "RIFF");
    out.setUint32(4, 36 + mono.length * 2, true);
    str(8, "WAVEfmt ");
    out.setUint32(16, 16, true);
    out.setUint16(20, 1, true);
    out.setUint16(22, 1, true);
    out.setUint32(24, rate, true);
    out.setUint32(28, rate * 2, true);
    out.setUint16(32, 2, true);
    out.setUint16(34, 16, true);
    str(36, "data");
    out.setUint32(40, mono.length * 2, true);
    mono.forEach((v, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
    return new File([out.buffer], `recording-${Date.now()}.wav`, { type: "audio/wav" });
  } finally {
    void ctx.close();
  }
}

/** Mic button: record a voice sample, convert it to WAV and upload it. Whoever the upload would refuse is asked first. */
export function VoiceRecorder({ onRecorded, max = 60, className }: { onRecorded: (v: SlotValue) => void; max?: number; className?: string }) {
  const [state, setState] = useState<"idle" | "recording" | "saving">("idle");
  const [secs, setSecs] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      rec.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const stop = () => rec.current?.state === "recording" && rec.current.stop();
  // A guest, or an account with neither its own GPU nor its own key, gets its card before the microphone: the sample would be refused.
  const askFirst = useAskBeforeUpload();

  const start = async () => {
    if (askFirst()) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      toast.error("Fuobe needs microphone access to record — allow it in your browser, or upload a file instead.");
      return;
    }
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream);
    rec.current = r;
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      if (timer.current) clearInterval(timer.current);
      stream.getTracks().forEach((t) => t.stop());
      setState("saving");
      try {
        const file = await toWav(new Blob(chunks, { type: r.mimeType }));
        const asset = await uploadFile(file);
        onRecorded({ ref: asset.url, preview: asset.url, kind: "audio", name: "Recording" });
      } catch (e) {
        toastError(e, "Couldn't save the recording");
      } finally {
        setState("idle");
      }
    };
    r.start();
    setSecs(0);
    setState("recording");
    let elapsed = 0;
    timer.current = setInterval(() => {
      elapsed += 1;
      setSecs(elapsed);
      if (elapsed >= max) stop();
    }, 1000);
  };

  return (
    <button
      type="button"
      onClick={state === "recording" ? stop : start}
      disabled={state === "saving"}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors",
        state === "recording" ? "bg-destructive text-white" : "bg-secondary text-secondary-foreground hover:bg-accent",
        className,
      )}
    >
      {state === "saving" ? <Loader2 className="size-3.5 animate-spin" /> : state === "recording" ? <Square className="size-3 fill-current" /> : <Mic className="size-3.5" />}
      {state === "recording" ? `Stop · 0:${String(secs).padStart(2, "0")}` : state === "saving" ? "Saving…" : "Record"}
    </button>
  );
}
