import { gateAsProxy, readFormWithin } from "@/server/direct-gate";
import { EngineSchema, FacelessError, handle, MAX_DOCUMENT_BYTES, readDocument } from "@/server/faceless";

/**
 * A PDF or Word source (multipart: "file", "engine"): the text is read on the server and, when the
 * document is longer than the script writer reads, summarised. The file itself isn't kept.
 */
export async function POST(request: Request) {
  // The proxy doesn't run on this route (a big form): its checks run here.
  const denied = gateAsProxy(request);
  if (denied) return denied;
  return handle(async () => {
    const form = await readFormWithin(request, MAX_DOCUMENT_BYTES);
    if (form === "too-big") throw new FacelessError(`That file is over ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB — add the part that matters, or paste its text into the prompt`, 413);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new FacelessError("Choose a PDF or a Word file (.docx)");
    if (file.size > MAX_DOCUMENT_BYTES) throw new FacelessError(`${file.name} is over ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB — add the part that matters, or paste its text into the prompt`, 413);
    const engine = EngineSchema.safeParse(form?.get("engine"));
    return Response.json(await readDocument({ name: file.name, data: Buffer.from(await file.arrayBuffer()), type: file.type }, engine.success ? engine.data : "cloud"));
  }, request);
}
