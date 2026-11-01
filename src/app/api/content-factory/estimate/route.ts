import { z } from "zod";
import { BriefSchema, estimateSeries, handle, SeriesInputSchema } from "@/server/content-factory";
import { body } from "@/server/faceless";
import { priceAs } from "@/server/visitor";

const Ask = SeriesInputSchema.extend({
  seriesId: z.string().max(20).optional(),
  presetId: z.string().max(60).optional(),
  brief: BriefSchema.optional(),
});

/** What the whole series would cost (one episode at the brief's pace × the episodes), and whether it runs as a demo. */
async function post(request: Request) {
  return handle(async () => Response.json(estimateSeries(await body(request, Ask, "Those settings aren't valid"))));
}

/** A visitor (public sign-up) gets the price of its run on its own GPU, never a demo (src/server/visitor.ts). */
export async function POST(request: Request) {
  return priceAs(request, () => post(request));
}
