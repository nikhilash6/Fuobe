import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ModelDef, ModelRoute } from "@/lib/catalog/types";
import { keysSeen, startFakeFal, startFakeReplicate, type FakeCloud } from "./helpers/fake-cloud";

/**
 * Your keys, at every provider call site: inside an account's work fal.ai and Replicate get that account's own key, and
 * never the studio's (Settings, the environment, an unsaved "Save & test" value) or another account's. A guest and an
 * account without a key send nothing at all. The owner's calls still send the owner's key. Against stand-in servers
 * (tests/helpers/fake-cloud.ts): no real key, no paid call.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-keys-providers-"));
process.env.FUOBE_DATA_DIR = dir;
delete process.env.FUOBE_PASSWORD;
// The owner's keys everywhere they can be: the environment (the fal client's own defaults too) and Settings.
process.env.FAL_KEY = "owner-fal-env";
process.env.FAL_KEY_ID = "owner-fal-env-id";
process.env.FAL_KEY_SECRET = "owner-fal-env-secret";
process.env.REPLICATE_API_TOKEN = "owner-rep-env";

const auth = await import("@/server/auth");
const keys = await import("@/server/account-keys");
const { setSetting, withCandidates } = await import("@/server/settings");
const { runAsTenant } = await import("@/server/tenant");
const { falProvider, falQueue } = await import("@/server/providers/fal");
const { replicateProvider } = await import("@/server/providers/replicate");
const { falQueueUrl } = await import("@/server/training");

let fal: FakeCloud;
let rep: FakeCloud;
let A = "";
let B = "";
let C = "";
beforeAll(async () => {
  fal = await startFakeFal();
  rep = await startFakeReplicate();
  globalThis.__fuobeTestFalUrl = fal.url;
  globalThis.__fuobeTestReplicateUrl = rep.url;
  // Every key works at the stand-ins, the owner's too: a leak would succeed, and the log would show it.
  for (const k of ["owner-fal-db", "owner-fal-env", "owner-fal-env-id:owner-fal-env-secret", "owner-cand", "acct-fal-A", "acct-fal-B"]) fal.keys[k] = "good";
  for (const k of ["owner-rep-db", "owner-rep-env", "acct-rep-A"]) rep.keys[k] = "good";
  setSetting("falKey", "owner-fal-db");
  setSetting("replicateToken", "owner-rep-db");
  auth.setPassword("install password");
  A = auth.createAccount("prov-a@example.com", "long enough").id;
  B = auth.createAccount("prov-b@example.com", "long enough").id;
  C = auth.createAccount("prov-c@example.com", "long enough").id;
  keys.saveAccountKey(A, "fal", "acct-fal-A");
  keys.saveAccountKey(A, "replicate", "acct-rep-A");
  keys.saveAccountKey(B, "fal", "acct-fal-B");
});
afterAll(async () => {
  globalThis.__fuobeTestFalUrl = undefined;
  globalThis.__fuobeTestReplicateUrl = undefined;
  await fal.close();
  await rep.close();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});
beforeEach(() => {
  fal.log.length = 0;
  rep.log.length = 0;
});

const model = { id: "m", name: "M", kind: "image", engine: "cloud", routes: [] } as unknown as ModelDef;
const falRoute = { op: "text-to-image", provider: "fal", endpoint: "fal-ai/nano-banana-pro/edit", map: { prompt: "prompt" } } as unknown as ModelRoute;
const repRoute = { op: "text-to-image", provider: "replicate", endpoint: "google/nano-banana-pro", map: { prompt: "prompt" } } as unknown as ModelRoute;
const repVersion = { ...repRoute, endpoint: "someone/model:0123abcd" } as ModelRoute;
const input = { prompt: "a quiet harbour at dawn" };
const BIG = Buffer.alloc(1_100_000, 7);

const asAccount = <T,>(id: string, fn: () => T) => runAsTenant({ kind: "account", id }, fn);
const asGuest = <T,>(fn: () => T) => runAsTenant({ kind: "guest" }, fn);

/** Every fal.ai call site: upload, submit, status and result, cancel, the key check. */
async function everyFalCall() {
  const file = await falProvider.prepareFile(Buffer.from("png"), "image/png", "in.png");
  const job = await falProvider.submit({ generationId: "g", model, route: falRoute, input: { ...input, images: [file] } });
  const ctx = { externalId: job.externalId, meta: job.meta ?? {}, route: falRoute, model, createdAt: 0 };
  for (let i = 0; i < 3; i++) await falProvider.poll(ctx);
  await falProvider.cancel!(ctx);
  expect((await falProvider.test!()).ok).toBe(true);
}

