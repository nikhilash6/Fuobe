/**
 * Character Swap Studio's edits: every change the page makes to a project, as pure functions (the server checks the
 * shape, applies them and saves; the tests run them here). Jobs that make something (the 24 fps copy, a transcript,
 * a mask, an anchor, a take, an assembly) are in src/server/swap-studio.ts. Akatz Labs' rules carried over: a new
 * character picture un-approves the anchors made with the old one (the shots' scene anchors and the segments' picked
 * references); editing a segment's words or speaker keeps its prompt as it was (Update prompt rebuilds it,
 * explicitly); a shot layout can't change under a running job.
 */
import { HISTORY_CHOICES, WINDOW_CHOICES, type SwapLora, type SwapWho } from "./character-swap";
import {
  applyLayout,
  buildSegmentPrompt,
  buildShotPrompt,
  currentSegments,
  cutsProblem,
  removeTake,
  segmentPrompt,
  segmentsProblem,
  selectTake,
  shotsFromCuts,
  SWAP_STUDIO,
  tidyCuts,
  updateTake,
  type AnchorMode,
  type Connection,
  type Decision,
  type LayoutOp,
  type RenderMp,
  type ShotMode,
  type SwapClip,
  type SwapProject,
  type SwapRole,
  type SwapSegment,
  type SwapSettings,
  type SwapShot,
  type WhoToSwap,
} from "./swap-studio";
import type { Engine } from "./types";

export interface SegmentPatch {
  prompt?: string;
  performancePrompt?: string | null;
  dialogue?: string | null;
  speaker?: SwapRole | null;
  seed?: number;
  connection?: Connection;
  history?: number;
  anchorMode?: AnchorMode;
  anchor?: string | null;
}

export interface ShotPatch {
  mode?: ShotMode;
  speaker?: SwapRole | null;
  dialogue?: string | null;
  prompt?: string | null;
  who?: Partial<WhoToSwap>;
  settings?: Partial<SwapSettings>;
  anchorInstructions?: string;
  anchorBasePrompt?: string;
  approvedAnchor?: string | null;
  approvedMask?: string | null;
}

export type SwapEdit =
  | { type: "rename"; name: string }
  | { type: "engine"; engine: Engine }
  | { type: "character"; image?: string | null; description?: string }
  | { type: "defaults"; settings: Partial<SwapSettings> }
  | { type: "clip"; clipId: string; name?: string; review?: Decision; reviewNotes?: string }
  | { type: "remove-clip"; clipId: string }
  | { type: "detected"; clipId: string; cuts: number[]; dismiss?: boolean }
  | { type: "cuts"; clipId: string; cuts: number[]; modes?: ShotMode[] }
  | { type: "voices"; clipId: string; voices: Record<string, SwapRole> }
  | { type: "shot"; clipId: string; shotId: string; patch: ShotPatch }
  | { type: "build-prompts"; clipId: string; shotId?: string }
  | { type: "layout"; clipId: string; shotId: string; op: LayoutOp }
  | { type: "segment"; clipId: string; shotId: string; segmentId: string; patch: SegmentPatch }
  | { type: "update-prompt"; clipId: string; shotId: string; segmentId: string }
  | { type: "take"; clipId: string; shotId: string; segmentId: string; takeId: string; select?: boolean; favourite?: boolean; decision?: Decision; notes?: string; remove?: boolean; finishUse?: boolean }
  | { type: "anchor-import"; clipId: string; shotId: string; segmentId?: string; url: string; id: string; at: number }
  | { type: "remove-anchor"; clipId: string; shotId: string; segmentId?: string; anchorId: string }
  | { type: "remove-mask"; clipId: string; shotId: string; maskId: string };

/** An edit the project can't take, with the status the API answers. */
export class EditError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}

const LORAS: SwapLora[] = ["v1.5", "v1", "none"];
const SELECTIONS: SwapWho[] = ["largest", "leftmost", "rightmost", "index"];

