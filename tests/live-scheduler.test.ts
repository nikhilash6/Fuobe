/**
 * Live edit's scheduler (src/lib/live/scheduler.ts), with a stand-in transport: the cases of the reference live
 * server's session (newest only per slot, keeps first and never cancelled by typing, urgent preempts an older running
 * live render, hurry), and settle and warm.
 */
import { describe, expect, it } from "vitest";
import { LiveScheduler, type LiveJob, type Outcome, type Slot } from "@/lib/live/scheduler";

interface Run {
  job: LiveJob<string>;
  signal: AbortSignal;
  finish: () => void;
  aborted: boolean;
}

function harness() {
  const runs: Run[] = [];
  const s = new LiveScheduler<string, string>({
    run: (job, signal) =>
      new Promise<string>((resolve, reject) => {
        const r: Run = { job, signal, finish: () => resolve(`pic:${job.payload}`), aborted: false };
        signal.addEventListener("abort", () => {
          r.aborted = true;
          // The transport learns ComfyUI stopped it a moment later.
          queueMicrotask(() => reject(new Error("interrupted")));
        });
        runs.push(r);
      }),
  });
  let seq = 0;
  const submit = (slot: Slot, text: string, urgent = false) => {
    const job = { seq: ++seq, slot, key: text, urgent, payload: text };
    return { job, p: s.submit(job) };
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { s, runs, submit, tick };
}

const outcome = (o: Outcome<string>) => ("result" in o ? o.result : "dropped" in o ? `dropped:${o.dropped}` : `error:${o.error}`);

describe("live scheduler", () => {
  it("keeps only the newest live request waiting", async () => {
    const { runs, submit, tick } = harness();
    const a = submit("live", "a");
    const b = submit("live", "b");
    const c = submit("live", "c");
    expect(runs.map((r) => r.job.payload)).toEqual(["a"]);
    expect(outcome(await b.p)).toBe("dropped:replaced");
    runs[0].finish();
    expect(outcome(await a.p)).toBe("pic:a");
    await tick();
    expect(runs.map((r) => r.job.payload)).toEqual(["a", "c"]);
    runs[1].finish();
    expect(outcome(await c.p)).toBe("pic:c");
  });

  it("runs keeps first, in order, and typing never cancels them", async () => {
    const { runs, submit, tick } = harness();
    const live = submit("live", "a");
    const k1 = submit("keep", "k1");
    const k2 = submit("keep", "k2");
    submit("live", "b", true);
    submit("live", "c", true);
    // The running live render of other text was superseded by the urgent one.
    expect(outcome(await live.p)).toBe("dropped:superseded");
    await tick();
    expect(runs[1].job.payload).toBe("k1");
    // An urgent live request doesn't stop a keep.
    submit("live", "d", true);
    expect(runs[1].aborted).toBe(false);
    runs[1].finish();
    expect(outcome(await k1.p)).toBe("pic:k1");
    await tick();
    expect(runs[2].job.payload).toBe("k2");
    runs[2].finish();
    await k2.p;
    await tick();
    expect(runs[3].job.payload).toBe("d");
  });

  it("an urgent request doesn't stop a running render of the same text", async () => {
    const { runs, submit } = harness();
    submit("live", "same");
    submit("live", "same", true);
    expect(runs[0].aborted).toBe(false);
  });

  it("hurry stops the running render for a waiting one", async () => {
    const { s, runs, submit, tick } = harness();
    const a = submit("live", "a");
    const b = submit("live", "b");
    expect(runs[0].aborted).toBe(false);
    s.hurry(b.job.seq);
    expect(outcome(await a.p)).toBe("dropped:superseded");
    await tick();
    expect(runs[1].job.payload).toBe("b");
    // hurry of a seq that isn't waiting changes nothing.
    s.hurry(999);
    expect(runs[1].aborted).toBe(false);
  });

  it("any live request cancels the settle render, waiting or running", async () => {
    const { runs, submit, tick } = harness();
    const settle = submit("settle", "a");
    expect(runs[0].job.slot).toBe("settle");
    const live = submit("live", "b");
    expect(outcome(await settle.p)).toBe("dropped:superseded");
    await tick();
    expect(runs[1].job.payload).toBe("b");
    const s2 = submit("settle", "b");
    submit("live", "c");
    expect(outcome(await s2.p)).toBe("dropped:replaced");
    runs[1].finish();
    expect(outcome(await live.p)).toBe("pic:b");
  });

  it("warm runs only when nothing else waits", async () => {
    const { runs, submit, tick } = harness();
    submit("live", "a");
    submit("warm", "w");
    submit("settle", "s");
    runs[0].finish();
    await tick();
    await tick();
    expect(runs[1].job.slot).toBe("settle");
    runs[1].finish();
    await tick();
    await tick();
    expect(runs[2].job.slot).toBe("warm");
  });

  it("only one render of ours runs at a time", async () => {
    const { runs, submit, tick } = harness();
    for (let i = 0; i < 5; i++) submit(i % 2 ? "keep" : "live", `x${i}`);
    await tick();
    expect(runs.filter((r) => !r.aborted)).toHaveLength(1);
  });

  it("waits while paused (newest only) and drops a late, older request", async () => {
    const { s, runs, submit, tick } = harness();
    s.pause();
    const a = submit("live", "a");
    const b = submit("live", "b");
    expect(runs).toHaveLength(0);
    expect(outcome(await a.p)).toBe("dropped:replaced");
    s.resume();
    expect(runs.map((r) => r.job.payload)).toEqual(["b"]);
    // A request with an older seq than one already waiting in its slot is dropped.
    const c = submit("live", "c");
    const late = s.submit({ seq: c.job.seq - 1, slot: "live", key: "late", payload: "late" });
    expect(outcome(await late)).toBe("dropped:replaced");
    runs[0].finish();
    await b.p;
    await tick();
  });

  it("cancel and close drop what matches and stop what runs", async () => {
    const { s, runs, submit } = harness();
    const a = submit("live", "a");
    const k = submit("keep", "k");
    s.cancel((j) => j.slot === "live");
    expect(outcome(await a.p)).toBe("dropped:cancelled");
    expect(runs[0].aborted).toBe(true);
    s.close();
    expect(outcome(await k.p)).toBe("dropped:closed");
    expect(outcome(await s.submit({ seq: 99, slot: "live", key: "z", payload: "z" }))).toBe("dropped:closed");
  });

  it("a failed render is an error, not a drop", async () => {
    const s = new LiveScheduler<string, string>({ run: () => Promise.reject(new Error("out of memory")) });
    expect(outcome(await s.submit({ seq: 1, slot: "live", key: "a", payload: "a" }))).toBe("error:out of memory");
  });
});
