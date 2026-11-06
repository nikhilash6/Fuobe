import { CONNECT_GPU_EVENT, GUEST_PROMPT_EVENT, refusalCard, type Asset, type ConnectGpuDetail } from "@/lib/api";
import { KINETIC_UPLOAD_HEADER } from "@/lib/guest-access";
import { responseError } from "@/lib/refusals";
import { fitAfterRefusal, fitBeforeSend, type FileFit } from "@/lib/av/fit-file";

/**
 * The file as the upload route takes it (src/lib/av/fit-file.ts): under the route's name for its type, or converted in this
 * browser (a HEIC photo, an AAC sound) when the owner's switches allow. A Kinetic Motion result goes as it is. A file
 * that needs nothing is returned at once (not a promise), so its upload starts in the same tick as before.
 */
function prepared(file: File, kinetic?: boolean): File | Promise<File> {
  if (kinetic) return file;
  const fit = fitBeforeSend(file);
  if (fit.kind === "send") return fit.type ? new File([file], file.name, { type: fit.type, lastModified: file.lastModified }) : file;
  return converted(file, fit).then((f) => f ?? file);
}

/** The converter is loaded only when a file needs it. */
async function converted(file: File, fit: FileFit): Promise<File | null> {
  const { fitFile } = await import("@/components/av/fit-file");
  return fitFile(file, fit);
}

/** Refused for its size or type (an account's caps, an account's GIF): fitted once, or null when nothing fits it. */
async function refitted(file: File, status: number, kinetic?: boolean): Promise<File | null> {
  const fit = kinetic ? null : fitAfterRefusal(file, status);
  return fit ? converted(file, fit).catch(() => null) : null;
}

/**
 * Upload a file as it is (the body is the file; its type and its name in headers), so the server streams it to disk
 * instead of reading a whole form into memory. Throws with the server's own message ("That clip is over 95 MB…"),
 * marked when the refusal shows its own card (src/lib/refusals.ts).
 */
export async function postFile(file: File, signal?: AbortSignal, opts: { kinetic?: boolean } = {}): Promise<Asset> {
  const send = (f: File) =>
    fetch("/api/uploads", {
      method: "POST",
      body: f,
      signal,
      // A Kinetic Motion clip or poster rendered in the page: any account may save one (KINETIC_UPLOAD_HEADER).
      headers: { "Content-Type": f.type || "application/octet-stream", "X-File-Name": encodeURIComponent(f.name), ...(opts.kinetic && { [KINETIC_UPLOAD_HEADER]: "1" }) },
    });
  const ready = prepared(file, opts.kinetic);
  const first = ready instanceof File ? ready : await ready;
  let res = await send(first);
  if (res.status === 413 || res.status === 415) {
    const again = await refitted(first, res.status, opts.kinetic);
    if (again && !signal?.aborted) res = await send(again);
  }
  const body = (await res.json().catch(() => ({}))) as Asset & { error?: string };
  if (!res.ok) throw responseError(res, body.error ?? "That upload didn't go through. Please try again.");
  return body;
}

/**
 * postFile with its progress (fetch can't report an upload's): the file as the body, its type and name in headers, so a
 * clip up to the viewer's limit is streamed to disk (a form is only taken from an account while small). Aborts with
 * `signal` (an AbortError).
 */
export async function postFileWithProgress(file: File, onProgress: (p: number) => void, signal?: AbortSignal): Promise<{ url: string; name?: string }> {
  const ready = prepared(file);
  const first = ready instanceof File ? ready : await ready;
  try {
    return await sendWithProgress(first, onProgress, signal);
  } catch (e) {
    const status = (e as { status?: number }).status;
    const again = status === 413 || status === 415 ? await refitted(first, status) : null;
    if (!again || signal?.aborted) throw e;
    return sendWithProgress(again, onProgress, signal);
  }
}

function sendWithProgress(file: File, onProgress: (p: number) => void, signal?: AbortSignal): Promise<{ url: string; name?: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.responseType = "json";
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      const body = xhr.response as { url?: string; name?: string; error?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && body?.url) return resolve({ url: body.url, name: body.name });
      const err = Object.assign(new Error(body?.error ?? "That upload didn't go through. Please try again."), { status: xhr.status });
      // A guest's upload (401 x-fuobe-guest) or an account's with no GPU or key of its own (403 x-fuobe-connect-gpu):
      // the card that sets it up opens, as for a fetch (watchGuestRefusals), and the error says it's shown.
      const guest = xhr.status === 401 && xhr.getResponseHeader("x-fuobe-guest") === "1";
      const gpu = xhr.status === 403 && xhr.getResponseHeader("x-fuobe-connect-gpu") === "1";
      if ((guest || gpu) && typeof window !== "undefined" && refusalCard(guest ? "guest" : "gpu", window.location)) {
        window.dispatchEvent(new CustomEvent<ConnectGpuDetail>(guest ? GUEST_PROMPT_EVENT : CONNECT_GPU_EVENT, { detail: { action: "upload" } }));
        Object.assign(err, { refusalShown: true });
      }
      reject(err);
    };
    xhr.onerror = () => reject(new Error("Upload failed — check your connection"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}
