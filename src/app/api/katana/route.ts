import { connection } from "next/server";
import { createKatana, KatanaBody, listKatana, previewKatana } from "@/server/katana";
import { connectRefusal } from "@/server/connect-refusal";
import { priceAs } from "@/server/visitor";

/** Recent Katana runs with the state of every step. */
export async function GET(request: Request) {
  await connection();
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
  return Response.json({ items: listKatana(Number.isFinite(limit) ? limit : 20) });
}

/** Start a run; `?preview=1` only plans and prices it (segments, steps, cost). */
async function post(request: Request) {
  const parsed = KatanaBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const path = String(parsed.error.issues[0]?.path[0] ?? "");
    const msg = path === "reference" ? "Add the reference edit" : path === "photos" ? "Add 1–5 photos of your subject" : path === "instructions" ? "Keep the instructions under 2,000 characters" : "Check the Katana settings";
    return Response.json({ error: msg }, { status: 400 });
  }
  const preview = new URL(request.url).searchParams.get("preview") === "1";
  try {
    if (preview) return Response.json(previewKatana(parsed.data));
    return Response.json(createKatana(parsed.data), { status: 201 });
  } catch (e) {
    // Nothing connected runs it: the connect card in the owner's browser (never on a price check).
    return connectRefusal(e, request, preview) ?? Response.json({ error: (e as Error).message }, { status: 422 });
  }
}

/** A visitor (public sign-up) gets the price of its run on its own GPU, never a demo (src/server/visitor.ts). */
export async function POST(request: Request) {
  return priceAs(request, () => post(request));
}
