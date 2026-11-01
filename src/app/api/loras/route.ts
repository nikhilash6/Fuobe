import { connection } from "next/server";
import { LORA_LIBRARY, LORA_LIBRARY_AS_OF } from "@/lib/catalog/lora-library.generated";
import { licenceLine } from "@/lib/catalog/loras";
import { downloadToComfy, filesInLoraFolder, listLoraCopies, LoraError } from "@/server/loras";
import { getSetting } from "@/server/settings";

/**
 * The LoRA library for Settings → LoRAs: every researched LoRA with its licence, where it downloads from,
 * whether it is in the LoRA folder and where Fuobe mirrored it. Keys are never in the answer.
 */
export async function GET() {
  await connection();
  const folder = getSetting("comfyLorasDir");
  // A folder setting that can't be read (a file, no permission) is said, not a 500.
  const { files: inFolder, problem } = filesInLoraFolder();
  const mirrored = new Map<string, string[]>();
  for (const c of listLoraCopies()) if (c.target !== "comfyui") mirrored.set(c.file, [...(mirrored.get(c.file) ?? []), c.target]);
  return Response.json({
    asOf: LORA_LIBRARY_AS_OF,
    folder: folder || null,
    ...(problem && { folderProblem: problem }),
    civitaiKey: !!getSetting("civitaiKey"),
    loras: LORA_LIBRARY.map((e) => ({
      key: e.key,
      name: e.name,
      file: e.file,
      group: e.group,
      base: e.base,
      ...(e.target && e.target !== "both" && { target: e.target }),
      page: e.page,
      download: e.download,
      licence: licenceLine(e.licence),
      commercial: e.licence.commercial,
      hostedOk: e.licence.hostedOk,
      spare: !!e.spare,
      inFolder: inFolder.has(e.file),
      mirrored: mirrored.get(e.file) ?? [],
    })),
  });
}

/** Download one library LoRA into the LoRA folder now (`{ file }`), instead of before the first run that needs it. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { file?: unknown };
  if (typeof body.file !== "string" || !body.file) return Response.json({ error: "Say which LoRA to download" }, { status: 400 });
  try {
    const copy = await downloadToComfy(body.file);
    return Response.json({ file: copy.file, sizeBytes: copy.sizeBytes, sha256: copy.sha256 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof LoraError ? 422 : 500 });
  }
}