/** Every Replicate call site: a file over 1 MB, both forms of submit, poll, cancel, the token check. */
async function everyReplicateCall() {
  await replicateProvider.prepareFile(BIG, "image/png", "in.png");
  await replicateProvider.submit({ generationId: "g", model, route: repVersion, input });
  const job = await replicateProvider.submit({ generationId: "g", model, route: repRoute, input });
  const ctx = { externalId: job.externalId, meta: {}, route: repRoute, model, createdAt: 0 };
  for (let i = 0; i < 3; i++) await replicateProvider.poll(ctx);
  await replicateProvider.cancel!(ctx);
  expect((await replicateProvider.test!()).ok).toBe(true);
}

describe("an account's work sends only its own key", () => {
  it("fal.ai: every call carries the account's key (none on the file's upload address)", async () => {
    await asAccount(A, everyFalCall);
    const keyed = fal.log.filter((r) => !r.path.startsWith("/upload/"));
    expect(keysSeen(keyed)).toEqual(["Key acct-fal-A"]);
    expect(fal.log.filter((r) => r.path.startsWith("/upload/")).map((r) => r.authorization)).toEqual([undefined]);
    expect(fal.log.map((r) => `${r.method} ${r.path.split("?")[0]}`)).toEqual(
      expect.arrayContaining(["POST /storage/upload/initiate", "POST /fal-ai/nano-banana-pro/edit", "PUT /fal-ai/nano-banana-pro/requests/fal-2/cancel"]),
    );
  });

  it("Replicate: every call carries the account's token", async () => {
    await asAccount(A, everyReplicateCall);
    expect(rep.log.length).toBeGreaterThanOrEqual(8);
    expect(keysSeen(rep.log)).toEqual(["Bearer acct-rep-A"]);
  });

  it("another account sends its own key, and nothing for a provider it has no key for", async () => {
    await asAccount(B, everyFalCall);
    expect(keysSeen(fal.log.filter((r) => !r.path.startsWith("/upload/")))).toEqual(["Key acct-fal-B"]);
    asAccount(B, () => expect(replicateProvider.isConfigured()).toBe(false));
    await expect(asAccount(B, () => replicateProvider.submit({ generationId: "g", model, route: repRoute, input }))).rejects.toThrow(/Add your Replicate key/);
    expect(rep.log).toEqual([]);
  });

  it("an account without a key, and a guest, send nothing at all", async () => {
    for (const run of [<T,>(fn: () => T) => asAccount(C, fn), asGuest]) {
      run(() => expect([falProvider.isConfigured(), replicateProvider.isConfigured()]).toEqual([false, false]));
      await expect(run(() => falProvider.prepareFile(Buffer.from("png"), "image/png", "in.png"))).rejects.toThrow();
      await expect(run(() => falProvider.submit({ generationId: "g", model, route: falRoute, input }))).rejects.toThrow();
      await expect(run(() => falProvider.poll({ externalId: "x", meta: { statusUrl: `${fal.url}/fal-ai/x/requests/x/status` }, route: falRoute, model, createdAt: 0 }))).rejects.toThrow();
      await expect(run(() => replicateProvider.submit({ generationId: "g", model, route: repRoute, input }))).rejects.toThrow();
      await expect(run(() => replicateProvider.prepareFile(BIG, "image/png", "in.png"))).rejects.toThrow();
      expect((await run(() => falProvider.test!())).ok).toBe(false);
    }
    expect(fal.log).toEqual([]);
    expect(rep.log).toEqual([]);
  });

  it("an unsaved value never stands in for an account's key (an empty one would fall through to FAL_KEY)", async () => {
    await asAccount(A, () => withCandidates({ falKey: "" }, () => falProvider.submit({ generationId: "g", model, route: falRoute, input })));
    await asAccount(A, () => withCandidates({ falKey: "owner-cand" }, () => falProvider.submit({ generationId: "g", model, route: falRoute, input })));
    await asAccount(C, () => withCandidates({ falKey: "owner-cand" }, () => expect(falProvider.isConfigured()).toBe(false)));
    expect(keysSeen(fal.log)).toEqual(["Key acct-fal-A"]);
  });

  it("a key this server can't open is no key (never the studio's)", async () => {
    const saved = auth.accountKeyRecord(B, "fal")!;
    // One character of its IV changed: it no longer opens.
    const [v, iv, ...rest] = saved.sealed.split(".");
    auth.setAccountKey(B, "fal", { ...saved, sealed: [v, (iv[0] === "A" ? "B" : "A") + iv.slice(1), ...rest].join(".") });
    try {
      asAccount(B, () => expect(falProvider.isConfigured()).toBe(false));
      await expect(asAccount(B, () => falProvider.submit({ generationId: "g", model, route: falRoute, input }))).rejects.toThrow(/Add your fal\.ai key/);
      expect(fal.log).toEqual([]);
    } finally {
      auth.setAccountKey(B, "fal", saved);
    }
  });
});

