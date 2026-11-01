import "server-only";
import { accountGpu, requestViewer } from "./auth";
import { asVisitor } from "./generations";

/**
 * Run a price check (an estimate route, or `?preview=1`) as the asker's run would go: the owner's
 * as always; a guest's or an account's as that visitor (only its own files), on its own GPU (none
 * yet: an address that reaches nothing), the open engine and no demo outputs, so a visitor is never
 * told a run is a free demo.
 */
export function priceAs<T>(request: Request, fn: () => T): T {
  const v = requestViewer(request);
  if (v.kind === "owner") return fn();
  return v.kind === "account" ? asVisitor(accountGpu(v.account.id), fn, v.account.id) : asVisitor(null, fn);
}
