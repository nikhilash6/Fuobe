import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-code-refusal-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { isCodeTemplate, TEMPLATES } = await import("@/lib/catalog/marketing");
const mk = await import("@/server/marketing");

// The database keeps its file open on Windows; the folder is temporary either way.
afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

// Templates drawn in the browser never reach a video or image model: an old tab, a saved draft or an API caller that
// names one is refused before anything is planned, priced or started.
const CODE = TEMPLATES.filter(isCodeTemplate);

describe("code-drawn templates on the server", () => {
  it("are the eighteen Kinetic templates", () => expect(CODE).toHaveLength(18));

  for (const t of CODE) {
    const input = { engine: "cloud" as const, format: t.format, templateId: t.id, prompt: "A bottle on a plinth" };
    it(`${t.id}: planning, pricing and running are refused`, async () => {
      expect(() => mk.planMarketing(input, {})).toThrow(mk.CODE_TEMPLATE_REFUSAL);
      expect(() => mk.estimateMarketing(input)).toThrow(mk.CODE_TEMPLATE_REFUSAL);
      await expect(mk.runMarketing(input)).rejects.toThrow(mk.CODE_TEMPLATE_REFUSAL);
      expect(mk.listRuns("marketing").some((r) => (r.meta as { templateId?: string } | undefined)?.templateId === t.id)).toBe(false);
    });
  }

  it("other motion templates still plan", () => {
    const other = TEMPLATES.find((t) => t.id === "m2-sticker-pop")!;
    expect(() => mk.planMarketing({ engine: "cloud", format: other.format, templateId: other.id, prompt: "A bottle on a plinth" }, {})).not.toThrow(mk.CODE_TEMPLATE_REFUSAL);
  });
});
