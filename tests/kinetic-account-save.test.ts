import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TINY_PNG } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

// Saving a Kinetic Motion result needs no model: the owner and every account (with or without its own GPU or key)
// upload the clip and its poster (sent with KINETIC_UPLOAD_HEADER) and record it (POST /api/generations/local), within
// the account's space and limits; a guest is asked to sign up. Anything else an account without a GPU or key uploads
// still answers "Connect your GPU", and the header lets through only a clip (MP4, WebM) or a PNG poster.

const dir = tempDir("fuobe-kinetic-save-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ALLOWED_ORIGINS;
delete process.env.FUOBE_MODERATION_URL;
globalThis.__fuobeTestDiskFree = 1e13;

const auth = await import("@/server/auth");
const keys = await import("@/server/account-keys");
const uploads = await import("@/app/api/uploads/route");
const local = await import("@/app/api/generations/local/route");
const { CONNECT_GPU_HEADER, GUEST_HEADER, KINETIC_UPLOAD_HEADER } = await import("@/lib/guest-access");
const { accountUsage, ACCOUNT_LIMITS } = await import("@/server/account-files");
const { generationAccount, fileAccount } = await import("@/server/account-library");
const { filesRel } = await import("@/server/storage");
const { hit, resetRates } = await import("@/server/rate");
const { recipe } = await import("./helpers/motion");
afterAll(() => {
  globalThis.__fuobeTestDiskFree = undefined;
});

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(400, 1)]);
// A WebM header: EBML, then its DocType "webm".
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84]), Buffer.from("webm"), Buffer.alloc(400, 0)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 2)]);

let owner = "";
let withKey = { id: "", cookie: "" };
let withGpu = { id: "", cookie: "" };
let bare = { id: "", cookie: "" };
let n = 0;
const newAccount = () => {
  const a = auth.createAccount(`kinetic-save-${n++}@example.com`, "long enough");
  return { id: a.id, cookie: auth.createSession(a.id).value };
};
beforeAll(() => {
  auth.setPassword("install password");
  owner = auth.createSession().value;
  withKey = newAccount();
  keys.saveAccountKey(withKey.id, "fal", "acct-fal-kinetic");
  withGpu = newAccount();
  auth.setAccountGpu(withGpu.id, { url: "https://gpu-kinetic.example" });
  bare = newAccount();
});
beforeEach(() => resetRates());

const cookieHeader = (cookie?: string): Record<string, string> => (cookie ? { cookie: `${auth.SESSION_COOKIE}=${cookie}` } : {});

function upload(bytes: Buffer, type: string, name: string, o: { cookie?: string; kinetic?: boolean } = {}) {
  const headers: Record<string, string> = { host: "localhost:3000", "content-type": type, "x-file-name": encodeURIComponent(name), "content-length": String(bytes.length), ...cookieHeader(o.cookie), ...(o.kinetic && { [KINETIC_UPLOAD_HEADER]: "1" }) };
  return uploads.POST(new Request("http://localhost:3000/api/uploads", { method: "POST", headers, body: new Uint8Array(bytes), duplex: "half" } as RequestInit));
}

const record = (output: string, poster: string | undefined, cookie?: string) =>
  local.POST(
    new Request("http://localhost:3000/api/generations/local", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost:3000", ...cookieHeader(cookie) },
      body: JSON.stringify({
        feature: "marketing-kinetic",
        modelId: "local-motion",
        op: "motion",
        prompt: "Close the month before lunch.",
        title: "Kinetic Headline",
        inputs: {},
        params: { extra: { motion: recipe("end-card/draw-on") } },
        output: { url: output, kind: "video", contentType: "video/mp4", ...(poster && { meta: { poster } }) },
      }),
    }),
  );

/** Upload the clip and its poster as the Kinetic save does, then record it. */
async function save(cookie?: string) {
  const clip = await upload(MP4, "video/mp4", "kinetic-motion.mp4", { cookie, kinetic: true });
  const poster = await upload(TINY_PNG, "image/png", "kinetic-motion.png", { cookie, kinetic: true });
  const clipBody = clip.status === 201 ? ((await clip.json()) as { url: string }) : null;
  const posterBody = poster.status === 201 ? ((await poster.json()) as { url: string }) : null;
  const rec = clipBody ? await record(clipBody.url, posterBody?.url, cookie) : null;
  return { clip, poster, clipUrl: clipBody?.url, posterUrl: posterBody?.url, rec };
}

