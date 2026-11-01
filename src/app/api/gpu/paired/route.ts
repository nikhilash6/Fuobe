import { connection } from "next/server";
import { pairingPrincipal } from "@/server/computer/pairing-http";
import { pairedOf } from "@/server/computer/workers";

/** The ComfyUIs paired with this person (Fuobe Connect): name, GPU, when each was last heard from. */
export async function GET(request: Request) {
  await connection();
  const principal = pairingPrincipal(request);
  if (principal instanceof Response) return principal;
  return Response.json({ paired: pairedOf(principal) }, { headers: { "Cache-Control": "no-store" } });
}
