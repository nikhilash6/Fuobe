import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { tempDir } from "./helpers/temp-dir";
// Route handlers call connection(); outside a request scope it would throw.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

/**
 * What a guest and an account (public sign-up) get on a public studio, from the site QA of Assist and the Library:
 * built-in skills open, Assist says once that it's the owner's, and an account's own likes, pins, reviews, counts and
 * uploads are its own.
 */

const dir = tempDir("fuobe-visitors-");
process.env.FUOBE_DATA_DIR = dir;
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ALLOWED_ORIGINS;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
const auth = await import("@/server/auth");
const { proxy } = await import("@/proxy");
const access = await import("@/lib/guest-access");
const { db } = await import("@/server/db");
afterAll(() => {
  delete process.env.FUOBE_PUBLIC_SIGNUP;
});

const passed = (r: Response) => r.headers.get("x-middleware-next") === "1";
const toldGuest = (r: Response) => r.headers.get(`x-middleware-request-${access.GUEST_HEADER}`) === "1";

function req(url: string, init: { method?: string; cookie?: string; headers?: Record<string, string> } = {}) {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = { ...init.headers };
  if (init.cookie) headers.cookie = `${auth.SESSION_COOKIE}=${init.cookie}`;
  return new NextRequest(`http://localhost:3000${url}`, { method, headers, ...(method !== "GET" && method !== "HEAD" && { body: "{}" }) });
}

let account = "";
let accountId = "";
let gpuAccount = "";
let other = "";
let owner = "";
beforeAll(() => {
  auth.setPassword("install password");
  const a = auth.createAccount("visitor@example.com", "long enough");
  accountId = a.id;
  account = auth.createSession(a.id).value;
  const g = auth.createAccount("visitor-gpu@example.com", "long enough");
  auth.setAccountGpu(g.id, { url: "https://gpu.example" });
  gpuAccount = auth.createSession(g.id).value;
  other = auth.createAccount("visitor-other@example.com", "long enough").id;
  owner = auth.createSession().value;
});

describe("a built-in skill opens for a guest and an account", () => {
  it("passes one skill, its recipe and its download to the route, marked as a guest's", () => {
    for (const cookie of [undefined, account]) {
      for (const p of ["/api/assist/skills/product-photoshoot", "/api/assist/skills/product-photoshoot/recipe", "/api/assist/skills/product-photoshoot/download"]) {
        const r = proxy(req(p, { cookie }));
        expect(passed(r), `${p} ${cookie ? "account" : "guest"}`).toBe(true);
        expect(toldGuest(r), p).toBe(true);
      }
    }
    // The owner's request is never marked.
    expect(toldGuest(proxy(req("/api/assist/skills/product-photoshoot", { cookie: owner })))).toBe(false);
  });

  it("answers a guest for a built-in skill, and 404 for the owner's own", async () => {
    const { createSkill } = await import("@/server/skills");
    createSkill({ name: "owners-secret", title: "Owner's secret", description: "d", body: "b" });
    const one = await import("@/app/api/assist/skills/[name]/route");
    const recipe = await import("@/app/api/assist/skills/[name]/recipe/route");
    const download = await import("@/app/api/assist/skills/[name]/download/route");
    const asGuest = (url: string) => new Request(`http://localhost:3000${url}`, { headers: { [access.GUEST_HEADER]: "1" } });
    const ctx = (name: string) => ({ params: Promise.resolve({ name }) });

    const builtin = await one.GET(asGuest("/api/assist/skills/product-photoshoot"), ctx("product-photoshoot"));
    expect(builtin.status).toBe(200);
    expect((await builtin.json()).source).toBe("builtin");
    expect((await one.GET(asGuest("/api/assist/skills/owners-secret"), ctx("owners-secret"))).status).toBe(404);
    expect((await recipe.GET(asGuest("/api/assist/skills/owners-secret/recipe"), ctx("owners-secret"))).status).toBe(404);
    expect((await download.GET(asGuest("/api/assist/skills/owners-secret/download"), ctx("owners-secret"))).status).toBe(404);
    expect((await download.GET(asGuest("/api/assist/skills/product-photoshoot/download"), ctx("product-photoshoot"))).status).toBe(200);
    // The owner still opens their own.
    expect((await one.GET(new Request("http://localhost:3000/api/assist/skills/owners-secret"), ctx("owners-secret"))).status).toBe(200);
  });

  it("prices only a built-in skill for a guest or an account, and never says whether the owner's own exists", async () => {
    const { createSkill, setSkillFile } = await import("@/server/skills");
    createSkill({ name: "owners-recipe", title: "Owner's recipe", description: "d", body: "b" });
    setSkillFile("owners-recipe", "recipe.json", JSON.stringify({ inputs: [{ id: "topic", label: "Topic", type: "text" }], steps: [{ tool: "generate", input: { model_id: "m", prompt: "secret prompt about {topic}" } }] }));
    const estimate = await import("@/app/api/assist/skills/[name]/estimate/route");
    const ctx = (name: string) => ({ params: Promise.resolve({ name }) });
    const post = (name: string, cookie?: string) =>
      estimate.POST(
        new Request(`http://localhost:3000/api/assist/skills/${name}/estimate`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(cookie && { cookie: `${auth.SESSION_COOKIE}=${cookie}` }) },
          body: JSON.stringify({ values: { topic: "x" } }),
        }),
        ctx(name),
      );
    for (const cookie of [undefined, account]) {
      for (const name of ["owners-recipe", "owners-secret", "no-such-skill"]) {
        const r = await post(name, cookie);
        expect(r.status, `${name} ${cookie ? "account" : "guest"}`).toBe(404);
        expect(await r.json()).toEqual({ error: "No such skill" });
      }
      // A built-in skill is still priced (here: it has no recipe, so the route says so).
      expect((await (await post("product-photoshoot", cookie)).json()).error).not.toBe("No such skill");
    }
    // The owner prices their own.
    expect((await (await post("owners-recipe", owner)).json()).error).not.toBe("No such skill");
  });
});

