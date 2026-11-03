import http from "node:http";
import zlib from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "./helpers/temp-dir";

/*
 * The Explainer's PDF and Word sources: .docx text through the bounded unzip (word/document.xml only),
 * PDFs through Assist's unpdf reader, long documents summarised by the engine's text model (a stand-in
 * Ollama here), and the multipart route the source picker posts to. Fixtures are built in the test.
 */

vi.setConfig({ testTimeout: 60_000 });
const dir = tempDir("fuobe-explainer-docs-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const { probeOllama } = await import("@/server/providers/llm");
const { docxText, documentXmlText, DocxError } = await import("@/server/assist/docx");
const { unzip } = await import("@/server/assist/unzip");
const faceless = await import("@/server/faceless");
const documentRoute = await import("@/app/api/explainer/document/route");
const explainerRoute = await import("@/app/api/explainer/route");

// ---------------------------------------------------------------------------
// Fixtures

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** A ZIP with deflated entries, the way Word writes a .docx. */
function zipDeflated(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const packed = zlib.deflateRawSync(f.data);
    const crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(packed.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(packed.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, packed);
    centrals.push(ch, name);
    offset += 30 + name.length + packed.length;
  }
  const dirBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dirBuf, end]);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const para = (...runs: string[]) => `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${runs.map((r) => `<w:r><w:rPr><w:b/></w:rPr>${r}</w:r>`).join("")}</w:p>`;
const t = (s: string) => `<w:t xml:space="preserve">${s}</w:t>`;

