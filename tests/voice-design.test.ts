import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import { DESIGN_MODELS, describeVoice, designBlocker, designModelFor, voiceOrigin } from "@/lib/voice-design";

describe("Design a voice: the words the model reads", () => {
  it("writes the chips as one sentence, then what was typed", () => {
    expect(describeVoice({ tone: "Warm", age: "Older", gender: "Female", accent: "British", pace: "Slow" }, "a hint of a smile")).toBe(
      "A warm, older female voice with a British accent, speaking at a slow pace. A hint of a smile.",
    );
    expect(describeVoice({ gender: "Male", age: "In their thirties", accent: "Irish" })).toBe("A male voice in their thirties with an Irish accent.");
    expect(describeVoice({ tone: "Authoritative" })).toBe("An authoritative voice.");
    expect(describeVoice({}, "  A gravelly 60-year-old narrator  ")).toBe("A gravelly 60-year-old narrator.");
    expect(describeVoice({})).toBe("");
    expect(describeVoice({}, "x".repeat(900)).length).toBe(500);
  });
});

describe("Design a voice: the model each engine runs", () => {
  it("runs Qwen3-TTS on both engines and VoxCPM2 on your GPU only", () => {
    expect(designModelFor("qwen", "open")).toBe("oss-qwen3-tts");
    expect(designModelFor("qwen", "cloud")).toBe("qwen-3-tts");
    expect(designModelFor("voxcpm", "open")).toBe("oss-voxcpm2");
    expect(designModelFor("voxcpm", "cloud")).toBeNull();
    expect(designBlocker("voxcpm", "cloud")).toMatch(/runs on your GPU/);
    expect(designBlocker("qwen", "cloud")).toBeNull();
    expect(DESIGN_MODELS.find((m) => m.key === "qwen")!.label).toBe("Qwen3-TTS · both engines");
  });

  it("names catalog models that design voices and clone them", () => {
    for (const m of DESIGN_MODELS) {
      for (const id of [m.open, m.cloud].filter(Boolean) as string[]) {
        const model = getModel(id);
        expect(model, id).toBeDefined();
        expect(model!.routes.map((r) => r.op).sort(), id).toEqual(["tts", "voice-design"]);
        expect(model!.options.voiceClone, id).toBe(true);
      }
    }
    expect(getModel("oss-voxcpm2")!.engine).toBe("open");
    expect(getModel("qwen-3-tts")!.engine).toBe("cloud");
  });

  it("says what a saved voice was designed with", () => {
    expect(voiceOrigin({ modelId: "qwen-3-tts", engine: "cloud" })).toBe("Designed with Qwen3-TTS · both engines");
    expect(voiceOrigin({ modelId: "oss-voxcpm2", engine: "open" })).toBe("Designed with VoxCPM2 · your GPU");
    expect(voiceOrigin(undefined)).toBeNull();
  });
});