describe("the owner's work is as before", () => {
  it("sends the studio's key from Settings (and a Save & test value), never an account's", async () => {
    await everyFalCall();
    await everyReplicateCall();
    expect(keysSeen(fal.log.filter((r) => !r.path.startsWith("/upload/")))).toEqual(["Key owner-fal-db"]);
    expect(keysSeen(rep.log)).toEqual(["Bearer owner-rep-db"]);
    fal.log.length = 0;
    await withCandidates({ falKey: "owner-cand" }, () => falProvider.submit({ generationId: "g", model, route: falRoute, input }));
    expect(keysSeen(fal.log)).toEqual(["Key owner-cand"]);
    // Training's queue is fal.ai's (the stand-in here) and goes through the same key.
    expect(falQueueUrl("fal-ai/flux-lora-portrait-trainer")).toBe(`${falQueue()}/fal-ai/flux-lora-portrait-trainer`);
  });

  it("falls back to the environment's key when Settings has none", async () => {
    setSetting("falKey", "");
    try {
      await falProvider.submit({ generationId: "g", model, route: falRoute, input });
      expect(keysSeen(fal.log)).toEqual(["Key owner-fal-env"]);
    } finally {
      setSetting("falKey", "owner-fal-db");
    }
  });
});

describe("overlapping calls keep their own keys", () => {
  it("owner, A and B submitting and polling at once: each request carries only its own key", async () => {
    let release!: () => void;
    fal.holdSubmits = new Promise<void>((r) => (release = r));
    const submitAs = (who: string | null) => {
      const go = () => falProvider.submit({ generationId: who ?? "owner", model, route: falRoute, input: { prompt: `from ${who ?? "owner"}` } });
      return who ? asAccount(who, go) : go();
    };
    const pending = [submitAs(A), submitAs(null), submitAs(B), submitAs(A), submitAs(null), submitAs(B)];
    // Every submit is in flight at the stand-in before any answers.
    while (fal.log.length < pending.length) await new Promise((r) => setTimeout(r, 5));
    release();
    fal.holdSubmits = null;
    const jobs = await Promise.all(pending);
    const who = [A, null, B, A, null, B];
    await Promise.all(
      jobs.map((j, i) => {
        const poll = () => falProvider.poll({ externalId: j.externalId, meta: j.meta ?? {}, route: falRoute, model, createdAt: 0 });
        return who[i] ? asAccount(who[i]!, poll) : poll();
      }),
    );
    const expected = { [`from ${A}`]: "Key acct-fal-A", "from owner": "Key owner-fal-db", [`from ${B}`]: "Key acct-fal-B" };
    for (const r of fal.log.filter((x) => x.method === "POST")) expect(r.authorization).toBe(expected[JSON.parse(r.body).prompt as string]);
    expect(new Set(fal.log.map((r) => r.authorization))).toEqual(new Set(["Key acct-fal-A", "Key owner-fal-db", "Key acct-fal-B"]));
  });
});

describe("a key goes to its provider's own hosts only", () => {
  it("refuses a status or cancel address outside fal.ai, and a Replicate address outside Replicate", async () => {
    const real = globalThis.fetch;
    const elsewhere: string[] = [];
    globalThis.fetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
      const url = String(u instanceof Request ? u.url : u);
      if (!url.startsWith("http://127.0.0.1")) {
        elsewhere.push(url);
        return new Response("{}", { status: 200 });
      }
      return real(u, init);
    }) as typeof fetch;
    try {
      const evil = { statusUrl: "https://collector.example/fal/status", responseUrl: "https://collector.example/fal", cancelUrl: "https://collector.example/fal/cancel" };
      const ctx = { externalId: "x", meta: evil, route: falRoute, model, createdAt: 0 };
      await expect(asAccount(A, () => falProvider.poll(ctx))).rejects.toThrow(/outside fal\.ai/);
      await expect(falProvider.poll(ctx)).rejects.toThrow(/outside fal\.ai/);
      await asAccount(A, () => falProvider.cancel!(ctx));
      expect(elsewhere).toEqual([]);
    } finally {
      globalThis.fetch = real;
    }
  });
});
