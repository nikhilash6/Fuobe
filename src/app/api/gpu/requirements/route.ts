import { connection } from "next/server";
import { loadIndexRaw } from "@/server/gpu/index-file";

/**
 * GPU pre-flight: what every workflow needs (workflows/comfyui/requirements.json, built by
 * scripts/comfy/build-requirements.mjs). Public, like the catalog: it holds nothing of anyone's machine.
 */
export async function GET(request: Request) {
  await connection();
  const { index, raw } = loadIndexRaw();
  const etag = `"${index.hash}"`;
  const headers = { ETag: etag, "Cache-Control": "public, max-age=3600" };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(raw, { headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}
