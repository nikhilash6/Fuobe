import "server-only";
import { z } from "zod";

/** A character as the browser sends it (src/server/chat/store.ts cleans and limits each field). */
export const CharacterBody = z.object({
  name: z.string().max(200).optional(),
  tagline: z.string().max(400).optional(),
  persona: z.string().max(4000).optional(),
  scenario: z.string().max(4000).optional(),
  greeting: z.string().max(2000).optional(),
  mature: z.boolean().optional(),
  accent: z.tuple([z.string(), z.string()]).optional(),
  portrait: z.string().max(400).nullish(),
});
