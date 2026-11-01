import { z } from "zod";
import { createSheet, previewSheet, type SheetRun } from "@/server/photodump";
import { refusedRun } from "@/server/connect-refusal";

const Engine = z.enum(["cloud", "open"]);

const Body = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("reference"), engine: Engine, images: z.array(z.string().startsWith("/api/files/")).max(5), details: z.string().max(300).optional() }),
  z.object({
    mode: z.literal("cast"),
    engine: Engine,
    cast: z.record(z.string().max(40), z.union([z.string().max(300), z.number(), z.array(z.string().max(60)).max(8)])),
    details: z.string().max(300).optional(),
  }),
  z.object({ mode: z.literal("describe"), engine: Engine, prompt: z.string().max(2000) }),
]);

/** What's wrong with a body, said for the mode it was meant for (Higgsfield's words where it has them). */
function bodyError(mode: unknown, issues: z.core.$ZodIssue[]): string {
  const at = (key: string) => issues.some((i) => i.path[0] === key);
  if (at("engine")) return "Pick Cloud or Open source";
  if (mode === "reference") {
    if (issues.some((i) => i.path[0] === "images" && i.code === "too_big")) return "Maximum 5 images";
    if (at("images")) return "Upload at least 1 image";
    if (at("details")) return "Keep the details under 300 characters";
  }
  if (mode === "cast") return at("details") ? "Keep the details under 300 characters" : "Check the cast fields";
  if (mode === "describe") return at("prompt") && issues.some((i) => i.code === "too_big") ? "Keep the description under 2,000 characters" : "Describe your character first";
  return "Pick how to build the character: From Reference, Build from scratch or From a description";
}

/**
 * Character Sheet: a turnaround sheet from 1–5 reference photos, from a Soul Cast build, or from a
 * description (the AI Influencer app). `?preview=1` prices it instead.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { mode?: unknown } | null;
  const parsed = Body.safeParse(body);
  if (!parsed.success) return Response.json({ error: bodyError(body?.mode, parsed.error.issues) }, { status: 400 });
  const input = parsed.data as SheetRun;
  if (new URL(request.url).searchParams.get("preview")) return Response.json(previewSheet(input));
  try {
    return Response.json(createSheet(input), { status: 201 });
  } catch (e) {
    return refusedRun(e, request);
  }
}
