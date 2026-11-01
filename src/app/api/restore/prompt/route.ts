import { PromptSchema, writeRestorePrompt } from "@/server/restore";
import { body, handle } from "@/server/shorts-schemas";

/**
 * Write the period / place / light sentence and the negative from a few frames: Claude, a local model, or Fuobe's
 * offline template. Never generates. The owner's only on a public studio (it asks the studio's own AI helpers): guests
 * and accounts get own-gpu-tool from the proxy.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const input = await body(request, PromptSchema, "Add a few frames of the clip or a few words about it");
    return Response.json(await writeRestorePrompt(input));
  }, request);
}
