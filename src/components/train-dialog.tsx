"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, CircleCheck, Cloud, Cpu, Download, GraduationCap, Loader2, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ElementLora, StudioElement } from "@/lib/catalog/elements";
import {
  AITK_FAMILIES,
  identityKey,
  licenceNote,
  loraFamily,
  needsConsent,
  photosBlocker,
  photoTips,
  SOUL_ID_COPY,
  TRAINING_FAMILIES,
  trainingSettingsHref,
  triggerFor,
  usableOn,
  type TrainingFamily,
  type TrainingTarget,
} from "@/lib/catalog/training";
import { cn } from "@/lib/utils";
import { responseError, toastError } from "@/lib/refusals";

interface Training {
  id: string;
  target: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number | null;
  message: string | null;
  error: string | null;
  createdAt: number;
}

type Target = TrainingTarget & { blocker: string | null; demo: boolean };

function useTrainings(id: string, open: boolean) {
  return useQuery({
    queryKey: ["trainings", id],
    queryFn: async () => (await (await fetch(`/api/elements/${id}/trainings`)).json()) as { targets: Target[]; items: Training[] },
    enabled: open,
    refetchInterval: (q) => (q.state.data?.items.some((t) => t.status === "queued" || t.status === "running") ? 2000 : false),
  });
}

/** Where a trained LoRA runs: "both engines", or the one it's on. */
function engines(l: ElementLora): string {
  if (l.demo) return "Demo: nothing was trained";
  const open = usableOn(l, "open");
  const cloud = usableOn(l, "cloud");
  return open && cloud ? "Your GPU and the cloud" : open ? "Your GPU only" : "Cloud only";
}

const price = (t: Target) => (t.costUsd === 0 ? "Free" : `$${t.costUsd.toFixed(2)}`);

/** Where a family's LoRA runs: both engines, or the one it has models on. */
function familyEngines(f: TrainingFamily): string {
  const lead = TRAINING_FAMILIES[f].lead;
  return lead.open && lead.cloud ? "Runs on your GPU and in the cloud" : lead.cloud ? "Runs in the cloud" : "Runs on your GPU";
}

/**
 * Fuobe Soul ID: train the element once (on your GPU or in the cloud), then every @mention on Fuobe Soul, Soul Cinema
 * and Soul HD uses the trained LoRA on both engines instead of reference photos. Photo rules and the consent line come
 * first; each option shows its price before it runs.
 */
