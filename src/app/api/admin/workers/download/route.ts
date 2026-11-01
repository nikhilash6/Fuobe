import { connection } from "next/server";
import { isOwnerRequest, sessionCookieOf } from "@/server/auth";
import fs from "node:fs";
import path from "node:path";

/**
 * Download the worker program as a zip, so its version always matches the server's (docs/gpu-workers.md).
 * The zip contains bin/ with the fuobe.mjs entry point, bin/lib/commands.mjs, bin/lib/worker/ and the
 * package.json that names the dependencies (`better-sqlite3` is not needed on the worker; the runner
 * is bundled). Owner only.
 */
export async function GET(request: Request) {
  await connection();
  if (!isOwnerRequest(request, sessionCookieOf(request)))
    return Response.json({ error: "Only the studio's owner manages workers" }, { status: 403 });

  // Dynamic import so the zip helper is loaded only for this route.
  const { zipFiles } = await import("../../../../../../bin/lib/zip.mjs");

  const root = process.cwd();
  const files: { name: string; data: Buffer }[] = [];

  const add = (rel: string) => {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs)) files.push({ name: rel, data: fs.readFileSync(abs) });
  };

  // The worker's entry point and its commands dispatcher.
  add("bin/fuobe.mjs");
  add("bin/lib/commands.mjs");

  // bin/lib/worker/ — the worker shell and the transpiled runner.
  const workerDir = path.join(root, "bin/lib/worker");
  if (fs.existsSync(workerDir)) {
    const walk = (dir: string, prefix: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = `${prefix}/${entry.name}`;
        if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
        else files.push({ name: rel, data: fs.readFileSync(path.join(dir, entry.name)) });
      }
    };
    walk(workerDir, "bin/lib/worker");
  }

  // A minimal package.json for the worker (no dev deps, no Next.js).
  files.push({
    name: "package.json",
    data: Buffer.from(JSON.stringify({ name: "fuobe-worker", private: true, type: "module" }, null, 2)),
  });

  const buf = zipFiles(files);
  return new Response(buf, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="fuobe-worker.zip"',
      "Content-Length": String(buf.length),
      "Cache-Control": "no-store",
    },
  });
}
