import { gateAsProxy, readFormWithin } from "@/server/direct-gate";
import { saveFile } from "@/server/storage";

const MAX_BYTES = 64 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * A picture the editor rendered to hand to a model or to keep in a layer (a layer, a region, the
 * composite, a mask, a merged region, a colour grade). Stored like an upload but as "derived", so it
 * stays out of the Library's Uploads and the pickers; projects that use it keep it (ASSET_REFS).
 */
export async function POST(request: Request) {
  // The proxy doesn't run on this route (a big form): its checks run here.
  const denied = gateAsProxy(request);
  if (denied) return denied;
  const form = await readFormWithin(request, MAX_BYTES);
  if (form === "too-big") return Response.json({ error: "That render is too large (64 MB max)" }, { status: 413 });
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "That render is too large (64 MB max)" }, { status: 413 });
  const data = Buffer.from(await file.arrayBuffer());
  if (file.type !== "image/png" || !data.subarray(0, 8).equals(PNG_MAGIC)) return Response.json({ error: "Renders are PNG images" }, { status: 415 });
  const asset = saveFile({ data, contentType: "image/png", name: file.name.slice(0, 120), source: "derived" });
  return Response.json(asset, { status: 201 });
}
