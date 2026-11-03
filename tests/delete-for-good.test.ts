import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { Generation, OutputFile } from "@/lib/catalog/types";
import { outputActions } from "@/lib/output-actions";
import { tempDir } from "./helpers/temp-dir";

// An account has no Trash: its ⋯ menu says "Delete for good…" (asked first) and deletes with DELETE
// /api/generations/<id>, its own runs only. The owner keeps "Move to Trash".

const dir = tempDir("fuobe-delete-for-good-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
process.env.COMFYUI_URL = "http://127.0.0.1:1";
delete process.env.FUOBE_PASSWORD;

const auth = await import("@/server/auth");
const { db } = await import("@/server/db");
const { proxy } = await import("@/proxy");
const one = await import("@/app/api/generations/[id]/route");
const bulk = await import("@/app/api/generations/bulk/route");

const gen = (p: Partial<Generation> = {}): Generation =>
  ({
    id: "g1",
    batchId: null,
    feature: "image",
    presetId: null,
    modelId: "oss-z-image",
    engine: "open",
    provider: "comfyui",
    op: "t2i",
    kind: "image",
    status: "succeeded",
    progress: null,
    message: null,
    prompt: "a perfume bottle on marble",
    request: { feature: "image", modelId: "oss-z-image", prompt: "a perfume bottle on marble" },
    outputs: [{ url: "/api/files/a.png", kind: "image" } as OutputFile],
    error: null,
    costUsd: 0,
    favorite: false,
    createdAt: 1,
    updatedAt: 1,
    completedAt: 1,
    ...p,
  }) as Generation;

describe("the ⋯ menu's delete says what happens, for each audience", () => {
  const del = (ctx = {}) => outputActions(gen(), 0, ctx).filter((a) => a.destructive);

  it("moves the owner's result to the Trash", () => {
    expect(del()).toEqual([expect.objectContaining({ id: "delete", label: "Move to Trash" })]);
    expect(del({ account: false })).toEqual([expect.objectContaining({ id: "delete", label: "Move to Trash" })]);
  });

  it("deletes an account's result for good, asked first, and never offers it the Trash", () => {
    const list = outputActions(gen(), 0, { account: true, visitor: true });
    expect(list.filter((a) => a.destructive)).toEqual([expect.objectContaining({ id: "delete-own", label: "Delete for good…" })]);
    expect(list.map((a) => a.label)).not.toContain("Move to Trash");
  });

  it("keeps an upload's own delete for everyone", () => {
    const up = gen({ feature: "upload", modelId: "upload", provider: "mock" as Generation["provider"], prompt: null, request: { feature: "upload", modelId: "upload" } });
    for (const account of [false, true]) expect(outputActions(up, 0, { account }).filter((a) => a.destructive).map((a) => a.id)).toEqual(["delete-upload"]);
  });
});

describe("DELETE /api/generations/<id> keeps to whose run it is", () => {
  let cookieA = "";
  let cookieB = "";
  let owner = "";
  let a = "";
  beforeAll(() => {
    auth.setPassword("install password");
    a = auth.createAccount("del-a@example.com", "long enough").id;
    const b = auth.createAccount("del-b@example.com", "long enough").id;
    cookieA = `${auth.SESSION_COOKIE}=${auth.createSession(a).value}`;
    cookieB = `${auth.SESSION_COOKIE}=${auth.createSession(b).value}`;
    owner = `${auth.SESSION_COOKIE}=${auth.createSession().value}`;
  });

  const row = (id: string, account?: string) =>
    db()
      .prepare(
        "INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'oss-z-image', 'open', 'comfyui', 't2i', 'image', 'succeeded', ?, '[]', ?, ?)",
      )
      .run(id, JSON.stringify({ feature: "image", modelId: "oss-z-image", ...(account && { account }) }), Date.now(), Date.now());
  const exists = (id: string) => !!db().prepare("SELECT 1 FROM generations WHERE id = ?").get(id);
  const inTrash = (id: string) => !!db().prepare("SELECT 1 FROM generation_trash WHERE generation_id = ?").get(id);
  const through = (id: string, cookie: string) => proxy(new NextRequest(`http://localhost:3000/api/generations/${id}?forever=1`, { method: "DELETE", headers: { cookie } }));
  const remove = (id: string, cookie: string, forever = true) =>
    one.DELETE(new Request(`http://localhost:3000/api/generations/${id}${forever ? "?forever=1" : ""}`, { method: "DELETE", headers: { cookie, host: "localhost:3000" } }), { params: Promise.resolve({ id }) } as never);

  it("lets an account delete its own run, for good", async () => {
    row("acct-own", a);
    expect(through("acct-own", cookieA).headers.get("x-middleware-next")).toBe("1");
    expect((await remove("acct-own", cookieA)).status).toBe(204);
    expect(exists("acct-own")).toBe(false);
    expect(inTrash("acct-own")).toBe(false);
  });

  it("refuses an account another account's run and the owner's", () => {
    row("acct-other", a);
    row("owner-run");
    expect(through("acct-other", cookieB).status).toBe(403);
    expect(through("owner-run", cookieA).status).toBe(403);
    expect(exists("acct-other")).toBe(true);
    expect(exists("owner-run")).toBe(true);
  });

  it("refuses an account the Trash (the bulk route), so its menu never offers it", async () => {
    row("acct-bulk", a);
    const body = JSON.stringify({ action: "trash", ids: ["acct-bulk"] });
    const r = await bulk.POST(new Request("http://localhost:3000/api/generations/bulk", { method: "POST", headers: { cookie: cookieA, host: "localhost:3000", "content-type": "application/json" }, body }));
    expect(r.status).toBe(403);
    expect(exists("acct-bulk")).toBe(true);
  });

  it("moves the owner's run to the Trash, where it can be restored", async () => {
    row("owner-trash");
    expect(through("owner-trash", owner).headers.get("x-middleware-next")).toBe("1");
    expect((await remove("owner-trash", owner, false)).status).toBe(204);
    expect(exists("owner-trash")).toBe(true);
    expect(inTrash("owner-trash")).toBe(true);
  });
});
