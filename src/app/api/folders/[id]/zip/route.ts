import { connection } from "next/server";
import { folderZipEntries, LibraryError, ZIP_MAX_BYTES } from "@/server/library";
import { zipSize, zipStream } from "@/server/zip";

/**
 * Download a folder as one zip: its finished results, and each subfolder's in a folder of its own.
 * `?check=1` answers {files, size} (or the error) without the zip, so the page can explain a refusal.
 * Helper steps are left out, as on the folder's page, unless `?steps=1` (Show steps is on).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/folders/[id]/zip">) {
  await connection();
  const { id } = await ctx.params;
  const sp = new URL(request.url).searchParams;
  let zip: ReturnType<typeof folderZipEntries>;
  try {
    zip = folderZipEntries(id, { steps: sp.get("steps") === "1" });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof LibraryError ? e.status : 500 });
  }
  if (!zip) return Response.json({ error: "That folder doesn't exist anymore" }, { status: 404 });
  if (!zip.entries.length) return Response.json({ error: "Nothing finished in this folder yet" }, { status: 404 });
  const size = zipSize(zip.entries);
  if (size > ZIP_MAX_BYTES) return Response.json({ error: "That's over 4 GB. Download its subfolders one at a time." }, { status: 413 });
  if (sp.get("check") === "1") return Response.json({ files: zip.entries.length, size });
  const slug = zip.name.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "folder";
  return new Response(zipStream(zip.entries), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${slug}-${new Date().toISOString().slice(0, 10)}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
