import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 60_000 });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-assist-sched-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

// No real 30 s sweep in this process: the fixtures' times are due by the real clock too, and a sweep
// with Date.now() would start extra runs. A runner that is already "running" (its timer cleared) keeps
// ensureScheduleRunner from starting one; the first test checks that saving a task starts it.
const stubTimer = setInterval(() => {}, 60_000);
clearInterval(stubTimer);
globalThis.__fuobeScheduleRunner = { tick: () => {}, timer: stubTimer };

const { setSetting } = await import("@/server/settings");
const agent = await import("@/server/assist/agent");
const tools = await import("@/server/assist/tools");
const sched = await import("@/server/assist/schedules");
const projects = await import("@/server/assist/projects");
const { db } = await import("@/server/db");
const { spendOf } = await import("@/lib/assist-schedule");
const connectors = await import("@/server/assist/connectors");
const listRoute = await import("@/app/api/assist/schedules/route");
const oneRoute = await import("@/app/api/assist/schedules/[scheduleId]/route");
const runRoute = await import("@/app/api/assist/schedules/[scheduleId]/run/route");

type Block = Anthropic.Beta.BetaContentBlock;
const text = (t: string) => ({ type: "text", text: t, citations: null }) as Block;
const generateCall = (id: string, input: unknown) => ({ type: "tool_use", id, name: "generate", input }) as unknown as Block;
const reply = (content: Block[], stop: Anthropic.Beta.BetaStopReason) => ({ content, stop_reason: stop, stop_details: null }) as Anthropic.Beta.BetaMessage;
const job = (prompt: string) => ({ summary: prompt, jobs: [{ model_id: "nano-banana-pro", prompt }] });

/** A model that makes one generate call per turn listed, then says it's done; it records what it saw. */
function scripted(...prompts: string[]) {
  const seen: { system: string; messages: string; connectors?: string[] }[] = [];
  let n = 0;
  const call: import("@/server/assist/agent").ModelCall = async ({ system, messages, connectors }) => {
    seen.push({ system: system.turn, messages: JSON.stringify(messages), connectors: connectors?.map((c) => c.slug) });
    const p = prompts[n++];
    return p ? reply([text("On it."), generateCall(`toolu_${n}`, job(p))], "tool_use") : reply([text("Done — your ad is rendering.")], "end_turn");
  };
  return { call, seen };
}

const T = (s: string) => Date.parse(s);
const base = { prompt: "Make today's perfume ad", tz: "UTC", engine: "cloud" as const, approval: "ask" as const };
const threadOf = (id: string) => agent.getThread(id)!.thread;

