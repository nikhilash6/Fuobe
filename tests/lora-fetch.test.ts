import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fitLoras, lorasFit, loraEntry, loraRef } from "@/lib/catalog/loras";
import type { LoraRef } from "@/lib/catalog/types";

// The route's GET opts out of prerendering with connection(), which needs a request scope.
vi.mock("next/server", () => ({ connection: async () => {} }));
// The library pins each file's SHA256: two entries are pinned to the small stand-in files these tests serve.
vi.mock("@/lib/catalog/lora-library.generated", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/catalog/lora-library.generated")>();
  const { createHash } = await import("node:crypto");
  const body = (s: string) => Buffer.from(s.repeat(64));
  const pin = (s: string) => ({ sha256: createHash("sha256").update(body(s)).digest("hex"), sizeBytes: body(s).length });
  const fake: Record<string, ReturnType<typeof pin>> = { awportrait: pin("awportrait"), y2k: pin("y2k-style") };
  return { ...real, LORA_LIBRARY: real.LORA_LIBRARY.map((e) => (fake[e.key] ? { ...e, ...fake[e.key] } : e)) };
});

// The downloader reads the civitai key and the LoRA folder from the settings table: a throwaway data folder.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-lora-fetch-"));
process.env.FUOBE_DATA_DIR = dir;
const { downloadLora, ensureLorasOnComfy, prepareCloudLoras, listLoraCopies, lorasPath, redact, LORA_CACHE_DIR } = await import("@/server/loras");
const { setSetting } = await import("@/server/settings");
const { db } = await import("@/server/db");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const KEY = "civitai-secret-0123456789abcdef";
const bytes = (s: string) => Buffer.from(s.repeat(64));
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
}

/** A fake network: answers by URL prefix, records every call (with headers), never touches the internet. */
function network(routes: Record<string, (c: Call) => Response>) {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const call = { url: String(input), method: init?.method ?? "GET", headers: Object.fromEntries(new Headers(init?.headers).entries()) };
    calls.push(call);
    const hit = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => call.url.startsWith(k));
    if (!hit) return new Response("not here", { status: 404 });
    return routes[hit](call);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}

let net: ReturnType<typeof network> | undefined;
let folder: string;
beforeEach(() => {
  folder = fs.mkdtempSync(path.join(dir, "loras-"));
  setSetting("civitaiKey", "");
  setSetting("comfyLorasDir", "");
  db().prepare("DELETE FROM lora_mirrors").run();
  fs.rmSync(LORA_CACHE_DIR, { recursive: true, force: true });
});
afterEach(() => net?.restore());

const aw = loraRef(loraEntry("awportrait")!);
const y2k = loraRef(loraEntry("y2k")!);
const AW_BODY = bytes("awportrait");
const Y2K_BODY = bytes("y2k-style");

/** Hugging Face: a HEAD answered with a redirect carrying the file's SHA256 and size, then the file. */
const hfRoutes = (body: Buffer, etag = sha(body)) => ({
  [aw.url!]: (c: Call) =>
    c.method === "HEAD"
      ? new Response(null, { status: 302, headers: { "x-linked-etag": `"${etag}"`, "x-linked-size": String(body.length), "x-repo-commit": "abc123" } })
      : new Response(new Uint8Array(body), { status: 200, headers: { "content-length": String(body.length) } }),
});

/** civitai: the version API (hash, size, model) and the download, which needs ?token=. */
const civitaiRoutes = (body: Buffer, opts: { modelId?: number; permissions?: string[]; hash?: string } = {}) => ({
  "https://civitai.com/api/v1/model-versions/3422541": () =>
    Response.json({ id: 3422541, modelId: opts.modelId ?? 2979601, files: [{ name: "V1.safetensors", primary: true, sizeKB: body.length / 1024, hashes: { SHA256: (opts.hash ?? sha(body)).toUpperCase() } }] }),
  "https://civitai.com/api/v1/models/2979601": () => Response.json({ id: 2979601, allowCommercialUse: opts.permissions ?? ["Image", "RentCivit", "Rent", "Sell"] }),
  "https://civitai.com/api/download/models/3422541": (c: Call) =>
    new URL(c.url).searchParams.get("token") === KEY ? new Response(new Uint8Array(body), { status: 200, headers: { "content-length": String(body.length) } }) : Response.json({ error: "Unauthorized" }, { status: 401 }),
});

