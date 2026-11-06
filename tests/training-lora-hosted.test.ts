import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoraRef } from "@/lib/catalog/types";
import { tempDir } from "./helpers/temp-dir";

/**
 * What fal's queue and Replicate's file store document, for a training and a LoRA copy:
 * - fal: PUT cancel_url removes a queued request and signals a running one (Queue API, "Cancel a request");
 * - Replicate: an upload expires 24 h after it is made (POST /v1/files answers expires_at; replicate-javascript README:
 *   "Files uploaded to Replicate using this endpoint expire after 24 hours"), and takes files under 100 MB
 *   (https://api.replicate.com/openapi.json: POST /files answers 413 "Files must be less than 100MB in size").
 * fetch is answered here: no key, no paid call, no network.
 */
process.env.FUOBE_DATA_DIR = tempDir("fuobe-training-lora-hosted-");

const { setSetting } = await import("@/server/settings");
const { createElement, deleteElement } = await import("@/server/elements");
const { startTraining, listTrainings, pollTrainings } = await import("@/server/training");
const { prepareCloudLoras, lorasPath, TRAINED_DIR } = await import("@/server/loras");

const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]).toString("base64")}`;

type Call = { url: string; method: string };
function answerAsFal(calls: Call[]): typeof fetch {
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, method: init.method ?? "GET" });
    if (url.includes("/storage/upload/initiate")) return Response.json({ upload_url: "https://upload.example/dataset.zip", file_url: "https://v3b.fal.media/files/b/0a9/dataset.zip" });
    if (url.startsWith("https://upload.example/")) return new Response("");
    if (url.startsWith("https://queue.fal.run/") && !url.includes("/requests/")) {
      return Response.json({ request_id: "r1", status_url: `${url}/requests/r1/status`, response_url: `${url}/requests/r1`, cancel_url: `${url}/requests/r1/cancel` });
    }
    if (url.endsWith("/requests/r1/cancel")) return Response.json({ status: "CANCELLATION_REQUESTED" }, { status: 202 });
    if (url.includes("/requests/r1/status")) return Response.json({ status: "IN_PROGRESS", request_id: "r1", logs: [{ message: "Step 10/2000", timestamp: "2026-11-06T00:00:00Z" }] }, { status: 202 });
    return new Response("not here", { status: 404 });
  }) as typeof fetch;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("a fal training Fuobe stops waiting for is cancelled on fal", () => {
  it("deleting the element of a running training sends PUT cancel_url and fails the training", async () => {
    setSetting("falKey", "test-id:test-secret");
    setSetting("demoMode", "off");
    const real = globalThis.fetch;
    const calls: Call[] = [];
    globalThis.fetch = answerAsFal(calls);
    try {
      const el = createElement({ name: "Maya cancel", kind: "character", description: "short dark hair", references: Array.from({ length: 6 }, () => JPEG) });
      const tr = startTraining(el.id, "fal-z-image", { consent: true });
      for (let i = 0; i < 500 && listTrainings().find((x) => x.id === tr.id)?.status === "queued"; i++) await new Promise((r) => setTimeout(r, 10));
      expect(listTrainings().find((x) => x.id === tr.id)?.status).toBe("running");
      deleteElement(el.id);
      await pollTrainings();
      expect(calls.filter((c) => c.method === "PUT" && c.url.endsWith("/requests/r1/cancel"))).toHaveLength(1);
      expect(listTrainings().find((x) => x.id === tr.id)).toMatchObject({ status: "failed" });
    } finally {
      globalThis.fetch = real;
    }
  }, 30_000);
});

describe("a LoRA copied to Replicate is copied again before Replicate deletes it", () => {
  it("reuses the copy within the day, and makes a new one in the last hour of its 24 h", async () => {
    const file = "fuobe/maya-ttl.safetensors";
    const p = lorasPath(TRAINED_DIR, file);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.alloc(1_500_000, 3));
    const lora: LoraRef = { file, own: true, strength: 1 };
    let n = 0;
    const upload = vi.fn(async () => `https://api.replicate.com/v1/files/f${++n}`);
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = new Date("2026-11-06T10:00:00Z").getTime();
    vi.setSystemTime(t0);
    expect((await prepareCloudLoras([lora], "replicate", upload))?.[0].hostedUrl).toBe("https://api.replicate.com/v1/files/f1");
    vi.setSystemTime(t0 + 2 * 3_600_000);
    expect((await prepareCloudLoras([lora], "replicate", upload))?.[0].hostedUrl).toBe("https://api.replicate.com/v1/files/f1");
    // 23 h 30 min after the upload: Replicate deletes the file in 30 min, so a run sent now gets a new copy.
    vi.setSystemTime(t0 + 23.5 * 3_600_000);
    expect((await prepareCloudLoras([lora], "replicate", upload))?.[0].hostedUrl).toBe("https://api.replicate.com/v1/files/f2");
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("a trained LoRA of 100 MB or more goes to Replicate by its fal URL, never through the Files API (it takes files under 100 MB)", async () => {
    const file = "fuobe/maya-big.safetensors";
    const p = lorasPath(TRAINED_DIR, file);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    // A sparse file: 120 MB long, nothing written.
    fs.closeSync(fs.openSync(p, "w"));
    fs.truncateSync(p, 120_000_000);
    const url = "https://v3b.fal.media/files/b/big/pytorch_lora_weights.safetensors";
    const upload = vi.fn(async () => "https://api.replicate.com/v1/files/big");
    const sent = await prepareCloudLoras([{ file, url, own: true, strength: 1 }], "replicate", upload);
    expect(sent?.[0].hostedUrl).toBe(url);
    expect(upload).not.toHaveBeenCalled();
    // fal takes it as before (Fuobe's own copy, sent once).
    const falUpload = vi.fn(async () => "https://v3b.fal.media/files/b/copy/maya-big.safetensors");
    expect((await prepareCloudLoras([{ file, url, own: true, strength: 1 }], "fal", falUpload))?.[0].hostedUrl).toBe("https://v3b.fal.media/files/b/copy/maya-big.safetensors");
  }, 60_000);
});
