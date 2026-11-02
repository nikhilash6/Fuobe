import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/** pnpm eval:covers --from-masters: rendered masters (one folder per preset id) become covers, merged into the manifest. */
type Entry = { poster: string; video?: string; run: string; engine: string; model: string; variant: string };
type Cover = Entry & { key: string; kind: "image" | "video"; from: string; kept?: true };
const covers = (await import("../scripts/eval/lib/covers.mjs")) as unknown as {
  coversFromMasters: (dir: string, opts: Record<string, unknown>) => { covers: Cover[]; skipped: { id: string; why: string }[] };
  readManifest: (file: string) => Record<string, Entry>;
  writeManifest: (entries: Record<string, Entry>, file: string) => void;
  withVersions: (entries: Record<string, Entry>, publicDir: string) => Record<string, Entry>;
  versionCovers: (opts: { publicDir?: string; manifest?: string; dryRun?: boolean }) => { entries: number; urls: number; changed: number; thumbs: string[]; unversioned: string[] };
  seamless: (frames: Buffer[], fade: number) => Buffer[];
  loopsAlready: (frames: Buffer[], luma: number) => boolean;
};
const { coversFromMasters, loopsAlready, readManifest, seamless, versionCovers, withVersions, writeManifest } = covers;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-covers-masters-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A content version as the covers spell it: the first 8 hex digits of the sha256 of these files, one after another. */
const sha8 = (...files: string[]) => {
  const hash = createHash("sha256");
  for (const f of files) hash.update(fs.readFileSync(f));
  return hash.digest("hex").slice(0, 8);
};
/** A cover URL at that path with any version. */
const versioned = (url: string) => expect.stringMatching(new RegExp(`^${url.replaceAll(".", "\\.")}\\?v=[0-9a-f]{8}$`));
/** The slim covers map written next to a manifest. */
const readSlim = (manifest: string) => {
  const text = fs.readFileSync(path.join(path.dirname(manifest), "preset-covers.generated.ts"), "utf8");
  return { text, slim: JSON.parse(text.slice(text.indexOf("=", text.indexOf("export const PRESET_COVERS")) + 1).trim().replace(/;\s*$/, "")) };
};

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const SAMPLES = path.join(process.cwd(), "public", "samples");

function master(root: string, id: string, files: Record<string, string>) {
  fs.mkdirSync(path.join(root, id), { recursive: true });
  for (const [name, from] of Object.entries(files)) fs.copyFileSync(from, path.join(root, id, name));
}

/** A small PNG still, made from a sample clip's first frame. */
function still(): string {
  const png = path.join(dir, "still.png");
  if (!fs.existsSync(png)) spawnSync("ffmpeg", ["-v", "error", "-y", "-i", path.join(SAMPLES, "demo-landscape.mp4"), "-frames:v", "1", png]);
  return png;
}

const PROVENANCE = { run: "comfyui-previews-test", engine: "comfyui", model: "ideogram4", videoModel: "minimax-h3", variant: "lean-json" };

