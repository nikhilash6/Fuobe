import { libraryEntry } from "@/lib/catalog/loras";
import type { LoraRef } from "@/lib/catalog/types";

/**
 * Files a run needs that the account's own ComfyUI doesn't have ("Your GPU"): what to download, and where to put it.
 * Fuobe never downloads anything onto an account's machine; it says what is missing and where each file comes from.
 * The shape is the pre-flight's fix (code "comfy_missing_model") with a download link on each item.
 */
export type MissingDownload = "direct" | "civitai-token" | "hf-gated";

export interface MissingFile {
  /** The ComfyUI models folder it goes in ("loras", "checkpoints"…). */
  folder: string;
  /** The file name, as the run loads it. */
  file: string;
  /** Where it downloads from. */
  url?: string;
  /** Its model card. */
  page?: string;
  download?: MissingDownload;
  sizeBytes?: number;
}

export interface MissingFiles {
  code: "comfy_missing_model";
  workflowId?: string;
  items: MissingFile[];
}

const slash = (f: string) => f.replace(/\\/g, "/");

/**
 * The LoRAs in `needs` that `listed` (the ComfyUI's GET /models/loras) doesn't have, by exact name ("\" read as "/").
 * Links come from Fuobe's LoRA library; a LoRA the run itself named may show the https link it gave. A private LoRA
 * (`own`) is never named.
 */
export function missingLoras(needs: LoraRef[], listed: string[]): MissingFile[] {
  const have = new Set(listed.map(slash));
  const out: MissingFile[] = [];
  const seen = new Set<string>();
  for (const l of needs) {
    if (!l.file || l.own || have.has(slash(l.file)) || seen.has(slash(l.file))) continue;
    seen.add(slash(l.file));
    const entry = libraryEntry(l);
    if (entry) {
      out.push({ folder: "loras", file: l.file, url: entry.url, page: entry.page, download: entry.download, ...(entry.sizeBytes && { sizeBytes: entry.sizeBytes }) });
      continue;
    }
    // A preset's own LoRA (the catalog names its link), or one the run itself named: its https link, and a Hugging
    // Face repo's page.
    const given = l.url && /^https:\/\//.test(l.url) ? l.url : undefined;
    const repo = given ? /^(https:\/\/huggingface\.co\/[^/]+\/[^/]+)\/resolve\//.exec(given)?.[1] : undefined;
    out.push({
      folder: "loras",
      file: l.file,
      ...(given && { url: given, download: /^https:\/\/civitai\.com\//.test(given) ? ("civitai-token" as const) : ("direct" as const) }),
      ...(repo && { page: repo }),
    });
  }
  return out;
}

const size = (n: number) => (n >= 2 ** 30 ? `${(n / 2 ** 30).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 2 ** 20))} MB`);

/** One item as a line: the file, where it downloads from, and what to know first. */
function itemLine(i: MissingFile): string {
  // civitai's download link answers 401 without signing in: its model page is where a person gets the file.
  const link = i.download === "civitai-token" ? (i.page ?? i.url) : (i.url ?? i.page);
  if (!link) return `• ${i.file} (we don't have a download link for it)`;
  const note =
    i.download === "civitai-token" ? "sign in to civitai to download" : i.download === "hf-gated" ? "accept the licence on Hugging Face first" : i.sizeBytes ? size(i.sizeBytes) : "";
  return `• ${i.file}: ${link}${note ? ` (${note})` : ""}`;
}

/** What the run says: how many files, where they go, and each one's link (at most 5, then "and N more"). */
export function missingFilesMessage(m: MissingFiles): string {
  const n = m.items.length;
  const folders = [...new Set(m.items.map((i) => i.folder))];
  const kind = folders.length === 1 && folders[0] === "loras" ? "LoRA file" : "model file";
  const where = folders.length === 1 ? `ComfyUI/models/${folders[0]}` : "the ComfyUI/models folder named for it";
  const head =
    n === 1
      ? `Your ComfyUI doesn't have a ${kind} this needs. Download it into ${where}, keep the file name, then press Generate again.`
      : `Your ComfyUI doesn't have ${n} ${kind}s this needs. Download each one into ${where}, keep the file name, then press Generate again.`;
  const lines = m.items.slice(0, 5).map(itemLine);
  if (n > 5) lines.push(`and ${n - 5} more`);
  return [head, ...lines].join("\n");
}
