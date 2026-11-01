import { connection } from "next/server";
import { z } from "zod";
import { MAX_TOPIC } from "@/lib/catalog/faceless";
import { body, createEpisode, handle, listEpisodes, SettingsSchema, SourceSchema } from "@/server/faceless";

const Create = z.object({
  prompt: z.string().max(MAX_TOPIC, "Prompt is too long (max 5000 characters)"),
  sources: z.array(SourceSchema).max(3, "Up to 3 sources per video — remove one to add another").optional(),
  settings: SettingsSchema,
  /** Show the script for review before rendering (default: render straight away). */
  review: z.boolean().optional(),
});

/** History: your explainers, newest first (`?q=` search, `?liked=1`). */
export async function GET(request: Request) {
  await connection();
  return handle(() => {
    const p = new URL(request.url).searchParams;
    return Response.json({ items: listEpisodes({ kind: "explainer", q: p.get("q") ?? undefined, liked: p.get("liked") === "1", limit: 200 }) });
  });
}

/** Explain something: the script is written from the prompt and sources, then rendered. */
export async function POST(request: Request) {
  return handle(async () => {
    const input = await body(request, Create, "Add a prompt, or attach a file or link");
    const episode = createEpisode({ kind: "explainer", topic: input.prompt, sources: input.sources, settings: input.settings, autoRender: !input.review });
    return Response.json(episode, { status: 201 });
  }, request);
}
