import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { planGeneration } from "@/lib/catalog/plan";
import { applySketch } from "@/lib/catalog/sketch";
import { convertMask, decodePng, encodePng } from "@/server/png";

const base = { feature: "edit", prompt: "a vase of tulips", inputs: { images: ["/img.png"], mask: "/mask.png", sketch: "/overlay.png" } };

describe("applySketch", () => {
  it("sends the mask natively to models with an inpaint route", () => {
    const m = getModel("gpt-image-2-5")!;
    const route = m.routes.find((r) => r.op === "inpaint")!;
    expect(route.map?.mask).toBe("mask_url");
    // fal's GPT Image 2.5 wrapper reads white = change, black = keep ("White marks regions to edit"): no conversion.
    expect(route.map?.maskFormat).toBeUndefined();
    const { request } = applySketch({ ...base, modelId: m.id }, m);
    expect(request.op).toBe("inpaint");
    expect(request.inputs).toEqual({ images: ["/img.png"], mask: "/mask.png" });
    expect(planGeneration(request, getModel, getPreset).op).toBe("inpaint");
  });

  it("shows the painted area to edit models without a mask input", () => {
    const m = getModel("nano-banana-pro")!;
    const { request, note } = applySketch({ ...base, modelId: m.id }, m);
    expect(request.op).toBe("edit");
    expect(request.inputs?.images).toEqual(["/img.png", "/overlay.png"]);
    expect(request.inputs?.mask).toBeUndefined();
    expect(request.prompt).toMatch(/^a vase of tulips\. Only change the region tinted red in image 2/);
    expect(note).toMatch(/no mask input/);
  });

  it("uses FLUX Fill's mask route on the open engine", () => {
    const m = getModel("oss-flux-fill")!;
    expect(applySketch({ ...base, modelId: m.id }, m).request.op).toBe("inpaint");
  });

  it("turns a drawing into an instruction image for edits and a first frame for video", () => {
    const draw = { feature: "x", prompt: "", inputs: { images: ["/img.png"], sketch: "/drawn.png" } };
    const nb = getModel("nano-banana-pro")!;
    const e = applySketch({ ...draw, modelId: nb.id }, nb).request;
    expect(e.inputs?.images).toEqual(["/img.png", "/drawn.png"]);
    expect(e.prompt).toMatch(/^Image 2 is image 1 with drawn instructions/);
    const v = getModel("kling-2-5-turbo")!;
    const r = applySketch({ ...draw, modelId: v.id, prompt: "the car drives off" }, v).request;
    expect(r.op).toBe("i2v");
    expect(r.inputs?.images).toEqual(["/drawn.png"]);
    expect(r.prompt).toMatch(/^the car drives off\. The first frame carries drawn directions/);
  });

  it("leaves the mask to video erasers, swaps and inserts, which read it themselves", () => {
    for (const id of ["bria-video-erase-mask", "oss-vace-remove-painted", "wan-22-vace-inpaint"]) {
      const m = getModel(id)!;
      const req = { feature: "video-tools", modelId: id, inputs: { video: "/v.mp4", mask: "/mask.png" } };
      expect(applySketch(req, m).request, id).toBe(req);
    }
  });

  it("requires a mask for inpainting", () => {
    expect(() => planGeneration({ feature: "edit", modelId: "oss-flux-fill", prompt: "x", inputs: { images: ["/a.png"] } }, getModel, getPreset)).toThrow(/paint the area/);
  });
});

describe("mask conversion", () => {
  // 2×1 RGBA: left pixel white (change), right black (keep). Filter type 1 on purpose.
  const raw = Buffer.from([1, 255, 255, 255, 255, 1, 1, 1, 0]);
  const png = (() => {
    const crc = (b: Buffer) => {
      let c = 0xffffffff;
      for (const x of b) {
        c ^= x;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (t: string, d: Buffer) => {
      const h = Buffer.alloc(8);
      h.writeUInt32BE(d.length);
      h.write(t, 4);
      const c = Buffer.alloc(4);
      c.writeUInt32BE(crc(Buffer.concat([h.subarray(4), d])));
      return Buffer.concat([h, d, c]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(2, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr.set([8, 6, 0, 0, 0], 8);
    // Sub filter: second pixel stores deltas (0 - 255) & 0xff = 1, alpha delta 0.
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  })();

  it("decodes filtered scanlines", () => {
    expect([...decodePng(png).data]).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
  });
  it("converts to black-means-change and transparent-means-change", () => {
    expect([...decodePng(convertMask(png, "black")).data]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
    expect([...decodePng(convertMask(png, "alpha")).data]).toEqual([0, 0, 0, 0, 0, 0, 0, 255]);
  });
  it("round-trips through the encoder", () => {
    const d = decodePng(png);
    expect(decodePng(encodePng(d)).data.equals(d.data)).toBe(true);
  });
});