beforeAll(() => setSetting("demoMode", "auto"));
afterEach(() => {
  setSetting("falKey", "");
  db().prepare("DELETE FROM assist_schedules").run();
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("scheduled tasks", () => {
  it("show a task saved with the old Ollama agent as a local-model task", () => {
    const s = sched.createSchedule({ ...base, title: "Old local", mode: { mode: "manual", agent: "local", model: "qwen3:8b" }, rule: { kind: "daily", time: "09:00" } }, T("2026-10-27T08:00:00Z"));
    expect(s.mode).toMatchObject({ mode: "manual", agent: "local" });
    db().prepare("UPDATE assist_schedules SET mode_json = json_set(mode_json, '$.agent', 'ollama') WHERE id = ?").run(s.id);
    expect(sched.getSchedule(s.id)!.mode).toEqual({ mode: "manual", agent: "local", model: "qwen3:8b" });
    sched.deleteSchedule(s.id);
  });

  it("are checked when saved: the zone, a time that has passed, the project", () => {
    const now = T("2026-10-27T08:00:00Z");
    expect(() => sched.createSchedule({ ...base, title: "x", tz: "Mars/Base", rule: { kind: "daily", time: "09:00" } }, now)).toThrow("Pick a time zone");
    expect(() => sched.createSchedule({ ...base, title: "x", rule: { kind: "once", at: "2026-10-26T09:00" } }, now)).toThrow(/passed/);
    expect(() => sched.createSchedule({ ...base, title: "x", projectId: "nope", rule: { kind: "daily", time: "09:00" } }, now)).toThrow(/project/);
    // Saving a task makes sure the sweep is running (it also starts at boot).
    const stub = globalThis.__fuobeScheduleRunner;
    globalThis.__fuobeScheduleRunner = undefined;
    const s = sched.createSchedule({ ...base, title: "Every 6h", rule: { kind: "hours", every: 6 } }, now);
    expect(globalThis.__fuobeScheduleRunner).toBeDefined();
    clearInterval(globalThis.__fuobeScheduleRunner!.timer);
    globalThis.__fuobeScheduleRunner = stub;
    expect(s.rule).toEqual({ kind: "hours", every: 6, from: now });
    expect(s.connectors).toBe(false);
    expect(s.nextRunAt).toBe(now + 6 * 3_600_000);
    // Ask first has no cap; auto gets the default unless one is given.
    expect(s.capUsd).toBeNull();
    expect(sched.createSchedule({ ...base, title: "auto", approval: "auto", rule: { kind: "daily", time: "09:00" } }, now).capUsd).toBe(2);
    // Pausing hides the next run; resuming picks it from now; an unchanged "every N hours" keeps counting from its start.
    const paused = sched.updateSchedule(s.id, { paused: true }, now + 1000)!;
    expect(paused).toMatchObject({ paused: true, nextRunAt: null });
    const resumed = sched.updateSchedule(s.id, { paused: false }, now + 7 * 3_600_000)!;
    expect(resumed.nextRunAt).toBe(now + 12 * 3_600_000);
    expect(sched.updateSchedule(s.id, { rule: { kind: "hours", every: 2 } }, now + 7 * 3_600_000)!.nextRunAt).toBe(now + 9 * 3_600_000);
  });

  it("the routes validate the body and say what's wrong", async () => {
    const bad = await listRoute.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ ...base, title: "x", rule: { kind: "daily", time: "9am" } }) }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("Pick a time");
    const ok = await listRoute.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ ...base, title: "Daily", rule: { kind: "weekly", days: [1, 3], time: "09:00" } }) }));
    expect(ok.status).toBe(201);
    const created = await ok.json();
    expect((await (await listRoute.GET(new Request("http://x/api/assist/schedules?project=none"))).json()).items).toHaveLength(1);
    const ctx = { params: Promise.resolve({ scheduleId: created.id }) };
    expect(await (await oneRoute.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ paused: true }) }), ctx)).json()).toMatchObject({ paused: true });
    expect((await oneRoute.DELETE(new Request("http://x"), ctx)).status).toBe(204);
    expect((await oneRoute.GET(new Request("http://x"), ctx)).status).toBe(404);
  });
});

