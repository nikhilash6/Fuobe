import { describe, expect, it } from "vitest";
import { cleanEngineText, ENGINE_WORDS, engineFailureKind, isEngineWords, plainEngineFailure, storedErrorText, withoutFolders, withoutLocalPaths } from "@/lib/engine-error";
import { withoutWorkerPaths } from "@/lib/computer-runner";
import type { ReportEvent } from "@/lib/relay";

/*
 * An engine's own error text (ComfyUI, a node's exception, ffmpeg's output) is cleaned before it is kept, and a run on
 * our GPUs shows the person a plain sentence for its kind of failure: never a path, a node's name, a tool's banner or a
 * stack trace (src/lib/engine-error.ts). The worker takes its own folders out before it reports (computer-runner.ts).
 */

/** What a worker's VHS_LoadVideo said for a clip with no sound (the ffmpeg banner as ffmpeg prints it). */
const VHS_NO_AUDIO = [
  "VHS failed to extract audio from X:\\fuobe-worker\\work\\input\\fuobe_HFpqXpUDFs__.mp4:",
  "ffmpeg version 7.1-full_build-www.gyan.dev Copyright (c) 2000-2026 the FFmpeg developers",
  "  built with gcc 14.2.0 (Rev1, Built by MSYS2 project)",
  "  configuration: --enable-gpl --enable-version3 --enable-static --disable-w32threads --enable-libx264 --enable-cuda-llvm",
  "  libavutil      59. 39.100 / 59. 39.100",
  "  libavcodec     61. 19.100 / 61. 19.100",
  "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'X:\\fuobe-worker\\work\\input\\fuobe_HFpqXpUDFs__.mp4':",
  "  Metadata:",
  "    major_brand     : isom",
  "  Duration: 00:00:05.00, start: 0.000000, bitrate: 2400 kb/s",
  "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1080x1920, 30 fps",
  "Stream map '0:a:0' matches no streams.",
  "To ignore this, add a trailing '?' to the map.",
  "Failed to set value '0:a:0' for option 'map': Invalid argument",
  "Error parsing options for output file /tmp/out.wav.",
].join("\n");

/** The same text with its line breaks lost (as the owner's page showed it). */
const VHS_ONE_LINE = `VHS_LoadVideo: ${VHS_NO_AUDIO.replace(/\s*\n\s*/g, " ")}`;

