import { connection } from "next/server";
import { ZIP_MAX_BYTES, zipEntries } from "@/server/library";
import { zipSize, zipStream } from "@/server/zip";

/** Download the finished outputs of several generations as one zip: GET ?ids=a,b,c (up to 500). */
export async function GET(request: Request) {
  await connection();
  const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return Response.json({ error: "Pick something to download" }, { status: 400 });
  const entries = zipEntries(ids);
  if (!entries.length) return Response.json({ error: "Nothing finished to download yet" }, { status: 404 });
  const size = zipSize(entries);
  if (size > ZIP_MAX_BYTES) return Response.json({ error: "That's over 4 GB. Download fewer items at a time." }, { status: 413 });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(zipStream(entries), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="fuobe-${day}-${entries.length}-files.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
