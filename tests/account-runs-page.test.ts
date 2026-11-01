import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { playsClip, runFiles, runFilters } from "@/components/account-runs";
import { runsHref } from "@/components/accounts-admin";
import type { Generation, OutputFile } from "@/lib/catalog/types";

const src = (f: string) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

/** A run's fields the tiles read: `outputs` of `kind`, made by `op`. */
function made(kind: Generation["kind"], outputs: Partial<OutputFile>[], op = "t2i", params: Record<string, unknown> = {}) {
  return {
    kind,
    op,
    request: { feature: "image", modelId: "m", params },
    outputs: outputs.map((o, i) => ({ url: `/api/files/outputs/2026-10-31/f${i}.png`, kind: "image", ...o }) as OutputFile),
  } as Pick<Generation, "kind" | "op" | "request" | "outputs">;
}

describe("Settings → Accounts' runs: the page", () => {
  it("keeps the account, status and kind in the address", () => {
    expect(runsHref()).toBe("/settings/runs");
    expect(runsHref({ account: "a1" })).toBe("/settings/runs?account=a1");
    expect(runsHref({ account: "a1", status: "failed", kind: "video" })).toBe("/settings/runs?account=a1&status=failed&kind=video");
    expect(runsHref({ status: "all", kind: "all" })).toBe("/settings/runs");
    expect(runsHref({ account: "a b&c" })).toBe("/settings/runs?account=a+b%26c");
    expect(runFilters(new URLSearchParams("status=failed&kind=model3d"))).toEqual({ status: "failed", kind: "model3d" });
    expect(runFilters(new URLSearchParams("status=sideways&kind=hologram"))).toEqual({ status: "all", kind: "all" });
    expect(runFilters(new URLSearchParams())).toEqual({ status: "all", kind: "all" });
    const back = new URL(runsHref({ account: "a1", status: "running", kind: "audio" }), "http://localhost").searchParams;
    expect(runFilters(back)).toEqual({ status: "running", kind: "audio" });
    // Another account is a new page (Back returns to the one before); a filter changes this one.
    const page = src("src/components/account-runs.tsx");
    expect(page).toMatch(/if \("account" in to\) router\.push\(href/);
  });

  it("opens every file a run shows, and leaves a 3D model's turntable out of the count", () => {
    expect(runFiles(made("image", [{}, {}]))).toEqual([
      { index: 0, url: "/api/files/outputs/2026-10-31/f0.png", label: "Open file 1 of 2" },
      { index: 1, url: "/api/files/outputs/2026-10-31/f1.png", label: "Open file 2 of 2" },
    ]);
    expect(runFiles(made("image", [{}])).map((f) => f.label)).toEqual(["Open file"]);
    const model = made("model3d", [{ url: "/api/files/outputs/m.glb", kind: "model3d" }, { url: "/api/files/outputs/t.mp4", kind: "video" }], "image-to-3d");
    expect(runFiles(model)).toEqual([{ index: 0, url: "/api/files/outputs/m.glb", label: "Open file" }]);
    expect(runFiles(made("image", []))).toEqual([]);
  });

  it("plays a clip from the keyboard as well as with a tap", () => {
    const clip = made("video", [{ url: "/api/files/outputs/c.mp4", kind: "video" }], "t2v");
    expect(playsClip(clip, clip.outputs[0])).toBe(true);
    const prores = made("video", [{ url: "/api/files/outputs/c.mov", kind: "video" }], "export-video", { format: "prores_422_hq" });
    expect(playsClip(prores, prores.outputs[0])).toBe(false);
    const model = made("model3d", [{ url: "/api/files/outputs/m.glb", kind: "model3d" }, { url: "/api/files/outputs/t.mp4", kind: "video" }], "image-to-3d");
    expect(playsClip(model, model.outputs[0])).toBe(true);
    const bare = made("model3d", [{ url: "/api/files/outputs/m.glb", kind: "model3d" }], "image-to-3d");
    expect(playsClip(bare, bare.outputs[0])).toBe(false);
    expect(playsClip(made("image", [{}]), made("image", [{}]).outputs[0])).toBe(false);
    expect(playsClip(clip, undefined)).toBe(false);
    // The clip's box is a button that takes focus, and Enter or Space plays or pauses it.
    const page = src("src/components/account-runs.tsx");
    expect(page).toMatch(/role=\{clip \? "button" : undefined\}\s+tabIndex=\{clip \? 0 : undefined\}/);
    expect(page).toMatch(/e\.key !== "Enter" && e\.key !== " "/);
  });

  it("keeps Settings → Accounts in reach: its row actions in view, and ways down to it", () => {
    const admin = src("src/components/accounts-admin.tsx");
    // The actions cell sticks to the table's right edge; Created and Last login wait for wide screens.
    expect(admin).toMatch(/<th className="sticky right-0 bg-background /);
    expect(admin).toMatch(/<td className="sticky right-0 bg-background /);
    expect(admin.match(/max-2xl:hidden/g)).toHaveLength(4);
    // /settings#accounts lands on the section once its list is here.
    expect(admin).toMatch(/useAccountsAnchor\(!!q\.data\)/);
    // The strip at the top of Settings and the Public sign-up switch lead to it.
    expect(src("src/components/settings-form.tsx")).toMatch(/<AccountsChip \/>/);
    expect(src("src/components/security-settings.tsx")).toMatch(/<a href="#accounts"/);
  });
});
