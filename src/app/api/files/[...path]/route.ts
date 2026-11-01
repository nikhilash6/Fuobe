import { fileResponse } from "@/server/file-response";

export async function GET(request: Request, ctx: RouteContext<"/api/files/[...path]">) {
  const { path: parts } = await ctx.params;
  // Next has decoded each segment once already: decoding again would turn %252e into "." (stored names never need it).
  return fileResponse(request, parts.join("/"));
}
