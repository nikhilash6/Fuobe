import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

/**
 * fal.ai's queue and storage, as fal.ai documents them (spec audit, 2026-11-06). A stand-in on 127.0.0.1 answers with
 * the documented shapes; no real key, no paid call.
 *   Cancel answers: https://fal.ai/docs/documentation/model-apis/inference/queue ("Cancel a Request": 200 OK, 202
 *     CANCELLATION_REQUESTED, 400 ALREADY_COMPLETED, 404 NOT_FOUND).
 *   File lifetime: https://fal.ai/docs/documentation/model-apis/common-parameters (X-Fal-Object-Lifecycle-Preference,
 *     default "forever and publicly readable if not configured") and the JS client's storage reference (lifecycle).
 *   Typed errors: https://fal.ai/docs/documentation/model-apis/errors (detail[].type is the category; "Client code should not
 *     parse and rely on the msg field") and .../model-apis/request-errors (error_type).
 *   Result 404: https://fal.ai/docs/api-reference/inference-api/queue/result ("the result expired, or the request belongs
 *     to a different account"); status 404: .../queue/status ("does not exist, or it belongs to a different account").
 */
const dir = tempDir("fuobe-fal-queue-spec-");
process.env.FUOBE_DATA_DIR = dir;
delete process.env.FAL_KEY;

const { setSetting } = await import("@/server/settings");
const { falProvider } = await import("@/server/providers/fal");
const { getModel } = await import("@/lib/catalog");
const { diagnoseKey } = await import("@/lib/diagnose");

type Rec = { method: string; path: string; headers: http.IncomingHttpHeaders };
type Answer = { status: number; body?: unknown };
const log: Rec[] = [];
let script: ((r: Rec) => Answer | undefined) | null = null;
let base = "";
const ID = "019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b";

function documented(r: Rec): Answer {
  if (r.method === "POST" && r.path === "/storage/upload/initiate") return { status: 200, body: { upload_url: `${base}/signed/one?sig=x`, file_url: `${base}/files/one.png` } };
  if (r.method === "PUT" && r.path.startsWith("/signed/")) return { status: 200, body: {} };
  const m = /^\/([^/]+)\/([^/]+)\/requests\/([^/]+)(\/status|\/cancel)?$/.exec(r.path);
  if (m) {
    if (m[4] === "/status") return { status: 200, body: { status: "COMPLETED", request_id: m[3], logs: [], metrics: {} } };
    if (m[4] === "/cancel") return { status: 202, body: { status: "CANCELLATION_REQUESTED" } };
    return { status: 200, body: { images: [{ url: `${base}/files/out.png`, content_type: "image/png" }], seed: 1 } };
  }
  const [owner, app] = r.path.split("/").slice(1, 3);
  const at = `${base}/${owner}/${app}/requests/${ID}`;
  return { status: 200, body: { status: "IN_QUEUE", request_id: ID, response_url: at, status_url: `${at}/status`, cancel_url: `${at}/cancel`, queue_position: 0 } };
}

let server: http.Server;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const r: Rec = { method: req.method ?? "", path: new URL(req.url ?? "/", "http://x").pathname, headers: req.headers };
      log.push(r);
      const a = script?.(r) ?? documented(r);
      res.writeHead(a.status, { "Content-Type": "application/json" });
      res.end(a.body === undefined ? "" : JSON.stringify(a.body));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  globalThis.__fuobeTestFalUrl = base;
  setSetting("falKey", "fal_spec_key:secret");
});
afterAll(async () => {
  globalThis.__fuobeTestFalUrl = undefined;
  server.closeAllConnections?.();
  await new Promise<void>((ok) => server.close(() => ok()));
});

const t2i = () => {
  const model = getModel("nano-banana-pro")!;
  return { model, route: model.routes.find((r) => r.provider === "fal" && r.op === "t2i")! };
};
const ctx = () => {
  const { model, route } = t2i();
  const at = `${base}/fal-ai/nano-banana-pro/requests/${ID}`;
  return { externalId: ID, meta: { statusUrl: `${at}/status`, responseUrl: at, cancelUrl: `${at}/cancel` }, route, model, createdAt: 0 } as never;
};
const lifecycle = (h: http.IncomingHttpHeaders | undefined) =>
  JSON.parse(String(h?.["x-fal-object-lifecycle-preference"] ?? h?.["x-fal-object-lifecycle"] ?? "{}")) as { expiration_duration_seconds?: number };