describe("the sweep (fake clock)", () => {
  it("starts what's due, once, as a new chat — and moves the task to its next time", async () => {
    const s = sched.createSchedule({ ...base, title: "Perfume ad", rule: { kind: "daily", time: "09:00" } }, T("2026-10-27T08:00:00Z"));
    expect(s.nextRunAt).toBe(T("2026-10-27T09:00:00Z"));
    const m = scripted("A perfume ad");
    expect(await sched.sweepSchedules(T("2026-10-27T08:59:59Z"), { model: m.call })).toEqual([]);
    // Two sweeps at once (a hot reload's second timer): one run.
    const [a, b] = await Promise.all([sched.sweepSchedules(T("2026-10-27T09:00:30Z"), { model: m.call }), sched.sweepSchedules(T("2026-10-27T09:00:30Z"), { model: m.call })]);
    expect([...a, ...b]).toHaveLength(1);
    const view = sched.getSchedule(s.id)!;
    expect(view).toMatchObject({ runs: 1, lastRunAt: T("2026-10-27T09:00:30Z"), nextRunAt: T("2026-10-28T09:00:00Z") });
    const t = threadOf([...a, ...b][0]);
    expect(t).toMatchObject({ title: "Perfume ad · Tue 27 Oct, 09:00", scheduleId: s.id, autoApprove: false });
    expect(t.items[0]).toMatchObject({ role: "notice", text: expect.stringMatching(/^Scheduled run of “Perfume ad” · Every day at 09:00 · plans wait for your approval/) });
    expect(t.items[1]).toMatchObject({ role: "user", text: "Make today's perfume ad" });
    // The model was told nobody is watching.
    expect(m.seen[0].system).toMatch(/scheduled run of the task “Perfume ad” \(Every day at 09:00, UTC/);
    expect(m.seen[0].system).toMatch(/don't ask questions/);
  });

  it("a run the server missed while it was off happens once, then the next time is from now", async () => {
    const s = sched.createSchedule({ ...base, title: "Missed", rule: { kind: "daily", time: "09:00" } }, T("2026-10-27T08:00:00Z"));
    const started = await sched.sweepSchedules(T("2026-10-30T12:00:00Z"), { model: scripted().call });
    expect(started).toHaveLength(1);
    expect(sched.getSchedule(s.id)).toMatchObject({ runs: 1, nextRunAt: T("2026-10-31T09:00:00Z") });
    expect(await sched.sweepSchedules(T("2026-10-30T12:00:01Z"), { model: scripted().call })).toEqual([]);
  });

  it("a one-off runs once, then has no next time; paused tasks don't run", async () => {
    const once = sched.createSchedule({ ...base, title: "Once", rule: { kind: "once", at: "2026-10-27T10:00" } }, T("2026-10-27T08:00:00Z"));
    const paused = sched.createSchedule({ ...base, title: "Paused", paused: true, rule: { kind: "daily", time: "09:00" } }, T("2026-10-27T08:00:00Z"));
    expect(await sched.sweepSchedules(T("2026-10-27T10:00:00Z"), { model: scripted().call })).toHaveLength(1);
    expect(sched.getSchedule(once.id)).toMatchObject({ runs: 1, nextRunAt: null, last: { status: "done", text: "Done — your ad is rendering." } });
    expect(sched.getSchedule(paused.id)).toMatchObject({ runs: 0, paused: true });
    expect(await sched.sweepSchedules(T("2026-10-29T10:00:00Z"), { model: scripted().call })).toEqual([]);
  });

  it("skips a run while the one before is still going", async () => {
    const s = sched.createSchedule({ ...base, title: "Slow", rule: { kind: "hours", every: 1 } }, T("2026-10-27T08:00:00Z"));
    let release!: () => void;
    const slow: import("@/server/assist/agent").ModelCall = () => new Promise((r) => (release = () => r(reply([text("Finally.")], "end_turn"))));
    const first = sched.sweepSchedules(T("2026-10-27T09:00:00Z"), { model: slow });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(await sched.sweepSchedules(T("2026-10-27T10:00:00Z"), { model: scripted().call })).toEqual([]);
    expect(sched.getSchedule(s.id)!.last).toMatchObject({ status: "skipped", text: expect.stringMatching(/the run before was still going/) });
    release();
    await first;
    expect(sched.getSchedule(s.id)).toMatchObject({ runs: 1, last: { status: "done", text: "Finally." } });
  });

  it("a task whose project was deleted pauses and says why", async () => {
    const p = projects.createProject({ name: "Launch" });
    const s = sched.createSchedule({ ...base, title: "In a project", projectId: p.id, rule: { kind: "daily", time: "09:00" } }, T("2026-10-27T08:00:00Z"));
    // Runs inside the project.
    const [id] = await sched.sweepSchedules(T("2026-10-27T09:00:00Z"), { model: scripted().call });
    expect(threadOf(id).projectId).toBe(p.id);
    expect(sched.getSchedule(s.id)!.last).toMatchObject({ threadId: id, status: "done" });
    projects.deleteProject(p.id);
    // The reason shows, not the last run's chat (which finished fine).
    expect(sched.getSchedule(s.id)).toMatchObject({ projectId: null, paused: true, nextRunAt: null, last: { threadId: null, status: "failed", text: "Paused: its project was deleted" } });
    expect(await sched.sweepSchedules(T("2026-10-28T09:00:00Z"), { model: scripted().call })).toEqual([]);
  });

  it("a project that vanished before a start: Run now says why, and so does the task", async () => {
    const p = projects.createProject({ name: "Gone" });
    const s = sched.createSchedule({ ...base, title: "Orphan", projectId: p.id, rule: { kind: "daily", time: "09:00" } }, T("2026-10-27T08:00:00Z"));
    const [first] = await sched.sweepSchedules(T("2026-10-27T09:00:00Z"), { model: scripted().call });
    expect(first).toBeTruthy();
    // Removed behind deleteProject's back (another process, a restore): the start finds no project.
    db().prepare("DELETE FROM assist_projects WHERE id = ?").run(p.id);
    const res = await runRoute.POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ scheduleId: s.id }) });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ threadId: null, reason: "paused", error: "Its project was deleted — edit the task to pick another" });
    expect(sched.getSchedule(s.id)).toMatchObject({ paused: true, last: { threadId: null, status: "failed", text: "Its project was deleted — edit the task to pick another" } });
  });

  it("Run now: 202 with the new chat; 409 while the last run is still going", async () => {
    const s = sched.createSchedule({ ...base, title: "Now", rule: { kind: "daily", time: "09:00" } }, T("2026-10-27T08:00:00Z"));
    const ctx = { params: Promise.resolve({ scheduleId: s.id }) };
    let release!: () => void;
    const slow: import("@/server/assist/agent").ModelCall = () => new Promise((r) => (release = () => r(reply([text("Made it.")], "end_turn"))));
    const begun = await sched.startSchedule(s.id, { model: slow });
    expect(begun.threadId).toBeTruthy();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const busy = await runRoute.POST(new Request("http://x", { method: "POST" }), ctx);
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ threadId: null, reason: "busy" });
    // The click isn't recorded as a skipped run: the task still shows the run that's going.
    expect(sched.getSchedule(s.id)!.last).toMatchObject({ threadId: begun.threadId, status: "running" });
    release();
    await begun.done;
    expect(sched.getSchedule(s.id)!.last).toMatchObject({ threadId: begun.threadId, status: "done", text: "Made it." });
    expect((await runRoute.POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ scheduleId: "nope" }) })).status).toBe(404);
  });

  it("a run whose chat is deleted doesn't stay 'running'", async () => {
    const s = sched.createSchedule({ ...base, title: "Deleted chat", rule: { kind: "daily", time: "09:00" } }, T("2026-10-27T08:00:00Z"));
    // A run the server lost track of (it restarted mid-run): stored as running.
    const t = agent.createThread({ engine: "cloud", agent: "offline", scheduleId: s.id });
    db().prepare("UPDATE assist_schedules SET last_thread_id = ?, last_status = 'running', last_text = 'Working…', last_run_at = ? WHERE id = ?").run(t.id, T("2026-10-27T09:00:00Z"), s.id);
    agent.deleteThread(t.id);
    expect(sched.getSchedule(s.id)!.last).toEqual({ threadId: null, status: "failed", text: "Its chat was deleted" });
    // A finished run whose chat is deleted keeps what it reported, without the link.
    const begun = await sched.startSchedule(s.id, { model: scripted().call });
    await begun.done;
    agent.deleteThread(begun.threadId!);
    expect(sched.getSchedule(s.id)!.last).toEqual({ threadId: null, status: "done", text: "Done — your ad is rendering." });
  });

  it("an edit that leaves the timing alone keeps a due run; a new time or zone doesn't", async () => {
    const s = sched.createSchedule({ ...base, title: "Due", rule: { kind: "daily", time: "09:00" } }, T("2026-10-27T08:00:00Z"));
    // Renamed at 09:00:10, before the sweep at 09:00:30: the 09:00 run still happens.
    expect(sched.updateSchedule(s.id, { title: "Due (renamed)", prompt: "A new prompt" }, T("2026-10-27T09:00:10Z"))!.nextRunAt).toBe(T("2026-10-27T09:00:00Z"));
    expect(await sched.sweepSchedules(T("2026-10-27T09:00:30Z"), { model: scripted().call })).toHaveLength(1);
    expect(sched.getSchedule(s.id)!.nextRunAt).toBe(T("2026-10-28T09:00:00Z"));
    // A new time is counted from now.
    expect(sched.updateSchedule(s.id, { rule: { kind: "daily", time: "10:00" } }, T("2026-10-27T09:30:00Z"))!.nextRunAt).toBe(T("2026-10-27T10:00:00Z"));
    expect(sched.updateSchedule(s.id, { tz: "Europe/Berlin" }, T("2026-10-27T09:30:00Z"))!.nextRunAt).toBe(T("2026-10-28T09:00:00Z"));
  });

  it("the runner started at boot sweeps a few seconds in, then every 30 s", () => {
    vi.useFakeTimers();
    const stub = globalThis.__fuobeScheduleRunner;
    globalThis.__fuobeScheduleRunner = undefined;
    try {
      sched.ensureScheduleRunner({ soon: true });
      const runner = globalThis.__fuobeScheduleRunner!;
      const ticks = vi.fn();
      runner.tick = ticks;
      vi.advanceTimersByTime(5_000);
      expect(ticks).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(25_000);
      expect(ticks).toHaveBeenCalledTimes(2);
      // A second call (a hot reload) keeps the one timer.
      sched.ensureScheduleRunner({ soon: true });
      expect(globalThis.__fuobeScheduleRunner).toBe(runner);
      clearInterval(runner.timer);
    } finally {
      globalThis.__fuobeScheduleRunner = stub;
      vi.useRealTimers();
    }
  });
});

