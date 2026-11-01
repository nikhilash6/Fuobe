import { connection } from "next/server";
import { z } from "zod";
import { body, createChannel, EngineSchema, GenreSchema, handle, listChannels } from "@/server/faceless";

const Create = z.object({
  idea: z.string().trim().min(1, "Describe the channel first").max(500, "Keep the channel idea under 500 characters"),
  genre: GenreSchema,
  engine: EngineSchema,
  reference: z.string().max(500).optional(),
  name: z.string().max(60).optional(),
});

/** Your channels, newest first, with episode counts and the latest finished episode. */
export async function GET() {
  await connection();
  return handle(() => Response.json({ items: listChannels() }));
}

/** Create a channel (its name is written for you when you don't give one). */
export async function POST(request: Request) {
  return handle(async () => {
    const input = await body(request, Create, "Describe the channel and pick a genre");
    return Response.json(await createChannel(input), { status: 201 });
  }, request);
}
