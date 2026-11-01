/**
 * Studio hubs: Audio, Video tools and Upscale group several studios, one path per mode
 * (/audio/music, /video-tools/join, /upscale/video, /upscale/fps). The hub's own path is its first mode.
 * Pure data (client and server). Old `/audio?mode=music` links redirect in src/proxy.ts (hubModeLink).
 */
export type HubKind = "audio" | "video-tools" | "upscale";

export const HUB_MODES: Record<HubKind, { id: string; label: string }[]> = {
  upscale: [
    { id: "image", label: "Image" },
    { id: "video", label: "Video" },
    { id: "fps", label: "FPS Boost" },
    { id: "hdr", label: "SDR to HDR" },
    { id: "export", label: "Export" },
  ],
  audio: [
    { id: "speech", label: "Speech" },
    { id: "dialogue", label: "Dialogue" },
    { id: "voice-change", label: "Voice change" },
    { id: "translate", label: "Translate" },
    { id: "transcribe", label: "Transcribe" },
    { id: "split", label: "Split soundtrack" },
    { id: "sfx", label: "Sound effects" },
    { id: "music", label: "Music" },
    { id: "loop", label: "Loop / extend" },
    { id: "join", label: "Join" },
    { id: "video", label: "Sound for video" },
  ],
  "video-tools": [
    { id: "matte", label: "Remove background" },
    { id: "remove-object", label: "Remove object" },
    { id: "evolution", label: "Evolution" },
    { id: "relight", label: "Relight" },
    { id: "depth", label: "Depth map" },
    { id: "captions", label: "Captions" },
    { id: "trim", label: "Trim" },
    { id: "join", label: "Join clips" },
    { id: "colors", label: "Match colors" },
  ],
};

/** The URL of one mode: the hub itself for the first one, else /<hub>/<mode>. */
export function modeHref(kind: HubKind, mode: string, query?: Record<string, string>): string {
  const path = HUB_MODES[kind][0].id === mode ? `/${kind}` : `/${kind}/${mode}`;
  const q = query ? new URLSearchParams(query).toString() : "";
  return q ? `${path}?${q}` : path;
}
