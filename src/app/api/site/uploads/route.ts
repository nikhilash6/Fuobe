import { connection } from "next/server";
import { uploadSwitches } from "@/server/upload-switches";

/**
 * The upload switches, for every browser (guests and accounts too): what it may do to a file that doesn't fit a tool before
 * it is uploaded (src/lib/av/upload-switches.ts). Holds nothing else.
 */
export async function GET() {
  await connection();
  return Response.json({ switches: uploadSwitches() }, { headers: { "Cache-Control": "no-store" } });
}
