import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  AUDIO_STUDIO,
  DIALOGUE_STUDIO,
  FOLEY_STUDIO,
  FPS_BOOST_STUDIO,
  JOIN_CLIPS_STUDIO,
  MUSIC_STUDIO,
  SDR_TO_HDR_STUDIO,
  SFX_STUDIO,
  SONG_TOOLS_STUDIO,
  TRANSCRIBE_STUDIO,
  TRANSLATE_STUDIO,
  UPSCALE_STUDIO,
  VIDEO_COLOR_MATCH_STUDIO,
  VIDEO_DEPTH_STUDIO,
  VIDEO_EXPORT_STUDIO,
  VIDEO_MATTE_STUDIO,
  VIDEO_RELIGHT_STUDIO,
  VIDEO_UPSCALE_STUDIO,
  VOICE_CHANGE_STUDIO,
} from "@/lib/studios";
import { studioCatalog } from "@/lib/studio-catalog";
import { HUB_MODES, modeHref, type HubKind } from "@/lib/hubs";
import { CaptionsStudio } from "@/components/captions/captions-studio";
import { DubStudio } from "@/components/dub/dub-studio";
import { TrimTool } from "@/components/av/trim-tool";
import { RemoveObjectTool } from "@/components/remove-object/remove-object-tool";
import { EvolutionTool } from "@/components/evolution/evolution-tool";
import { RestoreTool } from "@/components/restore/restore-tool";
import { AudioJoinTool, AudioLoopTool } from "@/components/audio-tools/audio-tools";
import { SplitSoundtrackTool } from "@/components/audio-tools/split-tool";
import { RemoveDialogueTool } from "@/components/audio-tools/remove-dialogue-tool";
import { CleanVoiceTool } from "@/components/audio-tools/clean-voice-tool";
import { DesignVoiceTool } from "@/components/audio-tools/design-voice-tool";
import { SpeechEditTool } from "@/components/audio-tools/speech-edit-tool";
import { ModeStudio, ModeTabs } from "./mode-studio";
import type { StudioConfig } from "./studio-context";

const CONFIGS: Record<HubKind, Record<string, StudioConfig>> = {
  upscale: { image: UPSCALE_STUDIO, video: VIDEO_UPSCALE_STUDIO, fps: FPS_BOOST_STUDIO, hdr: SDR_TO_HDR_STUDIO, export: VIDEO_EXPORT_STUDIO },
  audio: {
    speech: AUDIO_STUDIO,
    dialogue: DIALOGUE_STUDIO,
    "voice-change": VOICE_CHANGE_STUDIO,
    translate: TRANSLATE_STUDIO,
    transcribe: TRANSCRIBE_STUDIO,
    sfx: SFX_STUDIO,
    music: MUSIC_STUDIO,
    song: SONG_TOOLS_STUDIO,
    video: FOLEY_STUDIO,
  },
  "video-tools": {
    matte: VIDEO_MATTE_STUDIO,
    relight: VIDEO_RELIGHT_STUDIO,
    depth: VIDEO_DEPTH_STUDIO,
    join: JOIN_CLIPS_STUDIO,
    colors: VIDEO_COLOR_MATCH_STUDIO,
  },
};

/** Modes that are their own tool rather than a composer studio (Translate & dub, Loop / extend, Join, Split soundtrack, Clean up voice, Design a voice, Edit speech, Remove object, Remove dialogue, Evolution, Restore & colourise, Captions, Trim). */
const TOOLS: Partial<Record<HubKind, Record<string, (p: { tabs: React.ReactNode }) => React.ReactNode>>> = {
  audio: {
    translate: ({ tabs }) => <DubStudio tabs={tabs} />,
    loop: ({ tabs }) => <AudioLoopTool tabs={tabs} />,
    join: ({ tabs }) => <AudioJoinTool tabs={tabs} />,
    split: ({ tabs }) => <SplitSoundtrackTool tabs={tabs} />,
    clean: ({ tabs }) => <CleanVoiceTool tabs={tabs} />,
    design: ({ tabs }) => <DesignVoiceTool tabs={tabs} />,
    "edit-speech": ({ tabs }) => <SpeechEditTool tabs={tabs} />,
  },
  "video-tools": {
    "remove-object": ({ tabs }) => <RemoveObjectTool tabs={tabs} />,
    "remove-person": ({ tabs }) => <RemoveObjectTool tabs={tabs} person />,
    "remove-dialogue": ({ tabs }) => <RemoveDialogueTool tabs={tabs} />,
    evolution: ({ tabs }) => <EvolutionTool tabs={tabs} />,
    restore: ({ tabs }) => <RestoreTool tabs={tabs} />,
    captions: ({ tabs }) => <CaptionsStudio tabs={tabs} />,
    trim: ({ tabs }) => <TrimTool tabs={tabs} />,
  },
};

const HUB_TITLE: Record<HubKind, string> = { upscale: "Upscale", audio: "Audio", "video-tools": "Video tools" };

/**
 * A hub of studios with one path per mode (Audio → /audio/music, Video tools, Upscale). Server
 * component: the page is prerendered with that mode's hero, tabs and composer, and ships only
 * that mode's models. `mode` omitted = the first mode (the hub's own URL).
 */
export function ModeSwitchStudio({ kind, mode }: { kind: HubKind; mode?: string }) {
  const current = mode ?? HUB_MODES[kind][0].id;
  const tabs = HUB_MODES[kind].map((m) => ({ id: m.id, label: m.label, href: modeHref(kind, m.id) }));
  const Tool = TOOLS[kind]?.[current];
  if (Tool) return <Tool tabs={<ModeTabs tabs={tabs} current={current} />} />;
  const config = CONFIGS[kind][current];
  if (!config) notFound();
  return <ModeStudio key={current} tabs={tabs} current={current} config={config} catalog={studioCatalog(config)} />;
}

/** `generateStaticParams` for /<hub>/[mode]: every mode is prerendered. */
export function hubParams(kind: HubKind): { mode: string }[] {
  return HUB_MODES[kind].map((m) => ({ mode: m.id }));
}

export function hubMetadata(kind: HubKind, mode: string): Metadata {
  const m = HUB_MODES[kind].find((x) => x.id === mode);
  return { title: !m || m.id === HUB_MODES[kind][0].id ? HUB_TITLE[kind] : `${m.label} · ${HUB_TITLE[kind]}` };
}

/** The /<hub>/[mode] page body. */
export function HubModePage({ kind, params }: { kind: HubKind; params: Promise<{ mode: string }> }) {
  return <Suspense fallback={null}>{params.then(({ mode }) => <ModeSwitchStudio kind={kind} mode={mode} />)}</Suspense>;
}
