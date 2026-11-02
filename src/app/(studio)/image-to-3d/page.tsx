import fs from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { Model3dStudio, type Model3dInfo } from "@/components/model3d/model3d-studio";
import { ALL_MODELS_3D, CLOUD_NOTICES, RIG_MODEL } from "@/lib/av/model3d";
import { HI3D_MODEL } from "@/lib/av/hi3d";
import { getModel } from "@/lib/catalog";
import type { Manifest } from "@/lib/comfy";
import { buildLicenceList, FLAG_LABEL } from "@/lib/licences";

export const metadata: Metadata = { title: "Image to 3D" };

/** The open text-to-3D route draws its still with this workflow before TRELLIS.2 (src/server/chains.ts). */
const EXTRA_WORKFLOWS: Record<string, string[]> = { "oss-text-trellis2": ["qwen-image-21-t2i"] };

/** The licence the picker shows for each open model: its short name, its catches and the notices it needs. */
async function readLicences(): Promise<Record<string, NonNullable<Model3dInfo["licence"]>>> {
  "use cache";
  let workflows: Manifest["workflows"] = [];
  try {
    workflows = (JSON.parse(await fs.readFile(path.join(process.cwd(), "workflows", "comfyui", "manifest.json"), "utf8")) as Manifest).workflows;
  } catch {
    return {};
  }
  const models = [...ALL_MODELS_3D, { id: HI3D_MODEL }].flatMap((c) => {
    const m = getModel(c.id);
    return m?.engine === "open" ? [m] : [];
  });
  const list = buildLicenceList(
    models.map((m) => ({
      id: m.id,
      name: m.name,
      vendor: m.vendor,
      kind: m.kind,
      routes: [...m.routes.map((r) => ({ provider: r.provider, endpoint: r.endpoint })), ...(EXTRA_WORKFLOWS[m.id] ?? []).map((endpoint) => ({ provider: "comfyui" as const, endpoint }))],
    })),
    workflows.map((w) => ({ id: w.id, title: w.title, capability: w.capability, license: w.license })),
  );
  return Object.fromEntries(
    list.rows
      .filter((r) => r.inCatalog)
      .map((r) => [
        r.id,
        {
          // "MIT (TRELLIS.2 weights, …); the …" → "MIT"; a chain's licences joined.
          name: [...new Set(r.licences.map((l) => l.split(/[(;]/)[0].trim()))].join(" + "),
          flags: r.flags.map((f) => (f === "territory" && r.excludes ? `Not in ${r.excludes}` : FLAG_LABEL[f])),
          notices: r.notices,
        },
      ]),
  );
}

/** The page passes the 3D models' names and licences, so the client doesn't load the catalog. */
export default async function Page() {
  const licences = await readLicences();
  const info: Record<string, Model3dInfo> = Object.fromEntries(
    [...ALL_MODELS_3D.map((m) => m.id), RIG_MODEL, HI3D_MODEL].map((id) => [
      id,
      { name: getModel(id)?.name ?? id, notices: licences[id]?.notices ?? CLOUD_NOTICES[id] ?? [], ...(licences[id] && { licence: licences[id] }) },
    ]),
  );
  return <Model3dStudio info={info} />;
}
