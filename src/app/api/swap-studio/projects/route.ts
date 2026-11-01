import { connection } from "next/server";
import { body, handle } from "@/server/shorts-schemas";
import { createProject, CreateSchema, listProjects } from "@/server/swap-studio";

/** Character Swap Studio projects, most recently changed first. */
export async function GET() {
  await connection();
  return handle(() => Response.json({ items: listProjects() }));
}

/** A new project: a name, the engine, and (optionally) the character. */
export async function POST(request: Request) {
  return handle(async () => Response.json(createProject(await body(request, CreateSchema, "Name the project and pick an engine")), { status: 201 }));
}
