/**
 * A finished job's results as a worker reads them from its own ComfyUI (bin/lib/worker/results.mjs): an SVG comes without
 * the <metadata> element that ComfyUI's SVG save node writes into it (the run's graph, its prompt included), in the
 * kept copy and in what goes up to the studio. Every other result is read as it is. Each prompt goes to its ComfyUI
 * with every clip save node told to write no metadata.
 */
import { describe, expect, it } from "vitest";
import { Hold } from "../bin/lib/worker/hold.mjs";
import { graphWithoutMetadata, plainPromptBody, plainResult, svgWithoutMetadata, withPlainResults } from "../bin/lib/worker/results.mjs";
import { tempDir } from "./helpers/temp-dir";

/** An SVG as ComfyUI's SVG save node writes it: the graph in a CDATA section, right after the opening tag. */
const graph = { "1": { class_type: "LoadImage", inputs: { image: "fuobe_abcdefgh01.png" } }, "5": { class_type: "CLIPTextEncode", inputs: { text: "a private prompt </metadata> with İstanbul in it" } } };
const shapes = '<path d="M0 0h10v10H0z" fill="#1a2b3c"/><path d="M2 2h6v6H2z" fill="#ffffff"/>';
const saved = (meta = graph) =>
  `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="10" height="10">\n  <metadata>\n                <![CDATA[\n            ${JSON.stringify({ prompt: meta }, null, 2)}\n                ]]>\n            </metadata>\n            ${shapes}</svg>`;
const clean = `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="10" height="10">\n  \n            ${shapes}</svg>`;

const view = (filename: string, type = "output") => `http://127.0.0.1:41234/view?${new URLSearchParams({ filename, subfolder: "fuobe", type })}`;

