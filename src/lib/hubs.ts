/**
 * Studio hubs: Audio, Video tools and Upscale group several studios, one path per mode
 * (/audio/music, /video-tools/join, /upscale/video, /upscale/fps). The hub's own path is its first mode.
 * Pure data (client and server). Old `/audio?mode=music` links redirect in src/proxy.ts (hubModeLink).
 */
export type HubKind = "audio" | "video-tools" | "upscale";

export interface HubMode {
  id: string;
  label: string;
  /**
   * A mode a guest or an account doesn't see at all (its tab is left out for them). A tool that runs on a self-hosted
   * Fuobe only keeps its tab, and its page says up front that it isn't available here.
   */
  ownerOnly?: true;
  /** The mode's tool runs on a self-hosted Fuobe only: the hub's engine badge says so to anyone but the owner (EngineSwitch). */
  selfHostedOnly?: true;
}

export const HUB_TITLE: Record<HubKind, string> = { upscale: "Upscale", audio: "Audio", "video-tools": "Video tools" };

export const HUB_MODES: Record<HubKind, HubMode[]> = {
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
    { id: "design", label: "Design a voice" },
    { id: "translate", label: "Translate", selfHostedOnly: true },
    { id: "transcribe", label: "Transcribe" },
    { id: "clean", label: "Clean up voice" },
    { id: "split", label: "Split soundtrack", selfHostedOnly: true },
    { id: "sfx", label: "Sound effects" },
    { id: "music", label: "Music" },
    { id: "loop", label: "Loop / extend" },
    { id: "join", label: "Join" },
    { id: "video", label: "Sound for video" },
  ],
  "video-tools": [
    { id: "matte", label: "Remove background" },
    { id: "remove-object", label: "Remove object", selfHostedOnly: true },
    { id: "remove-dialogue", label: "Remove dialogue", selfHostedOnly: true },
    { id: "evolution", label: "Evolution", selfHostedOnly: true },
    { id: "restore", label: "Restore & colourise", ownerOnly: true, selfHostedOnly: true },
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

/** The hub a path belongs to (/audio, /audio/music…), if any. */
export function hubOfPath(pathname: string): HubKind | undefined {
  const first = pathname.split(/[?#]/)[0].split("/")[1];
  return (Object.keys(HUB_MODES) as HubKind[]).find((k) => k === first);
}

/** The mode a hub path shows: /audio is the first mode, /audio/music is Music. Undefined outside the hub or for an unknown mode. */
export function modeOfPath(kind: HubKind, pathname: string): string | undefined {
  const parts = pathname.split(/[?#]/)[0].split("/").filter(Boolean);
  if (parts[0] !== kind || parts.length > 2) return undefined;
  const id = parts[1] ?? HUB_MODES[kind][0].id;
  return HUB_MODES[kind].some((m) => m.id === id) ? id : undefined;
}
