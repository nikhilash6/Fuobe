/**
 * Live edit's ComfyUI plumbing: the node file Fuobe ships (src/lib/comfy-live-nodes.ts), the type-4 socket frame its
 * save node sends (as comfy-ws.ts reads it), and the tab's allow-lists for the browser-direct path (local-comfy.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isLiveNodes, LIVE_NODE_CLASSES, LIVE_NODES_FILE_NAME, LIVE_NODES_SOURCE, LIVE_NODES_VERSION, liveNodesBase64 } from "@/lib/comfy-live-nodes";
import { startFile } from "@/lib/comfy-install";
import { parseComfyBinary } from "@/lib/comfy-ws";
import { PACK_LIVE_CLASSES } from "@/lib/live/graph";
import { graphProblem, LocalComfyError, readPath, writePath } from "@/lib/local-comfy";

const ID = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";

describe("fuobe_live.py", () => {
  it("is plain ASCII, versioned, and defines every live class", () => {
    expect(LIVE_NODES_FILE_NAME).toBe("fuobe_live.py");
    expect(() => liveNodesBase64()).not.toThrow();
    expect(atob(liveNodesBase64())).toBe(LIVE_NODES_SOURCE);
    expect(LIVE_NODES_SOURCE).toContain(`FUOBE_LIVE = ${LIVE_NODES_VERSION}`);
    for (const c of LIVE_NODE_CLASSES) {
      expect(LIVE_NODES_SOURCE).toContain(`class ${c}:`);
      expect(LIVE_NODES_SOURCE).toContain(`"${c}": ${c},`);
      expect(c).toMatch(/FuobeLive$/);
    }
    expect([...LIVE_NODE_CLASSES].sort()).toEqual([...PACK_LIVE_CLASSES].sort());
    // Neutral: no machine paths.
    expect(LIVE_NODES_SOURCE).not.toMatch(/[A-Z]:\\\\|\/home\/|Projects/);
  });
  it("loads only Fuobe-named pictures from the input folder's root", () => {
    expect(LIVE_NODES_SOURCE).toContain('NAME = re.compile(r"^fuobe_[A-Za-z0-9_-]{8,24}\\.(png|jpg|jpeg|webp)$")');
    expect(LIVE_NODES_SOURCE).toContain("os.path.commonpath([root, path]) != root");
  });
  it("the Windows start file writes them next to the guard", () => {
    const bat = startFile(8188, "https://studio.example");
    // In parts ('…'+'…'), so no run of letters reads as a download command.
    expect(bat.replaceAll("'+'", "")).toContain(liveNodesBase64());
    expect(bat).toContain("fuobe_live.py");
  });
  it("answers its version", () => {
    expect(isLiveNodes({ version: 1 })).toBe(true);
    expect(isLiveNodes({ version: 0 })).toBe(false);
    expect(isLiveNodes(null)).toBe(false);
  });
});

describe("type-4 frames from the live save node", () => {
  it("reads the frame the node writes (fixture made by scripts/comfy/test_fuobe_live.py)", () => {
    const bytes = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/live-type4.bin"));
    const p = parseComfyBinary(bytes);
    expect(p).toMatchObject({ type: "image/webp", promptId: ID, node: "90", width: 192, height: 256, live: true });
    expect(Buffer.from(p!.data.subarray(0, 4)).toString()).toBe("RIFF");
  });
  it("still refuses an unknown image type", () => {
    const meta = Buffer.from(JSON.stringify({ prompt_id: ID, image_type: "text/html" }));
    const len = Buffer.alloc(4);
    len.writeUInt32BE(meta.length);
    expect(parseComfyBinary(Buffer.concat([Buffer.from([0, 0, 0, 4]), len, meta, Buffer.from("x")]))).toBeNull();
  });
});

describe("the tab's allow-lists for live edit", () => {
  const own = { promptIds: [ID], names: ["fuobe_lvAAAAAAAAAAAAAAAAAAAA.png"] };
  it("may take its own prompts out of the history, and nothing else", () => {
    expect(writePath("/history", { delete: [ID] }, own)).toBe("/history");
    expect(() => writePath("/history", { delete: [OTHER] }, own)).toThrow(LocalComfyError);
    expect(() => writePath("/history", { delete: [ID, OTHER] }, own)).toThrow(LocalComfyError);
    expect(() => writePath("/history", { delete: [] }, own)).toThrow(LocalComfyError);
    expect(() => writePath("/history", { clear: true }, own)).toThrow(LocalComfyError);
    expect(() => writePath("/history", { delete: [ID], clear: true }, own)).toThrow(LocalComfyError);
  });
  it("reads the live nodes' version", () => {
    expect(readPath("/fuobe/live")).toBe("/fuobe/live");
    expect(() => readPath("/fuobe/live?x=1")).toThrow(LocalComfyError);
  });
  it("checks the live loader like any other", () => {
    expect(graphProblem({ "10": { class_type: "LoadImageFuobeLive", inputs: { image: "fuobe_lvAAAAAAAAAAAAAAAAAAAA.png" } } }, own.names)).toBeNull();
    expect(graphProblem({ "10": { class_type: "LoadImageFuobeLive", inputs: { image: "private.png" } } }, own.names)).toMatch(/didn't send/);
  });
  it("uploads only names it made", () => {
    expect(writePath("/upload/image", { name: own.names[0], type: "input", overwrite: "true" }, own)).toBe("/upload/image");
    expect(() => writePath("/upload/image", { name: "fuobe_lvBBBBBBBBBBBBBBBBBBBB.png", type: "input", overwrite: "true" }, own)).toThrow(LocalComfyError);
  });
});