describe("fal.ai queue and storage, as documented", () => {
  it("a cancel says what fal.ai did: taken off the queue, asked to stop, already finished (its result is there), or no such job", async () => {
    const said: Record<string, unknown> = {};
    for (const [status, body] of [
      [200, { status: "OK" }],
      [202, { status: "CANCELLATION_REQUESTED" }],
      [400, { status: "ALREADY_COMPLETED" }],
      [404, { status: "NOT_FOUND" }],
    ] as const) {
      script = (r) => (r.method === "PUT" ? { status, body } : undefined);
      said[body.status] = await falProvider.cancel!(ctx());
    }
    expect(said).toEqual({ OK: "removed", CANCELLATION_REQUESTED: "requested", ALREADY_COMPLETED: "finished", NOT_FOUND: "gone" });
  });

  it("a run's results and uploads get an expiry on fal.ai's CDN (unset, they stay public forever)", async () => {
    script = null;
    const { model, route } = t2i();
    let from = log.length;
    await falProvider.submit({ route, model, input: { prompt: "a sunset" } } as never);
    const submit = log.slice(from).find((r) => r.method === "POST");
    expect(lifecycle(submit?.headers).expiration_duration_seconds).toBeGreaterThan(0);
    from = log.length;
    await falProvider.prepareFile(Buffer.from("x".repeat(100)), "image/png", "face.png");
    const initiate = log.slice(from).find((r) => r.path === "/storage/upload/initiate");
    expect(lifecycle(initiate?.headers).expiration_duration_seconds).toBeGreaterThan(0);
  });

  it("a finished run whose result fal.ai no longer has (404) reads as an expired result, not as a run fal.ai couldn't finish", async () => {
    script = (r) => (r.method === "GET" && !r.path.endsWith("/status") ? { status: 404, body: { detail: "Request not found" } } : undefined);
    const res = (await falProvider.poll(ctx())) as { state: string; trouble?: { cause: string } };
    expect(res.state).toBe("failed");
    expect(res.trouble?.cause).toBe("result-expired");
  });

  it("a 404 on a run's status (no such request for this key) is not 'this model isn't available', and isn't waited out", () => {
    const d = diagnoseKey({ stage: "poll", status: 404, text: 'fal 404: {"status":"NOT_FOUND"}' }, { provider: "fal" });
    expect(d.cause).not.toBe("model-unavailable");
    expect(d.retryable).toBe(false);
    // At submit a 404 is still the model (queue submit: "The model does not exist").
    expect(diagnoseKey({ stage: "submit", status: 404, text: "fal 404: Application not found" }, { provider: "fal" }).cause).toBe("model-unavailable");
  });

  it("fal.ai's typed errors keep their category: a partner's moderation (content_policy_violation) reads as the safety check", async () => {
    const detail = [{ loc: ["body", "prompt"], msg: "Your request was rejected by the partner's moderation.", type: "content_policy_violation", url: "https://docs.fal.ai/errors#content_policy_violation", categories: ["model_moderated"] }];
    script = (r) => (r.method === "POST" && !r.path.startsWith("/storage") ? { status: 422, body: { detail } } : undefined);
    const { model, route } = t2i();
    const e = (await falProvider.submit({ route, model, input: { prompt: "a sunset" } } as never).catch((x: unknown) => x)) as { message: string; status: number };
    expect(e.status).toBe(422);
    expect(diagnoseKey({ stage: "submit", status: 422, text: e.message }, { provider: "fal" }).cause).toBe("content-flag");
    // A failed job's status: its error_type goes with its words.
    script = (r) => (r.path.endsWith("/status") ? { status: 200, body: { status: "COMPLETED", request_id: ID, error: "No runner could take the request", error_type: "runner_scheduling_failure", logs: [], metrics: {} } } : undefined);
    expect(await falProvider.poll(ctx())).toMatchObject({ state: "failed", error: expect.stringContaining("runner_scheduling_failure") });
    script = null;
  });
});