describe("LoRA downloads (pinned, checked, never leaking the civitai key)", () => {
  it("downloads a Hugging Face file at its pinned commit under its unique name and checks its SHA256", async () => {
    expect(aw.url).toMatch(/\/resolve\/[0-9a-f]{40}\/AWPortrait-Z\.safetensors$/);
    net = network(hfRoutes(AW_BODY));
    const got = await downloadLora(aw, folder);
    expect(got.path).toBe(path.join(folder, "AWPortrait-Z.safetensors"));
    expect(fs.readFileSync(got.path).equals(AW_BODY)).toBe(true);
    expect(got).toMatchObject({ sha256: sha(AW_BODY), sizeBytes: AW_BODY.length, version: aw.version, sourceUrl: aw.url });
    expect(fs.readdirSync(folder)).toEqual(["AWPortrait-Z.safetensors"]);
  });

  it("keeps nothing that isn't the pinned file, even when the source vouches for it", async () => {
    // The file was replaced upstream: Hugging Face states the new bytes' own hash, the library pinned the old ones.
    const swapped = bytes("someone else's weights");
    net = network(hfRoutes(swapped));
    await expect(downloadLora(aw, folder)).rejects.toThrow(/doesn't match/);
    // A file outside the library is checked against what the source states.
    const mine = { file: "mine.safetensors", url: "https://huggingface.co/me/mine/resolve/main/mine.safetensors" };
    net = network({ [mine.url]: (c: Call) => (c.method === "HEAD" ? new Response(null, { status: 302, headers: { "x-linked-etag": `"${"0".repeat(64)}"` } }) : new Response(new Uint8Array(AW_BODY))) });
    await expect(downloadLora(mine, folder)).rejects.toThrow(/doesn't match/);
    expect(fs.readdirSync(folder)).toEqual([]);
  });

  it("won't fetch a file it can't check (no pin, and the source states no hash)", async () => {
    setSetting("civitaiKey", KEY);
    // civitai's version API is down: an unpinned civitai file can't be checked.
    const other = { file: "civitai-999-other.safetensors", url: "https://civitai.com/api/download/models/999", version: "999" };
    net = network({ "https://civitai.com/api/v1/model-versions/999": () => new Response("down", { status: 503 }), [other.url]: () => new Response(new Uint8Array(Y2K_BODY)) });
    await expect(downloadLora(other, folder)).rejects.toThrow(/can't be checked/);
    expect(net.calls.filter((c) => c.url.includes("/api/download/"))).toEqual([]);
    // A Hugging Face file whose HEAD states nothing.
    const mine = { file: "mine.safetensors", url: "https://huggingface.co/me/mine/resolve/main/mine.safetensors" };
    net = network({ [mine.url]: () => new Response(new Uint8Array(AW_BODY)) });
    await expect(downloadLora(mine, folder)).rejects.toThrow(/can't be checked/);
    // The pinned library file needs no answer from the source to be checked.
    net = network({ [aw.url!]: (c: Call) => (c.method === "HEAD" ? new Response("down", { status: 503 }) : new Response(new Uint8Array(AW_BODY))) });
    await expect(downloadLora(aw, folder)).resolves.toMatchObject({ sha256: sha(AW_BODY) });
  });

  it("asks for a civitai key before touching a civitai download", async () => {
    net = network(civitaiRoutes(Y2K_BODY));
    await expect(downloadLora(y2k, folder)).rejects.toThrow(/needs your free API key: add it in Settings → LoRAs/);
    expect(net.calls.filter((c) => c.url.includes("/api/download/"))).toEqual([]);
  });

  it("downloads the pinned civitai version with ?token= and stores neither the key nor a tokenised URL", async () => {
    setSetting("civitaiKey", KEY);
    setSetting("comfyLorasDir", folder);
    net = network(civitaiRoutes(Y2K_BODY));
    await ensureLorasOnComfy([y2k], [], () => {});
    const saved = path.join(folder, "civitai-3422541-y2k.safetensors");
    expect(fs.readFileSync(saved).equals(Y2K_BODY)).toBe(true);
    // The version it asked civitai about is the pinned one, never "latest".
    expect(net.calls.map((c) => c.url.split("?")[0])).toEqual(["https://civitai.com/api/v1/model-versions/3422541", "https://civitai.com/api/download/models/3422541"]);
    const [copy] = listLoraCopies();
    expect(copy).toMatchObject({ file: "civitai-3422541-y2k.safetensors", target: "comfyui", version: "3422541", sha256: sha(Y2K_BODY), sourceUrl: y2k.url });
    // The licence snapshot it was made under.
    expect(copy.licence).toMatchObject({ commercial: true, hostedOk: true, snapshotDate: "2026-10-23", permissions: ["Image", "RentCivit", "Rent", "Sell", "SellMerge"] });
    const stored = JSON.stringify(db().prepare("SELECT * FROM lora_mirrors").all());
    expect(stored).not.toContain(KEY);
    expect(stored).not.toContain("token=");
  });

  it("says to check the key on a 401, without the key in the message", async () => {
    setSetting("civitaiKey", "wrong-key-987654321");
    net = network(civitaiRoutes(Y2K_BODY));
    const err = (await downloadLora(y2k, folder).catch((e: Error) => e)) as Error;
    expect(err.message).toMatch(/civitai refused the download of V67 Y2K Style \(401\): check your civitai key in Settings → LoRAs/);
    expect(err.message).not.toContain("wrong-key");
    expect(redact(`https://civitai.com/api/download/models/1?token=${KEY}`, KEY)).toBe("https://civitai.com/api/download/models/1?token=•••");
  });

  it("refuses an unpinned civitai URL and a version that belongs to another model", async () => {
    setSetting("civitaiKey", KEY);
    net = network(civitaiRoutes(Y2K_BODY, { modelId: 1 }));
    await expect(downloadLora({ ...y2k, file: "x.safetensors", url: "https://civitai.com/api/download/models/latest", version: undefined }, folder)).rejects.toThrow(/isn't pinned/);
    await expect(downloadLora(y2k, folder)).rejects.toThrow(/belongs to another model/);
    expect(fs.readdirSync(folder)).toEqual([]);
  });

  it("keeps every file inside the LoRA folder", () => {
    expect(lorasPath(folder, "fuobe/maya.safetensors")).toBe(path.join(folder, "fuobe", "maya.safetensors"));
    for (const bad of ["../evil.safetensors", "/etc/x.safetensors", "a/../../b.safetensors", "notes.txt", ""]) expect(() => lorasPath(folder, bad), bad).toThrow(/isn't a LoRA file name/);
  });
});

describe("Before a ComfyUI run", () => {
  it("does nothing when ComfyUI already lists the LoRA", async () => {
    net = network({});
    await ensureLorasOnComfy([aw], ["AWPortrait-Z.safetensors"]);
    expect(net.calls).toEqual([]);
  });

  it("says what to do when the LoRA is missing and no LoRA folder is set", async () => {
    net = network({});
    await expect(ensureLorasOnComfy([aw], ["other.safetensors"])).rejects.toThrow(
      /ComfyUI doesn't have Shakker-Labs AWPortrait-Z yet\. Set the LoRA folder in Settings → LoRAs .* put AWPortrait-Z\.safetensors in ComfyUI\/models\/loras \(from https:\/\/huggingface\.co\/Shakker-Labs\/AWPortrait-Z\)/,
    );
    // ComfyUI couldn't list its LoRAs and there's no folder to check: its own validation has the last word.
    await expect(ensureLorasOnComfy([aw], null)).resolves.toBeUndefined();
  });

  it("downloads a missing LoRA into the folder once, even when two runs ask at the same time", async () => {
    setSetting("comfyLorasDir", folder);
    net = network(hfRoutes(AW_BODY));
    const progress: string[] = [];
    await Promise.all([ensureLorasOnComfy([aw], [], (m) => progress.push(m)), ensureLorasOnComfy([aw], [])]);
    expect(net.calls.filter((c) => c.method === "GET")).toHaveLength(1);
    expect(progress[0]).toMatch(/^Downloading Shakker-Labs AWPortrait-Z/);
    expect(fs.existsSync(path.join(folder, "AWPortrait-Z.safetensors"))).toBe(true);
    // Already on disk (ComfyUI's list not refreshed yet): no second download.
    await ensureLorasOnComfy([aw], []);
    expect(net.calls.filter((c) => c.method === "GET")).toHaveLength(1);
  });
});

describe("Before a cloud run", () => {
  const upload = () => {
    const sent: { name: string; size: number }[] = [];
    return { sent, fn: async (data: Buffer, name: string) => (sent.push({ name, size: data.length }), `https://v3.fal.media/files/${name}`) };
  };

  it("sends public files as they are and mirrors a civitai file once (Rent allowed), then reuses the mirror", async () => {
    setSetting("civitaiKey", KEY);
    net = network(civitaiRoutes(Y2K_BODY));
    const up = upload();
    const first = (await prepareCloudLoras([aw, y2k], "fal", up.fn)) as LoraRef[];
    expect(first[0]).toBe(aw);
    expect(first[1].hostedUrl).toBe("https://v3.fal.media/files/civitai-3422541-y2k.safetensors");
    expect(up.sent).toEqual([{ name: "civitai-3422541-y2k.safetensors", size: Y2K_BODY.length }]);
    const mirror = listLoraCopies().find((c) => c.target === "fal")!;
    expect(mirror).toMatchObject({ hostedUrl: first[1].hostedUrl, version: "3422541", sha256: sha(Y2K_BODY) });
    expect(mirror.licence).toMatchObject({ permissionsNow: ["Image", "RentCivit", "Rent", "Sell"] });
    const again = (await prepareCloudLoras([y2k], "fal", up.fn)) as LoraRef[];
    expect(again[0].hostedUrl).toBe(first[1].hostedUrl);
    expect(up.sent).toHaveLength(1);
  });

  it("copies a civitai file once when many frames ask for it at the same time (a per-frame render)", async () => {
    setSetting("civitaiKey", KEY);
    net = network(civitaiRoutes(Y2K_BODY));
    const up = upload();
    // Fuobe Mixed Media's cloud frames all start together, each with the look's LoRA.
    const frames = await Promise.all(Array.from({ length: 24 }, (_, i) => prepareCloudLoras([{ ...y2k, strength: 0.5 + i / 100 }], "fal", up.fn)));
    expect(up.sent).toEqual([{ name: "civitai-3422541-y2k.safetensors", size: Y2K_BODY.length }]);
    expect(frames.map((f) => f![0].hostedUrl)).toEqual(Array(24).fill("https://v3.fal.media/files/civitai-3422541-y2k.safetensors"));
    // Each frame keeps its own settings; civitai is asked once, and the file downloaded once.
    expect(frames[3]![0].strength).toBe(0.53);
    expect(net.calls.filter((c) => c.url.startsWith("https://civitai.com/api/v1/models/"))).toHaveLength(1);
    expect(net.calls.filter((c) => c.url.includes("/api/download/") && c.method === "GET")).toHaveLength(1);
    expect(listLoraCopies().filter((c) => c.target === "fal")).toHaveLength(1);
    // A failed copy fails every frame that waited for it, and the next run tries again.
    db().prepare("DELETE FROM lora_mirrors").run();
    const failing = async (): Promise<string> => Promise.reject(new Error("fal storage is down"));
    const tries = await Promise.allSettled(Array.from({ length: 3 }, () => prepareCloudLoras([y2k], "fal", failing)));
    expect(tries.map((t) => t.status)).toEqual(["rejected", "rejected", "rejected"]);
    expect((await prepareCloudLoras([y2k], "fal", up.fn))![0].hostedUrl).toBe("https://v3.fal.media/files/civitai-3422541-y2k.safetensors");
    expect(up.sent).toHaveLength(2);
  });

  it("mirrors a civitai file whose hosting permission is gone, recording what civitai says (licences are information)", async () => {
    setSetting("civitaiKey", KEY);
    net = network(civitaiRoutes(Y2K_BODY, { permissions: ["Image", "RentCivit"] }));
    const up = upload();
    const out = (await prepareCloudLoras([y2k], "fal", up.fn)) as LoraRef[];
    expect(out[0].hostedUrl).toBe("https://v3.fal.media/files/civitai-3422541-y2k.safetensors");
    const mirror = listLoraCopies().find((c) => c.target === "fal")!;
    expect(mirror.licence).toMatchObject({ permissionsNow: ["Image", "RentCivit"], hosting: expect.stringMatching(/without civitai's “Rent” permission: Settings → Models & licences/) });
  });

  it("records an unconfirmed hosting right, not a missing one, when civitai doesn't answer", async () => {
    setSetting("civitaiKey", KEY);
    const routes = civitaiRoutes(Y2K_BODY);
    net = network({ ...routes, "https://civitai.com/api/v1/models/2979601": () => new Response("down", { status: 503 }) });
    const up = upload();
    const out = (await prepareCloudLoras([y2k], "replicate", up.fn)) as LoraRef[];
    expect(out[0].hostedUrl).toBe("https://v3.fal.media/files/civitai-3422541-y2k.safetensors");
    const mirror = listLoraCopies().find((c) => c.target === "replicate")!;
    expect(mirror.licence?.hosting).toMatch(/civitai didn't answer, so its hosting right wasn't confirmed/);
    expect(mirror.licence?.hosting).not.toMatch(/without civitai's “Rent” permission/);
  });

  it("goes back to civitai's hosting permission while Settings → Models & licences keeps GPU-only LoRAs on the GPU", async () => {
    setSetting("civitaiKey", KEY);
    net = network(civitaiRoutes(Y2K_BODY, { permissions: ["Image", "RentCivit"] }));
    const up = upload();
    await expect(prepareCloudLoras([{ ...y2k, keepOnGpu: true }], "fal", up.fn)).rejects.toThrow(/no longer allows running it on a hosted service, and Settings → Models & licences keeps such LoRAs off the cloud/);
    const wiggle = loraRef(loraEntry("civitai-2490836-wiggle-redmond")!);
    await expect(prepareCloudLoras([{ ...wiggle, keepOnGpu: true }], "replicate", up.fn)).rejects.toThrow(/licensed for your GPU only, and Settings → Models & licences keeps such LoRAs off the cloud/);
    expect(up.sent).toEqual([]);
  });

  it("sends a GPU-only LoRA to the cloud and says so, unless the run keeps such LoRAs on the GPU", async () => {
    setSetting("civitaiKey", KEY);
    const entry = loraEntry("civitai-2490836-wiggle-redmond")!;
    // Built by hand (no loraRef, so no licence): the library's licence still counts.
    const bare: LoraRef = { file: entry.file, url: entry.url, strength: 1 };
    const route = { provider: "fal" as const, loraEndpoint: "fal-ai/wan/v2.2-a14b/image-to-video/lora" };
    const sent = fitLoras([bare], route);
    expect(sent.loras).toEqual([bare]);
    expect(sent.notes[0]).toMatch(/^Wiggle Redmond: its licence allows your GPU only \(civitai lists no “Rent”\); it runs in the cloud because Settings → Models & licences lets such LoRAs go there/);
    const kept = fitLoras([{ ...bare, keepOnGpu: true }], route);
    expect(kept.loras).toEqual([]);
    expect(kept.notes[0]).toMatch(/^Wiggle Redmond is licensed for your GPU only and Settings → Models & licences keeps such LoRAs off the cloud, so this run leaves it out/);
    // With civitai's API down (nothing to re-read), a kept file is never downloaded or copied, nor is a hostable one.
    net = network({ "https://civitai.com/api/": () => new Response("down", { status: 503 }) });
    const up = upload();
    await expect(prepareCloudLoras([{ ...bare, keepOnGpu: true }], "fal", up.fn)).rejects.toThrow(/licensed for your GPU only/);
    await expect(prepareCloudLoras([{ ...y2k, keepOnGpu: true }], "fal", up.fn)).rejects.toThrow(/Couldn't confirm on civitai/);
    expect(up.sent).toEqual([]);
    expect(net.calls.filter((c) => c.url.includes("/api/download/"))).toEqual([]);
  });

  it("leaves a gated Hugging Face LoRA out of a cloud run with a note, never failing the run", async () => {
    const relight = loraRef(loraEntry("ltx-2-3-22b-ic-lora-relight-1-0")!);
    const fpv = loraRef(loraEntry("ltx2-3-fpv-motion")!);
    const ltx = { provider: "fal" as const, map: { loras: { shape: "items" as const, key: "loras", required: true } }, loraEndpoint: "fal-ai/ltx-2.3-22b/image-to-video/lora" };
    const fitted = fitLoras([relight, fpv], ltx);
    expect(fitted.loras).toEqual([fpv]);
    expect(fitted.notes).toEqual([`${loraEntry("ltx-2-3-22b-ic-lora-relight-1-0")!.name} is in a gated Hugging Face repo, so this cloud run leaves it out (on your GPU it runs once you've accepted the licence)`]);
    // It counts as nothing to carry when routes are compared, and is refused by name if it gets this far.
    expect(lorasFit({ provider: "replicate", map: { loras: { shape: "single", weights: "w", scale: "s" } } }, [relight])).toBe(true);
    await expect(prepareCloudLoras([relight], "fal", upload().fn)).rejects.toThrow(/gated Hugging Face repo, so it can't be sent to fal\.ai/);
  });

  it("mirrors the pinned bytes, not a same-named file of other bytes in the LoRA folder", async () => {
    setSetting("civitaiKey", KEY);
    setSetting("comfyLorasDir", folder);
    fs.writeFileSync(path.join(folder, y2k.file), "another LoRA with the same name");
    net = network(civitaiRoutes(Y2K_BODY));
    const up = upload();
    await prepareCloudLoras([y2k], "fal", up.fn);
    expect(up.sent).toEqual([{ name: y2k.file, size: Y2K_BODY.length }]);
    expect(listLoraCopies().find((c) => c.target === "fal")?.sha256).toBe(sha(Y2K_BODY));
  });
});

describe("Settings → LoRAs (/api/loras)", () => {
  it("lists the library with licences and what is in the folder, and never the key", async () => {
    const route = await import("@/app/api/loras/route");
    setSetting("civitaiKey", KEY);
    setSetting("comfyLorasDir", folder);
    fs.writeFileSync(path.join(folder, "AWPortrait-Z.safetensors"), "x");
    const res = await route.GET();
    const text = await res.text();
    expect(text).not.toContain(KEY);
    const body = JSON.parse(text) as { folder: string; civitaiKey: boolean; loras: { key: string; inFolder: boolean; licence: string; target?: string }[] };
    expect(body).toMatchObject({ folder, civitaiKey: true });
    expect(body.loras.find((l) => l.key === "awportrait")).toMatchObject({ inFolder: true, licence: "Commercial · GPU and cloud" });
    expect(body.loras.find((l) => l.key === "civitai-2490836-wiggle-redmond")).toMatchObject({ inFolder: false, licence: "Commercial · your GPU only", target: "high" });
  });

  it("says when the LoRA folder setting isn't a folder it can read, instead of failing", async () => {
    const route = await import("@/app/api/loras/route");
    const file = path.join(folder, "not-a-folder.txt");
    fs.writeFileSync(file, "x");
    setSetting("comfyLorasDir", file);
    const res = await route.GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { folderProblem?: string; loras: unknown[] };
    expect(body.folderProblem).toBe(`The LoRA folder ${file} is a file, not a folder`);
    expect(body.loras.length).toBeGreaterThan(100);
    setSetting("comfyLorasDir", path.join(folder, "missing"));
    expect(((await (await route.GET()).json()) as { folderProblem?: string }).folderProblem).toMatch(/doesn't exist on this machine/);
  });

  it("downloads one LoRA on request, or says why it can't", async () => {
    const route = await import("@/app/api/loras/route");
    const post = (file: unknown) => route.POST(new Request("http://x/api/loras", { method: "POST", body: JSON.stringify({ file }) }));
    expect((await post("AWPortrait-Z.safetensors")).status).toBe(422);
    expect(await (await post("AWPortrait-Z.safetensors")).json()).toEqual({ error: "Set the LoRA folder first (ComfyUI's models/loras on this machine)" });
    expect((await post("nope.safetensors")).status).toBe(422);
    setSetting("comfyLorasDir", folder);
    net = network(hfRoutes(AW_BODY));
    const ok = await post("AWPortrait-Z.safetensors");
    expect(await ok.json()).toEqual({ file: "AWPortrait-Z.safetensors", sizeBytes: AW_BODY.length, sha256: sha(AW_BODY) });
  });
});
