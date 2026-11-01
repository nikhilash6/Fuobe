import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-files-route-"));
process.env.FUOBE_DATA_DIR = dir;
const { GET } = await import("@/app/api/files/[...path]/route");
afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

const get = (parts: string[]) => GET(new Request(`http://localhost:3000/api/files/${parts.join("/")}`), { params: Promise.resolve({ path: parts }) } as never);

describe("/api/files decodes a path once", () => {
  it("never turns %2e into a step out of the folder", async () => {
    // A secret beside the files folder, and a file inside it.
    fs.mkdirSync(path.join(dir, "files", "uploads"), { recursive: true });
    fs.writeFileSync(path.join(dir, "secret.txt"), "secret");
    fs.writeFileSync(path.join(dir, "files", "uploads", "a.txt"), "hello");
    // Next hands the route each segment decoded once: "%252e%252e" arrives as "%2e%2e", which must stay a name.
    const r = await get(["uploads", "%2e%2e", "%2e%2e", "secret.txt"]);
    expect(r.status).toBe(404);
    expect(await r.text()).not.toContain("secret");
    expect((await get(["..", "secret.txt"])).status).toBe(400);
    const ok = await get(["uploads", "a.txt"]);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("hello");
  });
});

describe("/api/files opens a file when its body is read", () => {
  it("so a body never read (HEAD) holds nothing open, and a file deleted first fails the read, not the process", async () => {
    fs.mkdirSync(path.join(dir, "files", "outputs"), { recursive: true });
    const file = path.join(dir, "files", "outputs", "b.txt");
    fs.writeFileSync(file, "0123456789");
    const ask = (init?: RequestInit) => GET(new Request("http://localhost:3000/api/files/outputs/b.txt", init), { params: Promise.resolve({ path: ["outputs", "b.txt"] }) } as never);
    const open = vi.spyOn(fs, "open");
    const opened = () => open.mock.calls.filter(([p]) => p === file).length;
    try {
      // Next answers HEAD with GET and never reads (or cancels) the body.
      const head = await ask({ method: "HEAD" });
      const part = await ask({ headers: { range: "bytes=2-4" } });
      await new Promise((r) => setTimeout(r, 20));
      expect(head.status).toBe(200);
      expect(part.status).toBe(206);
      expect(opened()).toBe(0);
      expect(await part.text()).toBe("234");
      expect(opened()).toBe(1);
      // Its run is deleted (the owner deletes an account's run) while the response is on its way: the read fails,
      // and no ENOENT is thrown from a stream nobody listens to.
      const late = await ask();
      fs.rmSync(file);
      await new Promise((r) => setTimeout(r, 20));
      await expect(late.text()).rejects.toThrow();
    } finally {
      open.mockRestore();
    }
  });
});
