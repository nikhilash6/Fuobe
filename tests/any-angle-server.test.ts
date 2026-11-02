import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ANY_ANGLE, SWEEP, viewOf, wrapYaw } from "@/lib/catalog/any-angle";

// Any Angle on the server (src/server/any-angle.ts): when a 3D view's build succeeds, its front view is measured on the
// turntable it rendered and kept on the splat (an angle's camera starts there); a photo's view is found again by the
// photo's content for the same owner or account, never for someone else, and a build that failed is built again.

vi.setConfig({ testTimeout: 60_000 });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-any-angle-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const gens = await import("@/server/generations");
const { db } = await import("@/server/db");
const { provider } = await import("@/server/providers");
const { saveFile } = await import("@/server/storage");
const { findView, viewKeyOf, requestViewKey, NO_SUBJECT_MESSAGE } = await import("@/server/any-angle");

afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

/** A figure on a turntable (as in tests/any-angle.test.ts): its body's width, colour and side stripe follow the turn. */
function figure(size: number, yaw: number): { rgb: Buffer; mask: Buffer } {
  const rgb = Buffer.alloc(size * size * 3);
  const mask = Buffer.alloc(size * size * 3);
  const t = (yaw * Math.PI) / 180;
  const half = (0.12 + 0.1 * Math.abs(Math.cos(t))) * size;
  const stripe = Math.sin(t) * half * 0.7;
  const cx = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const head = (x - cx) ** 2 + (y - 0.2 * size) ** 2 < (0.08 * size) ** 2;
      const neck = y >= 0.27 * size && y < 0.31 * size && Math.abs(x - cx) < 0.03 * size;
      const body = y >= 0.31 * size && y < 0.92 * size && Math.abs(x - cx) < half;
      const i = (y * size + x) * 3;
      if (!head && !neck && !body) {
        rgb.fill(16, i, i + 3);
        continue;
      }
      mask.fill(255, i, i + 3);
      const onStripe = body && Math.abs(x - cx - stripe) < 0.03 * size;
      rgb[i] = onStripe ? 250 : head ? 200 : Math.round(140 + 100 * Math.cos(t));
      rgb[i + 1] = onStripe ? 250 : head ? 150 : 90;
      rgb[i + 2] = onStripe ? 30 : head ? 120 : Math.round(140 - 100 * Math.cos(t));
    }
  }
  return { rgb, mask };
}

const png = (raw: Buffer, size: number) => sharp(raw, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
const dataUri = (b: Buffer, type: string) => `data:${type};base64,${b.toString("base64")}`;

async function sweep(): Promise<{ colour: Buffer; coverage: Buffer }> {
  const frames = Array.from({ length: SWEEP.frames }, (_, k) => figure(96, (360 * k) / SWEEP.frames));
  const join = async (parts: Buffer[]) => sharp(await Promise.all(parts.map((p) => png(p, 96))), { join: { animated: true } }).webp({ lossless: true }).toBuffer();
  return { colour: await join(frames.map((f) => f.rgb)), coverage: await join(frames.map((f) => f.mask)) };
}

function insertBuild(id: string, request: Record<string, unknown>) {
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, progress, message, request_json, external_id, external_meta_json, outputs_json, created_at, updated_at)
       VALUES (?, ?, ?, 'open', 'comfyui', 'splat', 'model3d', 'running', 0.5, NULL, ?, ?, '{}', '[]', ?, ?)`,
    )
    .run(id, ANY_ANGLE.stepFeature, ANY_ANGLE.buildModel, JSON.stringify(request), `prompt-${id}`, now, now);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function settled(id: string, ms = 30_000) {
  const end = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id);
    if (g && g.status !== "running" && g.status !== "queued") return g;
    if (Date.now() > end) throw new Error(`timed out waiting for ${id}`);
    await sleep(50);
  }
}

describe("a 3D view's build", () => {
  const comfy = provider("comfyui");
  const realPoll = comfy.poll;
  afterAll(() => {
    comfy.poll = realPoll;
  });

  it("measures the photo's front view on its turntable, keeps it on the splat, and is found again by the photo", async () => {
    const shot = figure(384, 60);
    const photoData = await png(shot.rgb, 384);
    const photo = saveFile({ contentType: "image/png", name: "photo.png", source: "upload", data: photoData });
    const key = viewKeyOf(photoData);
    expect(await requestViewKey({ inputs: { images: [photo.url] } })).toBe(key);
    const { colour, coverage } = await sweep();
    const outputs = (matte: Buffer) => [
      { url: dataUri(Buffer.from("NGSP-test"), "application/octet-stream"), kind: "model3d", contentType: "application/octet-stream", meta: { role: "splat", format: "spz" } },
      { url: dataUri(colour, "image/webp"), kind: "image", contentType: "image/webp", meta: { role: "sweep" } },
      { url: dataUri(coverage, "image/webp"), kind: "image", contentType: "image/webp", meta: { role: "sweep-mask" } },
      { url: dataUri(matte, "image/png"), kind: "image", contentType: "image/png", meta: { role: "matte" } },
    ];
    const matte = await png(shot.mask, 384);
    const empty = await png(Buffer.alloc(384 * 384 * 3), 384);
    comfy.poll = async (ctx) => ({ state: "succeeded", outputs: ctx.externalId === "prompt-nobody" ? outputs(empty) : outputs(matte) }) as never;

    const request = { feature: ANY_ANGLE.stepFeature, modelId: ANY_ANGLE.buildModel, op: "splat", inputs: { images: [photo.url] }, params: { extra: { viewKey: key } } };
    insertBuild("view-1", request);
    gens.ensureRunner();
    const g = await settled("view-1");
    expect(g.status).toBe("succeeded");
    const view = viewOf(g)!;
    expect(view).not.toBeNull();
    expect(Math.abs(wrapYaw(view.front.yaw - 60))).toBeLessThanOrEqual(360 / SWEEP.frames);
    expect(view.front.person).toBe(true);
    expect(view.size).toEqual({ width: 384, height: 384 });

    // The same photo finds this view for the owner, never for an account, and the account's own view is its own.
    expect(findView(key, undefined)).toBe("view-1");
    expect(findView(key, "acct-1")).toBeNull();
    insertBuild("view-acct", { ...request, account: "acct-1" });
    expect(findView(key, "acct-1")).toBe("view-acct");
    expect(findView(key, undefined)).toBe("view-1");
    expect(findView(`${key.slice(0, -2)}x`, undefined)).toBeNull();

    // A build with no subject to compare fails in words, keeps none of its files (the owner's included), and isn't found
    // again (the next try builds it anew).
    const assets = () => (db().prepare("SELECT COUNT(*) AS n FROM assets").get() as { n: number }).n;
    const before = assets();
    insertBuild("nobody", { ...request, params: { extra: { viewKey: "other" } } });
    const failed = await settled("nobody");
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe(NO_SUBJECT_MESSAGE);
    expect(assets()).toBe(before);
    expect(findView("other", undefined)).toBeNull();
    // A view in the Trash isn't found either.
    gens.deleteGeneration("view-1");
    expect(findView(key, undefined)).toBeNull();
  });
});
