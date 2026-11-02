import { describe, expect, it } from "vitest";
import { buildRequest } from "@/components/studio/composer";
import { addFrame, type Attachment, type FrameAttachment } from "@/lib/composer";
import { WORKFLOW_TIMING } from "@/lib/inbetween";

const still = (name: string): Attachment => ({ id: name, ref: `/api/files/${name}.png`, preview: `/api/files/${name}.png`, kind: "image" });
const framesOf = (...names: string[]) => names.reduce<FrameAttachment[]>((fs, n) => addFrame(fs, still(n)), []);

// A Frames draft that was animated, then switched to another model: its timing and still mouth are kept in the draft.
const draft = (modelId: string) => ({
  slots: {},
  refs: [],
  modelId,
  prompt: "a girl turns",
  negativePrompt: "",
  params: { aspectRatio: "16:9", extra: { inbetween: WORKFLOW_TIMING, stillMouth: true, system: "keep" } },
  frames: framesOf("a", "b", "c", "d", "e"),
});
const ctx = { support: "all" as const, duration: 5, chained: false };

describe("The studio request for keyframe animation", () => {
  it("sends the timing and the still mouth only with an animation", () => {
    const off = buildRequest("video", draft("flux-3-max") as never, undefined, undefined, "image", ctx);
    expect(off.params?.extra).toEqual({ system: "keep" });
    const on = buildRequest("video", draft("fuobe-animation") as never, undefined, undefined, "image", { ...ctx, chained: true, animation: { timing: WORKFLOW_TIMING } });
    expect(on.params?.extra).toMatchObject({ inbetween: WORKFLOW_TIMING, stillMouth: true, system: "keep" });
  });

  it("drops an emptied extra", () => {
    const d = { ...draft("flux-3-max"), params: { extra: { stillMouth: true } } };
    expect(buildRequest("video", d as never, undefined, undefined, "image", ctx).params?.extra).toBeUndefined();
  });
});
