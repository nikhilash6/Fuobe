import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LORA_LIBRARY, LORA_LIBRARY_AS_OF, MOTION_EFFECT_LORAS } from "@/lib/catalog/lora-library.generated";
import { civitaiVersion, libraryEntry, licenceLine, loraByFile, loraEntry, loraRef, needsToken } from "@/lib/catalog/loras";
import { tempDir } from "./helpers/temp-dir";

const ROOT = path.resolve(__dirname, "..");
const DATE = /^\d{4}-\d{2}-\d{2}$/;

describe("LoRA library (lora-library.generated.ts)", () => {
  it("has every Soul look and the motion / effect LoRAs of the research", () => {
    const research = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/research/fuobe-originals-recipes-5.json"), "utf8"));
    expect(LORA_LIBRARY.filter((e) => e.group === "look")).toHaveLength(research.loraLibrary.length);
    for (const l of research.loraLibrary) expect(loraEntry(l.key)?.file).toBe(l.file);
    // Hugging Face files download at the commit their hash was read at (resolve/<revision>/…).
    for (const m of research.motionsEffects) for (const l of m.loras ?? []) expect(loraByFile(l.file)?.url).toBe(l.revision ? l.url.replace("/resolve/main/", `/resolve/${l.revision}/`) : l.url);
    expect(MOTION_EFFECT_LORAS).toHaveLength(research.motionsEffects.length);
    expect(LORA_LIBRARY_AS_OF).toBe(research.asOf);
  });

  it("gives every entry licence fields and a snapshot date", () => {
    for (const e of LORA_LIBRARY) {
      expect(typeof e.licence.commercial, e.key).toBe("boolean");
      expect(typeof e.licence.hostedOk, e.key).toBe("boolean");
      expect(e.licence.snapshotDate, e.key).toMatch(DATE);
      expect(e.licence.name, e.key).toBeTruthy();
      expect(["direct", "civitai-token", "hf-gated"]).toContain(e.download);
      expect(e.url, e.key).toMatch(/^https:\/\//);
    }
  });

  it("has no duplicate local file name or key (ComfyUI keys LoRAs on lora_name)", () => {
    const files = LORA_LIBRARY.map((e) => e.file);
    expect(new Set(files).size).toBe(files.length);
    const keys = LORA_LIBRARY.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of files) expect(f).toMatch(/^[\w.\-[\]() ]+\.safetensors$/);
  });

  it("pins every civitai download to a version id and keeps its permission snapshot", () => {
    const civitai = LORA_LIBRARY.filter((e) => e.download === "civitai-token");
    expect(civitai.length).toBeGreaterThan(30);
    for (const e of civitai) {
      expect(e.version, e.key).toMatch(/^\d+$/);
      expect(civitaiVersion(e.url)).toBe(e.version);
      expect(e.civitaiModel, e.key).toMatch(/^\d+$/);
      expect(e.licence.permissions?.length, e.key).toBeGreaterThan(0);
      // Image = outputs may be sold, Rent = may run on fal / Replicate.
      expect(e.licence.commercial).toBe(e.licence.permissions!.includes("Image"));
      expect(e.licence.hostedOk).toBe(e.licence.permissions!.includes("Rent"));
      expect(needsToken(e.url)).toBe(true);
    }
  });

  it("pins every file to exact bytes: a SHA256 and size, and Hugging Face files to a commit", () => {
    for (const e of LORA_LIBRARY) {
      expect(e.sha256, e.key).toMatch(/^[0-9a-f]{64}$/);
      expect(e.sizeBytes, e.key).toBeGreaterThan(1_000_000);
      if (e.url.startsWith("https://huggingface.co/")) {
        const rev = /\/resolve\/([0-9a-f]{40})\//.exec(e.url)?.[1];
        expect(rev, e.key).toBeDefined();
        expect(e.version).toBe(rev);
      }
    }
    // A ref built from the research's resolve/main URL (or by hand, without loraRef) is still the library file.
    const aw = loraEntry("awportrait")!;
    expect(libraryEntry({ file: "", url: aw.url.replace(/\/resolve\/[0-9a-f]{40}\//, "/resolve/main/") })).toBe(aw);
    expect(libraryEntry({ file: "renamed.safetensors", url: loraEntry("y2k")!.url })?.key).toBe("y2k");
    expect(libraryEntry({ file: "mine.safetensors", url: "https://v3.fal.media/files/mine.safetensors" })).toBeUndefined();
  });

  it("never makes a non-commercial LoRA a motion or effect default, and keeps GPU-only ones in local-only rows", () => {
    const defaults = new Set(["add-lora", "replace", "relight-route", "weak-candidate", "local-only"]);
    for (const m of MOTION_EFFECT_LORAS.filter((x) => defaults.has(x.status))) {
      for (const k of m.loras) {
        expect(loraEntry(k)!.licence.commercial, `${m.presets[0]}: ${k}`).toBe(true);
        if (m.status !== "local-only") expect(loraEntry(k)!.licence.hostedOk, `${m.presets[0]}: ${k}`).toBe(true);
      }
    }
    // BTS: a licence conflict between its Hugging Face and civitai pages, so it waits (prompt-only).
    const bts = MOTION_EFFECT_LORAS.find((m) => m.presets.includes("BTS"))!;
    expect(bts.status).toBe("licence-hold");
    expect(loraEntry(bts.loras[0])!.licence.commercial).toBe(false);
  });

  it("flags non-commercial and local-only LoRAs and never uses them for a default look", () => {
    // Every look a Soul preset uses allows selling outputs and running on fal / Replicate (licence rules).
    for (const e of LORA_LIBRARY.filter((x) => x.group === "look" && !x.spare)) {
      expect(e.licence.commercial, e.key).toBe(true);
      expect(e.licence.hostedOk, e.key).toBe(true);
    }
    expect(loraEntry("reededglass")?.spare).toBe(true);
    expect(loraEntry("reededglass")?.licence.commercial).toBe(false);
    // Wiggle (civitai "RentCivit" only) runs on the user's GPU and never in the cloud.
    const wiggle = MOTION_EFFECT_LORAS.find((m) => m.presets.includes("Wiggle"))!;
    expect(wiggle.status).toBe("local-only");
    for (const k of wiggle.loras) expect(loraEntry(k)?.licence.hostedOk).toBe(false);
    expect(licenceLine(loraEntry(wiggle.loras[0])!.licence)).toBe("Commercial · your GPU only");
    expect(licenceLine(undefined)).toBe("Your own");
  });

  it("keeps Wan 2.2 pairs on their experts and puts Wan 2.1 LoRAs on both", () => {
    const overhead = MOTION_EFFECT_LORAS.find((m) => m.presets.includes("Overhead"))!;
    expect(overhead.loras.map((k) => loraEntry(k)!.target)).toEqual(["high", "low"]);
    for (const e of LORA_LIBRARY.filter((x) => x.base.startsWith("wan2.1"))) expect(e.target, e.key).toBe("both");
    for (const m of MOTION_EFFECT_LORAS) for (const k of m.loras) expect(loraEntry(k), k).toBeDefined();
  });

  it("turns an entry into a recipe LoRA with its pinned version and licence", () => {
    const y2k = loraEntry("y2k")!;
    expect(loraRef(y2k, 0.5)).toEqual({ file: "civitai-3422541-y2k.safetensors", url: y2k.url, strength: 0.5, trigger: y2k.trigger, version: "3422541", licence: y2k.licence });
    expect(loraRef(loraEntry("awportrait")!).strength).toBe(0.6);
  });

  it("is what the generator writes (no hand edits); the generator refuses broken pins and only notes licences", () => {
    const tmp = tempDir("fuobe-lora-gen-");
    const research = () => JSON.parse(fs.readFileSync(path.join(ROOT, "docs/research/fuobe-originals-recipes-5.json"), "utf8"));
    const refuses = (data: unknown, why: RegExp) => {
      fs.writeFileSync(path.join(tmp, "docs/research/fuobe-originals-recipes-5.json"), JSON.stringify(data));
      expect(() => execFileSync("python3", [path.join(tmp, "scripts/gen-lora-library.py")], { stdio: "pipe" })).toThrow(why);
    };
    // Licences are information (Settings → Models & licences): the generator writes the library and prints a note.
    const notes = (data: unknown, what: RegExp) => {
      fs.writeFileSync(path.join(tmp, "docs/research/fuobe-originals-recipes-5.json"), JSON.stringify(data));
      expect(execFileSync("python3", [path.join(tmp, "scripts/gen-lora-library.py")], { stdio: "pipe" }).toString()).toMatch(what);
    };
    try {
      // A copy of the repo layout the script reads, with one civitai URL unpinned.
      fs.mkdirSync(path.join(tmp, "scripts"));
      fs.mkdirSync(path.join(tmp, "docs/research"), { recursive: true });
      fs.mkdirSync(path.join(tmp, "src/lib/catalog"), { recursive: true });
      fs.copyFileSync(path.join(ROOT, "scripts/gen-lora-library.py"), path.join(tmp, "scripts/gen-lora-library.py"));
      fs.copyFileSync(path.join(ROOT, "docs/research/fuobe-originals-recipes-5.json"), path.join(tmp, "docs/research/fuobe-originals-recipes-5.json"));
      execFileSync("python3", [path.join(tmp, "scripts/gen-lora-library.py")], { stdio: "pipe" });
      expect(fs.readFileSync(path.join(tmp, "src/lib/catalog/lora-library.generated.ts"), "utf8")).toBe(fs.readFileSync(path.join(ROOT, "src/lib/catalog/lora-library.generated.ts"), "utf8"));
      type Raw = { key?: string; presets?: string[]; status?: string; loras?: Raw[]; url?: string; sha256?: string; revision?: string };
      // A civitai entry without a pinned version.
      let data = research();
      data.loraLibrary.find((l: Raw) => l.key === "y2k").url = "https://civitai.com/models/2979601";
      refuses(data, /pinned version/);
      // A non-commercial LoRA made a default (BTS back to add-lora): a note, not a failure.
      data = research();
      data.motionsEffects.find((m: Raw) => m.presets?.includes("BTS")).status = "add-lora";
      notes(data, /licence notes \(information, shown in Settings → Models & licences\):[\s\S]*BTS \(add-lora\).*is non-commercial/);
      // A GPU-only (RentCivit) LoRA in a row that sends it to the cloud: a note too.
      data = research();
      data.motionsEffects.find((m: Raw) => m.presets?.includes("Wiggle")).status = "add-lora";
      notes(data, /Wiggle \(add-lora\).*licensed for the user's GPU only/);
      // A file without its SHA256 pin, and a Hugging Face file without its commit.
      data = research();
      delete data.loraLibrary.find((l: Raw) => l.key === "y2k").sha256;
      refuses(data, /no SHA256 pin/);
      data = research();
      delete data.loraLibrary.find((l: Raw) => l.key === "awportrait").revision;
      refuses(data, /without a pinned commit/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
