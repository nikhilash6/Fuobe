import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseComfyBinary, parseComfyText, type ComfyEvent } from "@/lib/comfy-ws";
import { gatherInventory } from "@/lib/gpu/gather";
import { workflowReadiness } from "@/lib/gpu/readiness";
import { parseIndex } from "@/lib/gpu/requirements";
import { fetchTransport } from "@/lib/gpu/transport";
import { FAKE_PNG, startLocalComfy, type IndexLike, type LocalComfy } from "./helpers/fake-local-comfy";

const SITE = "http://127.0.0.1:3370";
let fake: LocalComfy | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

/** A request as a browser on SITE sends it to a loopback ComfyUI. */
const browser = (url: string, init: RequestInit = {}) => fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), origin: SITE, "sec-fetch-site": "cross-site" } });

async function watch(url: string, clientId: string, until: (e: ComfyEvent) => boolean) {
  const ws = new WebSocket(`${url.replace("http", "ws")}/ws?clientId=${clientId}`);
  ws.binaryType = "arraybuffer";
  const events: ComfyEvent[] = [];
  let previews = 0;
  await new Promise<void>((resolve, reject) => {
    ws.onmessage = (m) => {
      if (typeof m.data !== "string") {
        if (parseComfyBinary(m.data as ArrayBuffer)) previews++;
        return;
      }
      const e = parseComfyText(m.data);
      if (!e) return;
      events.push(e);
      if (until(e)) resolve();
    };
    ws.onerror = () => reject(new Error("socket"));
  });
  ws.close();
  return { events, previews };
}

describe("the fake local ComfyUI", () => {
  it("answers another site 403 without the setting, as ComfyUI does", async () => {
    fake = await startLocalComfy({ cors: "off" });
    expect((await browser(`${fake.url}/system_stats`)).status).toBe(403);
    expect((await fetch(`${fake.url}/system_stats`)).status).toBe(200);
  });

  it("lets the one site in with the setting, and runs a prompt with live steps and previews", async () => {
    fake = await startLocalComfy({ cors: SITE, steps: 3, stepMs: 5 });
    const stats = await browser(`${fake.url}/system_stats`);
    expect(stats.headers.get("access-control-allow-origin")).toBe(SITE);
    expect((await fetch(`${fake.url}/prompt`, { method: "OPTIONS" })).status).toBe(200);
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array(FAKE_PNG)], { type: "image/png" }), "fuobe_abcdefgh12.png");
    form.append("type", "input");
    form.append("overwrite", "true");
    const up = await browser(`${fake.url}/upload/image`, { method: "POST", body: form });
    expect(await up.json()).toEqual({ name: "fuobe_abcdefgh12.png", subfolder: "", type: "input" });
    expect(fake.inputs.get("fuobe_abcdefgh12.png")?.equals(FAKE_PNG)).toBe(true);
    const id = randomUUID();
    const seen = watch(fake.url, "client-12345678", (e) => e.type === "success");
    await new Promise((r) => setTimeout(r, 30));
    const res = await browser(`${fake.url}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: { "3": { class_type: "KSampler", inputs: {} }, "9": { class_type: "SaveImage", inputs: { filename_prefix: "fuobe/gen1" } } }, prompt_id: id, client_id: "client-12345678", extra_data: { preview_method: "auto" } }),
    });
    expect((await res.json()).prompt_id).toBe(id);
    const { events, previews } = await seen;
    expect(events.filter((e) => e.type === "progress").map((e) => (e as { value: number }).value)).toEqual([1, 2, 3]);
    expect(previews).toBe(3);
    const hist = (await (await browser(`${fake.url}/history/${id}`)).json())[id];
    expect(hist.outputs["9"].images[0]).toEqual({ filename: "gen1_00001_.png", subfolder: "fuobe", type: "output" });
    const file = await browser(`${fake.url}/view?filename=gen1_00001_.png&subfolder=fuobe&type=output`);
    expect(Buffer.from(await file.arrayBuffer()).equals(FAKE_PNG)).toBe(true);
    expect((await (await browser(`${fake.url}/api/jobs/${id}`)).json()).status).toBe("completed");
  });

  it("refuses a prompt for a missing node or model the way ComfyUI does, and forgets everything on a restart", async () => {
    fake = await startLocalComfy({ cors: "*", failNext: "missing_node" });
    const post = (body: unknown) => fetch(`${fake!.url}/prompt`, { method: "POST", body: JSON.stringify(body) });
    const a = await post({ prompt: {}, prompt_id: randomUUID() });
    expect(a.status).toBe(400);
    expect((await a.json()).error.type).toBe("missing_node_type");
    fake.opts.failNext = "missing_model";
    const b = await post({ prompt: { "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "x.safetensors" } } }, prompt_id: randomUUID() });
    expect((await b.json()).node_errors["4"].errors[0].extra_info.received_value).toBe("x.safetensors");
    fake.opts.failNext = "never";
    const id = randomUUID();
    await post({ prompt: {}, prompt_id: id });
    await new Promise((r) => setTimeout(r, 60));
    expect((await (await fetch(`${fake.url}/queue`)).json()).queue_running[0][1]).toBe(id);
    fake.restart();
    expect((await fetch(`${fake.url}/api/jobs/${id}`)).status).toBe(404);
    expect(await (await fetch(`${fake.url}/history/${id}`)).json()).toEqual({});
  });

  it("can have everything the studio's workflows need, so the GPU check finds a tool ready", async () => {
    const idx = parseIndex(JSON.parse(fs.readFileSync(path.join(process.cwd(), "workflows/comfyui/requirements.json"), "utf8")));
    const read = (base: string) => fetchTransport("browser", base, (url, init) => browser(url, init), { decodes: true });
    fake = await startLocalComfy({ cors: SITE });
    const bare = await gatherInventory(read(fake.url), idx, { where: "computer" });
    expect(workflowReadiness("z-image-turbo-t2i", bare, idx, { account: true }).state).not.toBe("ready");
    await fake.close();
    fake = await startLocalComfy({ cors: SITE, has: idx as unknown as IndexLike });
    const inv = await gatherInventory(read(fake.url), idx, { where: "computer" });
    expect(inv.nodes.missing).toEqual([]);
    expect(workflowReadiness("z-image-turbo-t2i", inv, idx, { account: true }).state).toBe("ready");
  });
});
