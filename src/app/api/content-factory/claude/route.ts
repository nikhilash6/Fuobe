import { z } from "zod";
import { claudePrompt, handle, SeriesInputSchema } from "@/server/content-factory";
import { body } from "@/server/faceless";

const Ask = SeriesInputSchema.extend({
  prompt: z.string().trim().min(1, "Say what the video is about").max(2000),
  seriesId: z.string().max(20).optional(),
  presetId: z.string().max(60).optional(),
});

/** "Generate in Claude": the message to paste into Claude Code (Fuobe's MCP server connected); nothing is sent anywhere. */
export async function POST(request: Request) {
  return handle(async () => Response.json(claudePrompt(await body(request, Ask, "Say what the video is about and pick the settings"))));
}