const LEAKS = [/[A-Za-z]:\\/, /fuobe-worker/, /\\work\\input/, /ffmpeg version/i, /Copyright/i, /configuration:/i, /--enable/, /libavutil/i, /built with/i, /\/tmp\//];

describe("cleanEngineText", () => {
  it("keeps what went wrong, without the worker's folders or ffmpeg's banner", () => {
    for (const raw of [`VHS_LoadVideo: ${VHS_NO_AUDIO}`, VHS_ONE_LINE]) {
      const out = cleanEngineText(raw);
      for (const leak of LEAKS) expect(out, `${leak}`).not.toMatch(leak);
      expect(out).toContain("VHS failed to extract audio from fuobe_HFpqXpUDFs__.mp4");
      expect(out.length).toBeLessThanOrEqual(600);
      expect(out).not.toContain("\n");
    }
    // The multi-line text keeps ffmpeg's own problem lines, not its stream listing.
    const lines = cleanEngineText(`VHS_LoadVideo: ${VHS_NO_AUDIO}`);
    expect(lines).toContain("matches no streams");
    expect(lines).not.toMatch(/Metadata|major_brand|Duration|Stream #0/);
  });

  it("takes out paths of every kind as the file's name", () => {
    expect(withoutLocalPaths("from C:\\Program Files\\ComfyUI\\models\\checkpoints\\flux1-dev.safetensors: bad")).toBe("from flux1-dev.safetensors: bad");
    expect(withoutLocalPaths("at \\\\nas01\\share\\clips\\a b.mov failed")).toContain("[folder]");
    expect(withoutLocalPaths("open /home/fuobe/app/data/uploads/abc.png")).toBe("open abc.png");
    expect(withoutLocalPaths("in /workspace/ComfyUI/models/loras/")).toBe("in [folder]");
    expect(withoutLocalPaths("read file:///D:/work/x.wav now")).toBe("read x.wav now");
    expect(withoutLocalPaths("cache ~/.cache/huggingface/hub/model.bin.")).toBe("cache model.bin.");
    expect(withoutLocalPaths("D:/fuobe-work/input/clip.mp4")).toBe("clip.mp4");
  });

  it("leaves links, relative folders and plain words alone", () => {
    const plain = [
      "Get it from https://huggingface.co/Comfy-Org/flux1-dev/resolve/main/flux1-dev.safetensors then put it in ComfyUI/models/checkpoints",
      "Plan A: try a 16/9 picture and/or a shorter clip.",
      "Start ComfyUI with a higher --max-upload-size, or use a smaller file.",
      "Set the LoRA folder in Settings → LoRAs and Fuobe downloads LoRAs before a run",
    ];
    for (const t of plain) {
      expect(withoutLocalPaths(t)).toBe(t);
      expect(storedErrorText(t)).toBe(t);
    }
  });

  it("drops stack traces, internal addresses and run ids", () => {
    const raw = [
      "Traceback (most recent call last):",
      '  File "/opt/ComfyUI/execution.py", line 327, in execute',
      "    output_data = get_output_data(obj, input_data_all)",
      '  File "C:\\ComfyUI\\nodes.py", line 12, in load',
      "    raise RuntimeError(msg)",
      "RuntimeError: can't reach http://127.0.0.1:8188/prompt (prompt_id: 6f1c2b7e-1d2a-4c8e-9f00-1234567890ab) on 192.168.1.20:8189",
      "    at runJob (file:///srv/fuobe/worker.mjs:10:5)",
    ].join("\n");
    const out = cleanEngineText(raw);
    expect(out).toBe("RuntimeError: can't reach [address] on [address]");
  });

  it("cuts long text short", () => {
    const out = cleanEngineText("x".repeat(5000), 100);
    expect(out.length).toBe(100);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("storedErrorText", () => {
  it("cleans a machine's words and keeps the lines of the rest", () => {
    const out = storedErrorText(`VHS_LoadVideo: ${VHS_NO_AUDIO}`);
    for (const leak of LEAKS) expect(out, `${leak}`).not.toMatch(leak);
    expect(out.split("\n")[0]).toBe("VHS_LoadVideo: VHS failed to extract audio from fuobe_HFpqXpUDFs__.mp4");
    const listed = "Missing models:\n  checkpoints/flux1-dev.safetensors\n  loras/a.safetensors";
    expect(storedErrorText(listed)).toBe(listed);
    expect(storedErrorText("y".repeat(3000)).length).toBe(2000);
  });
});

describe("withoutFolders", () => {
  it("takes out only the given folders", () => {
    const text = "Couldn't read /var/lib/fuobe/data/uploads/a.png; your file C:\\ComfyUI\\input\\b.png is fine";
    expect(withoutFolders(text, ["/var/lib/fuobe/data"])).toBe("Couldn't read a.png; your file C:\\ComfyUI\\input\\b.png is fine");
    expect(withoutFolders("C:\\Users\\me\\x.png", ["/", "C:\\"])).toBe("C:\\Users\\me\\x.png");
  });
});

describe("what the person reads for each kind of failure", () => {
  it("tells the kinds apart", () => {
    expect(engineFailureKind(VHS_ONE_LINE)).toBe("no-sound");
    expect(engineFailureKind("torch.OutOfMemoryError: CUDA out of memory. Tried to allocate 2.00 GiB")).toBe("out-of-memory");
    expect(engineFailureKind("Invalid data found when processing input")).toBe("unreadable-input");
    expect(engineFailureKind("moov atom not found")).toBe("unreadable-input");
    expect(engineFailureKind("Timed out after 45 minutes")).toBe("timeout");
    expect(engineFailureKind("whatever", "comfy_missing_model")).toBe("missing-on-gpu");
    expect(engineFailureKind("Value not in list: ckpt_name: 'x.safetensors' not in []")).toBe("missing-on-gpu");
    expect(engineFailureKind("ComfyUI restarted and lost this run. Press Retry.")).toBe("gpu-stopped");
    expect(engineFailureKind("KSampler: mat1 and mat2 shapes cannot be multiplied")).toBe("unknown");
    expect(engineFailureKind("This one didn't start in time — try again, or try a similar model.")).toBe("long-wait");
    expect(engineFailureKind("Stopped after 3 tries: ComfyUI kept stopping on the GPUs.")).toBe("gpu-stopped");
  });

  it("the example: a plain sentence for the person, the cleaned words for the owner", () => {
    const f = plainEngineFailure(VHS_ONE_LINE);
    expect(f.kind).toBe("no-sound");
    expect(f.words).toBe(ENGINE_WORDS["no-sound"]);
    expect(f.words).toBe("This clip has no sound for this run to use — try a clip with sound.");
    expect(f.detail).toMatch(/^VHS_LoadVideo: VHS failed to extract audio from fuobe_HFpqXpUDFs__\.mp4/);
    for (const leak of LEAKS) expect(f.detail!, `${leak}`).not.toMatch(leak);
  });

  it("every sentence is plain: no path, node, engine or dead end", () => {
    for (const w of Object.values(ENGINE_WORDS)) {
      expect(isEngineWords(w)).toBe(true);
      expect(w).not.toMatch(/ComfyUI|GPU|worker|node|ffmpeg|VHS|support|busy|queue|lane|Press Retry|try again later|[\\/!]/i);
      // What to do next is always said.
      expect(w).toMatch(/\btry\b/i);
    }
    expect(isEngineWords("VHS_LoadVideo: x")).toBe(false);
  });
});

describe("a worker's reports", () => {
  it("never name the worker's folders: ComfyUI's words and a refusal's answer go with file names only", () => {
    const finished: ReportEvent = {
      event: "finished",
      entry: {
        prompt: [1, "p"],
        status: { status_str: "error", messages: [["execution_error", { node_type: "VHS_LoadVideo", exception_message: VHS_NO_AUDIO, current_inputs: { video: ["X:\\fuobe-worker\\work\\input\\fuobe_HFpqXpUDFs__.mp4"] } }]] },
        outputs: { "9": { gifs: [{ filename: "fuobe_out_00001.mp4", subfolder: "", type: "output" }] } },
      },
    };
    const out = JSON.stringify(withoutWorkerPaths(finished));
    expect(out).not.toMatch(/fuobe-worker|X:\\\\/);
    expect(out).toContain("fuobe_HFpqXpUDFs__.mp4");
    // Results go as they were.
    expect((withoutWorkerPaths(finished) as Extract<ReportEvent, { event: "finished" }>).entry.outputs).toEqual(finished.entry.outputs);
    const refused: ReportEvent = { event: "refused", status: 400, body: { error: { message: "Prompt outputs failed validation" }, node_errors: { "4": { errors: [{ details: "/home/worker/ComfyUI/models/checkpoints/a.safetensors missing" }] } } } };
    expect(JSON.stringify(withoutWorkerPaths(refused))).not.toContain("/home/worker");
    const passes: ReportEvent = { event: "passes", running: false, entries: [finished.entry] };
    expect(JSON.stringify(withoutWorkerPaths(passes))).not.toContain("fuobe-worker");
    const running: ReportEvent = { event: "running", value: 1, max: 2, node: "4" };
    expect(withoutWorkerPaths(running)).toBe(running);
  });
});
