import { describe, expect, it } from "vitest";
import { startFakeBilling, startFakeModeration } from "./helpers/fake-billing";

describe("the stand-in billing and moderation services", () => {
  it("each listen on a free high port of their own, however many run at once, and never on the fixed test ports", async () => {
    // More at once than the ten ports the stand-ins once shared, as many test files running together start them.
    const started = await Promise.all([...Array.from({ length: 12 }, () => startFakeBilling()), ...Array.from({ length: 4 }, () => startFakeModeration())]);
    try {
      const ports = started.map((s) => s.port);
      expect(new Set(ports).size).toBe(ports.length);
      for (const p of ports) {
        // Never the ports the worker's end-to-end check listens on, nor the range the worker's stand-in ComfyUI takes.
        expect(p < 3360 || p > 3399, String(p)).toBe(true);
        expect(p).toBeGreaterThan(1024);
      }
      // Each answers on its own port.
      const health = await Promise.all(started.slice(0, 12).map((s) => fetch(`${s.url}/v1/health`, { headers: { authorization: "Bearer test-billing-token" } }).then((r) => r.status)));
      expect(health.every((s) => s === 200)).toBe(true);
    } finally {
      await Promise.all(started.map((s) => s.close()));
    }
  });
});
