import { ownGpuTool, toolViewer } from "@/server/account-tool-run";
import { describeCharacter, DescribeSchema } from "@/server/genjutsu";
import { body, handle } from "@/server/shorts-schemas";

/**
 * "Describe my character": the engine's text model writes what the character looks like from their picture. It runs
 * on the studio's own AI helper, so it is the owner's: a visitor describes the character in its own words.
 */
export async function POST(request: Request) {
  if (toolViewer(request).kind !== "owner") return ownGpuTool();
  return handle(async () => {
    const input = await body(request, DescribeSchema, "Add a picture of your character first");
    return Response.json(await describeCharacter(input));
  }, request);
}
