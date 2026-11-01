import { handleMcp } from "@/server/mcp";

/**
 * MCP endpoint (streamable HTTP, stateless, JSON responses). Point an MCP client at
 * http(s)://<host>/api/mcp; with a password set, send `Authorization: Bearer fuobe_…`.
 */
export async function POST(request: Request) {
  // Browsers send Origin: a web page on another site must not reach this server through the
  // user's browser (DNS rebinding, required by the MCP spec). Native clients send none.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Origin not allowed" } }, { status: 403 });
  }
  const body = await request.json().catch(() => undefined);
  if (body === undefined) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  if (Array.isArray(body)) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batches aren't supported" } }, { status: 400 });
  const res = await handleMcp(body);
  return res ? Response.json(res) : new Response(null, { status: 202 });
}

/** No server-initiated stream: this server only answers requests. */
export function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}

export function DELETE() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