describe("saving a Kinetic Motion result", () => {
  it("the owner saves it to the Library", async () => {
    const s = await save(owner);
    expect(s.clip.status).toBe(201);
    expect(s.poster.status).toBe(201);
    expect(s.rec?.status).toBe(201);
    const g = (await s.rec!.json()) as { id: string };
    expect(generationAccount(g.id)).toBeNull();
  });

  it("an account with its own key saves it to its own runs", async () => {
    const s = await save(withKey.cookie);
    expect(s.rec?.status).toBe(201);
    const g = (await s.rec!.json()) as { id: string };
    expect(generationAccount(g.id)).toBe(withKey.id);
    expect(fileAccount(filesRel(s.clipUrl!)!)).toBe(withKey.id);
  });

  it("an account with neither a GPU nor a key saves it too, as its own run and files, counted in its space", async () => {
    const before = accountUsage(bare.id).uploads;
    const s = await save(bare.cookie);
    expect(s.clip.status).toBe(201);
    expect(s.poster.status).toBe(201);
    expect(s.rec?.status).toBe(201);
    const g = (await s.rec!.json()) as { id: string };
    expect(generationAccount(g.id)).toBe(bare.id);
    expect(fileAccount(filesRel(s.clipUrl!)!)).toBe(bare.id);
    expect(fileAccount(filesRel(s.posterUrl!)!)).toBe(bare.id);
    expect(accountUsage(bare.id).uploads).toBe(before + MP4.length + TINY_PNG.length);
    // A WebM clip too.
    expect((await upload(WEBM, "video/webm", "kinetic-motion.webm", { cookie: bare.cookie, kinetic: true })).status).toBe(201);
  });

  it("a guest is asked to sign up, for the upload and the record", async () => {
    const s = await save(undefined);
    expect(s.clip.status).toBe(401);
    expect(s.clip.headers.get(GUEST_HEADER)).toBe("1");
    const r = await record("/api/files/uploads/x.mp4", undefined, undefined);
    expect(r.status).toBe(401);
  });
});

describe("an account with neither a GPU nor a key", () => {
  it("still can't add its own files: an upload without the Kinetic mark says Connect your GPU", async () => {
    for (const [bytes, type, name] of [
      [MP4, "video/mp4", "clip.mp4"],
      [TINY_PNG, "image/png", "p.png"],
    ] as const) {
      const r = await upload(bytes, type, name, { cookie: bare.cookie });
      expect(r.status).toBe(403);
      expect(r.headers.get(CONNECT_GPU_HEADER)).toBe("1");
      expect((await r.json()).code).toBe("connect-gpu");
    }
  });

  it("with the mark, only a clip or a PNG poster: anything else is refused, before reading when it says so", async () => {
    const said = await upload(JPEG, "image/jpeg", "p.jpg", { cookie: bare.cookie, kinetic: true });
    expect(said.status).toBe(403);
    expect((await said.json()).code).toBe("connect-gpu");
    // A picture that says it is a clip: its bytes decide.
    const lied = await upload(JPEG, "video/mp4", "k.mp4", { cookie: bare.cookie, kinetic: true });
    expect(lied.status).toBe(403);
    expect((await lied.json()).code).toBe("connect-gpu");
    const sound = await upload(MP4, "audio/mp4", "k.m4a", { cookie: bare.cookie, kinetic: true });
    expect(sound.status).toBe(403);
  });

  it("is held to the upload limits: 60 an hour", async () => {
    for (let i = 0; i < ACCOUNT_LIMITS.uploadsPerHour; i++) hit(`up:h:${bare.id}`, ACCOUNT_LIMITS.uploadsPerHour, 60 * 60_000);
    const r = await upload(MP4, "video/mp4", "kinetic-motion.mp4", { cookie: bare.cookie, kinetic: true });
    expect(r.status).toBe(429);
  });

  it("is held to its run rate when it records: 60 an hour", async () => {
    const clip = (await (await upload(MP4, "video/mp4", "kinetic-motion.mp4", { cookie: bare.cookie, kinetic: true })).json()) as { url: string };
    for (let i = 0; i < ACCOUNT_LIMITS.runsPerHour; i++) hit(`run:${bare.id}`, ACCOUNT_LIMITS.runsPerHour, 60 * 60_000);
    expect((await record(clip.url, undefined, bare.cookie)).status).toBe(429);
  });

  it("can't record another account's clip", async () => {
    const theirs = (await (await upload(MP4, "video/mp4", "kinetic-motion.mp4", { cookie: withKey.cookie, kinetic: true })).json()) as { url: string };
    expect((await record(theirs.url, undefined, bare.cookie)).status).toBe(403);
  });
});

describe("an account with its own GPU", () => {
  it("uploads as before, marked or not", async () => {
    expect((await upload(MP4, "video/mp4", "clip.mp4", { cookie: withGpu.cookie })).status).toBe(201);
    expect((await upload(TINY_PNG, "image/png", "p.png", { cookie: withGpu.cookie })).status).toBe(201);
    expect((await upload(TINY_PNG, "image/png", "p.png", { cookie: withGpu.cookie, kinetic: true })).status).toBe(201);
  });
});
