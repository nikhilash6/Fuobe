/**
 * The worker's face self-check (bin/lib/worker/self-check.mjs): which jobs need it, the graph it sends (every input the
 * tracking node needs, a new cache key each time), how it reads the report, and one check against a stand-in ComfyUI
 * (a pass, a collapsed detector, a failed or silent prompt, an upload that didn't go). Never a real ComfyUI.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectsFaces, FACE_DETECTOR, FACE_RANGE, faceHeight, facePasses, runSelfCheck, SELF_CHECK_INPUT, SELF_CHECK_PHOTO, selfCheckGraph } from "../bin/lib/worker/self-check.mjs";

const ROOT = path.resolve(__dirname, "..");
const report = (min: number, mean: number, max: number) =>
  `subject: select=largest_face index=0, locked on at frame 0 of 1\nfaces: max 1 in one frame\nface height  min=${min}px  mean=${mean}px  max=${max}px\nface fills   ~40% of every crop (crop_factor=2.5)`;

type Call = { url: string; init?: RequestInit };

/** A stand-in for its ComfyUI: answers upload, prompt and history the way ComfyUI does. */
function standIn(o: { text?: string | null; status?: string; uploadOk?: boolean; never?: boolean } = {}) {
  const calls: Call[] = [];
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const p = new URL(url).pathname;
    if (p === "/upload/image") return o.uploadOk === false ? new Response("no", { status: 500 }) : ok({ name: SELF_CHECK_INPUT, subfolder: "", type: "input" });
    if (p === "/prompt") return ok({ prompt_id: "check-1", number: 0, node_errors: {} });
    if (p === "/history/check-1") {
      if (o.never) return ok({});
      const outputs = o.text === null ? {} : { "3": { text: [o.text ?? report(168, 168, 168)] } };
      return ok({ "check-1": { status: { status_str: o.status ?? "success", completed: true }, outputs } });
    }
    return ok({});
  };
  return { fetchFn, calls };
}

describe("which jobs need the face self-check", () => {
  it("a graph with the tracking node or the select node does; others don't", () => {
    expect(detectsFaces({ "6": { class_type: "H3FaceTrackCrop", inputs: {} } })).toBe(true);
    expect(detectsFaces({ "1": { class_type: "H3FaceSelect", inputs: {} } })).toBe(true);
    expect(detectsFaces({ "1": { class_type: "LoadImage", inputs: {} }, "2": { class_type: "KSampler", inputs: {} } })).toBe(false);
    expect(detectsFaces(undefined)).toBe(false);
  });
});

describe("the check's graph", () => {
  it("sets every required input of the tracking node, with the Fix faces graph's detector and confidence", () => {
    const info = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows/comfyui/object_info.subset.json"), "utf8"));
    const required = Object.keys(info.H3FaceTrackCrop.input.required);
    const g = selfCheckGraph(1);
    for (const name of required) expect(g["2"].inputs, name).toHaveProperty(name);
    const fixFaces = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows/comfyui/video-fix-faces-h3.json"), "utf8"));
    const track = Object.values(fixFaces as Record<string, { class_type: string; inputs: Record<string, unknown> }>).find((n) => n.class_type === "H3FaceTrackCrop")!;
    expect(g["2"].inputs.detector).toBe(track.inputs.detector);
    expect(g["2"].inputs.detector).toBe(FACE_DETECTOR);
    expect(g["2"].inputs.confidence).toBe(track.inputs.confidence);
    // The report is the tracking node's fourth output, shown as text.
    expect(info.H3FaceTrackCrop.output_name[3]).toBe("report");
    expect(g["3"]).toEqual({ class_type: "PreviewAny", inputs: { source: ["2", 3] } });
    expect(g["1"].inputs.image).toBe(SELF_CHECK_INPUT);
  });

  it("changes with each check, so its ComfyUI runs the detector again instead of answering from its cache", () => {
    expect(JSON.stringify(selfCheckGraph(1))).not.toBe(JSON.stringify(selfCheckGraph(2)));
    expect(selfCheckGraph(7)["2"].inputs.fallback_detector).toBe("none");
  });

  it("the fixed photo is there", () => {
    expect(fs.statSync(SELF_CHECK_PHOTO).size).toBeGreaterThan(10_000);
  });
});

describe("reading the report", () => {
  it("reads the face heights, and passes only inside the range", () => {
    expect(faceHeight(report(168, 168, 168))).toEqual({ min: 168, mean: 168, max: 168 });
    expect(faceHeight(report(0, 1, 5))).toEqual({ min: 0, mean: 1, max: 5 });
    expect(faceHeight("face height  min=-0px  mean=0px  max=4px")).toEqual({ min: -0, mean: 0, max: 4 });
    expect(faceHeight("No face detected")).toBeNull();
    expect(facePasses({ min: 168, mean: 168, max: 168 })).toBe(true);
    expect(facePasses({ min: FACE_RANGE.min, mean: 160, max: FACE_RANGE.max })).toBe(true);
    expect(facePasses({ min: 3, mean: 3, max: 3 })).toBe(false);
    expect(facePasses({ min: 120, mean: 140, max: 160 })).toBe(false);
    expect(facePasses(null)).toBe(false);
  });
});

describe("one check against its ComfyUI", () => {
  const base = "http://127.0.0.1:41234";
  const fast = { sleep: async () => {}, photo: Buffer.from("jpeg") };

  it("passes on the photo's face, uploads the photo first, and leaves nothing in its history", async () => {
    const c = standIn();
    expect(await runSelfCheck(c.fetchFn, base, fast)).toEqual({ ok: true, height: 168 });
    const paths = c.calls.map((x) => `${x.init?.method ?? "GET"} ${new URL(x.url).pathname}`);
    expect(paths[0]).toBe("POST /upload/image");
    expect(paths[1]).toBe("POST /prompt");
    const del = c.calls.find((x) => new URL(x.url).pathname === "/history" && x.init?.method === "POST");
    expect(JSON.parse(String(del?.init?.body))).toEqual({ delete: ["check-1"] });
    expect(c.calls.every((x) => x.url.startsWith(base))).toBe(true);
  });

  it("fails on a collapsed detector (dozens of 0-5 px boxes)", async () => {
    expect(await runSelfCheck(standIn({ text: report(0, 1, 5) }).fetchFn, base, fast)).toEqual({ ok: false, height: 1, why: "height" });
  });

  it("fails when the prompt failed, when there is no report, when the upload didn't go, and when it never finishes", async () => {
    expect(await runSelfCheck(standIn({ status: "error" }).fetchFn, base, fast)).toMatchObject({ ok: false, why: "failed" });
    expect(await runSelfCheck(standIn({ text: null }).fetchFn, base, fast)).toMatchObject({ ok: false, why: "no-report" });
    expect(await runSelfCheck(standIn({ uploadOk: false }).fetchFn, base, fast)).toMatchObject({ ok: false, why: "upload" });
    let t = 0;
    const silent = standIn({ never: true });
    const r = await runSelfCheck(silent.fetchFn, base, { ...fast, now: () => (t += 1000), timeoutMs: 10_000 });
    expect(r).toMatchObject({ ok: false, why: "timeout" });
    expect(silent.calls.some((x) => new URL(x.url).pathname === "/interrupt")).toBe(true);
  });
});
