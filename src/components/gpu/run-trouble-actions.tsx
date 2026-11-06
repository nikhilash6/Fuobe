"use client";

import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { TroubleActions, type TroubleHandlers } from "./trouble";
import { useCreateGeneration } from "@/lib/api";
import type { Generation, ModelDef } from "@/lib/catalog/types";
import type { TroubleAction, TroubleActionKind } from "@/lib/diagnose";
import { openModelPicker } from "@/lib/open-model-picker";
import { toastError } from "@/lib/refusals";
import { batchKeyOf, failedRunHandlers, movingRun, subscribeMoving, waitingRunHandlers, type RunTroubleDeps } from "@/lib/run-trouble";

/** The Library reads a run's model only when Try one size smaller is pressed (the catalog isn't on its page). */
const loadModel = (id: string) => import("@/lib/catalog").then((m) => m.getModel(id));

/**
 * A run's trouble buttons with what they do (src/lib/run-trouble.ts): a waiting run's Run with your key (its batch's
 * other tiles stop offering it while one press is on its way), a failed run's Run with your key, Pick another model, Try
 * one size smaller and Send a smaller copy. In a studio (`reuse`) the run comes back into its composer; elsewhere (the
 * Library) its studio opens with it.
 */
export function RunTroubleActions({
  g,
  actions,
  reuse,
  model,
  skip = [],
  more,
  ...rest
}: {
  g: Generation;
  actions: TroubleAction[];
  reuse?: (g: Generation) => void;
  model?: Pick<ModelDef, "options" | "defaults">;
  skip?: TroubleActionKind[];
  /** Handlers of the caller's own (Run on Our GPUs, with hosted runs on), beside the run's. */
  more?: TroubleHandlers;
  max?: number;
  compact?: boolean;
  context?: "run" | "other";
  className?: string;
}) {
  const create = useCreateGeneration();
  const router = useRouter();
  const key = batchKeyOf(g);
  // (Nothing moves before the page is live: the server's answer is the same, empty one.)
  const moving = () => movingRun(key);
  const movingId = useSyncExternalStore(subscribeMoving, moving, moving);
  const waiting = g.status === "queued" || g.status === "running";
  const deps: RunTroubleDeps = {
    run: (request, done) =>
      create.mutateAsync(request).then(
        () => {
          if (done) toast.success(done);
          return true;
        },
        (e) => {
          toastError(e);
          return false;
        },
      ),
    onError: (e, next) => (next ? toast.error((e as Error).message || "That didn't work.", { action: next }) : toastError(e)),
    model,
    ...(model ? {} : { loadModel }),
    ...(reuse ? { reuse, openPicker: openModelPicker } : { go: (href: string) => router.push(href) }),
  };
  const handlers = waiting ? waitingRunHandlers(g, deps) : failedRunHandlers(g, deps);
  // Another tile of the same batch is moving it to a key right now: this one doesn't offer it again.
  const hide: TroubleActionKind[] = waiting && movingId && movingId !== g.id ? [...skip, "run-with-key"] : skip;
  return <TroubleActions actions={actions} handlers={more ? { ...handlers, ...more } : handlers} skip={hide} {...rest} />;
}
