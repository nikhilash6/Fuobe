import { connection } from "next/server";
import { z } from "zod";
import { createProject, FileUrl, LayersError, listProjects } from "@/server/layers";

const Body = z.object({
  /** The image to open: an upload or a result (an /api/files/ URL). */
  source: FileUrl,
  /** Its pixel size, read by the browser that loaded it. */
  width: z.number().positive().max(20_000),
  height: z.number().positive().max(20_000),
  name: z.string().max(200).optional(),
  /** A finished layers result to open as this project's layers. */
  generationId: z.string().max(40).optional(),
});

/** Your Layers projects, most recently edited first. */
export async function GET() {
  await connection();
  return Response.json({ items: listProjects() });
}

/** Open an image in Layers: a new project with the image as its only layer. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Only images can be edited here. Pick an image or upload one." }, { status: 400 });
  try {
    return Response.json(createProject(parsed.data), { status: 201 });
  } catch (e) {
    const status = e instanceof LayersError ? e.status : 422;
    return Response.json({ error: (e as Error).message }, { status });
  }
}
