import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

/**
 * What people read when a run fails (settings.ts runFailureDetail) on each kind of data folder: a new install starts
 * with the full details; a data folder an earlier build made keeps the friendly sentence only, saved before anything
 * reads it, and that choice (or the owner's later one) stays through every restart and update.
 */

const dir = tempDir("fuobe-failure-detail-install-");
process.env.FUOBE_DATA_DIR = dir;
delete process.env.FUOBE_RUN_FAILURE_DETAIL;
const file = path.join(dir, "fuobe.db");

const { db, MIGRATIONS, FAILURE_DETAIL_CHOSEN } = await import("@/server/db");
const { getSetting, runFailureDetail, setSetting } = await import("@/server/settings");

/** The server stops and starts again on the same data folder (a restart, or a deploy of a newer build). */
function restart() {
  globalThis.__fuobeDb?.close();
  globalThis.__fuobeDb = undefined;
}
const saved = () => (db().prepare("SELECT value FROM settings WHERE key = 'runs.failureDetail'").get() as { value: string } | undefined)?.value;

afterEach(() => {
  restart();
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
  delete process.env.FUOBE_RUN_FAILURE_DETAIL;
});

/** A data folder an earlier build made and used: its migrations, a run and a setting, and no choice made yet. */
function earlierInstall() {
  const d = new Database(file);
  d.exec("CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY)");
  MIGRATIONS.forEach((sql, i) => {
    d.exec(sql);
    d.prepare("INSERT INTO _migrations (id) VALUES (?)").run(i);
  });
  d.prepare("INSERT INTO settings (key, value) VALUES ('comfyui.where', 'workers')").run();
  d.close();
}

describe("what people read when a run fails, by data folder", () => {
  it("a new install shows the full details, and keeps them through restarts", () => {
    expect(runFailureDetail()).toBe("full");
    expect(saved()).toBeUndefined();
    expect(db().prepare("SELECT value FROM settings WHERE key = ?").get(FAILURE_DETAIL_CHOSEN)).toEqual({ value: "1" });
    for (let i = 0; i < 3; i++) {
      restart();
      expect(runFailureDetail()).toBe("full");
    }
  });

  it("an install an earlier build made keeps the friendly sentence, saved at its first start on this build", () => {
    earlierInstall();
    // Its first read already finds it saved: no request is ever served with the details on.
    expect(runFailureDetail()).toBe("friendly");
    expect(saved()).toBe("friendly");
    // Deploy after deploy, and with the environment saying otherwise, it stays.
    process.env.FUOBE_RUN_FAILURE_DETAIL = "full";
    for (let i = 0; i < 3; i++) {
      restart();
      expect(runFailureDetail()).toBe("friendly");
    }
    expect(getSetting("comfyWhere")).toBe("workers");
  });

  it("the owner's choice stays through restarts, either way: the first start's choice is made once only", () => {
    earlierInstall();
    expect(runFailureDetail()).toBe("friendly");
    setSetting("runFailureDetail", "full");
    restart();
    expect(runFailureDetail()).toBe("full");
    setSetting("runFailureDetail", "friendly");
    restart();
    expect(runFailureDetail()).toBe("friendly");
    // Even a cleared value isn't set again by a later start: the default (full) is then the owner's to have.
    setSetting("runFailureDetail", "");
    restart();
    expect(runFailureDetail()).toBe("full");
  });

  it("a value that isn't one of the two reads as the default, and can't be saved", () => {
    db().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('runs.failureDetail', 'everything')").run();
    expect(runFailureDetail()).toBe("full");
    expect(() => setSetting("runFailureDetail", "raw")).toThrow(/full, friendly/);
  });
});
