import { connection } from "next/server";
import { z } from "zod";
import type { ChatMe } from "@/lib/chat/types";
import { siteStatus } from "@/server/chat/backend";
import { body, chatViewer, refused, signUp, tooOften } from "@/server/chat/http";
import { getPrefs, setEngine, setKeyModel, setMature } from "@/server/chat/store";

function me(who: string, owner: boolean): ChatMe {
  const p = getPrefs(who);
  const s = siteStatus(who);
  return { site: s.on, siteKnown: s.known, key: p.key, engine: p.engine, mature: p.mature, owner };
}

/** The person's chat settings and what can answer them now. */
export async function GET(request: Request) {
  await connection();
  const v = chatViewer(request);
  if (!v) return signUp();
  return Response.json(me(v.who, v.owner));
}

const Patch = z.object({
  /** Mango Chilli mode: turning it on needs `adult: true` (the person said they're 18 or older). */
  mature: z.boolean().optional(),
  adult: z.boolean().optional(),
  engine: z.enum(["site", "key"]).optional(),
  model: z
    .string()
    .trim()
    .regex(/^[\w.:/-]{3,120}$/)
    .optional(),
});

export async function PATCH(request: Request) {
  const v = chatViewer(request);
  if (!v) return signUp();
  const limited = tooOften(v.who);
  if (limited) return limited;
  const p = Patch.safeParse(await body(request));
  if (!p.success) return Response.json({ error: "Those settings couldn't be read." }, { status: 400 });
  try {
    if (p.data.mature === true && p.data.adult !== true) return Response.json({ error: "Confirm you're 18 or older to turn on Mango Chilli mode.", code: "adult" }, { status: 400 });
    if (p.data.mature !== undefined) setMature(v.who, p.data.mature);
    if (p.data.model) setKeyModel(v.who, p.data.model);
    if (p.data.engine) setEngine(v.who, p.data.engine);
    return Response.json(me(v.who, v.owner));
  } catch (e) {
    return refused(e);
  }
}
