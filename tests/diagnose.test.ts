import { describe, expect, it } from "vitest";
import {
  addressFixNote,
  backoffMs,
  beforeRunWords,
  BILLING_URL,
  canSaveAnyway,
  checksTooFast,
  cleanDetails,
  diagnoseAddress,
  diagnoseGpu,
  diagnoseGpuJob,
  diagnoseKey,
  diagnoseKeyJob,
  diagnoseRefusal,
  gpuHostOf,
  isLoaderNode,
  ISOLATED_ON_GPU,
  loaderFiles,
  modelFileProblem,
  retryPlan,
  RUNPOD_CONSOLE_URL,
  shortState,
  testWords,
  troubleOf,
  waitingWords,
  withoutAddress,
  withoutSecrets,
  type Diagnosis,
  type GpuPlace,
} from "@/lib/diagnose";

// What an account sees when its own GPU or key has a problem: one plain sentence, a details line, the buttons that help,
// and whether waiting fixes it (src/lib/diagnose.ts). Pure: no network.

const pod: GpuPlace = { kind: "link", url: "https://abc123xyz-8188.proxy.runpod.net" };
const tunnel: GpuPlace = { kind: "link", url: "https://quiet-river.trycloudflare.com" };
const withToken: GpuPlace = { kind: "link", url: "https://gpu.example.com", hasToken: true };
const kinds = (d: Diagnosis) => d.actions.map((a) => a.kind);