/** A settings patch on known values only (unknown values are refused, not dropped). */
export function cleanSettings(patch: Partial<SwapSettings>): Partial<SwapSettings> {
  const out: Partial<SwapSettings> = {};
  if (patch.lora !== undefined) {
    if (!LORAS.includes(patch.lora)) throw new EditError("Choose V1.5, V1 or no swap LoRA");
    out.lora = patch.lora;
  }
  for (const k of ["useAnchor", "useMask"] as const) if (patch[k] !== undefined) out[k] = !!patch[k];
  if (patch.renderMp !== undefined) {
    if (patch.renderMp !== 0.5 && patch.renderMp !== 1) throw new EditError("Choose a render size of 0.5 MP (480) or 1.0 MP (768)");
    out.renderMp = patch.renderMp as RenderMp;
  }
  if (patch.seed !== undefined) {
    if (!Number.isInteger(patch.seed) || patch.seed < 0 || patch.seed > SWAP_STUDIO.maxSeed) throw new EditError("Use a whole-number seed");
    out.seed = patch.seed;
  }
  if (patch.windowFrames !== undefined) {
    if (!WINDOW_CHOICES.includes(patch.windowFrames)) throw new EditError("Choose a diffusion window of 22–362 frames (17n + 5)");
    out.windowFrames = patch.windowFrames;
  }
  if (patch.historyFrames !== undefined) {
    if (!HISTORY_CHOICES.includes(patch.historyFrames)) throw new EditError("Choose a continuation history of 0, 1 or 17n + 1 frames");
    out.historyFrames = patch.historyFrames;
  }
  if (patch.expansion !== undefined) {
    if (!Number.isInteger(patch.expansion) || patch.expansion < 0 || patch.expansion > 256) throw new EditError("Grow the mask by 0–256 pixels");
    out.expansion = patch.expansion;
  }
  if (out.windowFrames !== undefined && out.historyFrames !== undefined && out.historyFrames >= out.windowFrames) throw new EditError("History must be shorter than the window");
  return out;
}

const text = (v: string | null | undefined, max: number, what: string) => {
  if (v == null) return v;
  if (v.length > max) throw new EditError(`Keep the ${what} under ${max.toLocaleString("en-US")} characters`);
  return v;
};

function mustClip(p: SwapProject, id: string): SwapClip {
  const c = p.clips.find((x) => x.id === id);
  if (!c) throw new EditError("That clip is no longer in this project — reload", 404);
  return c;
}
function mustShot(c: SwapClip, id: string): SwapShot {
  const s = c.shots.find((x) => x.id === id);
  if (!s) throw new EditError("That shot changed — reload", 404);
  return s;
}

/** Whether a shot has a take still being made (or waiting to be). */
export function shotBusy(shot: SwapShot, active: (genId: string) => boolean): boolean {
  return (shot.segments ?? []).some((g) => g.takes.some((t) => t.state === "waiting" || (t.state === "launched" && !!t.genId && active(t.genId))));
}

const mapClip = (p: SwapProject, id: string, f: (c: SwapClip) => SwapClip): SwapProject => ({ ...p, clips: p.clips.map((c) => (c.id === id ? f(c) : c)) });
const mapShot = (c: SwapClip, id: string, f: (s: SwapShot) => SwapShot): SwapClip => ({ ...c, shots: c.shots.map((s) => (s.id === id ? f(s) : s)) });

/** The shot's segments made explicit (the default layout becomes its own) with one segment changed. */
function withSegment(shot: SwapShot, segmentId: string, f: (s: SwapSegment, items: SwapSegment[]) => SwapSegment): SwapShot {
  const items = currentSegments(shot).map((s) => ({ ...s }));
  const i = items.findIndex((s) => s.id === segmentId);
  if (i < 0) throw new EditError("That segment changed — reload", 404);
  items[i] = f(items[i], items);
  return { ...shot, segments: items };
}

/**
 * Apply one edit. `active` says whether a generation is still running (a shot layout can't change under a running
 * take). Throws EditError with what to do instead.
 */
