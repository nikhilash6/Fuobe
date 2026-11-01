import { z } from "zod";
import { clickToAdScript, failure, readBody } from "@/server/marketing";

const Body = z.object({
  engine: z.enum(["cloud", "open"]),
  productId: z.string().min(1).max(40),
  styleId: z.string().max(40),
  presenter: z.boolean().optional(),
  instructions: z.string().max(600).optional(),
});

/** Write a Click to Ad voiceover script to review (Auto, or with custom instructions). */
export async function POST(request: Request) {
  const body = await readBody(request, Body, "Pick a product and a style");
  if (body instanceof Response) return body;
  try {
    return Response.json(await clickToAdScript(body));
  } catch (e) {
    return failure(e);
  }
}
