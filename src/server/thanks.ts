import "server-only";
import fs from "node:fs";
import path from "node:path";
import { CLOUD_NOTICES } from "@/lib/av/model3d";
import { MODELS } from "@/lib/catalog";
import type { Manifest } from "@/lib/comfy";
import { loraLicenceRows } from "@/lib/lora-licences";
import { buildThanks, packageFacts, type Thanks, type ThanksPackage } from "@/lib/thanks";

/**
 * Thanks & licences' data: the catalog, the ComfyUI manifest, every LoRA, and the packages the app ships with (their own
 * package.json). Synchronous reads of files that only change with a deploy, so the page is prerendered with them.
 */
export function readThanks(root = process.cwd()): Thanks {
  const read = (p: string): unknown => {
    try {
      return JSON.parse(fs.readFileSync(path.join(/*turbopackIgnore: true*/ root, p), "utf8"));
    } catch {
      return undefined;
    }
  };
  const manifest = read("workflows/comfyui/manifest.json") as Manifest | undefined;
  const deps = Object.keys((read("package.json") as { dependencies?: Record<string, string> } | undefined)?.dependencies ?? {});
  const packages: ThanksPackage[] = deps.map((name) => ({ name, ...packageFacts((read(`node_modules/${name}/package.json`) as Parameters<typeof packageFacts>[0] | undefined) ?? {}) }));
  return buildThanks({
    models: MODELS.map((m) => ({ id: m.id, name: m.name, vendor: m.vendor, kind: m.kind, tagline: m.tagline, hidden: m.hidden, routes: m.routes.map((r) => ({ provider: r.provider, endpoint: r.endpoint })) })),
    workflows: (manifest?.workflows ?? []).map((w) => ({ id: w.id, title: w.title, capability: w.capability, license: w.license, models: (w.models ?? []).map((x) => ({ url: x.url, sizeGb: x.sizeGb })), packs: (w.customNodes ?? []).map((n) => n.name) })),
    loras: loraLicenceRows(),
    packages,
    cloudCredits: CLOUD_NOTICES,
  });
}
