import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Manifest } from "@/lib/comfy";
import { ZEN_ENCODER } from "@/lib/qwen21-speed";

// The gated model files (FLUX 3 Image Klein, LTX-2.5 and its IC-LoRAs, Bria VRMBG 3.0) and Qwen3.5-0.8B, the text encoder
// the Zen Image Edit loader reads from its own folder, are pinned to a commit with their size and SHA-256, so a copy on a
// GPU can be checked byte for byte before a run uses it.
const dir = path.join(process.cwd(), "workflows/comfyui");
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
type Pin = { revision: string; sizeBytes: number; sha256?: string };
const pins = read("model-pins.json") as Record<string, Pin>;
const manifest = read("manifest.json") as Manifest;
const requirements = read("requirements.json") as { files: Record<string, { url: string; pinnedUrl: string; sizeBytes: number; gated?: boolean }> };
const SHA = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;

const LTX = "https://huggingface.co/Lightricks/LTX-2.5/resolve/main/";
const LTX_REV = "49b093a39c19169a8a81721dcc541e07e945232f";

describe("model pins for gated files", () => {
  it("pins every gated file of the manifest to a commit with its exact size and SHA-256", () => {
    const gated = new Set(manifest.workflows.flatMap((w) => w.models.filter((m) => m.gated && m.url).map((m) => m.url!)));
    expect(gated.size).toBeGreaterThan(10);
    for (const url of gated) {
      expect(pins[url], url).toBeDefined();
      expect(pins[url].revision, url).toMatch(COMMIT);
      expect(pins[url].sizeBytes, url).toBeGreaterThan(0);
      expect(pins[url].sha256, url).toMatch(SHA);
    }
  });

  it("pins LTX-2.5's transformer, encoder, VAEs and upscaler at one commit, and the requirement index downloads that commit", () => {
    const expected: Record<string, [number, string]> = {
      "diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors": [21504034224, "c4279eeff115cbeaca494bd2183e7d768c38fe85a184dc6afbb7159157c44334"],
      "text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors": [15372969374, "6ce688a0aa98a5fa36a9f1e6c3f42152a498cc2b53ee8c15674c64244f91487f"],
      "vae/ltx-2.5-video-vae-bf16.safetensors": [1472223346, "847e14ca7f3355debca0cea4eaa24ac0fbcdf0061da054ac89ca638a869ddba3"],
      "vae/ltx-2.5-audio-vae-bf16.safetensors": [364866540, "c52733d37f6a7fb7949c3dc0fb468c6cb2169e4d836983a73babb9f0d54837a5"],
      "latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors": [995778752, "eb5a71fe4068ee87ccdb1c3aa635e547ca76bd2d30ae20ae889f2c325c0677e8"],
    };
    for (const [p, [sizeBytes, sha256]] of Object.entries(expected)) {
      expect(pins[LTX + p], p).toEqual({ revision: LTX_REV, sizeBytes, sha256 });
      const key = `${p.split("/")[0]}/${p.split("/").pop()}`;
      expect(requirements.files[key], key).toMatchObject({ url: LTX + p, pinnedUrl: LTX.replace("/main/", `/${LTX_REV}/`) + p, sizeBytes, gated: true });
    }
  });

  it("pins the Restore and Detail Refine IC-LoRAs at the commits in their URLs", () => {
    const loras: Record<string, [number, string]> = {
      "https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Restore/resolve/79245e197a6cd3251e77d178dc380b0e9f2d6563/ltx-2.5-22b-ic-lora-restore-1.0.safetensors": [
        1711643914, "357728bc704b3f56e59c5f09cf0540ef3b3fb88a93bbd0b050dbfacd5e05c8b0",
      ],
      "https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Refine-Details/resolve/4912c478b35dd96b6cdcc5f7c7ff9d72c2c57929/ltx-2.5-22b-ic-lora-refine-details-1.0.safetensors": [
        1308787534, "771a84f70e143af89867fc714ebbf7bd6edcaa4974c0360cba4a2d292a99f0e6",
      ],
    };
    for (const [url, [sizeBytes, sha256]] of Object.entries(loras)) {
      const revision = url.match(/\/resolve\/([0-9a-f]{40})\//)![1];
      expect(pins[url], url).toEqual({ revision, sizeBytes, sha256 });
      const file = url.split("/").pop()!;
      expect(requirements.files[`loras/${file}`]).toMatchObject({ pinnedUrl: url, sizeBytes });
    }
  });

  it("pins every file of Qwen3.5-0.8B's folder at the revision the Zen Image Edit loader uses", () => {
    const base = `https://huggingface.co/${ZEN_ENCODER.id}/resolve/${ZEN_ENCODER.revision}/`;
    const files = Object.keys(pins).filter((u) => u.startsWith(base)).map((u) => u.slice(base.length)).sort();
    expect(files).toEqual([
      "LICENSE",
      "chat_template.jinja",
      "config.json",
      "merges.txt",
      ZEN_ENCODER.weights,
      "model.safetensors.index.json",
      "preprocessor_config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "video_preprocessor_config.json",
      "vocab.json",
    ].sort());
    for (const f of files) {
      expect(pins[base + f].revision, f).toBe(ZEN_ENCODER.revision);
      expect(pins[base + f].sha256, f).toMatch(SHA);
    }
    expect(pins[base + ZEN_ENCODER.weights]).toEqual({
      revision: ZEN_ENCODER.revision,
      sizeBytes: 1746942600,
      sha256: "04b1c301231dd422b8860db31311ab2721511346a32cb1e079c4c4e5f1fe4696",
    });
  });
});
