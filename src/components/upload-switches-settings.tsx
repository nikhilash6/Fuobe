"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { UPLOAD_SWITCHES_KEY } from "@/components/av/use-upload-switches";
import { readUploadSwitches, UPLOAD_SWITCH_KEYS, UPLOAD_SWITCH_LABELS, type UploadSwitches } from "@/lib/av/upload-switches";

const ADMIN_KEY = ["admin", "upload-switches"] as const;
const GROUPS = ["Sound", "Video", "Photos"] as const;

/**
 * Settings → Uploads (the owner's): the fitting step's switches, grouped by kind of file. Each one saves at once
 * (PATCH /api/admin/site/uploads) and browsers pick it up when they next load the switches.
 */
export function UploadSwitchesSettings() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ADMIN_KEY,
    queryFn: async () => {
      const res = await fetch("/api/admin/site/uploads", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { switches?: unknown; error?: string };
      if (!res.ok) throw new Error(body.error || "We couldn't load the switches. Reload the page");
      return readUploadSwitches(body.switches);
    },
  });
  const save = useMutation({
    mutationFn: async (patch: Partial<UploadSwitches>) => {
      const res = await fetch("/api/admin/site/uploads", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const body = (await res.json().catch(() => ({}))) as { switches?: unknown; error?: string };
      if (!res.ok) throw new Error(body.error || "We couldn't save that. Try again");
      return readUploadSwitches(body.switches);
    },
    onMutate: (patch) => {
      const before = qc.getQueryData<UploadSwitches>(ADMIN_KEY);
      if (before) qc.setQueryData(ADMIN_KEY, { ...before, ...patch });
      return { before };
    },
    onError: (e, _patch, ctx) => {
      if (ctx?.before) qc.setQueryData(ADMIN_KEY, ctx.before);
      toast.error((e as Error).message);
    },
    onSuccess: (switches) => {
      qc.setQueryData(ADMIN_KEY, switches);
      qc.setQueryData(UPLOAD_SWITCHES_KEY, switches);
      toast.success("Saved");
    },
  });

  if (q.isLoading) return <Skeleton className="h-48 w-full rounded-xl" />;
  if (q.isError || !q.data) return <p className="text-[13px] text-destructive">{(q.error as Error | null)?.message ?? "We couldn't load the switches. Reload the page"}</p>;
  const s = q.data;
  return (
    <div className="space-y-4">
      {GROUPS.map((group) => (
        <div key={group} role="group" aria-labelledby={`uploads-${group}`} className="overflow-hidden rounded-xl border bg-background">
          <p id={`uploads-${group}`} className="border-b bg-muted/40 px-4 py-2 text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
            {group}
          </p>
          {UPLOAD_SWITCH_KEYS.filter((k) => UPLOAD_SWITCH_LABELS[k].group === group).map((k) => {
            const l = UPLOAD_SWITCH_LABELS[k];
            const id = `upload-switch-${k}`;
            return (
              <label key={k} htmlFor={id} className="flex cursor-pointer items-start justify-between gap-4 border-b px-4 py-3.5 last:border-b-0">
                <span className="min-w-0 space-y-0.5">
                  <span className="block text-[14px] font-medium">{l.label}</span>
                  <span className="block text-[13px] leading-relaxed text-muted-foreground">{l.hint}</span>
                </span>
                <Switch id={id} className="mt-0.5" checked={s[k]} disabled={save.isPending} onCheckedChange={(on) => save.mutate({ [k]: on })} />
              </label>
            );
          })}
        </div>
      ))}
    </div>
  );
}
