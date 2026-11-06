"use client";

import { toast } from "sonner";
import { STILL_LIMITS, stillPlan, type StillFormat } from "@/lib/catalog/still-limits";
import type { ModelDef, Operation } from "@/lib/catalog/types";
import { fitImage, imageSize } from "./fit-image";
import { uploadSwitchesNow } from "./use-upload-switches";

/**
 * A picture for a cloud endpoint with limits of its own (src/lib/catalog/still-limits.ts: Qwen Image 3 edit 384-2048 px and
 * 10 MB, Recraft Crisp PNG only, …) fitted in this browser before it is uploaded, so a smaller file goes up. The server
 * still fits what arrives (src/server/fit-still.ts), so this is never the only check. Off with the owner's "Convert or make
 * smaller" switch.
 */

/** The endpoint with limits a model's op runs on in the cloud, or undefined. */
export function stillEndpoint(model: Pick<ModelDef, "engine" | "routes"> | undefined, op: Operation | undefined): string | undefined {
  if (!model || model.engine === "open") return undefined;
  return model.routes.find((r) => (!op || r.op === op) && STILL_LIMITS[r.endpoint])?.endpoint;
}

const formatOf = (type: string): StillFormat =>
  /png/i.test(type) ? "png" : /jpe?g/i.test(type) ? "jpeg" : /webp/i.test(type) ? "webp" : /gif/i.test(type) ? "gif" : /svg/i.test(type) ? "svg" : "other";

/** The picture fitted to `endpoint`, or the same file when it fits (or can't be read here: the server fits it). */
export async function fitStill(file: File, endpoint: string, forName: string): Promise<File> {
  if (!(await uploadSwitchesNow()).photoConvert) return file;
  const size = await imageSize(file);
  if (!size) return file;
  const plan = stillPlan(endpoint, { ...size, bytes: file.size, format: formatOf(file.type) });
  if (!plan) return file;
  const lim = STILL_LIMITS[endpoint];
  try {
    const out = await fitImage(file, {
      name: file.name,
      size: plan.resize,
      png: plan.toFormat === "png" || (!plan.toFormat && formatOf(file.type) === "png" && !plan.flatten && !lim.maxBytes),
      keepAlpha: !plan.flatten && plan.toFormat !== "jpeg",
      maxBytes: lim.maxBytes,
    });
    toast.success(`Fitted for ${forName}`);
    return out.file;
  } catch {
    return file;
  }
}
