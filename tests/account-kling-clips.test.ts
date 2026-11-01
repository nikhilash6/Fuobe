import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Kling 4.0's reference clips and clip elements (nm10-kling-4): the server reads each clip's header to price it (input
 * plus output seconds). For an account's run that read is its own files only, as every other input: the run route's
 * check (account-inputs.ts) and storage's guard on the read (readRef) both refuse another's clip, and an account's
 * @mentions never pull the owner's Elements (their photos or clips) into its run.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-account-kling-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;

const auth = await import("@/server/auth");
const { runAsTenant } = await import("@/server/tenant");
const { readRef, saveFile } = await import("@/server/storage");
const { accountInputProblem } = await import("@/server/account-inputs");
const { mentionElements } = await import("@/server/generations");
const { createElement } = await import("@/server/elements");
const { getModel } = await import("@/lib/catalog");
const { applyMentions } = await import("@/lib/catalog/elements");
type Req = import("@/lib/catalog/types").GenerationRequest;

let a = "";
let b = "";
beforeAll(() => {
  auth.setPassword("install password");
  a = auth.createAccount("kling-a@example.com", "long enough").id;
  b = auth.createAccount("kling-b@example.com", "long enough").id;
});
afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

const CLIP = Buffer.from("not really an mp4, but a stored file");
const asA = <T,>(fn: () => T) => runAsTenant({ kind: "account", id: a }, fn);
const kling = getModel("kling-4")!;
const run = (videos: string[]): Req => ({ feature: "video", modelId: "kling-4", op: "ref2v", prompt: "@Maya walks in", inputs: { videos }, params: { duration: 10 } });

describe("an account's Kling 4.0 reference clips", () => {
  it("are its own uploads: another's clip is refused before the run and again when its header is read", async () => {
    const mine = saveFile({ data: CLIP, contentType: "video/mp4", source: "upload", accountId: a });
    const theirs = saveFile({ data: CLIP, contentType: "video/mp4", source: "upload", accountId: b });
    const owners = saveFile({ data: CLIP, contentType: "video/mp4", source: "upload" });
    expect(accountInputProblem(run([mine.url]), a)).toBeNull();
    expect(accountInputProblem(run([mine.url, theirs.url]), a)).toMatchObject({ code: "input-not-yours" });
    expect(accountInputProblem(run([owners.url]), a)).toMatchObject({ code: "input-not-yours" });
    expect(accountInputProblem(run(["https://example.com/clip.mp4"]), a)).toMatchObject({ code: "input-not-allowed" });
    // The read that measures a clip for the price (generations.ts prepClip) goes through readRef's guard.
    await asA(async () => {
      expect((await readRef(mine.url)).data.equals(CLIP)).toBe(true);
      await expect(readRef(theirs.url)).rejects.toThrow(/isn't yours/);
      await expect(readRef(owners.url)).rejects.toThrow(/isn't yours/);
    });
  });

  it("never take the owner's Elements as Kling elements", () => {
    const clip = saveFile({ data: CLIP, contentType: "video/mp4", source: "upload" });
    createElement({ name: "Maya", kind: "character", references: [clip.url] });
    // The owner's run turns @Maya into a clip element; an account's sees no Elements, so its request stays as it was.
    expect(applyMentions(run([]), kling, mentionElements()).request.params?.elements).toEqual([{ video: 0 }]);
    asA(() => {
      const { request, mentioned } = applyMentions(run([]), kling, mentionElements());
      expect(mentioned).toEqual([]);
      expect(request.inputs?.videos).toEqual([]);
      expect(request.params?.elements).toBeUndefined();
    });
  });
});
