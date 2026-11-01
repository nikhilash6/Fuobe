import { connection } from "next/server";
import { LICENCE_CLASSES } from "@/lib/licences";
import type { AccessChange } from "@/lib/model-access";
import { accessList, changeAccess, knownSwitch } from "@/server/model-access";

/**
 * Settings → Models & licences: every model, LoRA and node pack with its licence and its switch, and the
 * switches per licence class and provider (GET); flip switches (PUT `{ changes: AccessChange[] }`, answered with
 * the list as it is now). Everything is on until an admin turns it off.
 */
export async function GET() {
  await connection();
  return Response.json(accessList());
}

const KINDS = new Set(["model", "class", "provider", "pack", "lora"]);
const NOUN = { model: "Model", provider: "Provider", pack: "Node pack", lora: "LoRA" } as const;

/** A change as the API takes it, or why not. */
function readChange(v: unknown): AccessChange | string {
  if (!v || typeof v !== "object") return "Each change is an object";
  const c = v as Record<string, unknown>;
  if (c.kind === "reset") return { kind: "reset" };
  if (typeof c.on !== "boolean") return "Each change says on: true or false";
  if (c.kind === "keepGpuOnlyLoras") return { kind: "keepGpuOnlyLoras", on: c.on };
  if (typeof c.kind !== "string" || !KINDS.has(c.kind)) return "kind is model, class, provider, pack, lora, keepGpuOnlyLoras or reset";
  if (typeof c.id !== "string" || !c.id.trim()) return "Each change names its id";
  const id = c.id.trim();
  if (c.kind === "class") return (LICENCE_CLASSES as string[]).includes(id) ? { kind: "class", id, on: c.on } : `class is one of ${LICENCE_CLASSES.join(", ")}`;
  const kind = c.kind as keyof typeof NOUN;
  // Switching off something this install doesn't have would store a switch that does nothing (a typo, say).
  // Turning one back on always works, so a switch left from a model that has since gone can be cleared.
  if (!c.on && !knownSwitch(kind, id)) return `${NOUN[kind]} ${id} isn't one this install has (GET /api/settings/models lists them)`;
  return { kind, id, on: c.on };
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { changes?: unknown };
  if (!Array.isArray(body.changes) || !body.changes.length) return Response.json({ error: "Send { changes: [...] }" }, { status: 400 });
  const changes = body.changes.map(readChange);
  const bad = changes.find((c): c is string => typeof c === "string");
  if (bad) return Response.json({ error: bad }, { status: 400 });
  changeAccess(changes as AccessChange[]);
  return Response.json(accessList());
}
