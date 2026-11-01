import type { GenerationFix } from "@/lib/catalog/types";

/**
 * What a ComfyUI refusal says was missing (SPEC §13.2): a model file a loader didn't list ("not in list"), or a node
 * class it doesn't have (missing_node_type), as a code the failed tile turns into "Fix it". Pure.
 */
export interface PromptErrorBody {
  error?: { type?: string; message?: string; extra_info?: { class_type?: string } };
  node_errors?: unknown;
}

/** "Node 'My Node' not found", "Cannot execute because node MyNode does not exist": the class, quoted or not. */
const MISSING_NODE = /node (?:type )?(?:'([^'\n]{1,128})'|([^'"\s]{1,128})) (?:not found|does not exist)/i;

export function fixFromPromptError(
  body: PromptErrorBody,
  workflowId: string,
  models: { file: string; folder: string }[],
  packOf: (cls: string) => string | undefined,
): GenerationFix | null {
  const items: GenerationFix["items"] = [];
  const errs = (body.node_errors ?? {}) as Record<string, { errors?: { message?: string; extra_info?: { received_value?: unknown } }[]; class_type?: string }>;
  for (const ne of Object.values(errs)) {
    for (const e of ne?.errors ?? []) {
      const received = e.extra_info?.received_value;
      if (!e.message?.includes("not in list") || typeof received !== "string") continue;
      const base = received.split(/[\\/]/).pop() ?? received;
      const m = models.find((x) => x.file === base);
      if (m && !items.some((i) => i.file === m.file && i.folder === m.folder)) items.push({ folder: m.folder, file: m.file });
    }
  }
  if (items.length) return { code: "comfy_missing_model", workflowId, items };
  if (body.error?.type === "missing_node_type") {
    // A bounded pattern on the message's start: a long message (a ComfyUI's answer, or what a tab reports) can't stall it.
    const said = MISSING_NODE.exec(String(body.error.message ?? "").slice(0, 1024));
    const cls = body.error.extra_info?.class_type ?? said?.[1] ?? said?.[2];
    if (cls) {
      const pack = packOf(cls);
      return { code: "comfy_missing_node", workflowId, items: [{ class: cls, ...(pack && { pack }) }] };
    }
  }
  return null;
}

/** An out-of-memory error in a run's execution_error. */
export const isOutOfMemory = (text: string | undefined): boolean => !!text && /out of memory|OutOfMemoryError|CUDA error: out of memory|allocation on device/i.test(text);
