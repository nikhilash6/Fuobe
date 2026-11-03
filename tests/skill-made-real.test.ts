import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

// "Made from placeholder results" stays on a skill until one of its runs has made a real result.

process.env.FUOBE_DATA_DIR = tempDir("fuobe-skill-made-real-");
process.env.COMFYUI_URL = "http://127.0.0.1:1";

const { db } = await import("@/server/db");
const { madeRealResult } = await import("@/server/recipes");

let n = 0;
/** One step of a skill's run. */
function step(skill: string, run: string, status: string, provider: string, account?: string) {
  db()
    .prepare(
      "INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'flux-2', 'cloud', ?, 't2i', 'image', ?, ?, '[]', ?, ?)",
    )
    .run(`s${++n}`, provider, status, JSON.stringify({ feature: "image", modelId: "flux-2", skill: { name: skill, run }, ...(account && { account }) }), n, n);
}

describe("a skill made from placeholder results", () => {
  it("hasn't made a real result while its runs are placeholders, failed or unfinished", () => {
    expect(madeRealResult("poster")).toBe(false);
    // A free test run: placeholders only.
    step("poster", "check-1", "succeeded", "mock");
    step("poster", "check-1", "succeeded", "mock");
    // A real run whose second step failed, and one still going.
    step("poster", "r1", "succeeded", "fal");
    step("poster", "r1", "failed", "fal");
    step("poster", "r2", "running", "fal");
    // An account's run never counts for the owner's skill.
    step("poster", "acct-1", "succeeded", "fal", "acct-a");
    expect(madeRealResult("poster")).toBe(false);
  });

  it("has, once every step of one real run succeeded", () => {
    step("poster", "r3", "succeeded", "fal");
    step("poster", "r3", "succeeded", "replicate");
    expect(madeRealResult("poster")).toBe(true);
    // Another skill's runs don't count for it.
    expect(madeRealResult("other")).toBe(false);
  });
});
