import type { Asset } from "@/lib/api";
import { responseError } from "@/lib/refusals";

/**
 * Upload a file as it is (the body is the file; its type and its name in headers), so the server streams it to disk
 * instead of reading a whole form into memory. Throws with the server's own message ("That clip is over 95 MB…"),
 * marked when the refusal shows its own card (src/lib/refusals.ts).
 */
export async function postFile(file: File, signal?: AbortSignal): Promise<Asset> {
  const res = await fetch("/api/uploads", {
    method: "POST",
    body: file,
    signal,
    headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
  });
  const body = (await res.json().catch(() => ({}))) as Asset & { error?: string };
  if (!res.ok) throw responseError(res, body.error ?? `Upload failed (${res.status})`);
  return body;
}