describe("approval and the cost cap", () => {
  it("ask first: the plan waits as an approval card, and nothing runs", async () => {
    const s = sched.createSchedule({ ...base, title: "Ask", rule: { kind: "daily", time: "09:00" } }, T("2026-10-27T08:00:00Z"));
    const [id] = await sched.sweepSchedules(T("2026-10-27T09:00:00Z"), { model: scripted("A perfume ad").call });
    const t = threadOf(id);
    expect(t.status).toBe("waiting");
    expect(t.items.filter((i) => i.role === "approval")).toHaveLength(1);
    expect(t.items.some((i) => i.role === "generations")).toBe(false);
    expect(sched.getSchedule(s.id)!.last).toMatchObject({ threadId: id, status: "waiting", text: expect.stringMatching(/^A plan waits for your approval/) });
    // Approving it later shows in the task's last result.
    await agent.answerApproval(id, true);
    await agent.run(id, scripted().call);
    expect(sched.getSchedule(s.id)!.last).toMatchObject({ status: "done", text: "Started 1 result" });
  });

  it("auto-run: a plan within the cap starts on its own (demo runs cost nothing)", async () => {
    const s = sched.createSchedule({ ...base, title: "Auto", approval: "auto", capUsd: 0, rule: { kind: "daily", time: "09:00" } }, T("2026-10-27T08:00:00Z"));
    const [id] = await sched.sweepSchedules(T("2026-10-27T09:00:00Z"), { model: scripted("A perfume ad").call });
    const t = threadOf(id);
    expect(t).toMatchObject({ status: "idle", autoApprove: true, capUsd: 0, spentUsd: 0 });
    expect(t.items.some((i) => i.role === "approval")).toBe(false);
    expect(t.items.filter((i) => i.role === "generations")).toHaveLength(1);
    expect(t.items[0]).toMatchObject({ text: expect.stringMatching(/only free plans run on their own/) });
    expect(sched.getSchedule(s.id)!.last).toMatchObject({ status: "done" });
  });

  it("auto-run: what fits runs and counts against the cap; the plan that would pass it waits, with the reason", async () => {
    setSetting("falKey", "fal-test-key");
    const realFetch = globalThis.fetch;
    // The paid job that fits is queued for fal; no request may leave this test.
    globalThis.fetch = (async () => new Response("offline", { status: 503 })) as typeof fetch;
    try {
      const price = spendOf(tools.planFor("generate", job("x"), { engine: "cloud" }).jobs)!;
      expect(price).toBeGreaterThan(0);
      const cap = Math.round(price * 1.5 * 100) / 100;
      const s = sched.createSchedule({ ...base, title: "Capped", approval: "auto", capUsd: cap, rule: { kind: "daily", time: "09:00" } }, T("2026-10-27T08:00:00Z"));
      const m = scripted("First ad", "Second ad");
      const [id] = await sched.sweepSchedules(T("2026-10-27T09:00:00Z"), { model: m.call });
      const t = threadOf(id);
      expect(m.seen[0].system).toMatch(new RegExp(`Auto-run is on up to \\$${cap.toFixed(2)}`));
      expect(t).toMatchObject({ status: "waiting", spentUsd: price, capUsd: cap });
      expect(t.items.filter((i) => i.role === "generations")).toHaveLength(1);
      const card = t.items.find((i) => i.role === "approval");
      expect(card).toMatchObject({ status: "pending", summary: "Second ad" });
      const left = (cap - price).toFixed(2);
      expect(t.items.at(-1)).toMatchObject({ role: "notice", text: `Waiting for you: it costs about $${price.toFixed(2)} and this run has $${left} left of its $${cap.toFixed(2)} cap. Auto-run only starts what fits the cap.` });
      expect(sched.getSchedule(s.id)!.last).toMatchObject({ status: "waiting" });
    } finally {
      globalThis.fetch = realFetch;
      db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
    }
  });

  it("an ordinary chat with auto-run on has no cap", async () => {
    setSetting("falKey", "fal-test-key");
    const t = agent.createThread({ engine: "cloud", agent: "offline", autoApprove: true });
    expect(threadOf(t.id).capUsd).toBeUndefined();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("offline", { status: 503 })) as typeof fetch;
    try {
      agent.addMessage(t.id, "go");
      await agent.run(t.id, scripted("One", "Two").call);
      expect(threadOf(t.id).items.filter((i) => i.role === "generations")).toHaveLength(2);
      expect(threadOf(t.id).items.some((i) => i.role === "approval")).toBe(false);
    } finally {
      globalThis.fetch = realFetch;
      db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
    }
  });
});

