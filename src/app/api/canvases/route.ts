import { connection } from "next/server";
import { z } from "zod";
import { createCanvas, listCanvases, parseGraph, parsePages } from "@/server/canvas";
import { canvasFromSkill } from "@/server/canvas-skills";
import { refusedRun } from "@/server/connect-refusal";
import { SkillError } from "@/server/skills";

const Body = z.object({
  name: z.string().max(80).optional(),
  templateId: z.string().max(60).optional(),
  engine: z.enum(["cloud", "open"]).optional(),
  graph: z.unknown().optional(),
  pages: z.unknown().optional(),
  /** Open a recipe skill as a new canvas (W5): its inputs and steps drawn as nodes. */
  skill: z.string().min(1).max(64).optional(),
});

export async function GET() {
  await connection();
  return Response.json({ items: listCanvases() });
}

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid canvas" }, { status: 400 });
  const { graph: rawGraph, pages: rawPages, skill, ...rest } = parsed.data;
  if (skill) {
    try {
      return Response.json(canvasFromSkill(skill), { status: 201 });
    } catch (e) {
      if (e instanceof SkillError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  }
  const graph = rawGraph === undefined ? undefined : parseGraph(rawGraph);
  const pages = rawPages === undefined ? undefined : parsePages(rawPages);
  if (graph === null || pages === null) return Response.json({ error: "That board couldn't be read" }, { status: 400 });
  try {
    return Response.json(createCanvas({ ...rest, graph, pages }), { status: 201 });
  } catch (e) {
    return refusedRun(e, request);
  }
}