/** The main sentence never carries a status code, a program's own error words, an address or jargon. */
function plain(d: Diagnosis) {
  expect(d.words, d.cause).not.toMatch(/\b(HTTP|[1-5]\d\d)\b|upload failed|\/prompt|provider|route|ECONN|ENOTFOUND|getaddrinfo|<!DOCTYPE|<html|undefined|null|\{/i);
  expect(d.words, d.cause).not.toMatch(/proxy\.runpod\.net|trycloudflare|127\.0\.0\.1/);
  expect(d.words.length, d.cause).toBeLessThan(200);
}

describe("the kind of address a GPU has", () => {
  it("tells a RunPod pod's port, a quick tunnel and another web address apart", () => {
    expect(gpuHostOf("https://abc123xyz-8188.proxy.runpod.net")).toEqual({ kind: "runpod", port: 8188 });
    expect(gpuHostOf("https://abc123xyz-3000.proxy.runpod.net/")).toEqual({ kind: "runpod", port: 3000 });
    expect(gpuHostOf("https://quiet-river.trycloudflare.com")).toEqual({ kind: "tunnel" });
    expect(gpuHostOf("https://x.ngrok-free.app")).toEqual({ kind: "tunnel" });
    expect(gpuHostOf("https://gpu.example.com")).toEqual({ kind: "web" });
    expect(gpuHostOf("not a url")).toEqual({ kind: "web" });
  });
});

describe("Your GPU: what came back", () => {
  it("the reported case: a stopped RunPod pod's 404 says start the pod, links to RunPod, and waits", () => {
    for (const stage of ["upload", "test", "status", "prompt"] as const) {
      const d = diagnoseGpu({ stage, status: 404, body: "404 page not found", contentType: "text/plain" }, pod);
      expect(d.cause).toBe("gpu-stopped");
      expect(d.words).toMatch(/^Your RunPod pod isn't running, or ComfyUI isn't on port 8188\./);
      expect(d.actions[0]).toEqual({ kind: "start-gpu", label: "Start your pod", target: RUNPOD_CONSOLE_URL });
      expect(kinds(d)).toContain("check-gpu");
      expect(d.retryable).toBe(true);
      // The kind of address, never the address: a pod's address alone reaches its ComfyUI.
      expect(d.details).toMatch(/^RunPod pod, port 8188 · HTTP 404/);
      expect(d.details).not.toMatch(/abc123xyz|proxy\.runpod/);
      plain(d);
    }
    // A check connects once it answers; a run says what to press.
    expect(diagnoseGpu({ stage: "test", status: 404 }, pod).words).toMatch(/we connect as soon as it answers/);
    expect(diagnoseGpu({ stage: "upload", status: 404 }, pod).words).toMatch(/then press Retry/);
    expect(kinds(diagnoseGpu({ stage: "upload", status: 404 }, pod))).toEqual(["start-gpu", "retry", "check-gpu", "gpu-settings"]);
  });

  it("a RunPod 502 (the pod is on, ComfyUI not ready yet), 503, 504 and Cloudflare's 52x are a GPU starting up", () => {
    const ready = diagnoseGpu({ stage: "upload", status: 502, body: "<html>Bad gateway</html>" }, pod);
    expect(ready).toMatchObject({ cause: "gpu-starting", retryable: true });
    expect(ready.words).toMatch(/^Your pod is on, but ComfyUI on port 8188 wasn't ready/);
    expect(ready.actions[0]).toMatchObject({ kind: "start-gpu" });
    plain(ready);
    expect(diagnoseGpu({ stage: "test", status: 502 }, pod).words).toMatch(/We connect as soon as it is\./);
    for (const status of [502, 503, 504, 520, 522, 524]) {
      const d = diagnoseGpu({ stage: "upload", status, body: "<!DOCTYPE html><html><head><title>Bad gateway</title></head><body>…</body></html>", contentType: "text/html" }, tunnel);
      expect(d.cause, String(status)).toBe("gpu-starting");
      expect(d.retryable).toBe(true);
      // An HTML error page never reaches the words, and only its title the details.
      expect(d.details).toBe(`your tunnel · HTTP ${status} · Bad gateway`);
      plain(d);
    }
    expect(diagnoseGpu({ stage: "upload", status: 503 }, pod)).toMatchObject({ cause: "gpu-starting", actions: expect.arrayContaining([expect.objectContaining({ kind: "start-gpu" })]) });
  });

  it("a tunnel that isn't running (Cloudflare 530, ngrok's offline page) is a GPU that doesn't answer", () => {
    expect(diagnoseGpu({ stage: "status", status: 530, body: "error code: 1033" }, tunnel).cause).toBe("gpu-offline");
    expect(diagnoseGpu({ stage: "upload", status: 404, body: "ERR_NGROK_3200 The endpoint x.ngrok-free.app is offline." }, { kind: "link", url: "https://x.ngrok-free.app" }).cause).toBe("gpu-offline");
  });

  it("no answer at all: refused, timed out, a name that can't be found, a certificate, a private address", () => {
    const offline = diagnoseGpu({ stage: "prompt", error: "Couldn't reach gpu.example.com: connect ECONNREFUSED 1.2.3.4:443" }, tunnel);
    expect(offline).toMatchObject({ cause: "gpu-offline", retryable: true });
    expect(offline.details).toMatch(/ECONNREFUSED/);
    plain(offline);
    expect(diagnoseGpu({ stage: "test", error: "quiet-river.trycloudflare.com took over 15 s to answer" }, tunnel).cause).toBe("gpu-offline");
    const gone = diagnoseGpu({ stage: "upload", error: "Couldn't reach x: getaddrinfo ENOTFOUND quiet-river.trycloudflare.com" }, tunnel);
    expect(gone).toMatchObject({ cause: "gpu-not-found", retryable: true });
    expect(gone.words).toMatch(/new address/);
    expect(kinds(gone)).toEqual(expect.arrayContaining(["gpu-settings", "pair"]));
    plain(gone);
    const cert = diagnoseGpu({ stage: "test", error: "Couldn't reach 1.2.3.4: self-signed certificate" }, withToken);
    expect(cert).toMatchObject({ cause: "gpu-certificate", retryable: false });
    plain(cert);
    const priv = diagnoseGpu({ stage: "upload", error: "Fuobe won't fetch gpu.example.com: it points to this machine or a private network. Upload the file instead." }, withToken);
    expect(priv.cause).toBe("address-local");
    // The owner's advice about uploading a file isn't for a GPU.
    expect(priv.words).not.toMatch(/Upload the file/);
    // A big clip over a slow address: not a dead GPU.
    expect(diagnoseGpu({ stage: "upload", error: "x took over 300 s to answer", bytes: 80 * 2 ** 20 }, tunnel)).toMatchObject({ cause: "gpu-slow-upload", retryable: false });
  });

  it("a password: none sent, or the one sent refused; a sign-in page in front", () => {
    const none = diagnoseGpu({ stage: "test", status: 401 }, tunnel);
    expect(none).toMatchObject({ cause: "gpu-password", retryable: false, words: "Your GPU asks for a password. Paste it in Access token." });
    const wrong = diagnoseGpu({ stage: "test", status: 403 }, withToken);
    expect(wrong.cause).toBe("gpu-password-wrong");
    expect(wrong.words).toMatch(/didn't work/);
    expect(diagnoseGpu({ stage: "upload", status: 401 }, withToken).words).toMatch(/Settings → Your GPU/);
    const access = diagnoseGpu({ stage: "test", status: 302, location: "https://team.cloudflareaccess.com/cdn-cgi/access/login" }, tunnel);
    expect(access).toMatchObject({ cause: "gpu-sign-in", retryable: false });
    expect(kinds(access)).toContain("pair");
  });

  it("another app or a web page: the address to fix, with the RunPod port it should end in", () => {
    const page = diagnoseGpu({ stage: "test", status: 200, body: "<html><title>Jupyter</title></html>", contentType: "text/html" }, pod);
    expect(page.cause).toBe("gpu-not-comfy");
    expect(page.words).toMatch(/ending in -8188/);
    expect(diagnoseGpu({ stage: "test", status: 404 }, tunnel).cause).toBe("gpu-not-comfy");
    expect(diagnoseGpu({ stage: "test", status: 301, location: "https://elsewhere.example/" }, tunnel)).toMatchObject({ cause: "gpu-not-comfy", details: expect.stringMatching(/elsewhere/) });
  });

  it("a file too big: the address's own cap (a web page) apart from ComfyUI's", () => {
    const cap = diagnoseGpu({ stage: "upload", status: 413, body: "<html>413 Request Entity Too Large</html>", bytes: 150 * 2 ** 20 }, tunnel);
    expect(cap).toMatchObject({ cause: "gpu-too-big", retryable: false });
    expect(cap.words).toMatch(/too big to send to your GPU's address \(150 MB\)/);
    expect(kinds(cap)).toContain("pair");
    const comfy = diagnoseGpu({ stage: "upload", status: 413, body: "", contentType: "text/plain", bytes: 120 * 2 ** 20 }, tunnel);
    expect(comfy.words).toMatch(/too big for your ComfyUI \(120 MB\).*max-upload-size/);
  });

  it("a 500 from ComfyUI itself is not waited out; a 429 from the address is", () => {
    expect(diagnoseGpu({ stage: "upload", status: 500, body: "upload folder is read-only" }, tunnel)).toMatchObject({ cause: "gpu-error", retryable: false, details: expect.stringMatching(/upload · upload folder is read-only/) });
    expect(diagnoseGpu({ stage: "upload", status: 429, retryAfterS: 7 }, tunnel)).toMatchObject({ cause: "gpu-busy", retryable: true, retryAfterMs: 7000 });
  });

  it("a paired ComfyUI that is offline names it", () => {
    const d = diagnoseGpu({ stage: "poll", error: "no beat" }, { kind: "connect", name: "Studio PC" });
    expect(d.words).toBe("Studio PC isn't online. Start ComfyUI there, and your runs go on by themselves.");
  });
});

describe("Your GPU: the address before it is called", () => {
  it("says what to fix in plain words", () => {
    expect(diagnoseAddress("credentials").words).toMatch(/Access token box/);
    expect(diagnoseAddress("local")).toMatchObject({ cause: "address-local", actions: [{ kind: "use-computer" }, { kind: "pair", target: "/connect" }] });
    expect(diagnoseAddress("studio").words).toBe("Fuobe can't use this address. Connect your own ComfyUI.");
    expect(diagnoseAddress("format").words).toMatch(/https:\/\//);
    expect(addressFixNote(["scheme"])).toBe("We added https:// to the start of your address.");
    expect(addressFixNote(["scheme", "query"])).toBe("We added https:// to the start of your address. We kept only the address part.");
    expect(addressFixNote([])).toBeNull();
    expect(checksTooFast(12)).toMatchObject({ cause: "checks-too-fast", words: "Checking again in a few seconds.", retryable: true, retryAfterMs: 12_000 });
  });
});

describe("Your GPU: a run that failed there", () => {
  it("out of memory, stopped on the GPU, an add-on's exception: plain words, ComfyUI's own in the details", () => {
    const oom = diagnoseGpuJob({ kind: "error", nodeType: "KSampler", message: "CUDA out of memory. Tried to allocate 2.00 GiB" }, tunnel);
    expect(oom).toMatchObject({ cause: "gpu-out-of-memory", words: "Your GPU ran out of memory. Try a smaller size or a shorter clip." });
    expect(oom.details).toMatch(/^KSampler · CUDA out of memory/);
    expect(diagnoseGpuJob({ kind: "interrupted" }, tunnel).words).toBe("This run was stopped on your GPU. Press Retry to run it again.");
    const node = diagnoseGpuJob({ kind: "error", nodeType: "VHS_LoadVideo", message: "Traceback (most recent call last):\n  File …" }, tunnel);
    expect(node.cause).toBe("gpu-job-error");
    plain(node);
    expect(node.details).toMatch(/^VHS_LoadVideo · Traceback/);
  });

  it("restarted, moved, gone, busy, a result it couldn't copy, a graph it can't run", () => {
    expect(diagnoseGpuJob({ kind: "lost", resent: true }, tunnel).words).toBe("Your GPU restarted, so we sent this run again.");
    expect(diagnoseGpuJob({ kind: "lost" }, tunnel).words).toMatch(/Press Retry/);
    expect(diagnoseGpuJob({ kind: "moved" }, tunnel).words).toBe("This run stopped because your GPU moved to a new address. Press Retry.");
    const gone = diagnoseGpuJob({ kind: "gone", minutes: 15 }, pod);
    expect(gone.words).toBe("Your GPU stopped answering for 15 minutes, so this run stopped. Start it again, then press Retry.");
    expect(kinds(gone)).toEqual(["start-gpu", "retry", "check-gpu"]);
    expect(diagnoseGpuJob({ kind: "busy", minutes: 30 }, tunnel).words).toMatch(/busy for 30 minutes/);
    expect(diagnoseGpuJob({ kind: "save", over: "1 GB" }, tunnel).words).toBe("Your ComfyUI made a file over 1 GB. Try a shorter clip or a lower size.");
    expect(diagnoseGpuJob({ kind: "save" }, tunnel).words).toMatch(/couldn't copy it from your GPU/);
    expect(diagnoseGpuJob({ kind: "isolated" }, tunnel)).toMatchObject({ words: ISOLATED_ON_GPU, actions: [{ kind: "pick-model" }] });
    expect(diagnoseRefusal("KSampler: Value 9 smaller than min of 10")).toMatchObject({ cause: "gpu-refused", details: "KSampler: Value 9 smaller than min of 10" });
  });
});

describe("Your GPU: a model file a loader can't read, or doesn't have", () => {
  // The reported case: MiniMax H3 on an account's own GPU through a tunnel, five times the same error in a VAELoader.
  const VIDEO_VAE = "minimax_h3_video_vae_int8_convrot.safetensors";
  const LIVE = "'utf-8' codec can't decode byte 0xf7 in position 0: invalid start byte";
  const graph = {
    "12": { class_type: "UNETLoader", inputs: { unet_name: "minimax_h3_fast_fp8_scaled.safetensors", weight_dtype: "default" } },
    "13": { class_type: "CLIPLoader", inputs: { clip_name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", type: "wan" } },
    "14": { class_type: "VAELoader", inputs: { vae_name: VIDEO_VAE } },
    "15": { class_type: "VAELoader", inputs: { vae_name: "minimax_h3_audio_vae_fp32.safetensors" } },
    "16": { class_type: "LoraLoaderModelOnly", inputs: { model: ["12", 0], lora_name: "h3_lightx2v_4step.safetensors", strength_model: 1 } },
  };
  const URL_OF = "https://huggingface.co/Kijai/MiniMax-H3-experimental/resolve/f5c3b1d5a63e008a691fca1b6096fd57a5307536/minimax_h3_video_vae_int8_convrot.safetensors";

  it("the reported case: the video VAE named, Download it again, Get the file and Check my GPU, never Retry", () => {
    const err = { node_id: "14", node_type: "VAELoader", exception_message: LIVE };
    expect(modelFileProblem(err.node_type, err.exception_message)).toBe("damaged");
    const files = loaderFiles(err, graph);
    expect(files).toEqual([VIDEO_VAE]);
    const d = diagnoseGpuJob({ kind: "error", nodeType: err.node_type, message: err.exception_message, files, fileUrl: URL_OF }, tunnel);
    expect(d).toMatchObject({
      cause: "gpu-model-file",
      words: `A model file on your GPU can't be read: ${VIDEO_VAE}. It's damaged or didn't finish downloading. Download it again, then run.`,
      retryable: false,
    });
    expect(d.actions).toEqual([
      { kind: "get-file", label: "Get the file", target: URL_OF },
      { kind: "check-gpu", label: "Check my GPU" },
    ]);
    expect(kinds(d)).not.toContain("retry");
    expect(d.details).toBe(`VAELoader · ${LIVE}`);
    plain(d);
    expect(d.words).not.toMatch(/utf-8|codec|0xf7|Traceback/);
  });

  it("each loader type, and each way a file can't be read", () => {
    const loaders = ["VAELoader", "UNETLoader", "CheckpointLoaderSimple", "CLIPLoader", "DualCLIPLoader", "LoraLoader", "LoraLoaderModelOnly", "ControlNetLoader", "UpscaleModelLoader", "UnetLoaderGGUF"];
    const damaged = [
      LIVE,
      "invalid load key, '<'.",
      "Error while deserializing header: HeaderTooLarge",
      "SafetensorError: Error while deserializing header: MetadataIncompleteBuffer",
      "safetensors_rust.SafetensorError: incomplete metadata, file not fully covered",
      "unexpected EOF, expected 1234 more bytes. The file might be corrupted.",
      "PytorchStreamReader failed reading zip archive: failed finding central directory",
      "File is not a zip file",
    ];
    for (const nodeType of loaders) {
      for (const message of damaged) {
        expect(modelFileProblem(nodeType, message), `${nodeType}: ${message}`).toBe("damaged");
        const d = diagnoseGpuJob({ kind: "error", nodeType, message, files: ["x.safetensors"] }, tunnel);
        expect(d.cause).toBe("gpu-model-file");
        expect(d.words).toMatch(/^A model file on your GPU can't be read: x\.safetensors\./);
        expect(d.retryable).toBe(false);
        plain(d);
      }
    }
    // The same words from a node that loads no model file, and another loader problem: the add-on's words, as before.
    expect(modelFileProblem("KSampler", LIVE)).toBeNull();
    expect(diagnoseGpuJob({ kind: "error", nodeType: "KSampler", message: LIVE }, tunnel).cause).toBe("gpu-job-error");
    expect(modelFileProblem("VAELoader", "Some other problem")).toBeNull();
    expect(diagnoseGpuJob({ kind: "error", nodeType: "VAELoader", message: "Some other problem" }, tunnel).cause).toBe("gpu-job-error");
    // Out of memory while loading a model stays out of memory.
    expect(diagnoseGpuJob({ kind: "error", nodeType: "UNETLoader", message: "CUDA out of memory. Tried to allocate 2.00 GiB" }, tunnel).cause).toBe("gpu-out-of-memory");
  });

  it("a file that isn't there says add it; one that can't be read says download it again", () => {
    for (const message of [
      "[Errno 2] No such file or directory: '/workspace/ComfyUI/models/vae/minimax_h3_video_vae_int8_convrot.safetensors'",
      "FileNotFoundError: minimax_h3_video_vae_int8_convrot.safetensors",
      "Model in folder 'vae' with filename 'minimax_h3_video_vae_int8_convrot.safetensors' not found.",
      "Value not in list: vae_name: 'minimax_h3_video_vae_int8_convrot.safetensors' not in ['ae.safetensors']",
    ]) {
      expect(modelFileProblem("VAELoader", message), message).toBe("missing");
      const d = diagnoseGpuJob({ kind: "error", nodeType: "VAELoader", message, files: [VIDEO_VAE] }, tunnel);
      expect(d).toMatchObject({ cause: "gpu-model-file", words: `Your GPU doesn't have the model file ${VIDEO_VAE}. Add it, then run.`, retryable: false });
      plain(d);
    }
    // No file name known: still plain words.
    expect(diagnoseGpuJob({ kind: "error", nodeType: "VAELoader", message: LIVE }, tunnel).words).toBe("A model file on your GPU can't be read. It's damaged or didn't finish downloading. Download it again, then run.");
    expect(diagnoseGpuJob({ kind: "error", nodeType: "VAELoader", message: "No such file or directory" }, tunnel).words).toBe("Your GPU doesn't have a model file this needs. Add it, then run.");
    // Another value not in the list (not a file): not this.
    expect(modelFileProblem("CLIPLoader", "Value not in list: type: 'wan9' not in ['wan', 'sd3']")).toBeNull();
  });

  it("finds the file: the failing node's inputs, else what ComfyUI reported, else the error's own words", () => {
    // By the error's node id: the video VAE, not the audio one beside it.
    expect(loaderFiles({ node_id: "15", node_type: "VAELoader", exception_message: LIVE }, graph)).toEqual(["minimax_h3_audio_vae_fp32.safetensors"]);
    // A link to another node is not a file; a LoRA's file is.
    expect(loaderFiles({ node_id: "16", node_type: "LoraLoaderModelOnly", exception_message: "invalid load key, '<'." }, graph)).toEqual(["h3_lightx2v_4step.safetensors"]);
    // No graph: the inputs ComfyUI sent with the error (each in a list).
    expect(loaderFiles({ node_id: "9", node_type: "CheckpointLoaderSimple", exception_message: "invalid load key", current_inputs: { ckpt_name: ["sdxl/juggernaut.safetensors"] } })).toEqual(["sdxl/juggernaut.safetensors"]);
    // No node id: every node of that class, the one the error names first.
    expect(loaderFiles({ node_type: "VAELoader", exception_message: `Error while deserializing header: HeaderTooLarge in ${VIDEO_VAE}` }, graph)).toEqual([VIDEO_VAE]);
    expect(loaderFiles({ node_type: "VAELoader", exception_message: LIVE }, graph)).toEqual([VIDEO_VAE, "minimax_h3_audio_vae_fp32.safetensors"]);
    // Nothing else: a file the error itself names (its base name, no folder).
    expect(loaderFiles({ node_type: "UpscaleModelLoader", exception_message: "[Errno 2] No such file or directory: '/models/upscale_models/4x-UltraSharp.pth'" })).toEqual(["4x-UltraSharp.pth"]);
    expect(loaderFiles({ node_type: "UpscaleModelLoader", exception_message: LIVE })).toEqual([]);
    expect(isLoaderNode("DualCLIPLoader")).toBe(true);
    expect(isLoaderNode("KSampler")).toBe(false);
  });

  it("Get the file only for an https link; Check my GPU only for a GPU at a web address", () => {
    const base = { kind: "error" as const, nodeType: "VAELoader", message: LIVE, files: [VIDEO_VAE] };
    expect(kinds(diagnoseGpuJob({ ...base, fileUrl: "http://example.com/x.safetensors" }, tunnel))).toEqual(["check-gpu"]);
    expect(kinds(diagnoseGpuJob({ ...base, fileUrl: "javascript:alert(1)" }, tunnel))).toEqual(["check-gpu"]);
    expect(kinds(diagnoseGpuJob({ ...base, fileUrl: URL_OF }, { kind: "computer" }))).toEqual(["get-file"]);
    expect(kinds(diagnoseGpuJob(base, { kind: "connect" }))).toEqual([]);
    // The address never reaches the details line; a password it echoed neither.
    const echoed = diagnoseGpuJob({ ...base, message: `invalid load key at https://quiet-river.trycloudflare.com/x token=abcdef123456` }, tunnel);
    expect(echoed.details).not.toMatch(/quiet-river|abcdef123456/);
    // A traceback stays in the details line, on one line.
    const tb = diagnoseGpuJob({ ...base, message: `${LIVE}\nTraceback (most recent call last):\n  File "nodes.py", line 1` }, tunnel);
    expect(tb.words).not.toMatch(/Traceback/);
    expect(tb.details).not.toMatch(/\n/);
  });
});

describe("Your keys: what fal.ai or Replicate said", () => {
  const fal = { provider: "fal" as const };
  it("a key refused or out of credit is never waited out, and says where to fix it", () => {
    const key = diagnoseKey({ stage: "submit", status: 401, text: "fal.ai didn't accept your key. Check it in Settings → Your keys." }, fal);
    expect(key).toMatchObject({ cause: "key-rejected", retryable: false, words: "fal.ai didn't accept your key. Check it in Settings → Your keys." });
    expect(key.actions[0]).toEqual({ kind: "key-settings", label: "Replace key", target: "/settings#your-keys" });
    for (const f of [
      { status: 403, text: "fal 403: User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing." },
      { status: 402, text: "replicate 402: You have insufficient credit to run this model." },
    ]) {
      const d = diagnoseKey({ stage: "submit", ...f }, f.status === 402 ? { provider: "replicate" } : fal);
      expect(d.cause).toBe("key-balance");
      expect(d.retryable).toBe(false);
      expect(d.actions[0]).toEqual({ kind: "add-credit", label: `Add credit on ${f.status === 402 ? "Replicate" : "fal.ai"}`, target: BILLING_URL[f.status === 402 ? "replicate" : "fal"] });
    }
    expect(diagnoseKey({ stage: "submit", status: 403, text: "replicate 403: You do not have permission to run this model." }, { provider: "replicate" })).toMatchObject({ cause: "key-permission", retryable: false });
  });

  it("a model gone, an input refused, a content check: the main sentence plain, the provider's words in details", () => {
    const gone = diagnoseKey({ stage: "submit", status: 404, text: "fal 404: Application 'minimax/h9' not found" }, fal);
    expect(gone).toMatchObject({ cause: "model-unavailable", words: "This model isn't available on fal.ai right now. Pick another model." });
    expect(gone.details).toBe("fal.ai answered 404 · Application 'minimax/h9' not found");
    const input = diagnoseKey({ stage: "submit", status: 422, text: "fal 422: body.image_url: Could not download the file" }, fal);
    expect(input.words).toBe("fal.ai couldn't use this picture. Change it, then run again.");
    plain(input);
    expect(diagnoseKey({ stage: "submit", status: 422, text: "fal 422: body.prompt: too long" }, fal).words).toMatch(/these words/);
    expect(diagnoseKey({ stage: "poll", failed: true, text: "fal 422: The content could not be processed because it contained material flagged by a content checker." }, fal).cause).toBe("content-flag");
    expect(diagnoseKey({ stage: "poll", failed: true, text: "CUDA error: device-side assert" }, fal)).toMatchObject({ cause: "provider-failed", retryable: false });
    expect(diagnoseKey({ stage: "poll", failed: true, canceled: true, text: "canceled" }, { provider: "replicate" }).words).toBe("This run was stopped on Replicate. Press Retry to run it again.");
    expect(diagnoseKey({ stage: "poll", failed: true, text: 'No media in response: {"output":null}' }, fal).cause).toBe("no-result");
  });

  it("busy, down or unreachable is waited out, except a submit that may have landed", () => {
    expect(diagnoseKey({ stage: "submit", status: 429, text: "replicate 429: Request was throttled.", retryAfterS: 3 }, { provider: "replicate" })).toMatchObject({ cause: "provider-busy", retryable: true, retryAfterMs: 3000 });
    expect(diagnoseKey({ stage: "submit", status: 503, text: "fal 503: Service unavailable" }, fal)).toMatchObject({ cause: "provider-down", retryable: true });
    // A 502 or 504 at submit may have started a job already: never sent twice.
    expect(diagnoseKey({ stage: "submit", status: 502, text: "fal 502: <!DOCTYPE html>…" }, fal)).toMatchObject({ cause: "provider-down", retryable: false });
    expect(diagnoseKey({ stage: "poll", status: 502 }, fal).retryable).toBe(true);
    expect(diagnoseKey({ stage: "submit", error: "fetch failed ECONNREFUSED" }, fal)).toMatchObject({ cause: "provider-unreachable", retryable: true });
    expect(diagnoseKey({ stage: "submit", error: "fetch failed UND_ERR_SOCKET" }, fal).retryable).toBe(false);
  });

  it("offers the other key when it runs the same model", () => {
    const d = diagnoseKey({ stage: "submit", status: 503 }, { provider: "fal", other: "replicate" });
    expect(d.actions).toContainEqual({ kind: "run-with-key", label: "Run with your Replicate key", target: "replicate" });
  });
});

describe("waiting, and how long", () => {
  it("has a budget for what waiting can fix, and none for what it can't", () => {
    expect(retryPlan("gpu-stopped")).toEqual({ budgetMs: 30 * 60_000, firstMs: 15_000, maxMs: 60_000 });
    expect(retryPlan("gpu-offline")?.budgetMs).toBe(30 * 60_000);
    expect(retryPlan("gpu-starting")?.budgetMs).toBe(10 * 60_000);
    expect(retryPlan("gpu-offline", "check")?.budgetMs).toBe(3 * 60_000);
    expect(retryPlan("gpu-starting", "check")?.budgetMs).toBe(5 * 60_000);
    expect(retryPlan("provider-busy")?.budgetMs).toBe(60_000);
    for (const never of ["key-rejected", "key-balance", "gpu-password", "gpu-refused", "bad-input", "gpu-not-comfy", "gpu-out-of-memory", "content-flag"] as const) {
      expect(retryPlan(never), never).toBeNull();
    }
    expect(retryPlan("gpu-not-found", "check")).toBeNull();
  });

  it("doubles its wait up to a cap, or takes what the other side said", () => {
    const plan = { budgetMs: 60_000, firstMs: 5_000, maxMs: 60_000 };
    expect([1, 2, 3, 4, 5, 6].map((n) => backoffMs(n, plan))).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
    expect(backoffMs(1, plan, 12_000)).toBe(12_000);
    expect(backoffMs(1, plan, 1)).toBe(5_000);
  });

  it("says what a run waits for, and the strip's short words", () => {
    expect(waitingWords({ cause: "gpu-stopped" })).toBe("Your RunPod pod is off. Start it, and this run goes on by itself");
    expect(waitingWords({ cause: "gpu-starting" })).toBe("Waiting for your GPU to start up");
    expect(waitingWords({ cause: "gpu-starting" }, undefined, true)).toBe("Waiting for ComfyUI to start on your pod");
    expect(waitingWords({ cause: "gpu-not-found" })).toMatch(/Paste the new one, and this run goes there/);
    expect(waitingWords({ cause: "gpu-offline" })).toBe("Waiting for your GPU");
    expect(waitingWords({ cause: "provider-busy" }, "fal")).toBe("fal.ai is busy, trying again in a moment");
    expect(shortState("gpu-stopped")).toBe("pod stopped");
    expect(shortState("gpu-password-wrong")).toBe("needs a password");
    expect(shortState(undefined)).toBe("offline");
  });
});

describe("Save anyway", () => {
  it("keeps an address whose GPU is only off right now, never one that can't work as it is", () => {
    for (const c of ["gpu-stopped", "gpu-starting", "gpu-offline", "gpu-busy"] as const) expect(canSaveAnyway(c), c).toBe(true);
    for (const c of ["gpu-not-found", "gpu-password", "gpu-not-comfy", "gpu-certificate", "address-local"] as const) expect(canSaveAnyway(c), c).toBe(false);
  });
});

describe("the details line", () => {
  it("is short and never an HTML page", () => {
    expect(cleanDetails("<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body><h1>x</h1></body></html>")).toBe("502 Bad Gateway");
    expect(cleanDetails("<html><body>no title</body></html>")).toBe("");
    expect(cleanDetails("a\n  b\tc")).toBe("a b c");
    expect(cleanDetails("x".repeat(500)).length).toBe(160);
    expect(troubleOf(diagnoseGpu({ stage: "upload", status: 404 }, pod))).toEqual({ cause: "gpu-stopped", details: "RunPod pod, port 8188 · HTTP 404", actions: expect.any(Array) });
  });

  it("never names the GPU's address, an IP and port, or a credential the answer echoed", () => {
    const refused = diagnoseGpu({ stage: "upload", error: "Couldn't reach abc123xyz-8188.proxy.runpod.net: connect ECONNREFUSED 104.18.2.3:443" }, pod);
    expect(refused.details).toBe("RunPod pod, port 8188 · Couldn't reach your GPU: connect ECONNREFUSED your GPU");
    const v6 = diagnoseGpu({ stage: "test", error: "Couldn't reach quiet-river.trycloudflare.com: connect ECONNREFUSED 2606:4700::6810:84e5:443" }, tunnel);
    expect(v6.details).not.toMatch(/quiet-river|2606|6810/);
    const echoed = diagnoseGpu({ stage: "test", status: 200, body: '{"headers":{"Authorization":"Bearer sk-live-123456789","Host":"gpu.example.com"}}' }, withToken);
    expect(echoed.details).not.toMatch(/sk-live|123456789|gpu\.example\.com/);
    expect(withoutSecrets("token=abcdef123 password: hunter22 Bearer abc.def-ghi")).toBe("token=•••• password: •••• Bearer ••••");
    expect(withoutAddress("x.trycloudflare.com took over 15 s", "https://x.trycloudflare.com")).toBe("your GPU took over 15 s");
    // A redirect elsewhere names that site only; one to the GPU's own address doesn't name it.
    expect(diagnoseGpu({ stage: "test", status: 302, location: "https://login.example.org/path?next=secret" }, tunnel).details).toBe("your tunnel · HTTP 302 · to login.example.org");
    expect(diagnoseGpu({ stage: "test", status: 301, location: "/other" }, tunnel).details).toBe("your tunnel · HTTP 301 · to another page of your GPU's address");
    expect(diagnoseAddress("not-found", "https://quiet-river.trycloudflare.com/").details).toBe("your tunnel · name not found");
  });
});

describe("what was sent to ComfyUI's /prompt is never sent twice by itself", () => {
  it("waits only when the failure proves nothing arrived", () => {
    // A reset or a timeout after the job went out: the job may be on the GPU, so the run fails and says Retry.
    expect(diagnoseGpu({ stage: "prompt", error: "Couldn't reach x: socket hang up" }, tunnel)).toMatchObject({ cause: "gpu-offline", retryable: false });
    expect(diagnoseGpu({ stage: "prompt", status: 502, body: "<html>Bad gateway</html>" }, tunnel)).toMatchObject({ cause: "gpu-starting", retryable: false });
    // Nothing listens, no such name, a stopped pod, a tunnel that is down: nothing arrived, so it waits.
    expect(diagnoseGpu({ stage: "prompt", error: "Couldn't reach x: connect ECONNREFUSED 1.2.3.4:443" }, tunnel).retryable).toBe(true);
    expect(diagnoseGpu({ stage: "prompt", status: 404 }, pod).retryable).toBe(true);
    expect(diagnoseGpu({ stage: "prompt", status: 530, body: "error code: 1033" }, tunnel).retryable).toBe(true);
    // A file sent again is harmless: an upload's reset still waits.
    expect(diagnoseGpu({ stage: "upload", error: "Couldn't reach x: socket hang up" }, tunnel).retryable).toBe(true);
  });

  it("ngrok's and cloudflared's 'nothing behind me' pages read as a GPU that doesn't answer, whatever their status", () => {
    const ngrok = { kind: "link" as const, url: "https://x.ngrok-free.app" };
    expect(diagnoseGpu({ stage: "upload", status: 502, body: "ERR_NGROK_8012 Traffic successfully made it to the ngrok agent, but the agent failed to establish a connection" }, ngrok).cause).toBe("gpu-offline");
    expect(diagnoseGpu({ stage: "upload", status: 502, body: "Unable to reach the origin service. The service may be down or it may not be responding to traffic from cloudflared" }, tunnel).cause).toBe("gpu-offline");
  });
});

describe("words for where they are said", () => {
  it("before Run: runs start once the GPU answers, and Settings is named for what is there", () => {
    expect(beforeRunWords(diagnoseGpu({ stage: "status", status: 404 }, pod).words)).toBe(
      "Your RunPod pod isn't running, or ComfyUI isn't on port 8188. Start your pod, and your runs start as soon as it answers.",
    );
    expect(beforeRunWords(diagnoseGpu({ stage: "status", status: 503 }, tunnel).words)).toMatch(/your runs start as soon as ComfyUI is ready\.$/);
    expect(beforeRunWords(diagnoseGpu({ stage: "status", status: 401 }, tunnel).words)).toBe("Your GPU asks for a password. Add it in Settings → Your GPU.");
  });

  it("after Test (nothing saved): what to press once it answers; when the checks stop, Save anyway too", () => {
    const words = diagnoseGpu({ stage: "test", status: 404 }, pod).words;
    expect(testWords(words)).toMatch(/Start your pod, then press Connect\.$/);
    expect(testWords(words, true)).toMatch(/^Still no answer\. .*Start your pod, then press Connect again, or Save anyway\.$/);
  });

  it("a wait the other side asked for is honoured, never cut short", () => {
    expect(backoffMs(1, { budgetMs: 600_000, firstMs: 5_000, maxMs: 60_000 }, 3_600_000)).toBe(3_600_000);
  });

  it("a run's own time limits say what happened, with what helps", () => {
    expect(diagnoseGpuJob({ kind: "too-long", minutes: 45 }, pod).words).toBe("This took longer than 45 minutes, so we stopped it. Press Retry, or try a shorter clip.");
    expect(diagnoseGpuJob({ kind: "disconnected" }, pod)).toMatchObject({ actions: [{ kind: "gpu-settings", label: "Connect your GPU" }, { kind: "retry" }] });
    expect(diagnoseKeyJob({ kind: "busy", minutes: 30 }, { provider: "fal" }).words).toBe("fal.ai was busy for 30 minutes, so this run stopped. Press Retry in a few minutes.");
    expect(diagnoseKeyJob({ kind: "too-long", minutes: 45 }, { provider: "replicate" }).words).toBe("This took longer than 45 minutes on Replicate, so we stopped it. Press Retry.");
    // Out of memory offers one size smaller first; a file too big for the address, a smaller copy.
    expect(diagnoseGpuJob({ kind: "error", message: "CUDA out of memory" }, pod).actions[0].kind).toBe("try-smaller");
    expect(diagnoseGpu({ stage: "upload", status: 413, body: "<html>413</html>" }, tunnel).actions[0].kind).toBe("send-smaller");
  });
});
