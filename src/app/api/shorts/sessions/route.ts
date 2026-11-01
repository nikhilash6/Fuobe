import { connection } from "next/server";
import { createSession, listSessions } from "@/server/shorts";
import { ShortsBodySchema, body, handle, once } from "@/server/shorts-schemas";

/** Shorts sessions, newest first (History). */
export async function GET() {
  await connection();
  return handle(() => Response.json({ items: listSessions() }));
}

/** Start a session: cut the clip into segments, restyle each, stitch them under the original sound. */
export async function POST(request: Request) {
  return handle(async () => {
    const input = await body(request, ShortsBodySchema, "Pick a preset, upload a clip and choose the part to restyle");
    // A repeated requestId (a second click on Generate) gets the session the first one started.
    return Response.json(await once("shorts-session", input.requestId, () => createSession(input)), { status: 201 });
  }, request);
}