describe("connectors in scheduled runs", () => {
  afterEach(() => {
    setSetting("anthropicKey", "");
    for (const c of connectors.listConnectors()) connectors.deleteConnector(c.id);
  });

  it("are off unless the task allows them; when on, Claude is told they run without asking", async () => {
    setSetting("anthropicKey", "sk-ant-test");
    connectors.createConnector({ name: "Slack", url: "https://mcp.slack.example.com/mcp", token: "xoxb-0123456789abcdefghij" });
    const off = sched.createSchedule({ ...base, title: "No connectors", mode: { mode: "smart" }, rule: { kind: "daily", time: "09:00" } }, T("2026-10-27T08:00:00Z"));
    const m1 = scripted();
    const [a] = await sched.sweepSchedules(T("2026-10-27T09:00:00Z"), { model: m1.call });
    expect(threadOf(a).agent).toBe("claude");
    expect(m1.seen[0].connectors).toBeUndefined();
    expect(m1.seen[0].system).not.toMatch(/Connected apps/);
    expect(threadOf(a).items[0]).toMatchObject({ text: expect.not.stringMatching(/connectors on/) });
    sched.deleteSchedule(off.id);

    const on = sched.createSchedule({ ...base, title: "With Slack", mode: { mode: "smart" }, connectors: true, rule: { kind: "daily", time: "09:00" } }, T("2026-10-27T08:00:00Z"));
    expect(on.connectors).toBe(true);
    const m2 = scripted();
    const [b] = await sched.sweepSchedules(T("2026-10-27T09:00:00Z"), { model: m2.call });
    expect(m2.seen[0].connectors).toEqual(["slack"]);
    expect(m2.seen[0].system).toMatch(/Connected apps \(custom MCP connectors\): Slack\. Their tools run the moment you call them/);
    // Ask first: nothing that depends on unapproved results goes out.
    expect(m2.seen[0].system).toMatch(/plans here wait for the user's approval/);
    expect(threadOf(b).items[0]).toMatchObject({ text: expect.stringMatching(/connectors on \(their tools run without asking\)/) });
    // Turning it off again applies to the next run.
    expect(sched.updateSchedule(on.id, { connectors: false })!.connectors).toBe(false);
  });

  it("an ordinary Claude chat in Ask first is told to check before a connector changes anything", async () => {
    setSetting("anthropicKey", "sk-ant-test");
    connectors.createConnector({ name: "Linear", url: "https://mcp.linear.example.com/mcp" });
    const t = agent.createThread({ engine: "cloud", agent: "claude", mode: "smart" });
    agent.addMessage(t.id, "What's on my board?");
    const m = scripted();
    await agent.run(t.id, m.call);
    expect(m.seen[0].connectors).toEqual(["linear"]);
    expect(m.seen[0].system).toMatch(/approval cards and the cost cap don't cover them/);
    expect(m.seen[0].system).toMatch(/say what you'll do and wait for the user's OK in chat/);
  });
});
