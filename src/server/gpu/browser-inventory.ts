import "server-only";
import { z } from "zod";
import type { GpuInventory } from "@/lib/gpu/types";

/**
 * A check a Fuobe tab made of the ComfyUI on its own computer (lib/gpu/gather.ts run in the browser), as the server
 * keeps it: every field checked and capped, unknown ones dropped. It comes from the person's own machine, so it can
 * only say what that person's own board and badges show; nothing else reads it.
 */
const text = (n: number) => z.string().max(n);
const count = z.number().finite().nonnegative();
const names = (n: number, len = 256) => z.array(text(len)).max(n);

const Inventory = z.object({
  v: z.literal(1),
  via: z.literal("browser"),
  checkedAt: count,
  tookMs: count,
  reachable: z.boolean(),
  problem: z.enum(["unreachable", "auth", "not-comfy", "timeout", "cors-off", "lna-blocked", "redirect"]).optional(),
  problemDetail: text(300).optional(),
  comfy: z
    .object({
      version: text(40),
      os: text(20),
      python: text(20).optional(),
      torch: text(40).optional(),
      embeddedPython: z.boolean(),
      deployEnv: text(40),
      flags: z.object({
        listen: text(200).nullable(),
        loopbackOnly: z.boolean(),
        corsOrigin: text(200).nullable(),
        enableManager: z.boolean(),
        managerLegacyUi: z.boolean(),
        lowvram: z.boolean(),
        cpuOnly: z.boolean(),
      }),
      modelRoots: z.record(text(64), names(16, 512)).optional(),
      apiPrefix: z.enum(["", "/api"]).optional(),
    })
    .optional(),
  devices: z.array(z.object({ name: text(120), type: text(20), index: count, vramTotal: count, vramFree: count })).max(8),
  ram: z.object({ total: count, free: count }).optional(),
  manager: z.object({ api: z.enum(["v4", "v3", "none", "unknown"]), version: text(40).optional(), legacyUi: z.boolean().optional(), csrfPost: z.boolean().optional(), busy: z.boolean().optional() }),
  nodes: z.object({ have: names(20_000, 128), missing: names(20_000, 128), total: count, readAt: count, how: z.enum(["object_info", "per-class"]) }),
  combos: z.record(text(200), names(5_000)),
  packs: z.record(text(200), z.object({ dir: text(200), version: text(80).optional(), enabled: z.boolean(), importError: text(2_000).optional() })),
  models: z.record(text(64), z.object({ have: z.record(text(256), count.nullable()), total: count, folderMissing: z.boolean().optional() })),
  loras: z.record(text(256), count.nullable()),
  fingerprint: text(128),
  errors: z.array(z.object({ step: text(64), message: text(300) })).max(50),
});

/** The biggest check a tab may send. */
export const BROWSER_INVENTORY_BYTES = 2 * 2 ** 20;

/** The check as kept, or null when it isn't one. Its time is the server's (a computer's clock can't make it look fresh). */
export function cleanInventory(raw: unknown, now = Date.now()): GpuInventory | null {
  const r = Inventory.safeParse(raw);
  if (!r.success) return null;
  return { ...r.data, checkedAt: now } as GpuInventory;
}
