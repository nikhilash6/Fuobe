import { connection } from "next/server";
import { z } from "zod";
import { dismissSuggestion, skillSuggestions } from "@/server/skill-insights";

/**
 * Chains the owner made 3 or more times in 14 days that no skill makes yet, offered as skills above the Library (swept at
 * most once a day). Public sign-up: a guest's or an account's answer is empty (the owner's runs stay the owner's).
 */
export async function GET() {
  await connection();
  return Response.json({ items: skillSuggestions() });
}

const Body = z.object({ id: z.string().min(1).max(40), how: z.enum(["later", "never"]) });

/** Not now (hidden for a week) or Don't suggest this (never again). The owner's only. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Say which suggestion, and later or never" }, { status: 400 });
  dismissSuggestion(parsed.data.id, parsed.data.how);
  return Response.json({ items: skillSuggestions() });
}
