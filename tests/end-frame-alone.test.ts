import { describe, expect, it } from "vitest";
import { getModel, getPreset, MODELS } from "@/lib/catalog";
import { endFrameAloneProblem, inferOperation, planGeneration, routesFor, takesEndAlone } from "@/lib/catalog/plan";
import type { GenerationRequest } from "@/lib/catalog/types";
import { slimModel } from "@/lib/studio-catalog";
import { bodyProblems, END, handOverInput, IMG, inputSchema, PROMPT, routeRequest, SCHEMA_INDEX } from "./helpers/provider-schemas";

/**
 * A video run with only an end frame (no start frame). fal's H3, H3 Max and H3 Max Turbo image to video take one alone
 * ("It may be provided alone for end-only keyframe generation; in that case the output canvas follows this image"), so
 * the run goes there with the frame as end_image_url. Before, it was planned as text to video and the frame was left out
 * without a word. A model that uses an end frame only after a start frame says so: before the run in the composer (with
 * "Use it as the start frame") and in the run's notes.
 */

const H3_FAMILY = ["minimax-h3", "minimax-h3-max", "minimax-h3-max-turbo"];

function plan(modelId: string, inputs: GenerationRequest["inputs"], op?: GenerationRequest["op"]) {
  return planGeneration({ feature: "video", modelId, op, prompt: PROMPT, inputs, params: {} }, getModel, getPreset);
}

describe("an end frame alone on fal's H3 family", () => {
  it("goes to the image-to-video route as end_image_url, with no start frame and no text-to-video", () => {
    for (const id of H3_FAMILY) {
      const model = getModel(id)!;
      expect(takesEndAlone(model), id).toBe(true);
      const p = plan(id, { endImage: END });
      expect(p.op, id).toBe("flf2v");
      expect(p.notes ?? [], id).not.toContainEqual(expect.stringContaining("end frame"));
      const route = routesFor(p.model, p.op, p.params)[0];
      expect(route.endpoint, id).toMatch(/\/image-to-video$/);
      const { body } = routeRequest(route, handOverInput(p, { inputs: { endImage: END } }));
      expect(body.end_image_url, id).toBe(END);
      expect(body, id).not.toHaveProperty("image_url");
      expect(endFrameAloneProblem(model, { endImage: END }), id).toBeNull();
    }
  });

  it("the request fits the endpoint's saved schema", () => {
    for (const id of H3_FAMILY) {
      const p = plan(id, { endImage: END });
      const { endpoint, body } = routeRequest(routesFor(p.model, p.op, p.params)[0], handOverInput(p, { inputs: { endImage: END } }));
      expect(bodyProblems("fal", endpoint, body), `${id} ${JSON.stringify(body)}`).toEqual([]);
    }
  });

  it("the browser's slimmed catalog (no field maps) plans it the same, with nothing said", () => {
    for (const id of H3_FAMILY) {
      const slim = slimModel(getModel(id)!);
      expect(slim.routes.every((r) => !r.map), id).toBe(true);
      expect(takesEndAlone(slim), id).toBe(true);
      expect(inferOperation(slim, { inputs: { endImage: END } }), id).toBe("flf2v");
      expect(endFrameAloneProblem(slim, { endImage: END }), id).toBeNull();
      const p = planGeneration({ feature: "video", modelId: id, prompt: PROMPT, inputs: { endImage: END }, params: {} }, (m) => (m === id ? slim : getModel(m)), getPreset);
      expect(p.op, id).toBe("flf2v");
    }
    expect(endFrameAloneProblem(slimModel(getModel("minimax-h3-lite")!), { endImage: END })).toMatch(/only after a start frame/);
  });

  it("an API caller's start-and-end op with only the end frame runs too", () => {
    expect(plan("minimax-h3-max-turbo", { endImage: END }, "flf2v").op).toBe("flf2v");
  });

  it("a start and an end frame still go together", () => {
    const p = plan("minimax-h3-max-turbo", { images: [IMG], endImage: END });
    expect(p.op).toBe("flf2v");
    const { body } = routeRequest(routesFor(p.model, p.op, p.params)[0], handOverInput(p, { inputs: { images: [IMG], endImage: END } }));
    expect(body).toMatchObject({ image_url: IMG, end_image_url: END });
  });

  it("reference clips beside an end frame alone are refused with the same words as beside both frames", () => {
    expect(() => plan("minimax-h3", { endImage: END, videos: ["https://v3b.fal.media/files/in/ref.mp4"] })).toThrow(/can't go with an end frame/);
  });
});

describe("conformance: a route that takes an end frame alone (ModelRoute.endAlone)", () => {
  const flagged = MODELS.flatMap((m) => m.routes.filter((r) => r.endAlone).map((r) => ({ id: m.id, route: r })));

  it("is fal's H3 family's image to video, and nothing else", () => {
    expect([...new Set(flagged.map((f) => f.route.endpoint))].sort()).toEqual(["minimax/h3-max-turbo/image-to-video", "minimax/h3-max/image-to-video", "minimax/h3/image-to-video"]);
  });

  it("has a saved schema whose start frame is optional and whose end frame may go alone", () => {
    for (const { id, route } of flagged) {
      expect(SCHEMA_INDEX.fal, `${id} ${route.endpoint}`).toContain(route.endpoint);
      const schema = inputSchema("fal", route.endpoint);
      const start = route.map!.image!;
      const end = route.map!.endImage!;
      expect(schema.properties, route.endpoint).toHaveProperty(end);
      expect((schema as { required?: string[] }).required ?? [], route.endpoint).not.toContain(start);
      expect((schema.properties![end] as { description?: string }).description, route.endpoint).toMatch(/provided alone/i);
    }
  });
});

describe("an end frame alone on a model that uses it only after a start frame", () => {
  const others = MODELS.filter((m) => m.kind === "video" && m.options.endFrame && !takesEndAlone(m) && routesFor(m, "t2v").length);

  it("covers hosted and open models (H3 Lite, Kling, H3 on your GPU)", () => {
    const ids = others.map((m) => m.id);
    for (const id of ["minimax-h3-lite", "kling-3", "oss-minimax-h3"]) expect(ids, id).toContain(id);
  });

  it("is said before the run, and the run's notes say it was made without it", () => {
    for (const m of others) {
      const why = endFrameAloneProblem(m, { endImage: END });
      expect(why, m.id).toBe(`${m.name} uses an end frame only after a start frame`);
      // With a start frame there is nothing to say.
      expect(endFrameAloneProblem(m, { images: [IMG], endImage: END }), m.id).toBeNull();
      expect(inferOperation(m, { inputs: { endImage: END } }), m.id).not.toBe("flf2v");
      let p: ReturnType<typeof plan>;
      try {
        p = plan(m.id, { endImage: END });
      } catch {
        // A model whose text-to-video needs more than words (a refusal says why, and the composer note comes first).
        continue;
      }
      expect(p.notes, m.id).toContain(`${why}: this clip is made without it`);
    }
  });

  it("H3 Lite and Kling make the clip from the words, and say the end frame wasn't used", () => {
    for (const id of ["minimax-h3-lite", "kling-3"]) {
      const p = plan(id, { endImage: END });
      expect(p.op, id).toBe("t2v");
      expect(p.notes, id).toContain(`${getModel(id)!.name} uses an end frame only after a start frame: this clip is made without it`);
    }
  });

  it("an explicit start-and-end op still asks for both frames", () => {
    expect(() => plan("kling-3", { endImage: END }, "flf2v")).toThrow("Add a start and an end frame");
  });
});
