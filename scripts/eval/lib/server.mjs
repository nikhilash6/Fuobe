// The Fuobe the harness measures: any running server, reached the way the fuobe CLI reaches it
// (--url / --token, then FUOBE_URL / FUOBE_TOKEN, then what `fuobe login` saved). The token only
// rides to that server. Everything goes through the public REST API, so the harness measures what
// a user gets, on whichever engine that server runs.
import os from "node:os";
import { createClient } from "../../../bin/lib/client.mjs";
import { configPath, readConfig, resolveTarget } from "../../../bin/lib/config.mjs";

export { ApiError } from "../../../bin/lib/client.mjs";

/**
 * @param {{ url?: string, token?: string }} flags
 * @param {{ env?: Record<string, string | undefined>, home?: string, fetch?: typeof fetch }} [io]
 */
export function connect(flags = {}, io = {}) {
  const env = io.env ?? process.env;
  const target = resolveTarget(flags, env, readConfig(configPath(env, io.home ?? os.homedir())));
  const client = createClient({ ...target, fetch: io.fetch });
  return { target, client };
}

/**
 * What the server runs today: engine mode, demo mode, providers, and the model ids it has (hidden
 * helpers included, so a suite can name them).
 */
export async function serverFacts(client) {
  const status = await client.request("GET", "/api/status");
  const models = await client.request("GET", "/api/models", { query: { hidden: 1 } });
  const byId = new Map((models.items ?? []).map((m) => [m.id, m]));
  return {
    engineMode: status.engineMode ?? "both",
    demoMode: status.demoMode ?? "auto",
    cloudProvider: status.cloudProvider ?? null,
    providers: Object.fromEntries(Object.entries(status.providers ?? {}).map(([id, p]) => [id, !!p.configured])),
    models: byId,
    available: new Set(byId.keys()),
  };
}

/** Why this engine can't run on that server (or null). */
export function engineProblem(engine, facts) {
  if (engine === "demo") {
    return facts.demoMode === "off" ? "--engine demo needs Settings → Placeholder results turned on on that Fuobe (they are off)" : null;
  }
  if (facts.engineMode !== "both" && facts.engineMode !== engine) {
    return `That Fuobe runs ${facts.engineMode === "open" ? "open-source" : "cloud"} models only (Settings → Engine mode), so --engine ${engine} can't run there`;
  }
  return null;
}