export function applyEdit(project: SwapProject, edit: SwapEdit, o: { active: (genId: string) => boolean; rand?: () => number }): SwapProject {
  const p = project;
  switch (edit.type) {
    case "rename": {
      const name = edit.name.trim().slice(0, SWAP_STUDIO.maxNameChars);
      if (!name) throw new EditError("Give the project a name");
      return { ...p, name };
    }
    case "engine":
      return { ...p, engine: edit.engine };
    case "character": {
      const image = edit.image === undefined ? p.character.image : edit.image;
      const description = text(edit.description, SWAP_STUDIO.maxDescriptionChars, "description") ?? p.character.description;
      // Anchors and segment references were made with the old picture: they need approving (picking) again.
      const changed = image !== p.character.image;
      const unpick = (s: SwapShot): SwapShot => ({ ...s, approvedAnchor: null, segments: s.segments?.map((g) => (g.anchor ? { ...g, anchor: null } : g)) ?? null });
      return {
        ...p,
        character: { image, description },
        clips: changed ? p.clips.map((c) => ({ ...c, shots: c.shots.map(unpick) })) : p.clips,
      };
    }
    case "defaults":
      return { ...p, defaults: { ...p.defaults, ...cleanSettings(edit.settings) } };
    case "clip":
      return mapClip(p, edit.clipId, (c) => ({
        ...c,
        ...(edit.name !== undefined ? { name: edit.name.trim().slice(0, SWAP_STUDIO.maxNameChars) || c.name } : {}),
        ...(edit.review !== undefined ? { review: edit.review } : {}),
        ...(edit.reviewNotes !== undefined ? { reviewNotes: text(edit.reviewNotes, SWAP_STUDIO.maxNotesChars, "notes")! } : {}),
      }));
    case "remove-clip": {
      const c = mustClip(p, edit.clipId);
      if (c.shots.some((s) => shotBusy(s, o.active))) throw new EditError("Wait for this clip's takes to finish (or stop them) before removing it", 409);
      return { ...p, clips: p.clips.filter((x) => x.id !== edit.clipId) };
    }
    case "detected": {
      const c = mustClip(p, edit.clipId);
      // Dismissed: nothing waits to be confirmed (an empty list is a finding: "no edits").
      if (edit.dismiss) return mapClip(p, c.id, (x) => ({ ...x, detected: null }));
      const cuts = tidyCuts(edit.cuts.filter((n) => Number.isInteger(n) && n > 0 && n < c.frames));
      return mapClip(p, c.id, (x) => ({ ...x, detected: cuts }));
    }
    case "cuts": {
      const c = mustClip(p, edit.clipId);
      const cuts = tidyCuts(edit.cuts);
      const problem = cutsProblem(cuts, c.frames);
      if (problem) throw new EditError(problem);
      const shots = shotsFromCuts(c, cuts, p.defaults, edit.modes, o.rand);
      if (edit.modes && edit.modes.length !== shots.length) throw new EditError("Choose Replace character or Keep original for each shot");
      const kept = new Set(shots.map((s) => s.id));
      if (c.shots.some((s) => !kept.has(s.id) && shotBusy(s, o.active))) throw new EditError("Wait for the takes of the shots you're changing to finish (or stop them) first", 409);
      return mapClip(p, c.id, (x) => ({ ...x, cuts, shots, detected: null, cutsReviewed: true }));
    }
    case "voices":
      return mapClip(p, edit.clipId, (c) => {
        if (!c.transcript) throw new EditError("Transcribe the clip first");
        return { ...c, transcript: { ...c.transcript, voices: { ...c.transcript.voices, ...edit.voices } } };
      });
    case "shot": {
      const c = mustClip(p, edit.clipId);
      mustShot(c, edit.shotId);
      const x = edit.patch;
      return mapClip(p, c.id, (cl) =>
        mapShot(cl, edit.shotId, (s) => {
          const settings = x.settings ? { ...s.settings, ...cleanSettings(x.settings) } : s.settings;
          if (settings.historyFrames >= settings.windowFrames) throw new EditError("History must be shorter than the window");
          const who = x.who ? { ...s.who, ...x.who } : s.who;
          if (!SELECTIONS.includes(who.selection)) throw new EditError("Pick the largest, leftmost, rightmost or a numbered person");
          if (!Number.isInteger(who.index) || who.index < 0 || who.index > 100) throw new EditError("Person numbers run from 1 to 101");
          who.words = who.words.slice(0, 120);
          if (x.approvedAnchor && !s.anchors.some((a) => a.id === x.approvedAnchor && a.url)) throw new EditError("That anchor isn't ready yet");
          if (x.approvedMask && !s.masks.some((m) => m.id === x.approvedMask && m.pieces.every((pc) => pc.url))) throw new EditError("That mask isn't ready yet");
          if (x.approvedMask && s.masks.find((m) => m.id === x.approvedMask)!.engine !== p.engine) throw new EditError("That mask was made on the other engine — track the shot again here");
          return {
            ...s,
            ...(x.mode ? { mode: x.mode } : {}),
            ...(x.speaker !== undefined ? { speaker: x.speaker } : {}),
            ...(x.dialogue !== undefined ? { dialogue: text(x.dialogue, SWAP_STUDIO.maxPromptChars, "dialogue") ?? null } : {}),
            ...(x.prompt !== undefined ? { prompt: text(x.prompt, SWAP_STUDIO.maxPromptChars, "prompt") ?? null } : {}),
            ...(x.anchorInstructions !== undefined ? { anchorInstructions: text(x.anchorInstructions, SWAP_STUDIO.maxPromptChars, "anchor instructions")! } : {}),
            ...(x.anchorBasePrompt !== undefined ? { anchorBasePrompt: text(x.anchorBasePrompt, SWAP_STUDIO.maxPromptChars, "anchor base prompt")! } : {}),
            ...(x.approvedAnchor !== undefined ? { approvedAnchor: x.approvedAnchor } : {}),
            ...(x.approvedMask !== undefined ? { approvedMask: x.approvedMask } : {}),
            who,
            settings,
          };
        }),
      );
    }
    case "build-prompts": {
      const c = mustClip(p, edit.clipId);
      return mapClip(p, c.id, (cl) => ({
        ...cl,
        shots: cl.shots.map((s) => (s.mode === "generate" && (!edit.shotId || s.id === edit.shotId) ? { ...s, prompt: buildShotPrompt(p, cl, s) } : s)),
      }));
    }
    case "layout": {
      const c = mustClip(p, edit.clipId);
      const s = mustShot(c, edit.shotId);
      if (shotBusy(s, o.active)) throw new EditError("Wait for this shot's takes to finish (or stop them) before changing its segments", 409);
      let items: SwapSegment[];
      try {
        items = applyLayout(s, edit.op, o.rand);
      } catch (e) {
        throw new EditError((e as Error).message);
      }
      return mapClip(p, c.id, (cl) => mapShot(cl, s.id, (x) => ({ ...x, segments: items })));
    }
    case "segment": {
      const c = mustClip(p, edit.clipId);
      const s = mustShot(c, edit.shotId);
      const x = edit.patch;
      const shot = withSegment(s, edit.segmentId, (seg) => {
        const next: SwapSegment = { ...seg, needsReview: false };
        // Words and speaker never rewrite the prompt by themselves: the prompt stays as it reads now.
        if ((x.dialogue !== undefined || x.speaker !== undefined) && x.performancePrompt === undefined) next.performancePrompt = segmentPrompt(p, c, s, seg);
        if (x.prompt !== undefined) next.prompt = text(x.prompt, SWAP_STUDIO.maxPromptChars, "direction")!;
        if (x.performancePrompt !== undefined) next.performancePrompt = text(x.performancePrompt, SWAP_STUDIO.maxPromptChars, "prompt") ?? null;
        if (x.dialogue !== undefined) next.dialogue = text(x.dialogue, SWAP_STUDIO.maxPromptChars, "dialogue") ?? null;
        if (x.speaker !== undefined) next.speaker = x.speaker;
        if (x.seed !== undefined) next.seed = x.seed;
        if (x.connection !== undefined) next.connection = x.connection;
        if (x.history !== undefined) next.history = x.history;
        if (x.anchorMode !== undefined) next.anchorMode = x.anchorMode;
        if (x.anchor !== undefined) {
          if (x.anchor && !seg.anchors.some((a) => a.id === x.anchor && a.url)) throw new EditError("That reference isn't ready yet");
          next.anchor = x.anchor;
        }
        return next;
      });
      const problem = segmentsProblem(shot, shot.segments!);
      if (problem) throw new EditError(problem);
      return mapClip(p, c.id, (cl) => mapShot(cl, s.id, () => shot));
    }
    case "update-prompt": {
      const c = mustClip(p, edit.clipId);
      const s = mustShot(c, edit.shotId);
      const shot = withSegment(s, edit.segmentId, (seg) => ({ ...seg, performancePrompt: buildSegmentPrompt(p, c, s, seg), needsReview: false }));
      return mapClip(p, c.id, (cl) => mapShot(cl, s.id, () => shot));
    }
    case "take": {
      const c = mustClip(p, edit.clipId);
      const s = mustShot(c, edit.shotId);
      const shot = withSegment(s, edit.segmentId, (seg) => {
        try {
          let next = seg;
          if (edit.remove) {
            const t = next.takes.find((k) => k.id === edit.takeId);
            if (t && (t.state === "waiting" || (t.genId && o.active(t.genId)))) throw new Error("Stop the take before removing it");
            return removeTake(next, edit.takeId);
          }
          if (edit.select) next = selectTake(next, edit.takeId);
          // Its sharper version in the assembly (picked after comparing), or the take itself again.
          if (edit.finishUse !== undefined) {
            const t = next.takes.find((k) => k.id === edit.takeId);
            if (!t?.finish) throw new Error("This take has no sharper version — use Sharpen in Assemble");
            next = { ...next, takes: next.takes.map((k) => (k.id === edit.takeId ? { ...k, finish: { ...t.finish!, use: edit.finishUse! } } : k)) };
          }
          const patch = { ...(edit.favourite !== undefined ? { favourite: edit.favourite } : {}), ...(edit.decision ? { decision: edit.decision } : {}), ...(edit.notes !== undefined ? { notes: edit.notes } : {}) };
          return Object.keys(patch).length ? updateTake(next, edit.takeId, patch) : next;
        } catch (e) {
          throw new EditError((e as Error).message);
        }
      });
      return mapClip(p, c.id, (cl) => mapShot(cl, s.id, () => shot));
    }
    case "anchor-import": {
      const c = mustClip(p, edit.clipId);
      const s = mustShot(c, edit.shotId);
      if (!edit.url.startsWith("/api/files/")) throw new EditError("Upload the image first");
      const variant = { id: edit.id, createdAt: edit.at, source: "imported" as const, url: edit.url };
      if (edit.segmentId) {
        const shot = withSegment(s, edit.segmentId, (seg) => {
          if (seg.anchors.length >= SWAP_STUDIO.maxAnchors) throw new EditError(`Keep at most ${SWAP_STUDIO.maxAnchors} references a segment — remove one first`);
          return { ...seg, anchors: [...seg.anchors, variant], anchor: seg.anchor ?? variant.id };
        });
        return mapClip(p, c.id, (cl) => mapShot(cl, s.id, () => shot));
      }
      if (s.anchors.length >= SWAP_STUDIO.maxAnchors) throw new EditError(`Keep at most ${SWAP_STUDIO.maxAnchors} anchors a shot — remove one first`);
      return mapClip(p, c.id, (cl) => mapShot(cl, s.id, (x) => ({ ...x, anchors: [...x.anchors, variant] })));
    }
    case "remove-anchor": {
      const c = mustClip(p, edit.clipId);
      const s = mustShot(c, edit.shotId);
      if (edit.segmentId) {
        const shot = withSegment(s, edit.segmentId, (seg) => ({ ...seg, anchors: seg.anchors.filter((a) => a.id !== edit.anchorId), anchor: seg.anchor === edit.anchorId ? null : seg.anchor }));
        return mapClip(p, c.id, (cl) => mapShot(cl, s.id, () => shot));
      }
      return mapClip(p, c.id, (cl) => mapShot(cl, s.id, (x) => ({ ...x, anchors: x.anchors.filter((a) => a.id !== edit.anchorId), approvedAnchor: x.approvedAnchor === edit.anchorId ? null : x.approvedAnchor })));
    }
    case "remove-mask": {
      const c = mustClip(p, edit.clipId);
      const s = mustShot(c, edit.shotId);
      const m = s.masks.find((x) => x.id === edit.maskId);
      if (m && [m.genId, ...m.pieces.map((x) => x.genId)].some((id) => !!id && o.active(id))) throw new EditError("That mask is still being made");
      return mapClip(p, c.id, (cl) => mapShot(cl, s.id, (x) => ({ ...x, masks: x.masks.filter((v) => v.id !== edit.maskId), approvedMask: x.approvedMask === edit.maskId ? null : x.approvedMask })));
    }
  }
}
