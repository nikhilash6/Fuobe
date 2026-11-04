import { connection } from "next/server";
import { templateModels } from "@/lib/canvas-template-cards";

/**
 * The model names each Canvas template runs on, per engine: the owner's (their cards' and template pages' model line).
 * Not a guest read (src/lib/guest-access.ts), so a visitor or an account gets 401 from the proxy: the names never come
 * with a page.
 */
export async function GET() {
  await connection();
  return Response.json(templateModels());
}
