import { z } from "zod";
import { addSource, ProjectError } from "@/server/assist/projects";
import { gateAsProxy, readBodyWithin, readFormWithin } from "@/server/direct-gate";
import { contentTypeFor, deleteAsset, saveFile } from "@/server/storage";

const MAX_BYTES = 25 * 1024 * 1024;
/** A source sent as JSON: a link, an element or a note of up to 20,000 characters (4 bytes each at most), with room to spare. */
const JSON_MAX_BYTES = 256 * 1024;
/** Documents Assist can read (text, Markdown, PDF), plus media it can pass on as inputs. */
const ALLOWED = /^(text\/[\w.+-]+|application\/(json|pdf|xml|x-subrip|x-yaml|yaml)|image\/(png|jpeg|webp|gif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|wav|x-wav|ogg|flac|mp4|webm))$/;
const TEXT_EXT: Record<string, string> = { md: "text/markdown", markdown: "text/markdown", txt: "text/plain", csv: "text/csv", srt: "application/x-subrip", vtt: "text/vtt", json: "application/json", yml: "application/x-yaml", yaml: "application/x-yaml", pdf: "application/pdf" };

const Json = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("link"), url: z.string().trim().min(4).max(2000) }),
  z.object({ kind: z.literal("file"), url: z.string().startsWith("/api/files/"), name: z.string().max(160).optional() }),
  z.object({ kind: z.literal("element"), elementId: z.string().min(1).max(40) }),
  z.object({ kind: z.literal("text"), title: z.string().max(160).optional(), text: z.string().min(1).max(20_000) }),
]);

/**
 * Add a source: JSON (a link, an uploaded file URL, an element, a note) or multipart "file"
 * (documents and media are stored like uploads). Links are fetched through the guarded fetcher.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/assist/projects/[projectId]/sources">) {
  // The proxy doesn't run on this route (a big form): its checks run here.
  const denied = gateAsProxy(request);
  if (denied) return denied;
  const { projectId } = await ctx.params;
  try {
    if ((request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const form = await readFormWithin(request, MAX_BYTES);
      if (form === "too-big") return Response.json({ error: "That file is over 25 MB" }, { status: 413 });
      const file = form?.get("file");
      if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
      if (file.size > MAX_BYTES) return Response.json({ error: "That file is over 25 MB" }, { status: 413 });
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const type = TEXT_EXT[ext] ?? (!file.type || file.type === "application/octet-stream" ? contentTypeFor(file.name, "") : file.type);
      if (!ALLOWED.test(type)) return Response.json({ error: `Assist can't use ${type || "that kind of"} files — add text, Markdown, PDF, images, video or audio` }, { status: 415 });
      // The stored file's extension comes from the name for types storage doesn't map: keep it a plain one.
      let name = file.name.replace(/[\\/]/g, "_").replace(/[^\w.\- ()]+/g, "_").slice(-120) || "file";
      if (!/\.[a-z0-9]{1,8}$/i.test(name)) name = `${name}.${Object.entries(TEXT_EXT).find(([, t]) => t === type)?.[0] ?? "bin"}`;
      const asset = saveFile({ data: Buffer.from(await file.arrayBuffer()), contentType: type, name, source: "upload" });
      try {
        return Response.json(await addSource(projectId, { kind: "file", url: asset.url, name: file.name.slice(0, 160) }), { status: 201 });
      } catch (e) {
        // Refused (an unreadable PDF, the project is full): don't keep the upload.
        deleteAsset(asset.id);
        throw e;
      }
    }
    // A link, an element or a note: words only (a note is at most 20,000 characters).
    const body = await readBodyWithin(request, JSON_MAX_BYTES);
    if (body === "too-big") return Response.json({ error: "That note is too long" }, { status: 413 });
    let json: unknown = null;
    try {
      json = body ? JSON.parse(body.toString("utf8")) : null;
    } catch {}
    const parsed = Json.safeParse(json);
    if (!parsed.success) return Response.json({ error: "Add a link, a file, an element or a note" }, { status: 400 });
    return Response.json(await addSource(projectId, parsed.data), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof ProjectError ? e.status : 500 });
  }
}
