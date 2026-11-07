/**
 * Fuobe Chat: its prompts (history that fits, Make it lines, titles, Mango Chilli wording), its store (each account's
 * chats, characters and settings are its own), its routes through the proxy (accounts in, guests to the sign-up card),
 * a reply from the free text helper through a stand-in slot, shares at /c/<token>, and an account's deletion.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { tempDir } from "./helpers/temp-dir";

vi.setConfig({ testTimeout: 30_000 });
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-chat-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:7";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
process.env.FUOBE_HOSTED_RUNS = "1";
// Short waits for the free model here (the site waits about two minutes, then retries every 10 s).
process.env.FUOBE_CHAT_WAIT_MS = "800";
process.env.FUOBE_CHAT_RETRY_MS = "150";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_MODERATION_URL;

const prompt = await import("@/lib/chat/prompt");
const catalog = await import("@/lib/chat/catalog");
const { chatShareRoute } = await import("@/lib/chat/share");
const { wantsToMake } = await import("@/lib/chat/make-intent");
const auth = await import("@/server/auth");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const pool = await import("@/server/computer/pool");
const helper = await import("@/server/text-helper");
const store = await import("@/server/chat/store");
const { purgeAccount } = await import("@/server/account-sweep");
const { proxy } = await import("@/proxy");
const threadsRoute = await import("@/app/api/chat/threads/route");
const threadRoute = await import("@/app/api/chat/threads/[id]/route");
const replyRoute = await import("@/app/api/chat/threads/[id]/reply/route");
const shareRoute = await import("@/app/api/chat/threads/[id]/share/route");
const meRoute = await import("@/app/api/chat/me/route");
const charactersRoute = await import("@/app/api/chat/characters/route");

type WorkerRow = import("@/server/computer/workers").WorkerRow;
const workerRow = (id: string) => db().prepare("SELECT * FROM relay_workers WHERE id = ?").get(id) as WorkerRow;

let a = "";
let b = "";
const cookies: Record<string, string> = {};
let worker = "";

beforeAll(() => {
  auth.setPassword("install password");
  a = auth.createAccount("chat-a@example.com", "long enough").id;
  b = auth.createAccount("chat-b@example.com", "long enough").id;
  cookies.a = `${auth.SESSION_COOKIE}=${auth.createSession(a).value}`;
  cookies.b = `${auth.SESSION_COOKIE}=${auth.createSession(b).value}`;
  const w = pool.addWorker("pc-chat");
  pool.patchWorker(w.id, { paused: false, hours: { always: true } });
  worker = w.id;
});
beforeEach(() => resetRates());
afterAll(() => {
  delete process.env.FUOBE_HOSTED_RUNS;
});

const beat = () =>
  pool.workerBeat(workerRow(worker), pool.cleanBeat({ device: `wkr-${worker}`, protocol: 3, version: "1", local: { paused: false, why: null, until: null }, gpu: {}, inventoryHash: null, running: [], stopped: [] }));

/** A stand-in text slot answering every job with `answer(job)` until stopped. */
function standIn(answer: (job: { system: string; user: string; task: string }) => string) {
  let on = true;
  const seen: { system: string; user: string; task: string }[] = [];
  const done = (async () => {
    while (on) {
      beat();
      const job = helper.claimHelperJob(workerRow(worker), { model: "test", device: "gpu" });
      if (job) {
        seen.push(job);
        helper.finishHelperJob(workerRow(worker), job.id, { lease: job.lease, text: answer(job) });
      } else await new Promise((r) => setTimeout(r, 20));
    }
  })();
  return {
    seen,
    stop: async () => {
      on = false;
      await done;
    },
  };
}