export function TrainDialog({ element, open, onOpenChange }: { element: StudioElement; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const q = useTrainings(element.id, open);
  const [file, setFile] = useState("");
  const [kitFamily, setKitFamily] = useState<TrainingFamily>("z-image-turbo");
  const [consent, setConsent] = useState(false);
  const consentId = useId();
  const photos = element.references.filter((r) => !/\.(wav|mp3|ogg|flac|m4a|webm)$/i.test(r));
  const person = needsConsent(element.kind);
  const tooFew = photosBlocker(photos.length, element.name);
  const tips = person ? photoTips(photos.map((key) => ({ key }))) : [];
  const legacy = element.loras.filter((l) => l.referenceId);
  const trained = element.loras.filter((l) => !l.referenceId);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["trainings", element.id] });
    void qc.invalidateQueries({ queryKey: ["elements"] });
    void qc.invalidateQueries({ queryKey: ["element", element.id] });
  };
  const start = useMutation({
    mutationFn: async (target: string) => {
      const res = await fetch(`/api/elements/${element.id}/trainings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, consent: person ? consent : undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw responseError(res, body.error);
      return body as { provider: string };
    },
    onSuccess: (t) => {
      toast.success(t.provider === "demo" ? `Demo training for ${element.name}: nothing real is trained` : `Training ${element.name} — you can keep working`);
      refresh();
    },
    onError: (e) => toastError(e),
  });
  const attach = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/elements/${element.id}/lora`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file, trigger: triggerFor(element.handle), family: kitFamily }),
      });
      const body = await res.json();
      if (!res.ok) throw responseError(res, body.error);
    },
    onSuccess: () => {
      toast.success("LoRA attached");
      setFile("");
      refresh();
    },
    onError: (e) => toastError(e),
  });
  const remove = async (l: ElementLora) => {
    await fetch(`/api/elements/${element.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removeIdentities: [identityKey(l)] }),
    });
    refresh();
  };

  const latest = (target: string) => q.data?.items.find((t) => t.target === target);
  const targets = q.data?.targets ?? [];
  const families = [...new Set(targets.map((t) => t.family))] as TrainingFamily[];
  const hasFamily = (f: TrainingFamily) => trained.some((l) => !l.demo && loraFamily(l) === f);
  const busyFamily = (f: TrainingFamily) => targets.some((t) => t.family === f && ["queued", "running"].includes(latest(t.id)?.status ?? ""));
  const originals = families.filter((f) => TRAINING_FAMILIES[f].original);
  const more = families.filter((f) => !TRAINING_FAMILIES[f].original);
  const busyAny = q.data?.items.some((t) => t.status === "queued" || t.status === "running");
  // "Retrain for Fuobe Soul" on an older Soul ID: the first option that can run now. Once a real Fuobe Soul LoRA
  // is trained, the old Soul ID is only there to remove.
  const retrainTarget = targets.find((t) => t.family === "z-image-turbo" && !t.blocker && !t.demo) ?? targets.find((t) => t.family === "z-image-turbo" && !t.blocker);
  const replaced = hasFamily("z-image-turbo");

  const anyTrained = families.some((g) => hasFamily(g));
  /** One family: its models, its licence (information), and where it trains with each one's price first. */
  const familySection = (f: TrainingFamily) => {
    const fam = TRAINING_FAMILIES[f];
    const lic = targets.find((t) => t.family === f);
    return (
      <section key={f} aria-label={fam.name} className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <h3 className="text-[14px] font-semibold">{fam.name}</h3>
          <p className="text-[12px] text-muted-foreground">
            {fam.base} LoRA · {familyEngines(f)}
            {anyTrained && !hasFamily(f) ? " · upgrade: the same photos, another model" : ""}
          </p>
        </div>
        {lic && (
          // Information, never a gate: the admin decides what to turn on in Settings.
          <p className="text-[11.5px] text-muted-foreground">Licence: {licenceNote(lic)}</p>
        )}
        {targets
          .filter((t) => t.family === f)
          .map((t) => {
            const job = latest(t.id);
            const busy = job && (job.status === "queued" || job.status === "running");
            const needConsent = person && !consent;
            const label = busy ? "Training" : hasFamily(f) ? "Retrain" : anyTrained ? "Upgrade" : "Train";
            return (
              <div key={t.id} className={cn("rounded-xl border p-3", busy && "border-primary")}>
                <div className="flex flex-wrap items-start gap-3">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                    {t.engine === "open" ? <Cpu className="size-4" /> : <Cloud className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="flex flex-wrap items-center gap-x-2 text-[14px] font-medium">
                      {t.name}
                      <span className={cn("rounded-full px-2 py-px text-[11.5px] font-medium tabular-nums", t.costUsd === 0 ? "bg-success/15 text-success" : "bg-muted text-foreground")}>{price(t)}</span>
                      <span className="text-[12px] font-normal text-muted-foreground">{t.eta}</span>
                    </p>
                    <p className="text-[12px] text-muted-foreground">{t.description}</p>
                    <p className="mt-0.5 text-[11.5px] text-muted-foreground tabular-nums">{t.steps.toLocaleString("en-US")} steps</p>
                  </div>
                  <Button
                    size="sm"
                    className="ml-auto"
                    variant={busy ? "secondary" : "default"}
                    disabled={!!t.blocker || !!tooFew || !!busy || start.isPending || needConsent}
                    onClick={() => start.mutate(t.id)}
                  >
                    {busy && <Loader2 className="animate-spin" />}
                    {label}
                  </Button>
                </div>
                {!busy && (t.blocker || t.demo) && (
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    {t.blocker ??
                      `${t.provider === "fal" ? "No fal.ai key yet" : "No AI-Toolkit set up yet"}: this runs as a demo and trains nothing${hasFamily(f) ? ", and the Soul ID you trained stays" : ""}.`}{" "}
                    <Link href={trainingSettingsHref(t)} className="text-brand-text underline underline-offset-2">
                      Open Settings
                    </Link>
                  </p>
                )}
                {busy && (
                  <div className="mt-3 space-y-1">
                    <Progress value={(job.progress ?? 0.05) * 100} className="h-1.5" />
                    <p className="text-[12px] text-muted-foreground">{job.message}</p>
                  </div>
                )}
                {job?.status === "failed" && <p className="mt-2 text-[12px] text-destructive">{job.error}</p>}
                {job?.status === "succeeded" && job.message && <p className="mt-2 text-[12px] text-warning">{job.message}</p>}
              </div>
            );
          })}
      </section>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="size-5" /> Soul ID · {element.name}
          </DialogTitle>
          <DialogDescription>
            Train once and @{element.handle} {person ? "looks like them" : "looks right"} every time on Fuobe Soul, and on every other model you train it for — on your
            GPU and in the cloud, instead of reference photos.
          </DialogDescription>
        </DialogHeader>

        {/* Photos and the rules */}
        <section aria-label="Photos" className="space-y-2 rounded-xl border p-3">
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 -space-x-2 overflow-hidden">
              {photos.slice(0, 8).map((p, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={p} alt="" loading="lazy" className="size-9 shrink-0 rounded-lg border-2 border-background object-cover" />
              ))}
            </div>
            <p className="shrink-0 text-[13px] font-medium tabular-nums">
              {photos.length} photo{photos.length === 1 ? "" : "s"}
            </p>
          </div>
          {person ? (
            <>
              <p className="text-[12.5px]">
                <span className="font-medium">{SOUL_ID_COPY.moreTitle}</span> · {SOUL_ID_COPY.more}, up to 80.
              </p>
              <ul className="space-y-0.5 text-[12px] text-muted-foreground">
                {SOUL_ID_COPY.rules.map((r) => (
                  <li key={r} className="flex gap-1.5">
                    <Check className="mt-0.5 size-3 shrink-0" /> {r}
                  </li>
                ))}
              </ul>
              <p className="rounded-lg bg-destructive/10 px-2.5 py-1.5 text-[12px]">
                <span className="font-medium">{SOUL_ID_COPY.avoidTitle}</span> · {SOUL_ID_COPY.avoid}
              </p>
            </>
          ) : (
            <p className="text-[12px] text-muted-foreground">{element.kind === "style" ? "20+ images in one cohesive style train the best look." : "10+ photos from different angles train best."}</p>
          )}
          {(tooFew || tips.length > 0) && (
            <ul className="space-y-0.5 text-[12px] text-warning">
              {[tooFew, ...tips].filter(Boolean).map((t) => (
                <li key={t} className="flex gap-1.5">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {t}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* What's trained */}
        {(trained.length > 0 || legacy.length > 0) && (
          <section aria-label="Trained" className="space-y-1.5">
            <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">Trained</p>
            {trained.map((l) => {
              const fam = loraFamily(l);
              return (
                <div key={identityKey(l)} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px]">
                  {l.demo ? <AlertTriangle className="size-4 shrink-0 text-warning" /> : <CircleCheck className="size-4 shrink-0 text-success" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{fam ? TRAINING_FAMILIES[fam].name : l.modelId}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {engines(l)}
                      {l.trigger && !l.demo ? ` · trigger “${l.trigger}”` : ""}
                    </span>
                  </span>
                  <button onClick={() => void remove(l)} className="shrink-0 p-1 text-muted-foreground hover:text-destructive" aria-label={`Remove the ${fam ? TRAINING_FAMILIES[fam].name : ""} Soul ID`}>
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              );
            })}
            {legacy.map((l) => (
              <div key={identityKey(l)} className={cn("flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[13px]", !replaced && "border-warning/40")}>
                {replaced ? <CircleCheck className="size-4 shrink-0 text-muted-foreground" /> : <AlertTriangle className="size-4 shrink-0 text-warning" />}
                {/* Wide enough to read on a phone: the buttons wrap under it there. */}
                <span className="min-w-0 flex-1 basis-48">
                  <span className="block font-medium">Older Soul ID</span>
                  <span className="block text-[12px] text-muted-foreground">
                    {replaced ? "Your Fuobe Soul ID replaces it: remove it when you no longer need it." : "It can't be exported. Retrain on the same photos for Fuobe Soul."}
                  </span>
                </span>
                {!replaced && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!retrainTarget || !!tooFew || (person && !consent) || start.isPending || busyAny}
                    onClick={() => retrainTarget && start.mutate(retrainTarget.id)}
                  >
                    <RotateCcw /> Retrain for Fuobe Soul
                  </Button>
                )}
                <button onClick={() => void remove(l)} className="shrink-0 p-1 text-muted-foreground hover:text-destructive" aria-label="Remove the older Soul ID">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </section>
        )}

        {/* Consent before a person's photos are trained */}
        {person && (
          <label htmlFor={consentId} className={cn("flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-[12.5px] leading-snug", consent ? "border-primary/40 bg-brand-faint" : "bg-muted/40")}>
            <Checkbox id={consentId} checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
            <span>{SOUL_ID_COPY.consent}</span>
          </label>
        )}

        {/* Where to train, by family */}
        <div className="space-y-4">
          {q.isLoading && <p className="text-[13px] text-muted-foreground">Loading training options…</p>}
          {originals.map(familySection)}
          {more.length > 0 && (
            <Collapsible defaultOpen={more.some((f) => hasFamily(f) || busyFamily(f))} className="rounded-xl border">
              <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold">More models</span>
                  <span className="block text-[12px] text-muted-foreground">{more.map((f) => TRAINING_FAMILIES[f].name).join(" · ")}</span>
                </span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 px-3 pb-3">
                {more.map(familySection)}
              </CollapsibleContent>
            </Collapsible>
          )}
          {person && !consent && targets.length > 0 && <p className="text-[12px] text-muted-foreground">Tick the consent line above to train.</p>}
        </div>

        <div className="space-y-2 rounded-xl bg-muted/50 p-3">
          <p className="text-[13px] font-medium">Train anywhere</p>
          <p className="text-[12px] text-muted-foreground">
            Download a ready-to-run AI-Toolkit kit (photos, captions, config), train on any GPU, then attach the LoRA file you copied into ComfyUI/models/loras.
          </p>
          <div className="flex flex-wrap gap-2">
            <Select value={kitFamily} onValueChange={(v) => setKitFamily(v as TrainingFamily)}>
              <SelectTrigger size="sm" className="h-8 w-auto min-w-0" aria-label="Base model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AITK_FAMILIES.map((f) => (
                  <SelectItem key={f} value={f}>
                    {TRAINING_FAMILIES[f].base}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/elements/${element.id}/training-kit?family=${kitFamily}`}>
                <Download /> Training kit
              </a>
            </Button>
            <div className="flex min-w-0 flex-1 basis-56 gap-2">
              <Input value={file} onChange={(e) => setFile(e.target.value)} placeholder={`fuobe/${element.handle.toLowerCase()}.safetensors`} className="h-8 min-w-0" aria-label="LoRA file name" />
              <Button size="sm" variant="secondary" disabled={!file.trim() || attach.isPending} onClick={() => attach.mutate()}>
                Attach
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