describe("a worker's results carry nothing a save node wrote into them unasked", () => {
  it("takes the <metadata> element out of an SVG, and leaves the rest byte for byte", () => {
    expect(svgWithoutMetadata(saved())).toBe(clean);
    expect(svgWithoutMetadata(saved())).not.toMatch(/prompt|CLIPTextEncode|fuobe_abcdefgh01|İstanbul/);
    // No metadata: nothing changes.
    expect(svgWithoutMetadata(`<svg>${shapes}</svg>`)).toBe(`<svg>${shapes}</svg>`);
    // Other shapes of the element: empty, with attributes, in capitals, nested, more than one, a comment inside.
    expect(svgWithoutMetadata(`<svg><metadata/>${shapes}<metadata id="m" /></svg>`)).toBe(`<svg>${shapes}</svg>`);
    expect(svgWithoutMetadata(`<svg><METADATA lang="en">x<rdf:RDF><metadata>y</metadata></rdf:RDF></Metadata >${shapes}</svg>`)).toBe(`<svg>${shapes}</svg>`);
    expect(svgWithoutMetadata(`<svg><metadata>a</metadata>${shapes}<metadata><!-- </metadata> -->b</metadata></svg>`)).toBe(`<svg>${shapes}</svg>`);
    // A name that only starts the same stays.
    expect(svgWithoutMetadata(`<svg><metadataX>a</metadataX></svg>`)).toBe(`<svg><metadataX>a</metadataX></svg>`);
    // An element that never closes takes the rest with it (nothing of the graph goes up).
    expect(svgWithoutMetadata(`<svg>${shapes}<metadata><![CDATA[{"prompt": 1}`)).toBe(`<svg>${shapes}`);
    expect(svgWithoutMetadata(`<svg>${shapes}<metadata`)).toBe(`<svg>${shapes}`);
  });

  it("reads an SVG result from /view without it; every other answer comes as it is", async () => {
    const svgRes = () => new Response(saved(), { headers: { "Content-Type": "image/svg+xml", "Content-Length": "9999" } });
    const res = await plainResult(view("fuobe_x_00001_.svg"), svgRes());
    expect(await res.text()).toBe(clean);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-length")).toBeNull();
    expect(await (await plainResult(view("fuobe_x_00001_.SVG", "temp"), svgRes())).text()).toBe(clean);
    // A picture, a clip, another path, a failed answer, a POST: untouched.
    for (const [url, init] of [
      [view("fuobe_x_00001_.png"), undefined],
      [view("fuobe_x_00001_.mp4"), undefined],
      ["http://127.0.0.1:41234/history/0b4c3c1e-8d4f-4b8e-9f0a-2a1b3c4d5e6f", undefined],
      ["http://127.0.0.1:41234/upload/image?filename=x.svg", undefined],
      [view("fuobe_x_00001_.svg"), { method: "POST" }],
    ] as [string, RequestInit | undefined][]) {
      const r = svgRes();
      expect(await plainResult(url, r, init), url).toBe(r);
    }
    const missing = new Response("Not found", { status: 404 });
    expect(await plainResult(view("x.svg"), missing)).toBe(missing);
  });

  it("the kept copy and the upload come without it", async () => {
    const local = withPlainResults(async (url: string) => {
      const name = new URL(url).searchParams.get("filename") ?? "";
      return name.endsWith(".svg") ? new Response(saved(), { headers: { "Content-Type": "image/svg+xml" } }) : new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } });
    });
    const hold = new Hold(tempDir("fuobe-worker-results-"));
    const t = { id: "abcdefgh01234567", promptId: "0b4c3c1e-8d4f-4b8e-9f0a-2a1b3c4d5e6f" };
    const files = [
      { filename: "fuobe_x_00001_.svg", subfolder: "fuobe", type: "output" },
      { filename: "fuobe_x_00001_.png", subfolder: "fuobe", type: "output" },
    ];
    const entries = [{ status: { completed: true }, outputs: { "4": { images: files } } }];
    await hold.keep(t, { kind: "finished", entries }, (f: { filename: string; subfolder: string; type: string }) => local(`http://127.0.0.1:41234/view?${new URLSearchParams(f)}`));
    const svg = await hold.file(t, files[0]);
    expect(await svg!.text()).toBe(clean);
    const png = await hold.file(t, files[1]);
    expect([...new Uint8Array(await png!.arrayBuffer())]).toEqual([137, 80, 78, 71]);
    // Read again straight from its ComfyUI (no kept copy): the same.
    expect(await (await local(view("fuobe_x_00001_.svg"))).text()).toBe(clean);
  });

  it("tells every clip save node to write no metadata, and changes nothing else", () => {
    const combine = (inputs: Record<string, unknown>) => ({ class_type: "VHS_VideoCombine", inputs: { images: ["2", 0], frame_rate: 24, filename_prefix: "fuobe/x", format: "video/h264-mp4", ...inputs } });
    const g = {
      "1": combine({ save_metadata: true }),
      "2": { class_type: "KSampler", inputs: { seed: 1, save_metadata: true } },
      "3": combine({}),
      "4": combine({ save_metadata: ["9", 0] }),
      "5": { class_type: "VHS_VideoCombine" },
    };
    const before = structuredClone(g);
    const out = graphWithoutMetadata(g);
    expect(out["1"].inputs.save_metadata).toBe(false);
    expect(out["3"].inputs.save_metadata).toBe(false);
    expect(out["4"].inputs.save_metadata).toBe(false);
    expect(out["5"]).toEqual({ class_type: "VHS_VideoCombine", inputs: { save_metadata: false } });
    // Another node keeps its inputs, and every other input of the save node stays.
    expect(out["2"]).toEqual(g["2"]);
    expect({ ...out["1"].inputs, save_metadata: true }).toEqual(g["1"].inputs);
    // The graph it was given is left as it was.
    expect(g).toEqual(before);
    for (const v of [null, undefined, "x", [1, 2]]) expect(graphWithoutMetadata(v)).toBe(v);
  });

  it("a prompt goes to its ComfyUI with its clip save nodes told to write no metadata", async () => {
    const body = { prompt: { "9": { class_type: "VHS_VideoCombine", inputs: { format: "video/h264-mp4", save_metadata: true } } }, prompt_id: "0b4c3c1e-8d4f-4b8e-9f0a-2a1b3c4d5e6f", client_id: "c" };
    expect(JSON.parse(plainPromptBody(JSON.stringify(body)))).toEqual({ ...body, prompt: { "9": { class_type: "VHS_VideoCombine", inputs: { format: "video/h264-mp4", save_metadata: false } } } });
    // Anything that isn't a prompt as JSON stays as it is.
    for (const b of ["not json", '{"delete":["x"]}', "[1]", "null", undefined]) expect(plainPromptBody(b)).toBe(b);
    const form = new FormData();
    expect(plainPromptBody(form)).toBe(form);

    const seen: { url: string; init?: RequestInit }[] = [];
    const local = withPlainResults(async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return Response.json({ prompt_id: body.prompt_id, number: 1 });
    });
    await local("http://127.0.0.1:41234/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect(JSON.parse(String(seen[0].init?.body)).prompt["9"].inputs.save_metadata).toBe(false);
    expect(new Headers(seen[0].init?.headers).get("content-type")).toBe("application/json");
    // Other calls go as they came: a read, another path, a prompt read back.
    for (const [url, init] of [
      ["http://127.0.0.1:41234/history", { method: "POST", body: JSON.stringify(body) }],
      ["http://127.0.0.1:41234/prompt", undefined],
      ["http://127.0.0.1:41234/api/prompt/x", { method: "POST", body: JSON.stringify(body) }],
    ] as [string, RequestInit | undefined][]) {
      await local(url, init);
      expect(seen.at(-1)!.init, url).toBe(init);
    }
  });
});