const req = (who: string, url: string, method = "GET", body?: unknown) =>
  new Request(`http://localhost:3000${url}`, { method, headers: { cookie: who, host: "localhost:3000", "content-type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) }) as never;

async function events(res: Response) {
  const text = await res.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; [k: string]: unknown });
}

// ---------------------------------------------------------------------------

describe("what the model reads", () => {
  it("keeps the newest turns that fit, and always the last", () => {
    const turns = Array.from({ length: 20 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `message ${i} ${"x".repeat(80)}` }));
    const fit = prompt.fitHistory(turns, 600);
    expect(fit.turns.at(-1)).toEqual(turns.at(-1));
    expect(fit.dropped).toBe(turns.length - fit.turns.length);
    expect(fit.turns.reduce((n, t) => n + t.content.length + 16, 0)).toBeLessThanOrEqual(600);
    // It starts on the person's turn when it cut the chat.
    expect(fit.turns[0].role).toBe("user");
    // One huge last turn is cut to the budget, not dropped.
    const big = prompt.fitHistory([{ role: "user", content: "y".repeat(5000) }], 1000);
    expect(big.turns).toHaveLength(1);
    expect(big.turns[0].content.length).toBeLessThanOrEqual(1000);
  });

  it("turns Prompt lines into Make it cards, in order", () => {
    const parts = prompt.splitMakeIts("### Linen at dusk\nA slow walk.\nPrompt (video): A model in linen walks along a pier at dusk, the camera tracking beside her\n\n### Fig\nPrompt: Midnight fig perfume bottle on black velvet, rim light\nMore words.");
    expect(parts.map((p) => p.kind)).toEqual(["text", "make", "text", "make", "text"]);
    expect(parts[1]).toMatchObject({ kind: "make", make: { studio: "video" } });
    expect(parts[3]).toMatchObject({ kind: "make", make: { studio: "image", prompt: "Midnight fig perfume bottle on black velvet, rim light" } });
    expect(prompt.makeItHref({ studio: "music", prompt: "lo-fi & rain" })).toBe("/audio/music?prompt=lo-fi%20%26%20rain");
  });

  it("hands strict chat templates turns that start with the person and take turns", () => {
    const out = prompt.alternate([
      { role: "assistant", content: "*looks up* Hello." },
      { role: "user", content: "Hi" },
      { role: "user", content: "Are you there?" },
      { role: "assistant", content: "" },
      { role: "assistant", content: "Yes." },
      { role: "user", content: "Good." },
    ]);
    expect(out.map((t) => t.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    expect(out[2].content).toBe("Hi\n\nAre you there?");
    expect(helper.helperMessagesProblem(out)).toBeNull();
  });

  it("names a chat from its first line, and tidies a reply", () => {
    expect(prompt.titleFrom("  Plan a shoot  ")).toBe("Plan a shoot");
    expect(prompt.titleFrom("word ".repeat(30)).length).toBeLessThanOrEqual(61);
    expect(prompt.tidyReply("<think>hm</think>Sienna Vale: Ten minutes.", "Sienna Vale")).toBe("Ten minutes.");
  });

  it("says Mango Chilli only when it's on, and keeps characters adult either way", () => {
    const sienna = catalog.builtInCharacter("sienna-vale")!;
    const general = prompt.systemPrompt({ kind: "character", character: sienna, mature: false });
    const mature = prompt.systemPrompt({ kind: "character", character: sienna, mature: true });
    expect(general).toContain("You are Sienna Vale.");
    expect(general).toContain("explicit content is not");
    expect(general).not.toContain(catalog.MANGO_CHILLI.name);
    expect(mature).toContain(catalog.MANGO_CHILLI.name);
    for (const s of [general, mature]) expect(s).toContain("Every character in the story is an adult");
    expect(prompt.systemPrompt({ kind: "ideas", mature: false })).toContain("Prompt (image):");
  });

  it("every built-in character is complete, and mature ones are marked", () => {
    for (const c of catalog.BUILT_IN_CHARACTERS) {
      expect(c.name && c.persona && c.greeting && c.scenario).toBeTruthy();
      expect(c.accent.every((x) => /^#[0-9a-f]{6}$/i.test(x))).toBe(true);
    }
    expect(catalog.BUILT_IN_CHARACTERS.some((c) => c.mature)).toBe(true);
    expect(catalog.BUILT_IN_CHARACTERS.some((c) => !c.mature)).toBe(true);
  });
});

describe("the proxy", () => {
  it("lets accounts through to their chats and sends a guest's change to the sign-up card", async () => {
    const acct = await proxy(new NextRequest("http://localhost:3000/api/chat/threads", { method: "POST", headers: { cookie: cookies.a, host: "localhost:3000", origin: "http://localhost:3000" } }));
    expect(acct.headers.get("x-middleware-next")).toBe("1");
    const guest = await proxy(new NextRequest("http://localhost:3000/api/chat/threads", { method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:3000" } }));
    expect(guest.status).toBe(401);
    expect(guest.headers.get("x-fuobe-guest")).toBe("1");
  });

  it("opens a shared chat's page to anyone, and nothing else under /c/", async () => {
    const token = "a".repeat(32);
    expect(chatShareRoute(`/c/${token}`)).toBe(true);
    expect(chatShareRoute(`/c/${token}/portrait`)).toBe(true);
    expect(chatShareRoute(`/c/${token}/opengraph-image`)).toBe(true);
    expect(chatShareRoute(`/c/${token}/other`)).toBe(false);
    expect(chatShareRoute("/c/short")).toBe(false);
    const open = await proxy(new NextRequest(`http://localhost:3000/c/${token}`, { headers: { host: "localhost:3000" } }));
    expect(open.headers.get("x-middleware-next")).toBe("1");
    // Only reads: a POST there is no share.
    const post = await proxy(new NextRequest(`http://localhost:3000/c/${token}`, { method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:3000" } }));
    expect(post.headers.get("x-middleware-next")).not.toBe("1");
  });
});

describe("an account's chats are its own", () => {
  it("one account never reads, renames, shares or deletes another's chat", async () => {
    const r = await threadsRoute.POST(req(cookies.a, "/api/chat/threads", "POST", { kind: "chat", text: "What should I wear to a gallery opening?" }));
    expect(r.status).toBe(201);
    const t = (await r.json()) as { id: string; title: string; messages: unknown[] };
    expect(t.title).toBe("What should I wear to a gallery opening?");
    expect(t.messages).toHaveLength(1);
    expect((await threadRoute.GET(req(cookies.b, `/api/chat/threads/${t.id}`), ctx({ id: t.id }))).status).toBe(404);
    expect((await threadRoute.PATCH(req(cookies.b, `/api/chat/threads/${t.id}`, "PATCH", { title: "mine" }), ctx({ id: t.id }))).status).toBe(404);
    expect((await shareRoute.POST(req(cookies.b, `/api/chat/threads/${t.id}/share`, "POST", {}), ctx({ id: t.id }))).status).toBe(404);
    expect((await threadRoute.DELETE(req(cookies.b, `/api/chat/threads/${t.id}`, "DELETE"), ctx({ id: t.id }))).status).toBe(404);
    const listB = (await (await threadsRoute.GET(req(cookies.b, "/api/chat/threads"))).json()) as { items: unknown[] };
    expect(listB.items).toEqual([]);
    expect((await threadRoute.GET(req(cookies.a, `/api/chat/threads/${t.id}`), ctx({ id: t.id }))).status).toBe(200);
  });

  it("opens a chat's page only for its own account: anyone else gets a real 404", async () => {
    const t = store.createThread(a, { kind: "chat", mature: false });
    const page = (cookie?: string) => proxy(new NextRequest(`http://localhost:3000/chat/${t.id}`, { headers: { host: "localhost:3000", ...(cookie && { cookie }) } }));
    expect((await page(cookies.a)).headers.get("x-middleware-next")).toBe("1");
    expect((await page(cookies.b)).status).toBe(404);
    expect((await page()).status).toBe(404);
  });

  it("a guest gets the sign-up answer from the routes too", async () => {
    const r = await threadsRoute.POST(new Request("http://localhost:3000/api/chat/threads", { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json" }, body: "{}" }));
    expect(r.status).toBe(401);
    expect(r.headers.get("x-fuobe-guest")).toBe("1");
  });

  it("keeps mature characters behind Mango Chilli mode, which needs an adult's yes", async () => {
    const valentina = catalog.BUILT_IN_CHARACTERS.find((c) => c.mature)!;
    const list = (await (await charactersRoute.GET(req(cookies.a, "/api/chat/characters"))).json()) as { items: { id: string }[] };
    expect(list.items.some((c) => c.id === valentina.id)).toBe(false);
    const refused = await threadsRoute.POST(req(cookies.a, "/api/chat/threads", "POST", { kind: "character", characterId: valentina.id }));
    expect(refused.status).toBe(403);
    expect((await refused.json()).code).toBe("mature-off");
    expect((await meRoute.PATCH(req(cookies.a, "/api/chat/me", "PATCH", { mature: true }))).status).toBe(400);
    const on = await meRoute.PATCH(req(cookies.a, "/api/chat/me", "PATCH", { mature: true, adult: true }));
    expect((await on.json()).mature).toBe(true);
    const t = await threadsRoute.POST(req(cookies.a, "/api/chat/threads", "POST", { kind: "character", characterId: valentina.id }));
    expect(t.status).toBe(201);
    const view = (await t.json()) as { id: string; mature: boolean; messages: { role: string; content: string }[] };
    expect(view.mature).toBe(true);
    expect(view.messages[0]).toMatchObject({ role: "assistant", content: valentina.greeting });
    // Turned off, the chat stays out of the list and out of reach.
    await meRoute.PATCH(req(cookies.a, "/api/chat/me", "PATCH", { mature: false }));
    const hidden = (await (await threadsRoute.GET(req(cookies.a, "/api/chat/threads"))).json()) as { items: { id: string }[] };
    expect(hidden.items.some((x) => x.id === view.id)).toBe(false);
    expect((await threadRoute.GET(req(cookies.a, `/api/chat/threads/${view.id}`), ctx({ id: view.id }))).status).toBe(403);
  });

  it("makes characters with checks, and keeps them per account", async () => {
    const r = await charactersRoute.POST(req(cookies.a, "/api/chat/characters", "POST", { name: "Aurelie", persona: "A perfumer in Grasse, precise and warm.", tagline: "Perfumer" }));
    expect(r.status).toBe(201);
    const c = (await r.json()) as { id: string; greeting: string };
    expect(c.greeting).toContain("Aurelie");
    expect(store.getCharacter(b, c.id)).toBeNull();
    expect((await charactersRoute.POST(req(cookies.a, "/api/chat/characters", "POST", { name: "", persona: "x" }))).status).toBe(400);
    // A portrait must be the person's own picture.
    expect((await charactersRoute.POST(req(cookies.a, "/api/chat/characters", "POST", { name: "X", persona: "Someone with a voice.", portrait: "/api/files/uploads/x.png" }))).status).toBe(400);
  });
});

describe("a reply", () => {
  it("comes from the free text helper with the chat's system prompt and history, and is saved", async () => {
    const slot = standIn((job) => (job.task === "write" && job.user.includes("Write You's next reply") ? "Try a black wool coat over a silk slip.\n\nPrompt (image): A model in a black wool coat over a champagne silk slip at a gallery opening" : "Summary."));
    try {
      const t = (await (await threadsRoute.POST(req(cookies.a, "/api/chat/threads", "POST", { kind: "chat", text: "Gallery opening outfit?" }))).json()) as { id: string };
      const res = await replyRoute.POST(req(cookies.a, `/api/chat/threads/${t.id}/reply`, "POST", {}), ctx({ id: t.id }));
      expect(res.headers.get("content-type")).toContain("application/x-ndjson");
      const ev = await events(res);
      const done = ev.find((e) => e.type === "done") as { message: { role: string; content: string } } | undefined;
      expect(done?.message.role).toBe("assistant");
      expect(done?.message.content).toContain("black wool coat");
      expect(slot.seen[0].system).toContain("You are Fuobe Chat");
      expect(slot.seen[0].user).toContain("User: Gallery opening outfit?");
      const view = store.getThread(a, t.id)!;
      expect(view.messages.map((m) => m.role)).toEqual(["user", "assistant"]);

      // A new message streams back as the person's, then the reply.
      const res2 = await replyRoute.POST(req(cookies.a, `/api/chat/threads/${t.id}/reply`, "POST", { text: "And shoes?" }), ctx({ id: t.id }));
      const ev2 = await events(res2);
      expect(ev2[0]).toMatchObject({ type: "user", message: { role: "user", content: "And shoes?" } });
      expect(ev2.at(-1)?.type).toBe("done");
      expect(store.getThread(a, t.id)!.messages).toHaveLength(4);

      // Try again replaces the last reply.
      const ev3 = await events(await replyRoute.POST(req(cookies.a, `/api/chat/threads/${t.id}/reply`, "POST", { retry: true }), ctx({ id: t.id })));
      expect(ev3.at(-1)?.type).toBe("done");
      expect(store.getThread(a, t.id)!.messages).toHaveLength(4);
    } finally {
      await slot.stop();
    }
  });

  it("streams a reply from a chat slot as real turns, with the words as they come", async () => {
    let on = true;
    const seen: { messages?: { role: string; content: string }[]; task: string; system: string }[] = [];
    const slot = (async () => {
      while (on) {
        beat();
        const job = helper.claimHelperJob(workerRow(worker), { model: "test", device: "gpu", chat: true });
        if (!job) {
          await new Promise((r) => setTimeout(r, 20));
          continue;
        }
        seen.push(job as never);
        for (const part of ["Ten", "Ten minutes.", "Ten minutes. Show me"]) {
          helper.partialHelperJob(workerRow(worker), job.id, { lease: job.lease, text: part });
          await new Promise((r) => setTimeout(r, 300));
        }
        helper.finishHelperJob(workerRow(worker), job.id, { lease: job.lease, text: "Ten minutes. Show me what you brought." });
      }
    })();
    try {
      const t = (await (await threadsRoute.POST(req(cookies.a, "/api/chat/threads", "POST", { kind: "character", characterId: "sienna-vale", text: "Hi Sienna" }))).json()) as { id: string };
      const ev = await events(await replyRoute.POST(req(cookies.a, `/api/chat/threads/${t.id}/reply`, "POST", {}), ctx({ id: t.id })));
      const texts = ev.filter((e) => e.type === "text").map((e) => e.text);
      expect(texts.length).toBeGreaterThan(1);
      expect(ev.at(-1)).toMatchObject({ type: "done", message: { content: "Ten minutes. Show me what you brought." } });
      const job = seen.find((j) => j.task === "chat")!;
      // The greeting opens with a cue, then the turns alternate and end with the person's.
      expect(job.messages?.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
      expect(job.messages?.at(-1)?.content).toBe("Hi Sienna");
      expect(job.system).toContain("You are Sienna Vale.");
    } finally {
      on = false;
      await slot;
    }
  });

  it("never shows an error while the free model starts up: the message waits and is answered when it's ready", async () => {
    db().prepare("DELETE FROM helper_slots").run();
    const t = (await (await threadsRoute.POST(req(cookies.a, "/api/chat/threads", "POST", { kind: "chat" }))).json()) as { id: string };
    const ev = await events(await replyRoute.POST(req(cookies.a, `/api/chat/threads/${t.id}/reply`, "POST", { text: "Hello?" }), ctx({ id: t.id })));
    expect(ev[0].type).toBe("user");
    expect(ev.some((e) => e.type === "status" && e.status === "starting")).toBe(true);
    expect(ev.some((e) => e.type === "error")).toBe(false);
    expect(ev.at(-1)?.type).toBe("pending");
    expect(store.getThread(a, t.id)!.messages.map((m) => m.role)).toEqual(["user"]);
    // Asking again meanwhile doesn't start a second wait: it says the answer is on its way.
    const again = await events(await replyRoute.POST(req(cookies.a, `/api/chat/threads/${t.id}/reply`, "POST", {}), ctx({ id: t.id })));
    expect(again.map((e) => e.type)).toEqual(["pending"]);
    // The model comes up: the kept message is answered by itself, with nobody asking again.
    const slot = standIn(() => "Hello! I'm here.");
    try {
      const end = Date.now() + 15_000;
      while (store.getThread(a, t.id)!.messages.length < 2 && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
      expect(store.getThread(a, t.id)!.messages.map((m) => [m.role, m.content])).toEqual([
        ["user", "Hello?"],
        ["assistant", "Hello! I'm here."],
      ]);
    } finally {
      await slot.stop();
    }
  });
});

describe("making things in a chat", () => {
  it("tells a request to make something from talk about it", () => {
    for (const s of [
      "Make a 3-shot ad for a gold watch",
      "can you make four portraits of a model in a velvet suit",
      "Please create a music track for a rainy café",
      "generate a vertical video of a red gown in the snow",
      "let's make a poster for my launch",
    ])
      expect(wantsToMake(s), s).toBe(true);
    for (const s of ["How do I make a reel go viral?", "What should I wear to a gallery opening?", "Write a caption for my linen post", "make sense?", "I made a video yesterday", "Ideas for a perfume ad"])
      expect(wantsToMake(s), s).toBe(false);
    // An edit or animation of a picture sent with the message.
    expect(wantsToMake("Animate this", true)).toBe(true);
    expect(wantsToMake("remove the background", true)).toBe(true);
    expect(wantsToMake("Animate this", false)).toBe(false);
  });

  it("answers a request to make with a plan priced by the studio's own check, and a plan can be put aside", async () => {
    const t = (await (await threadsRoute.POST(req(cookies.a, "/api/chat/threads", "POST", { kind: "chat" }))).json()) as { id: string };
    const ev = await events(await replyRoute.POST(req(cookies.a, `/api/chat/threads/${t.id}/reply`, "POST", { text: "Make four portraits of a model in a black velvet suit" }), ctx({ id: t.id })));
    expect(ev.map((e) => e.type)).toEqual(["user", "done"]);
    const reply = ev[1].message as { id: string; plan?: { jobs: { modelName: string; count: number }[]; status: string; requests: { feature: string; params?: { numOutputs?: number } }[] } };
    expect(reply.plan?.status).toBe("ready");
    expect(reply.plan?.jobs).toHaveLength(1);
    expect(reply.plan?.jobs[0].modelName).toBeTruthy();
    expect(reply.plan?.requests[0]).toMatchObject({ feature: "chat", params: { numOutputs: 4 } });
    // Not now: kept as an idea, never run, and it can't be answered twice.
    const plansRoute = await import("@/app/api/chat/threads/[id]/plans/[mid]/route");
    const no = await plansRoute.POST(req(cookies.a, `/api/chat/threads/${t.id}/plans/${reply.id}`, "POST", { ok: false }), ctx({ id: t.id, mid: reply.id }));
    expect(no.status).toBe(200);
    expect(store.getThread(a, t.id)!.messages.at(-1)?.plan?.status).toBe("declined");
    const again = await plansRoute.POST(req(cookies.a, `/api/chat/threads/${t.id}/plans/${reply.id}`, "POST", { ok: true }), ctx({ id: t.id, mid: reply.id }));
    expect(again.status).toBe(409);
    // Another account can't answer it.
    const other = await plansRoute.POST(req(cookies.b, `/api/chat/threads/${t.id}/plans/${reply.id}`, "POST", { ok: true }), ctx({ id: t.id, mid: reply.id }));
    expect(other.status).toBe(404);
    // Make it: the steps go through the studios' route as this account, and either start or say why not.
    const ev2 = await events(await replyRoute.POST(req(cookies.a, `/api/chat/threads/${t.id}/reply`, "POST", { text: "Make a poster for a perfume called Midnight Fig" }), ctx({ id: t.id })));
    const second = ev2[1].message as { id: string };
    const run = await plansRoute.POST(req(cookies.a, `/api/chat/threads/${t.id}/plans/${second.id}`, "POST", { ok: true }), ctx({ id: t.id, mid: second.id }));
    expect(run.status).toBe(200);
    const ran = store.getThread(a, t.id)!.messages.find((m) => m.id === second.id)!.plan!;
    expect(ran.status).toBe("running");
    expect(ran.ids.length + ran.errors.length + ran.jobs.filter((j) => j.error).length).toBeGreaterThan(0);
    for (const g of ran.ids) expect(db().prepare("SELECT json_extract(request_json, '$.account') AS a FROM generations WHERE id = ?").get(g)).toEqual({ a });
  });

  it("keeps talk as talk, and characters stay in their story", async () => {
    const slot = standIn(() => "Pick a dark wool coat.");
    try {
      const t = (await (await threadsRoute.POST(req(cookies.a, "/api/chat/threads", "POST", { kind: "chat" }))).json()) as { id: string };
      const ev = await events(await replyRoute.POST(req(cookies.a, `/api/chat/threads/${t.id}/reply`, "POST", { text: "How do I make my outfit look expensive?" }), ctx({ id: t.id })));
      expect((ev.at(-1)?.message as { plan?: unknown } | undefined)?.plan).toBeUndefined();
      const c = (await (await threadsRoute.POST(req(cookies.a, "/api/chat/threads", "POST", { kind: "character", characterId: "kai" }))).json()) as { id: string };
      const ev2 = await events(await replyRoute.POST(req(cookies.a, `/api/chat/threads/${c.id}/reply`, "POST", { text: "Make a song for me, Kai" }), ctx({ id: c.id })));
      expect((ev2.at(-1)?.message as { plan?: unknown } | undefined)?.plan).toBeUndefined();
    } finally {
      await slot.stop();
    }
  });
});

describe("sharing", () => {
  it("shares a copy at a public link, stops sharing, and goes with the chat", async () => {
    const t = store.createThread(a, { kind: "chat", mature: false });
    store.addMessage(a, t.id, "user", "Hi");
    expect(() => store.shareThread(a, t.id)).toThrow(/nothing to share/);
    store.addMessage(a, t.id, "assistant", "Hello there.");
    const r = await shareRoute.POST(req(cookies.a, `/api/chat/threads/${t.id}/share`, "POST", {}), ctx({ id: t.id }));
    expect(r.status).toBe(201);
    const { token, path } = (await r.json()) as { token: string; path: string };
    expect(path).toBe(`/c/${token}`);
    expect(chatShareRoute(path)).toBe(true);
    // A copy: later messages aren't in it.
    store.addMessage(a, t.id, "user", "private follow-up");
    expect(store.findChatShare(token)!.snapshot.messages.map((m) => m.content)).toEqual(["Hi", "Hello there."]);
    expect((await shareRoute.DELETE(req(cookies.a, `/api/chat/threads/${t.id}/share`, "DELETE"), ctx({ id: t.id }))).status).toBe(200);
    expect(store.findChatShare(token)).toBeNull();
    const again = store.shareThread(a, t.id);
    store.deleteThread(a, t.id);
    expect(store.findChatShare(again.token)).toBeNull();
  });
});

describe("an account's deletion", () => {
  it("removes its chats, messages, characters, settings and shares", async () => {
    const t = store.createThread(b, { kind: "chat", mature: false });
    store.addMessage(b, t.id, "user", "Hi");
    store.addMessage(b, t.id, "assistant", "Hey.");
    store.shareThread(b, t.id);
    store.createCharacter(b, { name: "Bo", persona: "A friendly bookseller." });
    store.setMature(b, true);
    await purgeAccount(b);
    for (const table of ["account_chat_threads", "account_chat_messages", "account_chat_characters", "account_chat_prefs", "account_chat_shares"]) {
      expect((db().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE account_id = ?`).get(b) as { n: number }).n).toBe(0);
    }
  });
});