describe("Assist is the owner's", () => {
  const changes: [string, string][] = [
    ["POST", "/api/assist"],
    ["POST", "/api/assist/t1/messages"],
    ["POST", "/api/assist/t1/approval"],
    ["POST", "/api/assist/skills"],
    ["POST", "/api/assist/skills/upload"],
    ["POST", "/api/assist/skills/draft"],
    // Save as skill from a chat (W3) drafts and names through these two.
    ["POST", "/api/assist/skills/draft/name"],
    ["PATCH", "/api/assist/skills/ad-multiplier"],
    ["POST", "/api/assist/skills/product-photoshoot/run"],
    // A skill's Suggest a fix (W6) and a schedule that runs a skill (W4).
    ["POST", "/api/assist/skills/product-photoshoot/fixes"],
    ["PATCH", "/api/assist/schedules/s1"],
    ["POST", "/api/assist/memory"],
    ["POST", "/api/assist/memory/import"],
    ["POST", "/api/assist/projects"],
    ["POST", "/api/assist/schedules"],
  ];

  it("gives a guest and an account, with or without its own GPU, one answer to every change", async () => {
    for (const cookie of [account, gpuAccount]) {
      for (const [method, p] of changes) {
        const r = proxy(req(p, { method, cookie }));
        const who = `${method} ${p} ${cookie === account ? "account" : "gpu account"}`;
        expect(r.status, who).toBe(403);
        // Not "Connect your GPU" (a GPU wouldn't let it use Assist), not the library message.
        expect(r.headers.get(access.CONNECT_GPU_HEADER), who).toBeNull();
        expect(await r.json(), who).toEqual({ error: access.ASSIST_OWNER_MESSAGE, code: "assist-owner" });
      }
    }
    // A guest gets the same answer, not the 401 that offers to sign up: an account couldn't use Assist either.
    for (const [method, p] of changes) {
      const r = proxy(req(p, { method }));
      expect(r.status, `${method} ${p}`).toBe(403);
      expect(r.headers.get(access.GUEST_HEADER), `${method} ${p}`).toBeNull();
      expect(await r.json(), `${method} ${p}`).toEqual({ error: access.ASSIST_OWNER_MESSAGE, code: "assist-owner" });
    }
  });

  it("still prices a skill's run, and lets the owner change everything", () => {
    for (const cookie of [undefined, account]) expect(passed(proxy(req("/api/assist/skills/s1/estimate", { method: "POST", cookie })))).toBe(true);
    for (const [method, p] of changes) expect(passed(proxy(req(p, { method, cookie: owner }))), `${method} ${p}`).toBe(true);
  });

  it("says an owner-only read is the owner's to see", async () => {
    expect((await proxy(req("/api/assist/connectors", { cookie: account })).json()).error).toMatch(/aren't part of your account/);
    expect((await proxy(req("/api/assist/connectors", { method: "POST", cookie: account })).json()).error).toMatch(/aren't part of your account/);
  });
});

describe("the live stream", () => {
  it("answers a visitor with no content (a 404 is a console error on every page)", async () => {
    for (const cookie of [undefined, account]) {
      const r = proxy(req("/api/generations/stream", { cookie }));
      expect(r.status).toBe(204);
      expect(await r.text()).toBe("");
    }
  });
});

describe("an account's own Library", () => {
  const run = (id: string, who: string | null, favorite = 0) =>
    db()
      .prepare(
        "INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, favorite, created_at, updated_at) VALUES (?, 'image', 'm', 'open', 'comfyui', 'text-to-image', 'image', 'succeeded', ?, '[]', ?, ?, ?)",
      )
      .run(id, JSON.stringify({ feature: "image", modelId: "m", ...(who && { account: who }) }), favorite, Date.now(), Date.now());
  const file = (id: string, who: string | null) =>
    db()
      .prepare("INSERT INTO assets (id, kind, rel_path, content_type, size, source, account_id, created_at) VALUES (?, 'image', ?, 'image/png', 1, 'upload', ?, ?)")
      .run(id, `uploads/${id}.png`, who, Date.now());
  const cookieOf = (value: string) => ({ headers: { cookie: `${auth.SESSION_COOKIE}=${value}` } });

  beforeAll(() => {
    run("own-1", accountId, 1);
    run("own-2", accountId);
    run("owner-1", null, 1);
    run("other-1", other);
    file("up-own", accountId);
    file("up-owner", null);
  });

  it("counts only its own runs, and has no Trash", async () => {
    expect(passed(proxy(req("/api/generations/facets", { cookie: account })))).toBe(true);
    expect(await proxy(req("/api/generations/facets")).json()).toEqual(access.NO_FACETS);
    const { GET } = await import("@/app/api/generations/facets/route");
    const mine = await (await GET(new Request("http://localhost:3000/api/generations/facets", cookieOf(account)))).json();
    expect(mine).toMatchObject({ total: 2, favorites: 1, trash: 0 });
    const owners = await (await GET(new Request("http://localhost:3000/api/generations/facets", cookieOf(owner)))).json();
    expect(owners).toMatchObject({ total: 1, favorites: 1 });
  });

  it("lists its own uploads only", async () => {
    expect(passed(proxy(req("/api/assets?source=upload", { cookie: account })))).toBe(true);
    const { GET } = await import("@/app/api/assets/route");
    const ids = async (cookie?: string) =>
      ((await (await GET(new Request("http://localhost:3000/api/assets?source=upload", cookie ? cookieOf(cookie) : undefined))).json()) as { items: { id: string }[] }).items.map((a) => a.id);
    expect(await ids(account)).toEqual(["up-own"]);
    expect(await ids(owner)).toEqual(["up-owner"]);
    expect(await ids()).toEqual([]);
  });

  it("likes, pins and reviews its own runs at once, and nothing else", async () => {
    expect(passed(proxy(req("/api/generations/bulk", { method: "POST", cookie: account })))).toBe(true);
    const { POST } = await import("@/app/api/generations/bulk/route");
    const bulk = (body: object, cookie?: string) =>
      POST(new Request("http://localhost:3000/api/generations/bulk", { method: "POST", headers: { "content-type": "application/json", ...(cookie && { cookie: `${auth.SESSION_COOKIE}=${cookie}` }) }, body: JSON.stringify(body) }));
    const ok = await bulk({ action: "pin", ids: ["own-1", "own-2"] }, account);
    expect(ok.status).toBe(200);
    expect((await ok.json()).count).toBe(2);
    expect((await bulk({ action: "review", ids: ["own-1"], review: "approved" }, account)).status).toBe(200);
    // Someone else's run, or the owner's: refused, and unchanged.
    expect((await bulk({ action: "favorite", ids: ["own-1", "owner-1"] }, account)).status).toBe(403);
    expect((await bulk({ action: "favorite", ids: ["other-1"] }, account)).status).toBe(403);
    expect((db().prepare("SELECT favorite FROM generations WHERE id = 'other-1'").get() as { favorite: number }).favorite).toBe(0);
    // No folders, Trash or restore for an account.
    const move = await bulk({ action: "move", ids: ["own-1"], folderId: null }, account);
    expect(move.status).toBe(403);
    expect((await move.json()).code).toBe("library");
    expect((await bulk({ action: "trash", ids: ["own-1"] }, account)).status).toBe(403);
    // A guest that reached the route anyway.
    expect((await bulk({ action: "pin", ids: ["owner-1"] })).status).toBe(401);
  });
});

describe("skills in use (W6, W7) are the owner's", () => {
  it("gives a guest and an account no suggestions, and refuses the rest of a skill's runs", async () => {
    for (const cookie of [undefined, account, gpuAccount]) {
      const who = cookie ? "account" : "guest";
      const list = proxy(req("/api/skill-suggestions", { cookie }));
      expect(list.status, who).toBe(200);
      expect(await list.json(), who).toEqual({ items: [] });
      // Dismissing one changes the owner's settings.
      expect(passed(proxy(req("/api/skill-suggestions", { method: "POST", cookie }))), who).toBe(false);
      // A skill's run history, its fixes and its steps' progress are the owner's runs.
      for (const p of ["/api/assist/skills/product-photoshoot/history", "/api/assist/skills/product-photoshoot/fixes"]) expect(passed(proxy(req(p, { cookie }))), `${p} ${who}`).toBe(false);
    }
    for (const p of ["/api/skill-suggestions", "/api/assist/skills/product-photoshoot/history", "/api/assist/skills/product-photoshoot/fixes"]) expect(passed(proxy(req(p, { cookie: owner }))), p).toBe(true);
    expect(passed(proxy(req("/api/skill-suggestions", { method: "POST", cookie: owner })))).toBe(true);
  });
});
