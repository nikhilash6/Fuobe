import { connection } from "next/server";
import { createProject, listProjects, ProjectError } from "@/server/assist/projects";
import { ProjectBody } from "@/server/assist/schemas";

export async function GET() {
  await connection();
  return Response.json({ items: listProjects() });
}

export async function POST(request: Request) {
  const parsed = ProjectBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !parsed.data.name) return Response.json({ error: "Give the project a name" }, { status: 400 });
  try {
    return Response.json(createProject(parsed.data), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof ProjectError ? e.status : 500 });
  }
}
