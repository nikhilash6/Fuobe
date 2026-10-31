/**
 * The GPU check of the ComfyUI on this computer, made by the Fuobe tab ("Use the ComfyUI on this computer"): the same
 * check the server makes of a link (gather.ts), read from the browser through lib/local-comfy.ts's list of what may be
 * read, then sent to the server (PUT /api/gpu/inventory), which keeps it for this person's board, chips and fixes.
 */
import { localBase, preflightPath } from "../local-comfy";
import { gatherInventory, problemText } from "./gather";
import { parseIndex } from "./requirements";
import { fetchTransport } from "./transport";
import type { CheckLine, GpuInventory, RequirementIndex } from "./types";

/** fetch() to the ComfyUI on this computer: no cookies, nothing cached, and only to this computer (Chrome's own check). */
export function loopbackFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, credentials: "omit", cache: "no-store", targetAddressSpace: "loopback" } as RequestInit);
}

let index: Promise<RequirementIndex> | null = null;
const requirements = () =>
  (index ??= fetch("/api/gpu/requirements")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`The studio answered HTTP ${r.status}`))))
    .then(parseIndex)
    .catch((e) => {
      index = null;
      throw e;
    }));

/** Read what the ComfyUI on this port has (GET requests and the Manager's read-only questions only). */
export async function checkThisComputer(port: number, o: { host?: string; onLine?: (l: CheckLine) => void; classes?: string[]; folders?: string[] } = {}): Promise<GpuInventory> {
  const base = localBase(port, o.host);
  const t = fetchTransport(
    "browser",
    base,
    (url, init) => {
      const u = new URL(url);
      preflightPath(init.method === "POST" ? "POST" : "GET", u.pathname + u.search);
      return loopbackFetch(url, init);
    },
    { decodes: true },
  );
  // The first line's failure waits: it may be a ComfyUI that runs without Fuobe's setting, not one that's closed.
  let held: CheckLine | null = null;
  const onLine = (l: CheckLine) => (l.step === "found" && l.state === "fail" ? (held = l) : o.onLine?.(l));
  const inv = await gatherInventory(t, await requirements(), { where: "computer", statsTimeoutMs: 1500, onLine, classes: o.classes, folders: o.folders });
  // The browser can't read a ComfyUI started without Fuobe's setting: a look that can't read the answer still sees it's there.
  if (inv.problem === "unreachable" || inv.problem === "timeout") {
    const answers =
      inv.problem === "unreachable" &&
      (await loopbackFetch(`${base}/system_stats`, { mode: "no-cors" }).then(
        () => true,
        () => false,
      ));
    // The browser's own words ("Failed to fetch") say nothing to the person: one line says what to do.
    const out: GpuInventory = { ...inv, ...(answers && { problem: "cors-off" as const }) };
    delete out.problemDetail;
    o.onLine?.({ step: "found", state: "fail", text: problemText(out.problem!, "computer") });
    return out;
  }
  if (held) o.onLine?.(held);
  return inv;
}

/** Send a check to the server: the board it makes of it (as GET /api/gpu/readiness answers). */
export async function sendCheck<T = unknown>(inv: GpuInventory): Promise<T> {
  const res = await fetch("/api/gpu/inventory", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(inv) });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(body.error ?? `The studio answered HTTP ${res.status}`), { status: res.status });
  return body;
}