/** A minimal Word document: the parts Word needs, the body paragraphs and a title. */
function makeDocx(body: string, opts: { title?: string; extra?: { name: string; data: Buffer }[] } = {}): Buffer {
  return zipDeflated([
    { name: "[Content_Types].xml", data: Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>') },
    { name: "_rels/.rels", data: Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>') },
    { name: "word/document.xml", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W}>\n  <w:body>\n    ${body}\n    <w:sectPr/>\n  </w:body>\n</w:document>`) },
    ...(opts.title ? [{ name: "docProps/core.xml", data: Buffer.from(`<cp:coreProperties xmlns:cp="x" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${opts.title}</dc:title></cp:coreProperties>`) }] : []),
    ...(opts.extra ?? []),
  ]);
}

/** A small valid PDF: one page per entry, each line drawn with Helvetica (as in assist-skills.test.ts). */
function makePdf(pages: string[][]): Buffer {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((lines, i) => {
    const ops = lines.map((l, k) => `BT /F1 12 Tf 72 ${720 - k * 18} Td (${l.replace(/[()\\]/g, "\\$&")}) Tj ET`).join("\n");
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${Buffer.byteLength(ops)} >>\nstream\n${ops}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const upload = (name: string, data: Buffer, type = "", engine = "cloud") => {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(data)], name, { type }));
  form.append("engine", engine);
  return new Request("http://x/api/explainer/document", { method: "POST", body: form });
};

// A stand-in Ollama for the summaries.
const asked: { system: string; user: string }[] = [];
const ollama = http.createServer((req, res) => {
  if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [] }));
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const m = (JSON.parse(body) as { messages: { content: string }[] }).messages;
    asked.push({ system: m[0].content, user: m[1].content });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ message: { content: "The report says tides rise twice a day. The moon does most of the pulling." } }));
  });
});
let ollamaUrl = "";

beforeAll(async () => {
  await new Promise<void>((r) => ollama.listen(0, "127.0.0.1", r));
  ollamaUrl = `http://127.0.0.1:${(ollama.address() as { port: number }).port}`;
  setSetting("demoMode", "auto");
});
afterAll(() => {
  ollama.close();
});
beforeEach(async () => {
  asked.length = 0;
  // No text model unless a test turns Ollama on.
  setSetting("ollamaUrl", "http://127.0.0.1:9");
  await probeOllama(true);
});

// ---------------------------------------------------------------------------

describe("Word documents (.docx)", () => {
  it("reads paragraphs, tabs, breaks and table cells in order, without deleted text or field codes", () => {
    const xml = `<w:document ${W}><w:body>
      ${para(t("Tides &amp; the Moon"))}
      ${para(t("Twice a day"), "<w:tab/>", t("the sea rises."), "<w:br/>", t("Then it falls."))}
      ${para(t("Kept "), "<w:delText>removed </w:delText>", t("text"), '<w:instrText xml:space="preserve"> PAGE </w:instrText>')}
      <w:tbl><w:tr><w:tc>${para(t("High"))}</w:tc><w:tc>${para(t("06:12"))}</w:tc></w:tr><w:tr><w:tc>${para(t("Low"))}</w:tc><w:tc>${para(t("12:30"))}</w:tc></w:tr></w:tbl>
      <w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps">${t("In a box")}</mc:Choice><mc:Fallback>${t("In a box")}</mc:Fallback></mc:AlternateContent></w:r></w:p>
      ${para(t("&#8220;Quoted&#x201D; &lt;tag&gt; caf&#233;"))}
      <w:p/><w:p/><w:p/>
      ${para(t("The end."))}
    </w:body></w:document>`;
    expect(documentXmlText(xml)).toBe(["Tides & the Moon", "Twice a day\tthe sea rises.", "Then it falls.", "Kept text", "High\t06:12", "Low\t12:30", "In a box", "“Quoted” <tag> café", "", "The end."].join("\n"));
  });

  it("leaves out a paragraph's tab stops (they're <w:tab>s in its properties, not tabs in the text)", () => {
    const stops = '<w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/><w:tab w:val="right" w:leader="dot" w:pos="9000"/></w:tabs></w:pPr>';
    const xml = `<w:document ${W}><w:body><w:p>${stops}<w:r>${t("Contents")}</w:r></w:p><w:p>${stops}<w:r>${t("Second paragraph")}<w:tab/>${t("12")}</w:r></w:p></w:body></w:document>`;
    expect(documentXmlText(xml)).toBe("Contents\nSecond paragraph\t12");
    // A line break inside a table cell keeps the row on one line.
    expect(documentXmlText(`<w:tbl><w:tr><w:tc>${para(t("Two"), "<w:br/>", t("lines"))}</w:tc><w:tc>${para(t("x"))}</w:tc></w:tr></w:tbl>`)).toBe("Two lines\tx");
  });

  it("reads a crafted document in time that grows with its size, not its square", () => {
    // Tags that never close and runs of blanks used to make the regexes rescan the rest of the file for each one.
    const crafted = [
      "<w:tc>".repeat(200_000),
      "<mc:Fallback>".repeat(100_000),
      "<w:delText x>".repeat(100_000),
      `<w:p><w:r><w:t>${" ".repeat(1_000_000)}x${"\u00a0 ".repeat(200_000)}y</w:t></w:r></w:p>`,
    ];
    const started = performance.now();
    for (const xml of crafted) documentXmlText(xml);
    expect(documentXmlText(`<w:p><w:r><w:t>${" ".repeat(1_000_000)}x${"  ".repeat(100_000)}\ty</w:t></w:r></w:p>`)).toBe("x\ty");
    expect(performance.now() - started).toBeLessThan(2_000);
    // Through the .docx reader: a few KB that inflate to 12 MB of unclosed cells, refused quickly.
    const bomb = makeDocx("<w:tc>".repeat(2_000_000));
    expect(bomb.length).toBeLessThan(100_000);
    const t0 = performance.now();
    expect(() => docxText(bomb, { maxChars: 40_000 })).toThrow(/no text to read/);
    expect(performance.now() - t0).toBeLessThan(2_000);
    // A long document stops being read once there's enough text.
    const long = makeDocx(para(t("The tide comes in. ")).repeat(200_000));
    const t1 = performance.now();
    expect(docxText(long, { maxChars: 1000 }).text).toHaveLength(1000);
    expect(performance.now() - t1).toBeLessThan(2_000);
  });

  it("reads a .docx's text and title, inflating only the document (a large picture inside costs nothing)", () => {
    const picture = Buffer.alloc(60 * 1024 * 1024); // 60 MB of zeros: deflates to a few KB, would blow every cap if inflated
    const docx = makeDocx([para(t("Why the sea has tides.")), para(t("The Moon pulls the water."))].join(""), { title: "Tides &amp; you", extra: [{ name: "word/media/image1.png", data: picture }] });
    expect(docx.length).toBeLessThan(200_000);
    expect(docxText(docx, { maxChars: 10_000 })).toEqual({ text: "Why the sea has tides.\nThe Moon pulls the water.", title: "Tides & you" });
    expect(docxText(docx, { maxChars: 12 }).text).toBe("Why the sea ");
    // The same archive read whole stops at the caps.
    expect(() => unzip(docx, { maxFileBytes: 40_000_000, maxTotalBytes: 45_000_000, maxEntries: 100 })).toThrow(/over 40 MB/);
  });

  it("says what's wrong with files it can't read", () => {
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]);
    expect(() => docxText(ole, { maxChars: 100 })).toThrow(/older Word file \(\.doc\) — save it as \.docx or PDF/);
    expect(() => docxText(Buffer.from("just text"), { maxChars: 100 })).toThrow(/damaged or isn't a Word document/);
    expect(() => docxText(zipDeflated([{ name: "xl/workbook.xml", data: Buffer.from("<x/>") }]), { maxChars: 100 })).toThrow(/isn't a Word document \(\.docx\)/);
    expect(() => docxText(makeDocx('<w:p><w:r><w:drawing/></w:r></w:p>'), { maxChars: 100 })).toThrow(/no text to read/);
    expect(() => docxText(makeDocx('<w:p/>'), { maxChars: 100 })).toThrow(DocxError);
  });
});

describe("Explainer document sources", () => {
  it("knows a PDF and a Word file by their bytes and names", () => {
    expect(faceless.documentKind({ name: "x.bin", data: makePdf([["Hi"]]) })).toBe("pdf");
    expect(faceless.documentKind({ name: "notes.docx", data: makeDocx(para(t("Hi"))) })).toBe("docx");
    expect(faceless.documentKind({ name: "blob", data: makeDocx(para(t("Hi"))), type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })).toBe("docx");
    expect(faceless.documentKind({ name: "old.doc", data: Buffer.alloc(8) })).toBe("docx"); // the Word reader explains .doc
    expect(faceless.documentKind({ name: "a.zip", data: makeDocx(para(t("Hi"))) })).toBeNull();
    expect(faceless.documentKind({ name: "notes.txt", data: Buffer.from("hello") })).toBeNull();
  });

  it("keeps a short document as it is, page count included", async () => {
    const r = await faceless.readDocument({ name: "tides.pdf", data: makePdf([["The tide rises twice a day."], ["The Moon pulls the sea."]]) }, "cloud");
    expect(r).toEqual({ source: { kind: "text", name: "tides.pdf", text: "The tide rises twice a day.\n\nThe Moon pulls the sea." }, pages: 2, summarized: false });
    const w = await faceless.readDocument({ name: "tides.docx", data: makeDocx(para(t("Spring tides follow the full Moon."))) }, "open");
    expect(w).toEqual({ source: { kind: "text", name: "tides.docx", text: "Spring tides follow the full Moon." }, summarized: false });
    expect(asked).toHaveLength(0);
  });

  it("says how many pages of a long PDF were read", async () => {
    const line = "High water at the harbour is about twelve hours and twenty-five minutes apart.";
    const pdf = makePdf(Array.from({ length: 30 }, () => Array.from({ length: 36 }, () => line)));
    const r = await faceless.readDocument({ name: "tables.pdf", data: pdf }, "cloud");
    // 30 pages of about 2,900 characters: the 40,000 the summary is written from run into page 15.
    expect(r).toMatchObject({ pages: 30, readPages: 15, summarized: false });
    const short = await faceless.readDocument({ name: "two.pdf", data: makePdf([[line], [line]]) }, "cloud");
    expect(short.pages).toBe(2);
    expect(short.readPages).toBeUndefined();
  });

  it("summarises a long document with the engine's text model, and keeps the beginning without one", async () => {
    const lines = Array.from({ length: 400 }, (_, i) => para(t(`Paragraph ${i + 1}: the tide tables for the harbour list high and low water for every day of the month.`)));
    const docx = makeDocx(lines.join(""), { title: "Harbour tides" });
    // No text model: the beginning, up to what a source holds.
    const plain = await faceless.readDocument({ name: "harbour.docx", data: docx }, "cloud");
    expect(plain.summarized).toBe(false);
    expect(plain.source.text.startsWith("Paragraph 1: the tide tables")).toBe(true);
    expect(plain.source.text.length).toBe(20_000);
    // With Ollama: a summary, written from the document's text under its title.
    setSetting("ollamaUrl", ollamaUrl);
    await probeOllama(true);
    const sum = await faceless.readDocument({ name: "harbour.docx", data: docx }, "cloud");
    expect(sum).toEqual({ source: { kind: "text", name: "harbour.docx", text: "The report says tides rise twice a day. The moon does most of the pulling." }, summarized: true });
    expect(asked).toHaveLength(1);
    expect(asked[0].system).toMatch(/^You summarise documents for a video script writer/);
    expect(asked[0].user.startsWith("Document: Harbour tides\n\nParagraph 1:")).toBe(true);
    expect(asked[0].user.length).toBeLessThanOrEqual(40_000 + "Document: Harbour tides\n\n".length);
  });

  it("the route reads a multipart upload, and refuses what it can't read with a clear message", async () => {
    const ok = await documentRoute.POST(upload("brief.docx", makeDocx(para(t("Explain the water cycle for kids."))), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { source: { kind: string; name: string; text: string } };
    expect(body.source).toEqual({ kind: "text", name: "brief.docx", text: "Explain the water cycle for kids." });
    const pdf = await documentRoute.POST(upload("brief.pdf", makePdf([["Clouds form when vapour cools."]]), "application/pdf", "open"));
    expect(await pdf.json()).toMatchObject({ source: { text: "Clouds form when vapour cools." }, pages: 1 });

    const cases: [Request, number, RegExp][] = [
      [upload("old.doc", Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64)])), 422, /older Word file/],
      [upload("scan.pdf", makePdf([[]])), 422, /no text to read \(it may be scanned images\)/],
      [upload("broken.pdf", Buffer.from("%PDF-1.4 nothing else")), 422, /damaged or isn't a PDF/],
      [upload("notes.txt", Buffer.from("plain text")), 415, /isn't a PDF or a Word file/],
      [upload("huge.pdf", Buffer.alloc(faceless.MAX_DOCUMENT_BYTES + 1)), 413, /over 20 MB/],
      [new Request("http://x/api/explainer/document", { method: "POST", body: new FormData() }), 400, /Choose a PDF or a Word file/],
    ];
    for (const [req, status, error] of cases) {
      const res = await documentRoute.POST(req);
      expect(res.status, String(error)).toBe(status);
      expect(((await res.json()) as { error: string }).error).toMatch(error);
    }
  });

  it("a document source goes into an explainer like any text source", async () => {
    const { source } = await faceless.readDocument({ name: "volcano.docx", data: makeDocx(para(t("Magma rises through cracks in the crust."))) }, "cloud");
    const res = await explainerRoute.POST(
      new Request("http://x/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "",
          sources: [source],
          review: true,
          settings: { engine: "cloud", length: 30, animation: "animated", aspect: "16:9", subtitles: true, music: false, styleId: "editorial-motion-graphics", styleRefs: [], voice: { kind: "preset", id: "Xb7hH8MSUJpSbSDYk0k2" }, elements: [] },
        }),
      }),
    );
    expect(res.status).toBe(201);
    const ep = (await res.json()) as { id: string; sources: unknown[] };
    expect(ep.sources).toEqual([{ kind: "text", name: "volcano.docx", text: "Magma rises through cracks in the crust." }]);
    await faceless.deleteEpisode(ep.id);
  });
});
