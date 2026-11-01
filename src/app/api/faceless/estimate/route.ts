import { z } from "zod";
import { BlockSchema, body, estimateEpisode, GenreSchema, handle, SettingsSchema } from "@/server/faceless";
import { priceAs } from "@/server/visitor";

const Ask = z.object({
  kind: z.enum(["faceless", "explainer"]),
  settings: SettingsSchema,
  blocks: z.array(BlockSchema).max(80).optional(),
  genre: GenreSchema.optional(),
});

/** What an episode would cost (by part), whether it runs as a demo, and what's in the way. */
async function post(request: Request) {
  return handle(async () => Response.json(estimateEpisode(await body(request, Ask, "Those settings aren't valid"))));
}

/** A visitor (public sign-up) gets the price of its run on its own GPU, never a demo (src/server/visitor.ts). */
export async function POST(request: Request) {
  return priceAs(request, () => post(request));
}
