import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

/**
 * Replicate input files as Replicate documents them (read 2026-11-06): a data URI only for a file under 1 MB, at most
 * 10 MB of them in one request (the official client's cap), and a Files API file lives 24 hours. Stand-ins only: no key
 * is real and nothing leaves this machine.
 * https://replicate.com/docs/topics/predictions/input-files
 * https://github.com/replicate/replicate-javascript/blob/main/lib/util.js (MAX_DATA_URI_SIZE)
 * https://github.com/replicate/replicate-javascript#replicatefilescreate ("expire after 24 hours")
 */
const dir = tempDir("fuobe-replicate-files-");
process.env.FUOBE_DATA_DIR = dir;
delete process.env.FUOBE_PASSWORD;
delete process.env.HF_TOKEN;

const { setSetting } = await import("@/server/settings");
const { db } = await import("@/server/db");
const { MODELS } = await import("@/lib/catalog");
const { replicateProvider } = await import("@/server/providers/replicate");
const loras = await import("@/server/loras");

setSetting("replicateToken", "owner-rep");

describe("Replicate: the data URIs one create request carries", () => {
  it("keeps at most 10 MB inline; the largest of many sub-1 MB files go through POST /v1/files", async () => {
    const model = MODELS.find((m) => m.id === "nano-banana-pro")!;
    const route = model.routes.find((r) => r.provider === "replicate" && r.op === "t2i")!;
    const real = globalThis.fetch;
    const sent: { url: string; body: unknown }[] = [];
    let n = 0;
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      sent.push({ url: String(url), body: init.body });
      const json = String(url).endsWith("/files") ? { id: `f${++n}`, urls: { get: `https://api.replicate.com/v1/files/f${n}` } } : { id: "p1", status: "starting" };
      return new Response(JSON.stringify(json), { status: 201, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    // 14 pictures (Nano Banana Pro's limit), each 999,999 bytes: every one is a data URI on its own.
    const images = await Promise.all(Array.from({ length: 14 }, (_, i) => replicateProvider.prepareFile(Buffer.alloc(999_999, i + 1), "image/png", `in-${i}.png`)));
    expect(images.every((u) => u.startsWith("data:image/png;base64,"))).toBe(true);
    try {
      await replicateProvider.submit({ generationId: "g", model, route, input: { prompt: "a quiet harbour", images } as never });
    } finally {
      globalThis.fetch = real;
    }
    const create = sent.find((s) => s.url.endsWith("/predictions"))!;
    const input = (JSON.parse(String(create.body)) as { input: { image_input: string[] } }).input;
    expect(input.image_input).toHaveLength(14);
    const inlineBytes = input.image_input.filter((u) => u.startsWith("data:")).reduce((t, u) => t + ((u.length - u.indexOf(",") - 1) * 3) / 4, 0);
    expect(inlineBytes).toBeLessThanOrEqual(10_000_000);
    expect(sent.filter((s) => s.url.endsWith("/files")).length).toBeGreaterThan(0);
    expect(input.image_input.filter((u) => !u.startsWith("data:")).every((u) => u.startsWith("https://api.replicate.com/v1/files/"))).toBe(true);
  });
});

describe("Replicate: Fuobe's copy of a LoRA on the Files API", () => {
  it("is not used once it is 20 hours old (Replicate deletes it at 24 hours; a run may wait 4 hours to start)", () => {
    const file = "replicate-ttl-check.safetensors";
    loras.recordTrainedMirror(file, "replicate", "https://api.replicate.com/v1/files/ttl");
    const age = (h: number) => db().prepare("UPDATE lora_mirrors SET created_at = ? WHERE file = ? AND target = 'replicate'").run(Date.now() - h * 3_600_000, file);
    age(19);
    expect(loras.gatedFileReady(file, "replicate")).toBe(true);
    age(21);
    expect(loras.gatedFileReady(file, "replicate")).toBe(false);
  });
});
