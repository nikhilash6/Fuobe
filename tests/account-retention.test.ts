import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TINY_PNG } from "./helpers/fake-comfy-runner";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-account-retention-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;

const auth = await import("@/server/auth");
const { db } = await import("@/server/db");
const { saveFile, getAsset, absolutePath, scratchDir } = await import("@/server/storage");
const { sweepAccountFiles, purgeAccount } = await import("@/server/account-sweep");
const { onAccountDeleted } = await import("@/server/account-files");
const { DELETE } = await import("@/app/api/generations/[id]/route");
afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

const DAY = 24 * 60 * 60_000;
let a = "";
beforeAll(() => {
  auth.setPassword("install password");
  a = auth.createAccount("keep@example.com", "long enough").id;
});

/** A finished run, made `ageDays` ago, with one output file; its request names `input` when given. */
function runRow(id: string, account: string | undefined, ageDays: number, input?: string) {
  const at = Date.now() - ageDays * DAY;
  db()
    .prepare(
      "INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'video', 'fuobe-dop', 'open', 'comfyui', 'i2v', 'video', 'succeeded', ?, '[]', ?, ?)",
    )
    .run(id, JSON.stringify({ feature: "video", modelId: "fuobe-dop", ...(account && { account }), ...(input && { inputs: { images: [input] } }) }), at, at);
  const out = saveFile({ data: TINY_PNG, contentType: "image/png", source: "generation", generationId: id });
  db().prepare("UPDATE assets SET created_at = ? WHERE id = ?").run(at, out.id);
  db().prepare("UPDATE generations SET outputs_json = ? WHERE id = ?").run(JSON.stringify([{ url: out.url, kind: "image", assetId: out.id }]), id);
  return out;
}

function upload(account: string | undefined, ageDays: number) {
  const f = saveFile({ data: TINY_PNG, contentType: "image/png", source: "upload", ...(account && { accountId: account }) });
  db().prepare("UPDATE assets SET created_at = ? WHERE id = ?").run(Date.now() - ageDays * DAY, f.id);
  return f;
}

const exists = (id: string) => {
  const asset = getAsset(id);
  return !!asset && fs.existsSync(absolutePath(asset.relPath));
};
const runExists = (id: string) => !!db().prepare("SELECT 1 FROM generations WHERE id = ?").get(id);

describe("what an account keeps goes in time", () => {
  it("removes uploads after 14 days (even when a run names them) and runs after 30, never the owner's", async () => {
    const oldUpload = upload(a, 15);
    const newUpload = upload(a, 2);
    const ownerUpload = upload(undefined, 400);
    // A recent run still names the old upload: it goes anyway.
    runRow("recent-run", a, 1, oldUpload.url);
    const oldOut = runRow("old-run", a, 31);
    const keptOut = runRow("kept-run", a, 10);
    const ownerOut = runRow("owner-old-run", undefined, 400);
    // An upload's temp file left behind an hour ago.
    const stale = path.join(scratchDir(), "up-stale");
    fs.writeFileSync(stale, "x");
    fs.utimesSync(stale, new Date(Date.now() - 2 * 3600_000), new Date(Date.now() - 2 * 3600_000));

    const swept = await sweepAccountFiles();
    expect(swept.uploads).toBe(1);
    expect(swept.runs).toBe(1);
    expect(exists(oldUpload.id)).toBe(false);
    expect(exists(newUpload.id)).toBe(true);
    expect(runExists("old-run")).toBe(false);
    expect(exists(oldOut.id)).toBe(false);
    expect(runExists("kept-run")).toBe(true);
    expect(exists(keptOut.id)).toBe(true);
    expect(runExists("recent-run")).toBe(true);
    // The owner's files and runs are never the sweep's.
    expect(exists(ownerUpload.id)).toBe(true);
    expect(runExists("owner-old-run")).toBe(true);
    expect(exists(ownerOut.id)).toBe(true);
    expect(fs.existsSync(stale)).toBe(false);
  });

  it("removes everything of a deleted account, and runs the cleanups registered for it", async () => {
    const gone = auth.createAccount("gone@example.com", "long enough").id;
    const up = upload(gone, 0);
    const out = runRow("gone-run", gone, 0);
    const seen: string[] = [];
    onAccountDeleted((id) => void seen.push(id));
    const r = await purgeAccount(gone);
    expect(r.runs).toBe(1);
    expect(runExists("gone-run")).toBe(false);
    expect(exists(up.id)).toBe(false);
    expect(exists(out.id)).toBe(false);
    expect(seen).toContain(gone);
    // The sweep catches an account deleted without a purge.
    const later = auth.createAccount("later@example.com", "long enough").id;
    runRow("later-run", later, 0);
    const laterUp = upload(later, 0);
    auth.deleteAccount(later);
    await sweepAccountFiles();
    expect(runExists("later-run")).toBe(false);
    expect(exists(laterUp.id)).toBe(false);
  });

  it("deletes an account's run for good when it deletes it", async () => {
    const out = runRow("delete-me", a, 0);
    const cookie = `${auth.SESSION_COOKIE}=${auth.createSession(a).value}`;
    const r = await DELETE(new Request("http://localhost:3000/api/generations/delete-me", { method: "DELETE", headers: { cookie, host: "localhost:3000" } }), {
      params: Promise.resolve({ id: "delete-me" }),
    } as never);
    expect(r.status).toBe(204);
    expect(runExists("delete-me")).toBe(false);
    expect(db().prepare("SELECT 1 FROM generation_trash WHERE generation_id = 'delete-me'").get()).toBeUndefined();
    expect(exists(out.id)).toBe(false);
  });
});
