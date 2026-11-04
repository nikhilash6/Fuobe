import { describe, expect, it } from "vitest";
import {
  describeRule,
  formatWhen,
  nextRun,
  ruleError,
  spendOf,
  untilText,
  validTimeZone,
  wallClock,
  withinCap,
  zonedToUtc,
  type ScheduleRule,
} from "@/lib/assist-schedule";

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const at = (s: string) => Date.parse(s);
const NY = "America/New_York";
const BERLIN = "Europe/Berlin";

describe("zonedToUtc", () => {
  it("reads a wall-clock time in a zone, both sides of a clock change", () => {
    expect(iso(zonedToUtc(2026, 7, 1, 9, 0, BERLIN))).toBe("2026-07-01T07:00:00.000Z");
    expect(iso(zonedToUtc(2026, 12, 1, 9, 0, BERLIN))).toBe("2026-12-01T08:00:00.000Z");
    expect(iso(zonedToUtc(2026, 1, 15, 23, 59, "UTC"))).toBe("2026-01-15T23:59:00.000Z");
    expect(iso(zonedToUtc(2026, 6, 1, 9, 0, "Asia/Kolkata"))).toBe("2026-06-01T03:30:00.000Z");
  });

  it("a time the spring-forward skips lands as much later as the clocks jumped", () => {
    // New York, 8 Mar 2026: 02:00 EST → 03:00 EDT. 02:30 doesn't exist: it's read as 03:30 EDT.
    const t = zonedToUtc(2026, 3, 8, 2, 30, NY);
    expect(iso(t)).toBe("2026-03-08T07:30:00.000Z");
    expect(wallClock(t, NY)).toMatchObject({ h: 3, mi: 30 });
  });

  it("a time the fall-back repeats is its first instant", () => {
    // New York, 1 Nov 2026: 01:30 happens at 05:30Z (EDT) and again at 06:30Z (EST).
    expect(iso(zonedToUtc(2026, 11, 1, 1, 30, NY))).toBe("2026-11-01T05:30:00.000Z");
    // Berlin, 25 Oct 2026: 02:30 happens at 00:30Z (CEST) and 01:30Z (CET).
    expect(iso(zonedToUtc(2026, 10, 25, 2, 30, BERLIN))).toBe("2026-10-25T00:30:00.000Z");
  });
});

describe("nextRun", () => {
  const daily = (time: string): ScheduleRule => ({ kind: "daily", time });

  it("a daily time keeps its wall-clock hour across the autumn change (the UTC hour moves)", () => {
    const rule = daily("09:00");
    const first = nextRun(rule, BERLIN, at("2026-10-23T10:00:00Z"))!;
    expect(iso(first)).toBe("2026-10-24T07:00:00.000Z"); // CEST
    const second = nextRun(rule, BERLIN, first)!;
    expect(iso(second)).toBe("2026-10-25T08:00:00.000Z"); // CET
    expect(wallClock(second, BERLIN)).toMatchObject({ d: 25, h: 9, mi: 0 });
  });

  it("a daily time in the skipped hour runs an hour later that day, then normally", () => {
    const rule = daily("02:30");
    const skipped = nextRun(rule, NY, at("2026-03-07T08:00:00Z"))!;
    expect(iso(skipped)).toBe("2026-03-08T07:30:00.000Z"); // 03:30 EDT
    expect(iso(nextRun(rule, NY, skipped))).toBe("2026-03-09T06:30:00.000Z"); // 02:30 EDT
  });

  it("a daily time in the repeated hour runs once, not twice", () => {
    const rule = daily("01:30");
    const first = nextRun(rule, NY, at("2026-10-31T12:00:00Z"))!;
    expect(iso(first)).toBe("2026-11-01T05:30:00.000Z");
    // From the first run, and from between the two 01:30s, the next is the next day.
    expect(iso(nextRun(rule, NY, first))).toBe("2026-11-02T06:30:00.000Z");
    expect(iso(nextRun(rule, NY, at("2026-11-01T06:00:00Z")))).toBe("2026-11-02T06:30:00.000Z");
  });

  it("strictly after: a run due right now moves to the next day", () => {
    expect(iso(nextRun(daily("09:00"), "UTC", at("2026-10-27T09:00:00Z")))).toBe("2026-10-28T09:00:00.000Z");
    expect(iso(nextRun(daily("09:00"), "UTC", at("2026-10-27T08:59:59Z")))).toBe("2026-10-27T09:00:00.000Z");
  });

  it("weekly picks the next listed weekday, across a month end and a clock change", () => {
    const rule: ScheduleRule = { kind: "weekly", days: [1, 4], time: "18:30" }; // Mondays and Thursdays
    // Tue 27 Oct 2026 → Thu 29 Oct.
    const thu = nextRun(rule, BERLIN, at("2026-10-27T12:00:00Z"))!;
    expect(iso(thu)).toBe("2026-10-29T17:30:00.000Z");
    expect(iso(nextRun(rule, BERLIN, thu))).toBe("2026-11-02T17:30:00.000Z");
    // Sunday only, from the Saturday before Berlin's autumn change.
    expect(iso(nextRun({ kind: "weekly", days: [0], time: "10:00" }, BERLIN, at("2026-10-24T12:00:00Z")))).toBe("2026-10-25T09:00:00.000Z");
  });

  it("every N hours counts real hours from when it was set up, whatever the clocks do", () => {
    const from = at("2026-10-24T22:00:00Z");
    const rule: ScheduleRule = { kind: "hours", every: 6, from };
    expect(iso(nextRun(rule, BERLIN, from - 1000))).toBe("2026-10-25T04:00:00.000Z");
    expect(iso(nextRun(rule, BERLIN, from + 3_600_000))).toBe("2026-10-25T04:00:00.000Z");
    expect(iso(nextRun(rule, BERLIN, at("2026-10-25T04:00:00Z")))).toBe("2026-10-25T10:00:00.000Z");
    // A server that was off for two days: the next slot from now, not the missed ones.
    expect(iso(nextRun(rule, BERLIN, at("2026-10-27T11:00:00Z")))).toBe("2026-10-27T16:00:00.000Z");
  });

  it("once runs at its time and then never again; a past time never runs", () => {
    const rule: ScheduleRule = { kind: "once", at: "2026-11-01T01:30" };
    const t = nextRun(rule, NY, at("2026-10-27T00:00:00Z"));
    expect(iso(t)).toBe("2026-11-01T05:30:00.000Z");
    expect(nextRun(rule, NY, t!)).toBeNull();
  });

  it("a broken rule or an unknown zone never runs", () => {
    expect(nextRun(daily("25:00"), "UTC", 0)).toBeNull();
    expect(nextRun(daily("09:00"), "Mars/Olympus", 0)).toBeNull();
    expect(nextRun({ kind: "weekly", days: [], time: "09:00" }, "UTC", 0)).toBeNull();
  });
});

