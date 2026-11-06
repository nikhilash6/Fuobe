import { connection } from "next/server";
import { adminAccess, audit } from "@/server/admin-tokens";
import { checkUploadSwitches } from "@/lib/av/upload-switches";
import { saveUploadSwitches, uploadSwitches } from "@/server/upload-switches";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The upload switches (owner only, or an admin token with site:read): what a browser may do to a file that doesn't fit a
 * tool before it is uploaded (src/lib/av/upload-switches.ts).
 */
export async function GET(request: Request) {
  await connection();
  const access = adminAccess(request, "site:read", "Only the studio's owner sees the site's switches");
  if (access instanceof Response) return access;
  return Response.json({ switches: uploadSwitches() }, { headers: NO_STORE });
}

/**
 * Change them (owner only, or an admin token with site:write): any of `{ soundConvert, soundTrim, videoTrim, photoConvert,
 * photoCrop }`, each true or false. Each change is written to the admin log with the values before and after. Browsers
 * pick it up when they next load the switches.
 */
export async function PATCH(request: Request) {
  const access = adminAccess(request, "site:write", "Only the studio's owner changes the site's switches");
  if (access instanceof Response) return access;
  const body = (await request.json().catch(() => null)) as unknown;
  const before = uploadSwitches();
  const r = checkUploadSwitches(body, before);
  if ("error" in r) {
    audit(access.actor, "site.uploads", null, { keys: body && typeof body === "object" ? Object.keys(body).slice(0, 8) : [] }, 400);
    return Response.json({ error: r.error }, { status: 400, headers: NO_STORE });
  }
  const switches = saveUploadSwitches(r.switches);
  audit(access.actor, "site.uploads", null, { before, after: switches }, 200);
  return Response.json({ switches }, { headers: NO_STORE });
}
