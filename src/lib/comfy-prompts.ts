/**
 * Words for a ComfyUI run that came without any. A graph's own prompt text is its template's sample ("Cartoon character
 * lost" in an empty white room, "The man is playing the guitar"), so a run must never keep it: each graph that can run
 * without words gets Fuobe's own line here, and motion transfer always describes the character from the photo.
 */
import { offlineRestorePrompt } from "./catalog/restore";

/** Who the clip's moves go to: the person in the character photo, as photographed. */
export const MOTION_CHARACTER = "The person from the reference picture, with their own face, hair, body and complete outfit";
/** Where they are: the photo's own setting (Wan Animate 2 draws the background from the reference picture). */
export const MOTION_SETTING = "The setting, background and light of the reference picture";

const tidy = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The motion-transfer graphs whose prompt describes the character (a character photo and a driving clip). */
export const MOTION_GRAPHS: ReadonlySet<string> = new Set(["wan-animate2", "wan22-fun-control-14b"]);

/**
 * Motion transfer's prompt: the character from the photo, in the photo's setting, moving as the person in the driving
 * clip does, then the user's own words. Wan Animate 2 reads it in its template's two labelled lines; words already
 * written in that form go as typed.
 */
export function motionTransferPrompt(graph: string, words?: string): string {
  const typed = (words ?? "").trim();
  const said = tidy(words);
  if (graph === "wan-animate2") {
    if (/^\s*(character|background) description\s*:/im.test(typed)) return typed;
    return `Character Description: ${MOTION_CHARACTER}${said ? `. ${cap(said)}` : ""}.\nBackground description: ${MOTION_SETTING}.`;
  }
  return `${MOTION_CHARACTER}, moves exactly like the person in the driving video, in the setting and light of the reference picture.${said ? ` ${cap(said)}.` : ""}`;
}

/** Fuobe's neutral line for each graph that runs without words (its op is promptless, or its model's prompt optional). */
const NEUTRAL: Record<string, () => string> = {
  // A talking avatar from a voice (Wan 2.2 S2V), as InfiniteTalk's graphs say it.
  "wan22-s2v-14b": () => "A person is talking to the camera.",
  // A new aspect ratio: the padding becomes more of the same shot.
  "video-reframe-wan22-fun-vace": () => "The same scene continues naturally beyond the frame edges, with the same light, perspective and motion.",
  // Sound for a clip: what the picture shows, in sync.
  "v2a-hunyuan-foley": () => "The natural sounds of what happens in the video, in sync with the picture.",
  // Restore & colourise with no words about the scene: the offline writer's generic card.
  "video-restore-ltx25-tiled": () => offlineRestorePrompt().prompt,
};

/** The words a graph runs with when the run gives none (undefined: the graph's own text is already Fuobe's). */
export function neutralPrompt(graph: string): string | undefined {
  return NEUTRAL[graph]?.();
}

/** A graph that needs words to know what to do (no neutral line fits): refused without them. */
export const WORDS_NEEDED: Record<string, string> = {
  "layers-qwen-image-layered-control": "Name the part to separate, e.g. “the headline text”",
  // Fuobe Reshoot reads a prompt written for the part's length (Genjutsu writes it: src/lib/catalog/reshoot.ts).
  "video-reshoot-swap-h3": "Run Fuobe Reshoot from Genjutsu: it writes the words for your part",
  "video-reshoot-edit-h3": "Run Fuobe Reshoot from Genjutsu: it writes the words for your part",
};
