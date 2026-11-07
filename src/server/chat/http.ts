import "server-only";
import { GUEST_HEADER, GUEST_RUN_MESSAGE } from "@/lib/guest-access";
import { requestAccount, requestViewer } from "../auth";
import { hit } from "../rate";
import { ChatError } from "./store";

/**
 * Who a chat request is for. An account reaches its own chats (the proxy lets it through: ACCOUNT_PROJECT_ROUTES); the
 * owner has their own, under "owner"; a guest is refused with the sign-up card.
 */
export function chatViewer(request: Request): { who: string; owner: boolean } | null {
  const account = requestAccount(request);
  if (account) return { who: account.id, owner: false };
  return requestViewer(request).kind === "owner" ? { who: "owner", owner: true } : null;
}

export const signUp = () => Response.json({ error: GUEST_RUN_MESSAGE, code: "sign-in" }, { status: 401, headers: { [GUEST_HEADER]: "1" } });

/** Changes a minute per person (saves, renames, new chats): a runaway tab can't fill the database. */
export function tooOften(who: string, what = "changes", limit = 60): Response | null {
  if (who === "owner") return null;
  const r = hit(`chat-${what}:${who}`, limit, 60_000);
  return r.ok ? null : Response.json({ error: "That's a lot at once — it'll work again in a few seconds.", code: "limit" }, { status: 429, headers: { "Retry-After": String(r.retryAfterS) } });
}

export function refused(e: unknown): Response {
  if (e instanceof ChatError) return Response.json({ error: e.message, ...(e.code && { code: e.code }) }, { status: e.status });
  throw e;
}

export async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const b = await request.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const gone = () => Response.json({ error: "That chat is gone." }, { status: 404 });
