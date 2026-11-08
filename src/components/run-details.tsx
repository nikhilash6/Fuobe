"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileX2, Link2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { adminCall, runsHref } from "@/components/accounts-admin";
import { StatusCover } from "@/components/library/asset-card";
import { PageHeader } from "@/components/page-shell";
import { FailedTile, tileRatio } from "@/components/studio/feed";
import { DeclinedCards } from "@/components/studio/made-note";
import { MediaThumb } from "@/components/studio/result-media";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useViewer } from "@/lib/api";
import { OPERATION_LABELS, type Generation } from "@/lib/catalog/types";
import { elapsed, formatCost, timeAgo } from "@/lib/format";
import type { SettingRow, SettingState } from "@/lib/run-settings";
import { cn } from "@/lib/utils";
import type { AccountRun, AdminRun } from "@/server/account-admin";
import type { NearRun, RunDetails, RunInput, RunJob, RunMadeBy, RunMoney, RunTiming, WorkerEvent } from "@/server/run-details";

/** The address of a run's details page. */
export const runDetailsHref = (id: string) => `/settings/runs/${encodeURIComponent(id)}`;

const STATUS_WORDS: Record<string, string> = { succeeded: "Finished", queued: "Queued", running: "Running", failed: "Failed", canceled: "Canceled" };
const STATE_WORDS: Record<SettingState, string> = { default: "Default", changed: "Changed", unknown: "Unknown default", input: "Its input" };
const STATE_STYLE: Record<SettingState, string> = {
  default: "bg-muted text-muted-foreground",
  changed: "bg-highlight text-highlight-foreground",
  unknown: "border border-dashed text-muted-foreground",
  input: "bg-secondary text-secondary-foreground",
};
const FROM_WORDS: Record<string, string> = { composer: "composer", model: "model", preset: "preset", app: "app", control: "model option", option: "app option" };
const HOST_WORDS: Record<string, string> = {
  runpod: "RunPod pod",
  tunnel: "Tunnel (Cloudflare, ngrok…)",
  lan: "LAN address",
  web: "Web address",
  computer: "ComfyUI on its own computer",
  connect: "Paired with a code (Fuobe Connect)",
  none: "No GPU set",
};
const MATCH_WORDS: Record<NearRun["match"], string> = { same: "Same request again", "other-model": "Same words and files, other model or settings", other: "Another run" };

const featureName = (f: string) => f.charAt(0).toUpperCase() + f.slice(1).replaceAll("-", " ");

/** A value in a few words: lists and objects as compact JSON, a boolean as On/Off. */
function shown(v: unknown): string {
  if (v === undefined) return "—";
  if (typeof v === "boolean") return v ? "On" : "Off";
  if (typeof v === "string" || typeof v === "number") return String(v);
  const s = JSON.stringify(v);
  return s.length > 300 ? `${s.slice(0, 299)}…` : s;
}

/** Anyone but the owner goes back to Settings: this page is the owner's. */
function BackToSettings() {
  const router = useRouter();
  useEffect(() => router.replace("/settings"), [router]);
  return <Loading />;
}

function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-10 w-72 max-w-full" />
      <Skeleton className="h-4 w-52 max-w-full" />
      <Skeleton className="h-56 w-full max-w-md rounded-xl" />
    </div>
  );
}

/**
 * Settings → Accounts' runs → a run (the owner only): everything about one account's run. What the account was shown
 * (its feed tile and Library card, the same components, inert here), what went wrong and where it ran, the model and
 * each setting beside its default, the prompt, its input files, its batch and the account's runs around it (a Retry
 * is the same request sent again), and what was sent to the GPU or provider. Nothing here is a key, a token or a GPU's
 * address (the server leaves them out).
 */
