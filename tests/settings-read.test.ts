import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/settings answers only the studio's owner, so the hooks that read it ask only once the page knows the
// owner is looking: a guest's or an account's page (Home's guide, the connect dialog) never asks and never logs a 401.

const state = vi.hoisted(() => ({ viewer: undefined as undefined | { owner: boolean; signedIn: boolean; publicSignup: boolean }, asked: [] as { enabled?: boolean }[] }));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (o: { enabled?: boolean }) => {
    state.asked.push(o);
    return { data: undefined };
  },
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  useViewer: () => ({ data: state.viewer }),
}));

const { useAllowPrivate, useSettings } = await import("@/components/connect-field");

const enabled = (hook: () => unknown) => {
  state.asked.length = 0;
  hook();
  return state.asked.map((o) => o.enabled);
};

describe("the settings hooks", () => {
  beforeEach(() => {
    state.viewer = undefined;
  });

  it("wait while the page doesn't yet know who is looking", () => {
    expect(enabled(() => useSettings())).toEqual([false]);
    expect(enabled(() => useAllowPrivate())).toEqual([false]);
  });

  it("never ask for a guest or an account", () => {
    for (const viewer of [
      { owner: false, signedIn: false, publicSignup: true },
      { owner: false, signedIn: true, publicSignup: true },
    ]) {
      state.viewer = viewer;
      expect(enabled(() => useSettings())).toEqual([false]);
      expect(enabled(() => useAllowPrivate())).toEqual([false]);
    }
  });

  it("ask for the owner, unless the caller waits", () => {
    state.viewer = { owner: true, signedIn: true, publicSignup: true };
    expect(enabled(() => useSettings())).toEqual([true]);
    expect(enabled(() => useAllowPrivate())).toEqual([true]);
    expect(enabled(() => useSettings(false))).toEqual([false]);
    expect(enabled(() => useAllowPrivate(false))).toEqual([false]);
  });
});