describe("rules in words", () => {
  it("describes each kind", () => {
    expect(describeRule({ kind: "daily", time: "09:00" })).toBe("Every day at 09:00");
    expect(describeRule({ kind: "weekly", days: [4, 1], time: "18:30" })).toBe("Mondays and Thursdays at 18:30");
    expect(describeRule({ kind: "weekly", days: [1, 2, 3, 4, 5], time: "08:00" })).toBe("Weekdays at 08:00");
    expect(describeRule({ kind: "weekly", days: [6, 0], time: "10:00" })).toBe("Weekends at 10:00");
    expect(describeRule({ kind: "weekly", days: [0, 1, 2, 3, 4, 5, 6], time: "10:00" })).toBe("Every day at 10:00");
    expect(describeRule({ kind: "weekly", days: [0, 3, 5], time: "07:15" })).toBe("Wednesdays, Fridays and Sundays at 07:15");
    expect(describeRule({ kind: "hours", every: 1, from: 0 })).toBe("Every hour");
    expect(describeRule({ kind: "hours", every: 6, from: 0 })).toBe("Every 6 hours");
    expect(describeRule({ kind: "hours", every: 72, from: 0 })).toBe("Every 3 days");
    expect(describeRule({ kind: "once", at: "2026-10-30T14:00" })).toBe("Once, 30 Oct 2026 at 14:00");
  });

  it("says when, in the task's zone, and how long until", () => {
    expect(formatWhen(at("2026-10-25T08:00:00Z"), BERLIN)).toBe("Sun 25 Oct, 09:00");
    const now = at("2026-10-27T09:00:00Z");
    expect(untilText(now + 20_000, now)).toBe("now");
    expect(untilText(now + 25 * 60_000, now)).toBe("in 25 min");
    expect(untilText(now + 5 * 3_600_000, now)).toBe("in 5 h");
    expect(untilText(now + 4 * 86_400_000, now)).toBe("in 4 days");
  });

  it("checks rules and zones", () => {
    expect(ruleError({ kind: "daily", time: "9:00" })).toBe("Pick a time");
    expect(ruleError({ kind: "weekly", days: [7], time: "09:00" })).toBe("Pick at least one day");
    expect(ruleError({ kind: "hours", every: 0, from: 0 })).toMatch(/Every 1 to 168 hours/);
    expect(ruleError({ kind: "once", at: "2026-02-30T10:00" })).toBe("Pick a real date");
    expect(ruleError({ kind: "once", at: "2026-02-28T10:00" })).toBeNull();
    expect(validTimeZone("Europe/Berlin")).toBe(true);
    expect(validTimeZone("Europe/Nowhere")).toBe(false);
    expect(validTimeZone("")).toBe(false);
  });
});

describe("what a scheduled run may start on its own", () => {
  it("fits within the cap, or waits with the reason", () => {
    expect(withinCap(null, 50, 10)).toEqual({ ok: true });
    expect(withinCap(2, 0, 1.5)).toEqual({ ok: true });
    expect(withinCap(2, 1.5, 0.5)).toEqual({ ok: true });
    expect(withinCap(2, 1.5, 0.6)).toEqual({ ok: false, reason: "it costs about $0.60 and this run has $0.50 left of its $2.00 cap" });
    expect(withinCap(2, 0, null)).toEqual({ ok: false, reason: "its price isn't known in advance" });
    expect(withinCap(0, 0, 0)).toEqual({ ok: true });
  });

  it("counts only what really runs: demo jobs are free, broken jobs don't start", () => {
    expect(spendOf([{ costUsd: 0.15, demo: true }])).toBe(0);
    expect(spendOf([{ costUsd: 0.15, demo: false }, { costUsd: 0.5, demo: false }])).toBe(0.65);
    expect(spendOf([{ costUsd: null, demo: false }])).toBeNull();
    // A price guessed before an earlier step's result exists can't count against a cap.
    expect(spendOf([{ costUsd: 0.5, demo: false, estimate: true }])).toBeNull();
    expect(spendOf([{ costUsd: null, demo: false, error: "no input" }, { costUsd: 1, demo: false }])).toBe(1);
  });
});