export function RunDetailsView() {
  const id = useParams<{ id: string }>().id ?? "";
  const viewer = useViewer();
  const owner = !!viewer.data?.owner;
  const q = useQuery({
    queryKey: ["admin-run", id],
    enabled: owner,
    queryFn: () => adminCall<RunDetails>(`/api/admin/generations/${encodeURIComponent(id)}`),
    refetchInterval: (s) => (s.state.data && (s.state.data.run.status === "queued" || s.state.data.run.status === "running") ? 10_000 : false),
  });

  // One loading look for every wait, so the page the server draws matches the browser's first draw.
  if (viewer.isPending) return <Loading />;
  if (!owner) return <BackToSettings />;
  if (q.isPending) return <Loading />;
  if (q.isError)
    return (
      <div className="space-y-3">
        <PageHeader title="Run details" />
        <p className="text-[13px] text-destructive">Couldn&apos;t load this run. {q.error.message}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
            Try again
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link href="/settings/runs">Accounts&apos; runs</Link>
          </Button>
        </div>
      </div>
    );

  const d = q.data;
  const g = d.run;
  const email = g.account ? g.account.email : undefined;
  return (
    <>
      <PageHeader
        title={d.preset?.name ?? g.presetName ?? d.studio?.title ?? featureName(g.feature)}
        description={
          <>
            {g.whose === "owner" ? (
              "Your own run"
            ) : email ? (
              <Link href={runsHref({ account: g.account!.id })} className="underline-offset-2 hover:underline">
                {email}
              </Link>
            ) : email === null ? (
              "Deleted account"
            ) : (
              "An account"
            )}
            {" · "}
            <span className={cn(g.status === "failed" && "text-destructive")}>{STATUS_WORDS[g.status] ?? g.status}</span>
            {" · "}
            <span title={new Date(g.createdAt).toLocaleString()}>{timeAgo(g.createdAt)}</span>
            {" · "}
            {d.surface.label}
            {" · "}
            {d.model.name}
          </>
        }
      />

      <Summary d={d} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="space-y-8">
          <Section title="What the account saw">
            <Seen g={g} />
          </Section>
          <Section title="Its input files">
            <Inputs inputs={d.inputs} />
          </Section>
        </div>

        <div className="min-w-0 space-y-8">
          <Section title="Timeline">
            <Timeline t={d.timing} status={g.status} progress={d.progress} log={d.workerLog} />
          </Section>

          <MadeBy m={d.madeBy} model={d.model} cards={g.declinedCards} prompt={d.prompt} />

          <Section title="What happened">
            <Facts>
              <Fact label="Status">{STATUS_WORDS[g.status] ?? g.status}</Fact>
              <Fact label="Pressed">{new Date(g.createdAt).toLocaleString()}</Fact>
              {g.completedAt && (
                <Fact label="Ended">
                  {new Date(g.completedAt).toLocaleString()} ({elapsed(g.createdAt, g.completedAt)})
                </Fact>
              )}
              <Fact label="Last change">{new Date(g.updatedAt).toLocaleString()}</Fact>
              {d.stored.message && <Fact label="Status words">{d.stored.message}</Fact>}
              {d.stored.error && (
                <Fact label="Error (stored)">
                  <span className="whitespace-pre-wrap text-destructive">{d.stored.error}</span>
                </Fact>
              )}
              {g.error && g.error !== d.stored.error && <Fact label="Error (as the account read it)">{g.error}</Fact>}
              {d.stored.detail && (
                <Fact label="Technical detail">
                  <span className="whitespace-pre-wrap">{d.stored.detail}</span>
                </Fact>
              )}
              {d.trouble && (
                <>
                  <Fact label="Cause">
                    <code className="text-[12px]">{d.trouble.cause}</code>
                  </Fact>
                  {d.trouble.details && <Fact label="Details line">{d.trouble.details}</Fact>}
                </>
              )}
              {(g.status === "failed" || g.status === "canceled") && (
                <Fact label="Buttons it was given">
                  {[...(g.trouble?.actions.filter((a) => a.kind !== "retry").map((a) => a.label) ?? []), ...(g.status === "failed" && g.fix ? ["Fix it"] : []), "Retry"].join(" · ")}
                  {(g.trouble?.actions.length ?? 0) > 2 && <span className="block text-[12px] text-muted-foreground">A tile shows two or three of them: its tiles under What the account saw show which.</span>}
                </Fact>
              )}
              {d.fix?.items?.length ? (
                <Fact label="Missing on its GPU">
                  <ul className="space-y-0.5">
                    {d.fix.items.map((it, i) => (
                      <li key={i} className="font-mono text-[12px] break-all">
                        {[it.folder, it.file, it.class, it.pack].filter(Boolean).join(" · ")}
                      </li>
                    ))}
                  </ul>
                </Fact>
              ) : null}
              {d.where.note && (
                <Fact label="Noted when it failed">
                  {[d.where.note.stage && `stage ${d.where.note.stage}`, d.where.note.code && `code ${d.where.note.code}`, d.where.note.cause && `cause ${d.where.note.cause}`].filter(Boolean).join(" · ") || "—"}
                  {d.where.note.said && <span className="mt-1 block font-mono text-[11.5px] break-all whitespace-pre-wrap text-muted-foreground">{d.where.note.said}</span>}
                </Fact>
              )}
            </Facts>
          </Section>

          <Section title="Where it ran">
            <Facts>
              <Fact label="Made in">
                {d.surface.label}
                <span className="text-muted-foreground"> · {d.surface.standalone ? "on its own in a studio" : "by a tool, for one of its projects"}</span>
                {d.surface.skill && <span className="block text-muted-foreground">From the skill “{d.surface.skill}”</span>}
                {d.surface.step && <span className="block text-muted-foreground">Step: {d.surface.step}</span>}
              </Fact>
              <Fact label="Place">{d.where.label}</Fact>
              {d.where.hostKind && <Fact label="GPU reached through">{HOST_WORDS[d.where.hostKind] ?? d.where.hostKind}</Fact>}
              {d.where.hostKindNow && <Fact label="Its GPU setting now">{HOST_WORDS[d.where.hostKindNow] ?? d.where.hostKindNow}</Fact>}
              <Fact label="Engine">{d.where.engine === "open" ? "Open source" : "Cloud"}</Fact>
              <Fact label="Provider">{d.where.provider}</Fact>
              {d.where.workflowId && (
                <Fact label="Graph">
                  <code className="text-[12px]">{d.where.workflowId}</code>
                </Fact>
              )}
              <Fact label="Reached the GPU or provider">{d.where.handedOver ? "Yes" : "No"}</Fact>
              {d.providerId && (
                <Fact label="Job id there">
                  <code className="text-[12px] break-all">{d.providerId}</code>
                </Fact>
              )}
              {d.where.workers && <Fact label="Workers">Ran through this site&apos;s workers</Fact>}
              {d.where.resent && <Fact label="Resent">Sent again once after its GPU lost it</Fact>}
              {d.where.wait && (
                <Fact label="Waited for its GPU or key">
                  {d.where.wait.tries} {d.where.wait.tries === 1 ? "try" : "tries"}
                  {d.where.wait.until ? `, until ${new Date(d.where.wait.until).toLocaleTimeString()}` : ""}
                  {d.where.wait.words && <span className="block text-muted-foreground">{d.where.wait.words}</span>}
                </Fact>
              )}
            </Facts>
            <Jobs jobs={d.jobs} />
          </Section>

          <Section title="Cost">
            <Money m={d.money} status={g.status} />
            {d.checks.length > 0 && (
              <Facts>
                <Fact label="Results checked first">
                  {d.checks.map((c, i) => (
                    <span key={i} className="block">
                      Result {i + 1}: {CHECK_WORDS[c.state] ?? c.state}
                      {c.decidedAt ? ` after ${dur(c.decidedAt - c.askedAt)}` : ""}
                      {c.tries > 1 ? ` · ${c.tries} tries` : ""}
                    </span>
                  ))}
                </Fact>
              </Facts>
            )}
          </Section>

          <Section title="Model and settings">
            <Facts>
              <Fact label="Model">
                {d.model.name} <StateChip state={d.model.state} />
                {d.model.state === "changed" && d.model.defaultName && <span className="text-muted-foreground"> (default {d.model.defaultName})</span>}
                {d.model.ranOn && <span className="block text-muted-foreground">Made with {d.model.ranOn.name}</span>}
              </Fact>
              {d.preset && (
                <Fact label={d.preset.type === "app" ? "App" : d.preset.type === "unknown" ? "Preset" : d.preset.type === "motion" ? "Camera motion" : "Effect"}>{d.preset.name}</Fact>
              )}
              {d.studio && <Fact label="Studio">{d.studio.title}</Fact>}
              <Fact label="Operation">{OPERATION_LABELS[g.op] ?? g.op}</Fact>
              {d.asked && <Fact label="Request">Made in steps; settings are those it was asked with</Fact>}
            </Facts>
            <Words label="Prompt" text={d.prompt} />
            {d.negativePrompt && <Words label="Negative prompt" text={d.negativePrompt} />}
            <Settings rows={d.settings} />
          </Section>

          <Section title="Its batch and retries">
            <Near title={d.batch.length > 1 ? `Its batch (${d.batch.length} runs)` : "Its batch"} runs={d.batch} current={g.id} empty="It wasn't part of a batch." />
            <Near
              title="The account's runs around it (2 hours before to 6 hours after)"
              runs={d.near}
              current={g.id}
              empty="No other runs then."
              note="A Retry, or Run pressed again with nothing changed, sends the same request again: both show as Same request again."
            />
          </Section>

          <Section title="What was sent">
            {d.sent == null ? (
              <p className="text-[13px] text-muted-foreground">Nothing was sent to a GPU or provider.</p>
            ) : (
              <details className="rounded-lg border">
                <summary className="cursor-pointer px-3 py-2 text-[13px]">The graph or request as sent (links shown by their kind, keys left out)</summary>
                <pre className="max-h-[32rem] overflow-auto border-t p-3 text-[11px] leading-snug">{JSON.stringify(d.sent, null, 2)}</pre>
              </details>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 space-y-3">
      <h2 className="text-[15px] font-medium">{title}</h2>
      {children}
    </section>
  );
}

function Facts({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-[11rem_minmax(0,1fr)]">{children}</dl>;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function StateChip({ state }: { state: SettingState }) {
  return <span className={cn("ml-1 inline-flex rounded-full px-1.5 py-px text-[11px] font-medium whitespace-nowrap", STATE_STYLE[state])}>{STATE_WORDS[state]}</span>;
}

function Words({ label, text }: { label: string; text: string | null }) {
  return (
    <div className="mt-3 text-[13px]">
      <p className="text-muted-foreground">{label}</p>
      {text?.trim() ? <p className="mt-0.5 rounded-lg bg-muted/60 p-2.5 break-words whitespace-pre-wrap">{text}</p> : <p className="mt-0.5 text-muted-foreground italic">None</p>}
    </div>
  );
}

/** Each setting: what the run used, its default and where that comes from, and whether the account changed it. */
function Settings({ rows }: { rows: SettingRow[] }) {
  if (!rows.length) return <p className="mt-3 text-[13px] text-muted-foreground">No settings.</p>;
  const changed = rows.filter((r) => r.state === "changed").length;
  return (
    <div className="mt-4">
      <p className="mb-2 text-[13px] text-muted-foreground">
        {changed ? `${changed} changed from the default` : "Nothing changed from the defaults"}
        {rows.some((r) => r.state === "unknown") ? "; some defaults aren't known here." : "."}
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-[12.5px]">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 font-normal">Setting</th>
              <th className="px-3 py-1.5 font-normal">Asked for</th>
              <th className="px-3 py-1.5 font-normal">Default</th>
              <th className="px-3 py-1.5 font-normal">
                <span className="sr-only">State</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t align-top">
                <td className="px-3 py-1.5" title={r.key}>
                  {r.label}
                </td>
                <td className="max-w-64 px-3 py-1.5 break-words">
                  {r.sent ? (r.valueLabel ?? shown(r.value)) : <span className="text-muted-foreground">not sent</span>}
                  {r.valueLabel && r.sent && <span className="text-muted-foreground"> ({shown(r.value)})</span>}
                  {r.made && (
                    <span className="mt-0.5 block text-[11.5px] font-medium">
                      Made at {r.made.value}
                      <span className="text-muted-foreground"> · {r.made.reason}</span>
                    </span>
                  )}
                </td>
                <td className="max-w-64 px-3 py-1.5 break-words text-muted-foreground">
                  {r.hasDefault ? (
                    <>
                      {r.defaultLabel ?? (r.default === undefined ? "none" : shown(r.default))}
                      {r.from && <span className="text-[11px]"> · {FROM_WORDS[r.from] ?? r.from}</span>}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <StateChip state={r.state} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Its files: each opens full size (the owner's view of the account's file); a removed upload says so. */
function Inputs({ inputs }: { inputs: RunInput[] }) {
  if (!inputs.length) return <p className="text-[13px] text-muted-foreground">No files.</p>;
  return (
    <ul className="grid grid-cols-3 gap-2">
      {inputs.map((f, i) => (
        <li key={i} className="min-w-0">
          <div className="aspect-square overflow-hidden rounded-lg border bg-muted">
            {f.url && f.kind === "image" ? (
              <a href={f.url} target="_blank" rel="noreferrer" aria-label={`Open ${f.slot}`} className="block size-full">
                {/* eslint-disable-next-line @next/next/no-img-element -- the account's own stored file, as the files route serves it */}
                <img src={f.url} alt="" loading="lazy" className="size-full object-cover" />
              </a>
            ) : f.url && f.kind === "video" ? (
              <video src={f.url} preload="metadata" muted controls className="size-full object-cover" />
            ) : f.url ? (
              <a href={f.url} target="_blank" rel="noreferrer" className="grid size-full place-items-center text-[12px] text-muted-foreground hover:text-foreground">
                <span className="inline-flex items-center gap-1">
                  <ExternalLink className="size-3.5" /> Open
                </span>
              </a>
            ) : (
              <div className="grid size-full place-items-center p-2 text-center text-[11.5px] text-muted-foreground">
                {f.state === "removed" ? (
                  <span className="inline-flex flex-col items-center gap-1">
                    <FileX2 className="size-4" /> Removed
                  </span>
                ) : f.state === "link" ? (
                  <span className="inline-flex flex-col items-center gap-1">
                    <Link2 className="size-4" /> {f.words ?? "A link"}
                  </span>
                ) : (
                  "Sent inline"
                )}
              </div>
            )}
          </div>
          <p className="mt-1 truncate text-[12px]">{f.slot}</p>
          {f.state === "example" && <p className="text-[11px] text-muted-foreground">Example file</p>}
          {f.state === "removed" && <p className="text-[11px] text-muted-foreground">Uploads clear after 14 days</p>}
        </li>
      ))}
    </ul>
  );
}

/**
 * What the account was shown for this run: its studio feed's tile and its Library card, made by the same components
 * its own pages use (inert: nothing here runs anything). A finished run shows its results.
 */
function Seen({ g }: { g: AdminRun }) {
  const run = g as unknown as Generation;
  if (g.status === "succeeded") {
    const outs = g.outputs.filter((o) => o.state === "shown");
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {g.outputs.map((o, i) => (
            <div key={i} className="aspect-square overflow-hidden rounded-lg border bg-muted">
              {o.state === "shown" ? (
                <MediaThumb output={o} g={run} />
              ) : (
                <div className="grid size-full place-items-center text-[12px] text-muted-foreground">{o.state === "held" ? "Held for its check" : "Removed"}</div>
              )}
            </div>
          ))}
        </div>
        <p className="text-[12px] text-muted-foreground">
          {outs.length === g.outputs.length ? `Its result${g.outputs.length > 1 ? "s" : ""}, as it saw ${g.outputs.length > 1 ? "them" : "it"}.` : "Some results weren't shown to it."}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-[12px] text-muted-foreground">In its studio</p>
        <div inert className="h-56 max-w-full">
          {g.status === "failed" || g.status === "canceled" ? (
            <FailedTile g={run} ratio={tileRatio(run)} onRetry={() => {}} />
          ) : (
            <div className="aspect-square h-full overflow-hidden rounded-xl">
              <StatusCover g={run} actionable />
            </div>
          )}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-[12px] text-muted-foreground">In its Library</p>
        <div inert className="@container aspect-square w-56 overflow-hidden rounded-xl bg-muted">
          <StatusCover g={run} actionable />
        </div>
      </div>
      <p className="text-[12px] text-muted-foreground">The same words and buttons the account&apos;s pages show. Nothing here can be pressed.</p>
    </div>
  );
}

function Near({ title, runs, current, empty, note }: { title: string; runs: NearRun[]; current: string; empty: string; note?: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[13px] text-muted-foreground">{title}</p>
      {!runs.length ? (
        <p className="text-[13px] text-muted-foreground italic">{empty}</p>
      ) : (
        <ul className="divide-y rounded-lg border text-[12.5px]">
          {runs.map((r) => (
            <li key={r.id} className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-1.5", r.id === current && "bg-muted/50")}>
              {r.id === current ? (
                <span className="font-medium">This run</span>
              ) : (
                <Link href={runDetailsHref(r.id)} className="font-medium underline-offset-2 hover:underline">
                  {r.presetName ?? r.modelName ?? r.modelId}
                </Link>
              )}
              <span className={cn("text-muted-foreground", r.status === "failed" && "text-destructive")}>{STATUS_WORDS[r.status] ?? r.status}</span>
              <span className="text-muted-foreground" title={new Date(r.createdAt).toLocaleString()}>
                {new Date(r.createdAt).toLocaleTimeString()}
              </span>
              {r.step && <span className="text-muted-foreground">{r.step}</span>}
              {r.id !== current && <span className="text-[11px] text-muted-foreground">· {MATCH_WORDS[r.match]}</span>}
              {r.error && <span className="w-full truncate text-[12px] text-muted-foreground">{r.error}</span>}
            </li>
          ))}
        </ul>
      )}
      {note && <p className="text-[11.5px] text-muted-foreground">{note}</p>}
    </div>
  );
}

const CHECK_WORDS: Record<string, string> = { waiting: "Waiting for its check", shown: "Passed", hidden: "Hidden by its check", unchecked: "Not checked in time" };
const HELD_WORDS: Record<string, string> = {
  mine: "behind its other runs",
  today: "the day's GPU time is used up",
  service: "waiting for the service to answer",
  hour: "an hourly limit",
  list: "the waiting list",
  credits: "no free runs left until they renew",
};
const EVENT_WORDS: Record<string, string> = {
  claimed: "Taken by a worker",
  finished: "Worker finished its job",
  requeued: "Worker gave it back: back in line",
  done: "Job done",
  failed: "Job failed",
  canceled: "Job canceled",
};
const JOB_STATE_WORDS: Record<string, string> = {
  waiting: "In line",
  sending: "Sending files",
  queued: "Queued on the GPU",
  running: "Running",
  collecting: "Collecting results",
  done: "Done",
  failed: "Failed",
  canceled: "Canceled",
};
const REPORT_WORDS: Record<string, string> = { settle: "Charge", refund: "Refund", release: "Release" };
const ENDED_WORDS: Record<string, string> = { succeeded: "Finished", failed: "Failed", canceled: "Canceled" };

/** A length of time in a few characters: "0.4s", "12s", "3m 05s", "1h 20m". */
function dur(ms: number): string {
  if (ms < 10_000) return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** The few numbers the owner looks for first: how long it waited and ran, what it cost, and which worker made it. */
function Summary({ d }: { d: RunDetails }) {
  const t = d.timing;
  const job = [...d.jobs].reverse().find((j) => j.worker || j.device);
  const cost = d.money.charge ?? (d.money.costUsd != null ? formatCost(d.money.costUsd) : d.money.lineClass === "free" ? "Free" : null);
  const items: [string, string][] = [
    ...(t.waitedMs !== undefined ? [["Waited", dur(t.waitedMs)] as [string, string]] : []),
    ...(t.ranMs !== undefined ? [["Ran", dur(t.ranMs)] as [string, string]] : []),
    ...(t.gpuMs !== undefined ? [["GPU time", dur(t.gpuMs)] as [string, string]] : []),
    ...(t.totalMs !== undefined ? [["Total", dur(t.totalMs)] as [string, string]] : []),
    ...(cost ? [["Cost", cost] as [string, string]] : []),
    ...(job ? [["Made on", [job.worker, job.device].filter(Boolean).join(" · ")] as [string, string]] : []),
  ];
  if (!items.length) return null;
  return (
    <dl className="mb-8 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-lg border px-3 py-2 sm:min-w-28">
          <dt className="text-[11.5px] text-muted-foreground">{label}</dt>
          <dd className="truncate text-[14px] font-medium tabular-nums" title={value}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

interface Step {
  at: number;
  words: string;
  more?: string;
  tone?: "bad" | "now";
}

/** Pressed, held, sent, started, each worker's take and give-back, and the end, in time order. */
function Timeline({ t, status, progress, log }: { t: RunTiming; status: string; progress: RunDetails["progress"]; log: WorkerEvent[] }) {
  const steps: Step[] = [{ at: t.pressedAt, words: "Run pressed" }];
  if (t.held) steps.push({ at: t.pressedAt, words: `Waiting to enter the line: ${HELD_WORDS[t.held.reason] ?? t.held.reason}`, more: t.held.startAt ? `May enter at ${clock(t.held.startAt)}` : undefined, tone: "now" });
  if (t.sentAt !== undefined) steps.push({ at: t.sentAt, words: "Sent to the GPU or provider", more: `${dur(t.sentAt - t.pressedAt)} after the press` });
  for (const e of log)
    steps.push({
      at: e.at,
      words: EVENT_WORDS[e.event] ?? e.event,
      more: [e.worker, e.device, e.lane && `lane ${e.lane}`, e.execMs != null && `GPU ${dur(e.execMs)}`].filter(Boolean).join(" · ") || undefined,
      tone: e.event === "requeued" || e.event === "failed" ? "bad" : undefined,
    });
  if (t.startedAt !== undefined) steps.push({ at: t.startedAt, words: "Work started", more: `waited ${dur(t.waitedMs ?? 0)}` });
  if (progress && (status === "running" || status === "queued")) {
    const s = progress.step;
    const bits = [
      progress.share != null && `${Math.round(progress.share * 100)}%`,
      s?.loading && "loading its model",
      s?.value !== undefined && s.max !== undefined && `step ${s.value} of ${s.max}`,
      s?.node && `node ${s.node}`,
    ].filter(Boolean);
    steps.push({ at: s?.at ?? Math.max(...steps.map((x) => x.at)), words: status === "running" ? "Working now" : "In line now", more: bits.join(" · ") || undefined, tone: "now" });
  }
  if (t.endedAt !== undefined) steps.push({ at: t.endedAt, words: ENDED_WORDS[status] ?? "Ended", more: t.ranMs !== undefined ? `ran ${dur(t.ranMs)}` : undefined, tone: status === "failed" ? "bad" : undefined });
  steps.sort((a, b) => a.at - b.at);
  return (
    <ol className="relative space-y-3 border-l pl-4 text-[13px]">
      {steps.map((s, i) => (
        <li key={i} className="relative">
          <span
            aria-hidden
            className={cn(
              "absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-muted-foreground/60",
              s.tone === "bad" && "bg-destructive",
              s.tone === "now" && "bg-foreground",
            )}
          />
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className={cn("font-medium", s.tone === "bad" && "text-destructive")}>{s.words}</span>
            <span className="text-[12px] text-muted-foreground tabular-nums" title={new Date(s.at).toLocaleString()}>
              {clock(s.at)}
            </span>
          </p>
          {s.more && <p className="text-[12px] break-words text-muted-foreground">{s.more}</p>}
        </li>
      ))}
    </ol>
  );
}

/** How it was made: Auto's pick and why, Ideogram 4's declines (with what it returned), notices, and values made differently. */
function MadeBy({ m, model, cards, prompt }: { m: RunMadeBy; model: RunDetails["model"]; cards?: AccountRun["declinedCards"]; prompt: string | null }) {
  if (!m.auto && !m.declined && !m.notices.length && !m.changes.length && !cards?.length) return null;
  return (
    <Section title="How it was made">
      <Facts>
        {m.auto && (
          <Fact label="Auto picked">
            {m.auto.name}
            <span className="block text-muted-foreground">{m.auto.words}</span>
          </Fact>
        )}
        {m.declined && (
          <Fact label="Ideogram 4 declined">
            {m.declined.words}
            {m.declined.askedModelName && m.declined.modelName && (
              <span className="block text-muted-foreground">
                Asked for {m.declined.askedModelName} · made with {m.declined.modelName}
              </span>
            )}
            {!m.declined.modelName && model.ranOn && <span className="block text-muted-foreground">Made with {model.ranOn.name}</span>}
          </Fact>
        )}
        {!!cards?.length && (
          <Fact label="What it returned">
            <DeclinedCards cards={cards} words={prompt ?? undefined} className="block break-words" />
          </Fact>
        )}
        {m.notices.map((n, i) => (
          <Fact key={i} label={i ? "" : "Said on the result"}>
            {n}
          </Fact>
        ))}
        {m.changes.length > 0 && (
          <Fact label="Made differently">
            {m.changes.map((c) => (
              <span key={c.setting} className="block">
                {c.label}: asked for {c.asked} · made at <span className="font-medium">{c.made}</span>
                <span className="text-muted-foreground"> ({c.reason})</span>
              </span>
            ))}
            <span className="mt-0.5 block text-[11.5px] text-muted-foreground">The account&apos;s pages show the made value only.</span>
          </Fact>
        )}
      </Facts>
    </Section>
  );
}

/** Each job on this site's GPUs or the account's computer: its worker and GPU, lane, tries and times. */
function Jobs({ jobs }: { jobs: RunJob[] }) {
  if (!jobs.length) return null;
  return (
    <div className="mt-4 space-y-2">
      <p className="text-[13px] text-muted-foreground">{jobs.length > 1 ? `Its ${jobs.length} jobs` : "Its job"}</p>
      <ul className="space-y-2">
        {jobs.map((j, i) => (
          <li key={i} className="rounded-lg border p-3 text-[12.5px]">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">
                {jobs.length > 1 ? `Job ${i + 1}` : "Job"}
                {j.slot === "cpu" ? " (finishing, on a CPU)" : ""}
              </span>
              <span className={cn("text-muted-foreground", j.state === "failed" && "text-destructive")}>{JOB_STATE_WORDS[j.state] ?? j.state}</span>
            </p>
            <dl className="mt-1.5 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-0.5">
              {j.worker && <JobFact label="Worker">{j.worker}</JobFact>}
              {j.device && <JobFact label="GPU">{j.device}</JobFact>}
              {j.lane && <JobFact label="Lane">{j.lane}</JobFact>}
              {j.lineClass && <JobFact label="Line">{j.lineClass === "paid" ? "Paid" : j.lineClass === "free" ? "Free" : j.lineClass}</JobFact>}
              {j.workflowId && (
                <JobFact label="Graph">
                  <code className="text-[11.5px]">{j.workflowId}</code>
                </JobFact>
              )}
              <JobFact label="Tries">
                {j.attempts ? `Sent to ComfyUI ${j.attempts}×` : "Not sent on this take"}
                {j.requeues ? ` · back in line ${j.requeues}×` : ""}
                {j.triedBy ? ` · ${j.triedBy} worker${j.triedBy > 1 ? "s" : ""} tried it` : ""}
              </JobFact>
              {(j.estMs !== undefined || j.execMs !== undefined) && (
                <JobFact label="GPU time">
                  {j.execMs !== undefined ? dur(j.execMs) : "—"}
                  {j.estMs !== undefined && <span className="text-muted-foreground"> (expected {dur(j.estMs)})</span>}
                </JobFact>
              )}
              <JobFact label="Times">
                <span className="tabular-nums">
                  {[
                    `made ${clock(j.createdAt)}`,
                    j.claimedAt && `taken ${clock(j.claimedAt)}`,
                    j.sentAt && `sent ${clock(j.sentAt)}`,
                    j.startedAt && `started ${clock(j.startedAt)}`,
                    j.finishedAt && `ended ${clock(j.finishedAt)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </JobFact>
              {j.down && (
                <JobFact label="GPU down">
                  since {clock(j.down.at)}
                  {j.down.why === "setting" ? " (its ComfyUI answers, without Fuobe's setting)" : ""}
                </JobFact>
              )}
              {j.note && <JobFact label="Note">{j.note}</JobFact>}
              {j.error && (
                <JobFact label="Error">
                  <span className="break-words whitespace-pre-wrap text-destructive">{j.error}</span>
                </JobFact>
              )}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

function JobFact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

/** What it cost, its place in the line, and whether it was charged. */
function Money({ m, status }: { m: RunMoney; status: string }) {
  return (
    <Facts>
      <Fact label="Cost">{m.costUsd != null ? formatCost(m.costUsd) : "Not known"}</Fact>
      {m.charge && <Fact label="Charged">{m.charge}</Fact>}
      {m.lineClass && <Fact label="Line">{m.lineClass === "paid" ? "Paid run" : "Free run"}</Fact>}
      {m.light && <Fact label="Light work">Joins and trims only: free and not counted</Fact>}
      {(m.setAside || m.notCharged) && <Fact label="Set aside">{m.notCharged ? "Yes, and given back: nothing was charged" : status === "succeeded" ? "Yes, then charged" : "Yes"}</Fact>}
      {m.notBilled && <Fact label="Billed">No: it stopped before the provider took the job</Fact>}
      {m.waitMs !== undefined && <Fact label="Longest wait in line">{dur(m.waitMs)}</Fact>}
      {m.boostMs ? <Fact label="Head start in line">{dur(m.boostMs)}</Fact> : null}
      {m.report && (
        <Fact label={`${REPORT_WORDS[m.report.kind] ?? m.report.kind} report`}>
          {m.report.state === "sent" ? "Sent" : m.report.state === "gave-up" ? "Gave up" : "Waiting to send"}
          {m.report.tries > 1 ? ` · ${m.report.tries} tries` : ""}
        </Fact>
      )}
    </Facts>
  );
}
