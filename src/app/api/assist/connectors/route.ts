import { connection } from "next/server";
import { ConnectorError, createConnector, listConnectors } from "@/server/assist/connectors";
import { ConnectorBody } from "@/server/assist/schemas";

/** Custom MCP connectors, tokens masked. */
export async function GET() {
  await connection();
  return Response.json({ items: listConnectors() });
}

export async function POST(request: Request) {
  const parsed = ConnectorBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Check the connector's name, URL and token" }, { status: 400 });
  try {
    return Response.json(createConnector(parsed.data), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof ConnectorError ? e.status : 500 });
  }
}
