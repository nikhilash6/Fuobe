import { connection } from "next/server";
import { createProject, listProjects } from "@/server/cinema";
import { ProjectCreate, body, handle } from "@/server/cinema-schemas";

export async function GET() {
  await connection();
  return handle(() => Response.json({ items: listProjects() }));
}

export async function POST(request: Request) {
  return handle(async () => {
    const input = await body(request, ProjectCreate, "Give the project a name");
    return Response.json(createProject(input), { status: 201 });
  }, request);
}
