import http from "node:http";
import zlib from "node:zlib";

/**
 * A stand-in ComfyUI (core read routes, under "/" and "/api") with ComfyUI-Manager v4 or v3 read routes, for the
 * GPU pre-flight tests (SPEC §17.2, the read-only part P1 needs). Every request is logged, so a test can prove the
 * probe only reads (R8). Plain Node and type annotations only, so a smoke script can run it with `node`.
 */

export interface FakeScenario {
  version?: string;
  os?: string;
  embeddedPython?: boolean;
  deployEnv?: string;
  argv?: string[];
  devices?: { name: string; type: string; vramGb: number }[];
  ramGb?: number;
  /** Node classes that are loaded. */
  classes: string[];
  /** class → input → the combo's options (a loader's file list). */
  combos?: Record<string, Record<string, string[]>>;
  /** Use the new combo shape ["COMBO", {options}] instead of the legacy [[...]]. */
  newCombos?: boolean;
  /** folder → files (relative names, sizes in bytes). */
  files?: Record<string, { name: string; size: number }[]>;
  /** Folders GET /models lists (default: the keys of `files`). */
  folders?: string[];
  roots?: Record<string, string[]>;
  auth?: { header: string; value: string };
  apiPrefixOnly?: boolean;
  /** Extra fake classes, to make /object_info this many bytes bigger. */
  objectInfoPadBytes?: number;
  /** /object_info answers this status instead. */
  objectInfoStatus?: number;
  /** path → delay before answering, in ms. */
  slow?: Record<string, number>;
  /** Paths that send one byte at a time, forever. */
  drip?: string[];
  /** Folder listings under /experiment/models 404 (an older ComfyUI). */
  noExperiment?: boolean;
  manager?: {
    api: "v4" | "v3" | "none";
    version?: string;
    busy?: boolean;
    installed?: Record<string, { ver?: string; cnr_id?: string; aux_id?: string; enabled?: boolean }>;
    /** cnr id or repo URL → traceback. */
    importErrors?: Record<string, string>;
  };
  /** /system_stats answers a web page (ngrok's warning). */
  html?: boolean;
  /** /system_stats redirects here. */
  redirect?: string;
  /** Bodies are gzip-compressed whatever the client asked. */
  gzip?: boolean;
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface FakeComfy {
  url: string;
  port: number;
  requests: RecordedRequest[];
  scenario: FakeScenario;
  close(): Promise<void>;
}

const PT = /\.(ckpt|pt|pt2|bin|pth|safetensors|pkl|sft)$/i;
const GB = 2 ** 30;

function classInfo(s: FakeScenario, cls: string): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const [input, options] of Object.entries(s.combos?.[cls] ?? {})) inputs[input] = s.newCombos ? ["COMBO", { options }] : [options];
  return { input: { required: inputs }, name: cls, display_name: cls, python_module: "nodes", category: "test", output: [] };
}

/** A scenario with everything these workflows of the requirement index need (classes, files, loader combos). */
export function readyFor(
  idx: { workflows: Record<string, { core: string[]; packs: Record<string, string[]>; files: string[] }>; files: Record<string, { folder: string; file: string; sizeBytes: number; loaders?: [string, string][] }>; folders: string[] },
  ids: string[],
  extra: Partial<FakeScenario> = {},
): FakeScenario {
  const files: Record<string, { name: string; size: number }[]> = {};
  const combos: Record<string, Record<string, string[]>> = {};
  const classes = new Set<string>();
  for (const id of ids) {
    const w = idx.workflows[id];
    w.core.forEach((c) => classes.add(c));
    Object.values(w.packs).forEach((cs) => cs.forEach((c) => classes.add(c)));
    for (const k of w.files) {
      const f = idx.files[k];
      (files[f.folder] ??= []).push({ name: f.file, size: f.sizeBytes });
      for (const [cls, input] of f.loaders ?? []) ((combos[cls] ??= {})[input] ??= []).push(f.file);
    }
  }
  const packFolders = ["mmaudio", "foley", "thinksound", "insightface", "facerestore_models"];
  return { classes: [...classes], files, combos, folders: idx.folders.filter((f) => !packFolders.includes(f)), ...extra };
}

