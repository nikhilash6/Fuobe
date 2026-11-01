import { gateAsProxy, readFormWithin } from "@/server/direct-gate";
import { importSkill, SkillError } from "@/server/skills";

const MAX_BYTES = 5 * 1024 * 1024;

/** Add a skill from a .zip / .skill archive or a SKILL.md (multipart "file"; `?replace=1` overwrites your skill of the same name). */
export async function POST(request: Request) {
  // The proxy doesn't run on this route (a big form): its checks run here.
  const denied = gateAsProxy(request);
  if (denied) return denied;
  const tooBig = () => Response.json({ error: "That file is over 5 MB — a skill is mostly text; leave large assets out" }, { status: 413 });
  const form = await readFormWithin(request, MAX_BYTES);
  if (form === "too-big") return tooBig();
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose a .zip, .skill or SKILL.md file" }, { status: 400 });
  if (file.size > MAX_BYTES) return tooBig();
  try {
    const replace = new URL(request.url).searchParams.get("replace") === "1";
    const r = importSkill({ name: file.name, data: Buffer.from(await file.arrayBuffer()) }, { replace });
    return Response.json(r, { status: r.replaced ? 200 : 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof SkillError ? e.status : 500 });
  }
}
