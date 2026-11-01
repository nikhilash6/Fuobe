import { after } from "next/server";
import { BatchBody, createBatch } from "@/server/ads";
import { failure, readBody } from "@/server/marketing";

/** "Create N ads": creatives land in the grid at once; copy and pictures follow in the background. */
export async function POST(request: Request) {
  const body = await readBody(request, BatchBody, "Pick products and how many ads to make");
  if (body instanceof Response) return body;
  try {
    const { batchId, creatives, run } = createBatch(body);
    after(() => run);
    return Response.json({ batchId, creatives }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