export async function startFakeComfy(scenario: FakeScenario, port = 0): Promise<FakeComfy> {
  const requests: RecordedRequest[] = [];
  const s = scenario;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://x");
      let path = decodeURIComponent(url.pathname);
      requests.push({ method: req.method ?? "GET", path: url.pathname + url.search, headers: req.headers, body });
      if (s.apiPrefixOnly) {
        if (!path.startsWith("/api/")) return void res.writeHead(404).end("Not found");
        path = path.slice(4);
      } else if (path.startsWith("/api/")) path = path.slice(4);
      if (s.auth && req.headers[s.auth.header.toLowerCase()] !== s.auth.value) return void res.writeHead(401).end("Unauthorized");
      const send = (status: number, data: unknown, type = "application/json") => {
        const raw = Buffer.from(typeof data === "string" && type !== "application/json" ? data : JSON.stringify(data));
        const headers: Record<string, string> = { "Content-Type": type };
        const out = s.gzip ? zlib.gzipSync(raw) : raw;
        if (s.gzip) headers["Content-Encoding"] = "gzip";
        headers["Content-Length"] = String(out.length);
        const go = () => {
          if (res.destroyed) return;
          res.writeHead(status, headers);
          res.end(out);
        };
        const wait = s.slow?.[path];
        if (wait) setTimeout(go, wait);
        else go();
      };
      if (s.drip?.includes(path)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        const t = setInterval(() => (res.destroyed ? clearInterval(t) : res.write(" ")), 200);
        res.on("close", () => clearInterval(t));
        return;
      }
      const m = s.manager?.api ?? "none";
      if (req.method === "GET") {
        if (path === "/system_stats") {
          if (s.redirect) return void res.writeHead(302, { Location: s.redirect }).end();
          if (s.html) return send(200, "<html><body>You are about to visit…</body></html>", "text/html");
          return send(200, {
            system: {
              os: s.os ?? "posix",
              ram_total: (s.ramGb ?? 32) * GB,
              ram_free: (s.ramGb ?? 32) * GB * 0.5,
              comfyui_version: s.version ?? "0.41.2",
              python_version: "3.12.9 (main)",
              pytorch_version: "2.9.0+cu128",
              embedded_python: !!s.embeddedPython,
              deploy_environment: s.deployEnv ?? "local-git",
              argv: s.argv ?? ["main.py"],
            },
            devices: (s.devices ?? [{ name: "cuda:0 NVIDIA GeForce RTX 4070 : cudaMallocAsync", type: "cuda", vramGb: 12 }]).map((d, index) => ({
              name: d.name,
              type: d.type,
              index,
              vram_total: d.vramGb * GB,
              vram_free: d.vramGb * GB * 0.9,
            })),
          });
        }
        if (path === "/object_info") {
          if (s.objectInfoStatus) return send(s.objectInfoStatus, { error: "no" });
          const all: Record<string, unknown> = {};
          for (const c of s.classes) all[c] = classInfo(s, c);
          for (let i = 0, size = 0; size < (s.objectInfoPadBytes ?? 0); i++) {
            const pad = { input: { required: { text: ["STRING", { default: "x".repeat(1000) }] } }, name: `Pad${i}` };
            all[`Pad${i}`] = pad;
            size += 1100;
          }
          return send(200, all);
        }
        const one = /^\/object_info\/(.+)$/.exec(path);
        if (one) return send(200, s.classes.includes(one[1]) ? { [one[1]]: classInfo(s, one[1]) } : {});
        const folders = s.folders ?? Object.keys(s.files ?? {});
        if (path === "/models") return send(200, folders);
        const list = /^\/models\/([^/]+)$/.exec(path);
        if (list) return folders.includes(list[1]) ? send(200, (s.files?.[list[1]] ?? []).map((f) => f.name)) : send(404, { error: "not found" });
        if (path === "/experiment/models") {
          if (s.noExperiment) return send(404, { error: "not found" });
          return send(200, folders.map((name) => ({ name, folders: s.roots?.[name] ?? [`/home/me/ComfyUI/models/${name}`] })));
        }
        const exp = /^\/experiment\/models\/([^/]+)$/.exec(path);
        if (exp) {
          if (s.noExperiment || !folders.includes(exp[1])) return send(404, { error: "not found" });
          return send(200, (s.files?.[exp[1]] ?? []).filter((f) => PT.test(f.name)).map((f) => ({ name: f.name, pathIndex: 0, modified: 0, created: 0, size: f.size })));
        }
        if (path === "/features") return send(200, { supports_preview_metadata: true, extension: { manager: { supports_v4: true, ...(m === "v4" && { supports_csrf_post: true }) } } });
        const pre = m === "v4" ? "/v2" : "";
        if (m !== "none" && path === `${pre}/manager/version`) return send(200, s.manager?.version ?? (m === "v4" ? "V4.2.2" : "V3.42"), "text/plain");
        if (m !== "none" && path === `${pre}/manager/queue/status`) return send(200, { total_count: 0, done_count: 0, in_progress_count: 0, pending_count: 0, is_processing: !!s.manager?.busy });
        if (m !== "none" && path === `${pre}/customnode/installed`) return send(200, s.manager?.installed ?? {});
      }
      if (req.method === "POST") {
        let json: Record<string, unknown> = {};
        try {
          json = body ? (JSON.parse(body) as Record<string, unknown>) : {};
        } catch {}
        if (m === "v4" && path === "/v2/customnode/import_fail_info_bulk") {
          const out: Record<string, unknown> = {};
          for (const k of [...((json.cnr_ids as string[]) ?? []), ...((json.urls as string[]) ?? [])]) out[k] = s.manager?.importErrors?.[k] ? { error: "import failed", traceback: s.manager.importErrors[k] } : null;
          return send(200, out);
        }
        if (m === "v3" && path === "/customnode/import_fail_info") {
          const k = (json.cnr_id ?? json.url) as string;
          const tb = s.manager?.importErrors?.[k];
          return tb ? send(200, { msg: "import failed", traceback: tb }) : send(400, { error: "no info" });
        }
        // Anything that would change the machine answers as ComfyUI would, so a test can see it was asked.
        if (path === "/prompt" || path.startsWith("/upload")) return send(200, { prompt_id: "x" });
      }
      send(404, { error: "Not found" });
    });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${addr.port}`,
    port: addr.port,
    requests,
    scenario,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
