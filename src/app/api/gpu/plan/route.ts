import { connection } from "next/server";
import { preflightOn } from "@/server/gpu/index-file";
import { planFor } from "@/server/gpu/readiness-service";
import { gpuTargetFor } from "@/server/gpu/target";

/**
 * GPU pre-flight: one tool's fix plan (`?ref=model:<id>#<op>`, `preset:<id>` or `preset:<id>@<model id>` for its
 * route on that model, `studio:<href>` or `workflow:<id>`), built on the server from the requirement index and the
 * viewer's last check. The client names a tool only, never a file, URL or repository (R2). P1 plans are by hand: the
 * commands to run.
 */
const REF = /^(model:[\w.-]{1,120}#[\w-]{1,40}|preset:[\w.-]{1,120}(?:@[\w.-]{1,120})?|studio:\/[\w/-]{0,60}|workflow:[\w.-]{1,120})$/;

export async function GET(request: Request) {
  await connection();
  const headers = { "Cache-Control": "private, no-store" };
  if (!preflightOn()) return Response.json({ error: "The GPU pre-flight is switched off on this studio." }, { status: 404, headers });
  const ref = new URL(request.url).searchParams.get("ref") ?? "";
  if (!REF.test(ref)) return Response.json({ error: "Name a tool (ref)" }, { status: 400, headers });
  const t = gpuTargetFor(request, "read");
  if (t.kind === "none") return Response.json({ error: "Connect your GPU first.", code: "connect-gpu" }, { status: 409, headers });
  const plan = await planFor(t, ref, t.kind === "account" ? t.accountId : t.kind === "computer" ? (t.accountId ?? "owner") : "owner");
  if (!plan) return Response.json({ error: "Check your GPU first, or that tool doesn't run on ComfyUI.", code: "no-check" }, { status: 404, headers });
  return Response.json(plan, { headers });
}
