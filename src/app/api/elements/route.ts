import { connection } from "next/server";
import { z } from "zod";
import { getModel } from "@/lib/catalog";
import { MAX_ELEMENT_PHOTOS, VOICE_DESCRIPTION_MAX, VOICE_TRANSCRIPT_MAX, type ElementVoice } from "@/lib/catalog/elements";
import { createElement, listElements } from "@/server/elements";

const Kind = z.enum(["character", "location", "prop", "style", "voice"]);

const Body = z.object({
  name: z.string().trim().min(1).max(60),
  kind: Kind.default("character"),
  description: z.string().max(500).optional(),
  references: z.array(z.string().startsWith("/api/files/")).max(MAX_ELEMENT_PHOTOS),
  // Design a voice: the model that made the take, its words and what the take says. The embedding is the server's own
  // (src/server/voices.ts), never taken from a request.
  voice: z
    .object({
      modelId: z.string().max(80),
      description: z.string().trim().max(VOICE_DESCRIPTION_MAX).optional(),
      transcript: z.string().trim().max(VOICE_TRANSCRIPT_MAX).optional(),
    })
    .optional(),
});

/** A designed voice's record, from a model that designs voices; null when the model doesn't. */
function designedVoice(v: z.infer<typeof Body>["voice"]): ElementVoice | null {
  const model = v && getModel(v.modelId);
  if (!v || !model?.routes.some((r) => r.op === "voice-design")) return null;
  return { modelId: model.id, engine: model.engine, ...(v.description && { description: v.description }), ...(v.transcript && { transcript: v.transcript }) };
}

export async function GET(request: Request) {
  await connection();
  const kind = Kind.safeParse(new URL(request.url).searchParams.get("kind"));
  return Response.json({ items: listElements(kind.success ? kind.data : undefined) });
}

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Give the element a name" }, { status: 400 });
  if (!parsed.data.references.length && !parsed.data.description?.trim()) {
    return Response.json({ error: "Add at least one photo or a description" }, { status: 400 });
  }
  const { voice: asked, ...rest } = parsed.data;
  const voice = asked ? designedVoice(asked) : null;
  if (asked && (!voice || parsed.data.kind !== "voice" || !parsed.data.references.length)) {
    return Response.json({ error: "Pick a take to save as the voice" }, { status: 400 });
  }
  return Response.json(createElement({ ...rest, ...(voice && { voice }) }), { status: 201 });
}