describe("covers from masters", () => {
  it("needs a run name and a masters folder", () => {
    expect(() => coversFromMasters(dir, {})).toThrow(/--run/);
    expect(() => coversFromMasters(path.join(dir, "nope"), { run: "r" })).toThrow(/No masters folder/);
  });

  it("dry run: a clip where there is one, else the start still; folders without either are skipped; nothing is written", () => {
    const masters = path.join(dir, "dry");
    master(masters, "effect-set-on-fire", { "clip.mp4": path.join(SAMPLES, "demo-portrait.mp4"), "start.png": path.join(SAMPLES, "previews", "portrait.svg") });
    master(masters, "app-headshot-generator", { "start.png": path.join(SAMPLES, "previews", "portrait.svg") });
    master(masters, "motion-still-rendering", {});
    const manifest = path.join(dir, "dry-manifest.ts");
    const r = coversFromMasters(masters, { ...PROVENANCE, dryRun: true, publicDir: path.join(dir, "dry-public"), manifest });
    expect(r.covers.map((c) => [c.key, !!c.video, c.model])).toEqual([
      ["app-headshot-generator", false, "ideogram4"],
      ["effect-set-on-fire", true, "minimax-h3"],
    ]);
    expect(r.covers[1]).toMatchObject({ poster: "/previews/presets/effect-set-on-fire.jpg", video: "/previews/presets/effect-set-on-fire.mp4", run: "comfyui-previews-test", engine: "comfyui", variant: "lean-json" });
    expect(r.skipped).toEqual([{ id: "motion-still-rendering", why: "no clip.mp4 or start.png yet" }]);
    expect(fs.existsSync(manifest)).toBe(false);
    expect(fs.existsSync(path.join(dir, "dry-public"))).toBe(false);
  });

  it.runIf(hasFfmpeg)("encodes small covers and merges them into the manifest, keeping other runs' entries; runs again cheaply", () => {
    const masters = path.join(dir, "masters");
    const pub = path.join(dir, "public");
    const out = path.join(pub, "previews", "presets");
    const manifest = path.join(dir, "manifest.ts");
    // An earlier eval run's cover, and an earlier masters cover that this run replaces.
    const measured = { poster: "/previews/dop/effect-thunder-god.jpg", video: "/previews/dop/effect-thunder-god.mp4", run: "r1", engine: "open", model: "oss-wan22-14b", variant: "research" };
    writeManifest({ "effect-thunder-god": measured, "app-headshot-generator": { poster: "/previews/presets/old.jpg", run: "old", engine: "comfyui", model: "x", variant: "y" } }, manifest);
    master(masters, "effect-set-on-fire", { "clip.mp4": path.join(SAMPLES, "demo-portrait.mp4") });
    master(masters, "app-headshot-generator", { "start.png": still() });
    // A folder's meta.json can name the model that made it.
    fs.writeFileSync(path.join(masters, "app-headshot-generator", "meta.json"), JSON.stringify({ model: "krea2-realism" }));

    const r = coversFromMasters(masters, { ...PROVENANCE, publicDir: pub, manifest });
    expect(r.covers).toHaveLength(2);
    const m = readManifest(manifest);
    expect(Object.keys(m)).toEqual(["app-headshot-generator", "effect-set-on-fire", "effect-thunder-god"]);
    // Its files aren't in this public folder, so its URLs get no version.
    expect(m["effect-thunder-god"]).toEqual(measured);
    expect(m["app-headshot-generator"]).toEqual({ poster: versioned("/previews/presets/app-headshot-generator.jpg"), run: "comfyui-previews-test", engine: "comfyui", model: "krea2-realism", variant: "lean-json" });
    expect(m["effect-set-on-fire"]).toEqual({ poster: versioned("/previews/presets/effect-set-on-fire.jpg"), video: versioned("/previews/presets/effect-set-on-fire.mp4"), run: "comfyui-previews-test", engine: "comfyui", model: "minimax-h3", variant: "lean-json" });
    // Each URL's version is its file's, made after the small copies: a poster's with its small copy's, a clip's its own.
    const fire = m["effect-set-on-fire"];
    expect(fire.poster).toBe(`/previews/presets/effect-set-on-fire.jpg?v=${sha8(path.join(out, "effect-set-on-fire.jpg"), path.join(out, "thumbs", "effect-set-on-fire.jpg"))}`);
    expect(fire.video).toBe(`/previews/presets/effect-set-on-fire.mp4?v=${sha8(path.join(out, "effect-set-on-fire.mp4"))}`);
    expect(r.covers.find((c) => c.key === "effect-set-on-fire")).toMatchObject({ poster: fire.poster, video: fire.video });
    expect(readSlim(manifest).slim["effect-set-on-fire"]).toEqual([fire.poster.split("=")[1], fire.video!.split("=")[1]]);
    // Still: at most 768 px; clip: at most 512 px and 4 s, no audio.
    const probe = (f: string) => JSON.parse(spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", path.join(out, f)], { encoding: "utf8" }).stdout);
    const s = probe("app-headshot-generator.jpg").streams[0];
    expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(768);
    // 4:2:0, not the 4:4:4 a PNG source would give: about a third smaller.
    const pix = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=pix_fmt", "-of", "csv=p=0", path.join(out, "app-headshot-generator.jpg")], { encoding: "utf8" }).stdout.trim();
    expect(pix).toBe("yuvj420p");
    const v = probe("effect-set-on-fire.mp4");
    expect(v.streams.map((x: { codec_type: string }) => x.codec_type)).toEqual(["video"]);
    expect(Math.max(v.streams[0].width, v.streams[0].height)).toBeLessThanOrEqual(512);
    expect(Number(v.format.duration)).toBeLessThanOrEqual(4.1);
    // Each poster's small copy for the pickers' tiles, in thumbs/ next to it: at most 320 px wide, a fraction of the poster.
    for (const id of ["app-headshot-generator", "effect-set-on-fire"]) {
      const t = probe(path.join("thumbs", `${id}.jpg`)).streams[0];
      expect(t.width, id).toBe(Math.min(320, probe(`${id}.jpg`).streams[0].width));
      expect(fs.statSync(path.join(out, "thumbs", `${id}.jpg`)).size, id).toBeLessThan(fs.statSync(path.join(out, `${id}.jpg`)).size);
    }
    const thumbTime = () => fs.statSync(path.join(out, "thumbs", "effect-set-on-fire.jpg")).mtimeMs;
    const thumbAt = thumbTime();

    // Again: nothing changed, so nothing is encoded; the manifest is the same.
    const before = fs.readFileSync(manifest, "utf8");
    const again = coversFromMasters(masters, { ...PROVENANCE, publicDir: pub, manifest });
    expect(again.covers.every((c) => c.kept)).toBe(true);
    expect(fs.readFileSync(manifest, "utf8")).toBe(before);
    expect(thumbTime()).toBe(thumbAt);

    // A preset whose clip goes away becomes a still cover and loses its old clip; --only touches just that id.
    fs.rmSync(path.join(masters, "effect-set-on-fire", "clip.mp4"));
    fs.copyFileSync(still(), path.join(masters, "effect-set-on-fire", "start.png"));
    const only = coversFromMasters(masters, { ...PROVENANCE, publicDir: pub, manifest, only: ["effect-set-on-fire"] });
    expect(only.covers.map((c) => c.key)).toEqual(["effect-set-on-fire"]);
    expect(readManifest(manifest)["effect-set-on-fire"]).toEqual({ poster: versioned("/previews/presets/effect-set-on-fire.jpg"), run: "comfyui-previews-test", engine: "comfyui", model: "ideogram4", variant: "lean-json" });
    expect(fs.existsSync(path.join(out, "effect-set-on-fire.mp4"))).toBe(false);
    expect(readManifest(manifest)["effect-thunder-god"]).toEqual(measured);
    // Its new poster gets a new small copy, and both a new URL; the other cover keeps its own.
    expect(thumbTime()).toBeGreaterThan(thumbAt);
    expect(readManifest(manifest)["effect-set-on-fire"].poster).not.toBe(fire.poster);
    expect(readManifest(manifest)["app-headshot-generator"].poster).toBe(m["app-headshot-generator"].poster);

    // A master for a preset whose cover a measured run made: kept, and listed, unless --replace.
    const dop = path.join(pub, "previews", "dop");
    fs.mkdirSync(path.join(dop, "thumbs"), { recursive: true });
    for (const f of ["effect-thunder-god.jpg", "effect-thunder-god.mp4", "thumbs/effect-thunder-god.jpg"]) fs.writeFileSync(path.join(dop, f), "x");
    master(masters, "effect-thunder-god", { "start.png": still() });
    const held = coversFromMasters(masters, { ...PROVENANCE, publicDir: pub, manifest, only: ["effect-thunder-god"] });
    expect(held.covers).toEqual([]);
    expect(held.skipped).toEqual([{ id: "effect-thunder-god", why: "its cover is r1's (/previews/dop/effect-thunder-god.jpg): --replace takes it over" }]);
    expect(readManifest(manifest)["effect-thunder-god"]).toEqual(measured);
    const replaced = coversFromMasters(masters, { ...PROVENANCE, publicDir: pub, manifest, only: ["effect-thunder-god"], replace: true });
    expect(replaced.covers.map((c) => c.key)).toEqual(["effect-thunder-god"]);
    expect(readManifest(manifest)["effect-thunder-god"]).toMatchObject({ poster: versioned("/previews/presets/effect-thunder-god.jpg"), run: "comfyui-previews-test" });
    // The replaced cover's files go, its poster's small copy too.
    expect(fs.readdirSync(dop, { recursive: true, encoding: "utf8" }).filter((f) => /\.(jpg|mp4)$/.test(f))).toEqual([]);
    expect(fs.existsSync(path.join(out, "thumbs", "effect-thunder-god.jpg"))).toBe(true);
  });

  it.runIf(hasFfmpeg)('keeps a clip\'s whole length where its meta.json says {"length": "full"}, and only there', () => {
    const masters = path.join(dir, "masters-full");
    const pub = path.join(dir, "public-full");
    const out = path.join(pub, "previews", "presets");
    const manifest = path.join(dir, "full-manifest.ts");
    // A 5.2 s clip: the sample twice over, cut.
    const long = path.join(dir, "long.mp4");
    spawnSync("ffmpeg", ["-v", "error", "-y", "-stream_loop", "1", "-i", path.join(SAMPLES, "demo-portrait.mp4"), "-t", "5.2", "-an", long]);
    master(masters, "effect-canvas", { "clip.mp4": long });
    fs.writeFileSync(path.join(masters, "effect-canvas", "meta.json"), JSON.stringify({ length: "full" }));
    master(masters, "effect-set-on-fire", { "clip.mp4": long });
    // A still keeps no length: the option is for clips.
    master(masters, "app-headshot-generator", { "start.png": still() });
    fs.writeFileSync(path.join(masters, "app-headshot-generator", "meta.json"), JSON.stringify({ length: "full" }));

    const r = coversFromMasters(masters, { ...PROVENANCE, publicDir: pub, manifest });
    expect(r.covers.map((c) => [c.key, (c as Cover & { length?: string }).length])).toEqual([
      ["app-headshot-generator", undefined],
      ["effect-canvas", "full"],
      ["effect-set-on-fire", undefined],
    ]);
    const seconds = (f: string) => Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(out, f)], { encoding: "utf8" }).stdout);
    const frames = (f: string) => Number(spawnSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", path.join(out, f)], { encoding: "utf8" }).stdout);
    // The usual cover: the first 4 s (96 frames at 24 fps). The full one: all 5.2 s (124 or 125 frames), less the 6 the
    // loop's crossfade blends into its end.
    expect(frames("effect-set-on-fire.mp4")).toBe(96);
    expect(seconds("effect-set-on-fire.mp4")).toBeLessThanOrEqual(4.1);
    expect(frames("effect-canvas.mp4")).toBeGreaterThanOrEqual(118);
    expect(frames("effect-canvas.mp4")).toBeLessThanOrEqual(119);
    expect(seconds("effect-canvas.mp4")).toBeGreaterThan(4.8);
    // The manifest entry is a clip cover like any other: the length is the file's.
    expect(readManifest(manifest)["effect-canvas"]).toEqual({ poster: versioned("/previews/presets/effect-canvas.jpg"), video: versioned("/previews/presets/effect-canvas.mp4"), run: "comfyui-previews-test", engine: "comfyui", model: "minimax-h3", variant: "lean-json" });

    // Run again: kept. A meta.json changed after the cover makes it again, now at 4 s.
    expect(coversFromMasters(masters, { ...PROVENANCE, publicDir: pub, manifest }).covers.every((c) => c.kept)).toBe(true);
    fs.writeFileSync(path.join(masters, "effect-canvas", "meta.json"), JSON.stringify({}));
    const later = new Date(Date.now() + 5_000);
    fs.utimesSync(path.join(masters, "effect-canvas", "meta.json"), later, later);
    const again = coversFromMasters(masters, { ...PROVENANCE, publicDir: pub, manifest });
    expect(again.covers.filter((c) => !c.kept).map((c) => c.key)).toEqual(["effect-canvas"]);
    expect(frames("effect-canvas.mp4")).toBe(96);
  });

  it("reads a missing manifest as empty, and stops at one it can't read rather than write over it", () => {
    expect(readManifest(path.join(dir, "no-such-manifest.ts"))).toEqual({});
    const broken = path.join(dir, "broken-manifest.ts");
    fs.writeFileSync(broken, 'export const PRESET_PREVIEWS: Record<string, PresetPreviewMedia> = {\n  "app-x": { "poster": ');
    expect(() => readManifest(broken)).toThrow(/isn't a covers manifest/);
    const masters = path.join(dir, "masters-broken");
    master(masters, "app-headshot-generator", { "start.png": path.join(SAMPLES, "previews", "portrait.svg") });
    expect(() => coversFromMasters(masters, { ...PROVENANCE, dryRun: true, manifest: broken })).toThrow(/isn't a covers manifest/);
  });

  it("writes the slim covers map the pickers read next to the manifest: the versions of a cover at the usual place, others in full", () => {
    const manifest = path.join(dir, "slim", "manifest.ts");
    const elsewhere = { poster: "/previews/dop/effect-thunder-god.jpg?v=0123abcd", video: "/previews/dop/effect-thunder-god.mp4?v=4567ef01", run: "r1", engine: "open", model: "m", variant: "v" };
    writeManifest(
      {
        "motion-zoom-in": { poster: "/previews/presets/motion-zoom-in.jpg?v=aaaa1111", video: "/previews/presets/motion-zoom-in.mp4?v=bbbb2222", run: "r", engine: "comfyui", model: "m", variant: "v" },
        "effect-thunder-god": elsewhere,
        "app-headshot-generator": { poster: "/previews/presets/app-headshot-generator.jpg?v=cccc3333", run: "r", engine: "comfyui", model: "m", variant: "v" },
        // Not versioned (its file was missing): listed in full, so the pickers never make up a version.
        "app-unversioned": { poster: "/previews/presets/app-unversioned.jpg", run: "r", engine: "comfyui", model: "m", variant: "v" },
      },
      manifest,
    );
    const { text, slim } = readSlim(manifest);
    expect(text).not.toMatch(/"run"|"engine"|"model"|"variant"/);
    expect(slim).toEqual({
      "app-headshot-generator": "cccc3333",
      "app-unversioned": { poster: "/previews/presets/app-unversioned.jpg" },
      "effect-thunder-god": { poster: elsewhere.poster, video: elsewhere.video },
      "motion-zoom-in": ["aaaa1111", "bbbb2222"],
    });
    expect(Object.keys(slim)).toEqual(["app-headshot-generator", "app-unversioned", "effect-thunder-god", "motion-zoom-in"]);
  });

  it("versions each URL from its file's bytes: a file that changes gets a new version, the others keep theirs", () => {
    const pub = path.join(dir, "versions-public");
    const presets = path.join(pub, "previews", "presets");
    const put = (f: string, bytes: string) => {
      fs.mkdirSync(path.dirname(path.join(presets, f)), { recursive: true });
      fs.writeFileSync(path.join(presets, f), bytes);
    };
    put("motion-zoom-in.jpg", "poster");
    put("thumbs/motion-zoom-in.jpg", "small poster");
    put("motion-zoom-in.mp4", "clip");
    put("app-relight.jpg", "still");
    const meta = { run: "r", engine: "comfyui", model: "m", variant: "v" };
    const entries = {
      "motion-zoom-in": { poster: "/previews/presets/motion-zoom-in.jpg", video: "/previews/presets/motion-zoom-in.mp4", ...meta },
      // A still without its small copy yet: versioned by the still alone.
      "app-relight": { poster: "/previews/presets/app-relight.jpg?v=00000000", ...meta },
      // A file that isn't there loses the version it had; a URL outside /previews is left as it is.
      "app-gone": { poster: "/previews/presets/app-gone.jpg?v=12345678", ...meta },
      "app-elsewhere": { poster: "/samples/previews/portrait.svg", ...meta },
    };
    const at = (f: string) => path.join(presets, f);
    const first = withVersions(entries, pub);
    expect(first["motion-zoom-in"]).toEqual({
      ...entries["motion-zoom-in"],
      poster: `/previews/presets/motion-zoom-in.jpg?v=${sha8(at("motion-zoom-in.jpg"), at("thumbs/motion-zoom-in.jpg"))}`,
      video: `/previews/presets/motion-zoom-in.mp4?v=${sha8(at("motion-zoom-in.mp4"))}`,
    });
    expect(first["app-relight"].poster).toBe(`/previews/presets/app-relight.jpg?v=${sha8(at("app-relight.jpg"))}`);
    expect(first["app-gone"].poster).toBe("/previews/presets/app-gone.jpg");
    expect(first["app-elsewhere"].poster).toBe("/samples/previews/portrait.svg");
    // Versioned again, nothing changes: the version is the bytes', not the time's.
    expect(withVersions(first, pub)).toEqual(first);

    // The clip made again: its URL changes, the poster's stays.
    put("motion-zoom-in.mp4", "clip, made again");
    const clipAgain = withVersions(first, pub)["motion-zoom-in"];
    expect(clipAgain.video).not.toBe(first["motion-zoom-in"].video);
    expect(clipAgain.poster).toBe(first["motion-zoom-in"].poster);
    // The small copy made again: the poster's URL changes with it (thumbOf keeps the poster's version).
    put("thumbs/motion-zoom-in.jpg", "small poster, made again");
    const thumbAgain = withVersions(first, pub)["motion-zoom-in"];
    expect(thumbAgain.poster).not.toBe(first["motion-zoom-in"].poster);
    expect(thumbAgain.video).toBe(clipAgain.video);
    // The same bytes back: the same version as before.
    put("motion-zoom-in.mp4", "clip");
    put("thumbs/motion-zoom-in.jpg", "small poster");
    expect(withVersions(first, pub)["motion-zoom-in"]).toEqual(first["motion-zoom-in"]);
  });

  it("versions the manifest from the files as they are, without encoding or touching them (--versions)", () => {
    const pub = path.join(dir, "restamp-public");
    const presets = path.join(pub, "previews", "presets");
    fs.mkdirSync(path.join(presets, "thumbs"), { recursive: true });
    for (const [f, bytes] of [["app-relight.jpg", "a"], ["thumbs/app-relight.jpg", "b"], ["effect-flame-on.jpg", "c"], ["thumbs/effect-flame-on.jpg", "d"], ["effect-flame-on.mp4", "e"]]) fs.writeFileSync(path.join(presets, f), bytes);
    const manifest = path.join(dir, "restamp", "manifest.ts");
    const meta = { run: "r", engine: "comfyui", model: "m", variant: "v" };
    writeManifest(
      {
        "app-relight": { poster: "/previews/presets/app-relight.jpg", ...meta },
        "effect-flame-on": { poster: "/previews/presets/effect-flame-on.jpg", video: "/previews/presets/effect-flame-on.mp4", ...meta },
        "app-missing": { poster: "/previews/presets/app-missing.jpg", ...meta },
      },
      manifest,
    );
    const media = () => fs.readdirSync(presets, { recursive: true, encoding: "utf8" }).map((f) => [f, fs.statSync(path.join(presets, f)).mtimeMs]);
    const was = media();
    const unwritten = fs.readFileSync(manifest, "utf8");

    expect(versionCovers({ publicDir: pub, manifest, dryRun: true })).toMatchObject({ entries: 3, urls: 4, changed: 3, thumbs: [], unversioned: ["/previews/presets/app-missing.jpg"] });
    expect(fs.readFileSync(manifest, "utf8")).toBe(unwritten);
    expect(versionCovers({ publicDir: pub, manifest })).toMatchObject({ changed: 3 });
    const m = readManifest(manifest);
    expect(m["app-relight"].poster).toBe(`/previews/presets/app-relight.jpg?v=${sha8(path.join(presets, "app-relight.jpg"), path.join(presets, "thumbs", "app-relight.jpg"))}`);
    expect(m["effect-flame-on"].video).toBe(`/previews/presets/effect-flame-on.mp4?v=${sha8(path.join(presets, "effect-flame-on.mp4"))}`);
    expect(readSlim(manifest).slim).toEqual({
      "app-missing": { poster: "/previews/presets/app-missing.jpg" },
      "app-relight": m["app-relight"].poster.split("=")[1],
      "effect-flame-on": [m["effect-flame-on"].poster.split("=")[1], m["effect-flame-on"].video!.split("=")[1]],
    });
    // The media is as it was; a second run finds nothing to change.
    expect(media()).toEqual(was);
    expect(versionCovers({ publicDir: pub, manifest })).toMatchObject({ changed: 0 });
  });

  it.runIf(hasFfmpeg)("makes a poster's small copy first when it's missing or older than a poster copied in by hand (--versions)", () => {
    const pub = path.join(dir, "byhand-public");
    const presets = path.join(pub, "previews", "presets");
    fs.mkdirSync(path.join(presets, "thumbs"), { recursive: true });
    const poster = path.join(presets, "app-relight.jpg");
    const thumb = path.join(presets, "thumbs", "app-relight.jpg");
    const newThumb = path.join(presets, "thumbs", "app-headshot.jpg");
    spawnSync("ffmpeg", ["-v", "error", "-y", "-i", still(), "-frames:v", "1", "-q:v", "4", poster]);
    fs.copyFileSync(poster, path.join(presets, "app-headshot.jpg"));
    // The relit poster was copied in by hand over an older one: its small copy still shows the old picture.
    fs.writeFileSync(thumb, "the old picture");
    const before = new Date(Date.now() - 60_000);
    fs.utimesSync(thumb, before, before);
    const manifest = path.join(dir, "byhand", "manifest.ts");
    const meta = { run: "r", engine: "comfyui", model: "m", variant: "v" };
    writeManifest(
      { "app-relight": { poster: "/previews/presets/app-relight.jpg?v=00000000", ...meta }, "app-headshot": { poster: "/previews/presets/app-headshot.jpg", ...meta } },
      manifest,
    );
    const unwritten = fs.readFileSync(manifest, "utf8");
    const thumbs = ["/previews/presets/thumbs/app-headshot.jpg", "/previews/presets/thumbs/app-relight.jpg"];

    // A dry run lists the copies it would make, and makes none.
    expect(versionCovers({ publicDir: pub, manifest, dryRun: true })).toMatchObject({ changed: 2, thumbs, unversioned: [] });
    expect(fs.readFileSync(thumb, "utf8")).toBe("the old picture");
    expect(fs.existsSync(newThumb)).toBe(false);
    expect(fs.readFileSync(manifest, "utf8")).toBe(unwritten);
    // Then it makes them before hashing, so each version is of the poster and its new small copy.
    expect(versionCovers({ publicDir: pub, manifest })).toMatchObject({ changed: 2, thumbs, unversioned: [] });
    for (const f of [thumb, newThumb]) expect(fs.readFileSync(f).subarray(0, 2), f).toEqual(Buffer.from([0xff, 0xd8]));
    const m = readManifest(manifest);
    expect(m["app-relight"].poster).toBe(`/previews/presets/app-relight.jpg?v=${sha8(poster, thumb)}`);
    expect(m["app-headshot"].poster).toBe(`/previews/presets/app-headshot.jpg?v=${sha8(path.join(presets, "app-headshot.jpg"), newThumb)}`);
    // Made once: the next run has nothing to make or change.
    expect(versionCovers({ publicDir: pub, manifest, dryRun: true })).toMatchObject({ changed: 0, thumbs: [] });
  });

  it("makes a clip loop without a jump: its last frames fade into its first, which it then starts after (unless it loops already)", () => {
    const frames = Array.from({ length: 20 }, (_, i) => Buffer.from([i * 10, i * 10]));
    const out = seamless(frames, 4);
    expect(out).toHaveLength(16);
    // It starts at the 5th frame; the last four are blended from the old end towards the first four.
    expect(out[0]).toEqual(frames[4]);
    expect(out.slice(12).map((b) => b[0])).toEqual([128, 106, 84, 62]);
    // So looping (last frame back to the first) is a step like those of the fade, not the plain clip's jump from 190 to 0.
    const steps = out.map((b, i) => Math.abs(b[0] - out[(i + 1) % out.length][0]));
    expect(Math.max(...steps)).toBe(22);
    expect(seamless(frames, 0)).toBe(frames);
    // A clip that ends where it starts (an orbit holding the same picture) loops already: it is cut, not crossfaded.
    const orbit = [100, 100, 100, 110, 120, 130, 140, 130, 120, 110, 100, 100, 100].map((v) => Buffer.alloc(8, v));
    expect(loopsAlready(orbit, 8)).toBe(true);
    expect(loopsAlready(frames, 2)).toBe(false);
  });
});
