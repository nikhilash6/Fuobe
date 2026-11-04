import "server-only";
import { clearAccountLoras } from "../account-loras";
import { accountGpu, requestViewer, setAccountGpu } from "../auth";
import { dropSnapshots } from "../gpu/snapshots";
import type { Principal } from "./tasks";

const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Who is approving or listing paired ComfyUIs: a person signed in in a browser (the owner, or an account while sign-up
 * is open). An API token can't pair a computer: a person has to see the code.
 */
export function pairingPrincipal(request: Request): Principal | Response {
  if (request.headers.get("authorization")) return no(403, "Sign in in your browser to pair a ComfyUI.");
  const v = requestViewer(request);
  if (v.kind === "owner") return "owner";
  if (v.kind === "account") return `acct:${v.account.id}`;
  return no(401, "Sign in to pair your ComfyUI.");
}

/**
 * A paired ComfyUI runs the person's jobs as their own computer does: an account's GPU becomes "this computer" (as when
 * its browser connects). The owner's pairing changes nothing of where the studio's ComfyUI jobs run: that stays the
 * owner's choice in Settings (a pairing link anyone can start must never move the studio's jobs).
 */
export function runOnComputer(principal: Principal): void {
  if (principal === "owner") return;
  const id = principal.slice(5);
  if (accountGpu(id)?.mode !== "computer") {
    setAccountGpu(id, { mode: "computer" });
    clearAccountLoras(id);
    dropSnapshots(principal);
  }
}
