"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileX2, Link2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { adminCall, runsHref } from "@/components/accounts-admin";
import { StatusCover } from "@/components/library/asset-card";
import { PageHeader } from "@/components/page-shell";
import { GallerySkeleton } from "@/components/skeletons";
import { FailedTile, tileRatio } from "@/components/studio/feed";
import { MediaThumb } from "@/components/studio/result-media";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useViewer } from "@/lib/api";
import { OPERATION_LABELS, type Generation } from "@/lib/catalog/types";
import { elapsed, timeAgo } from "@/lib/format";
import type { SettingRow, SettingState } from "@/lib/run-settings";
import { cn } from "@/lib/utils";
import type { AccountRun } from "@/server/account-admin";
import type { NearRun, RunDetails, RunInput } from "@/server/run-details";

/** The address of a run's details page (the private admin panel links here too). */
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
  return <GallerySkeleton cards={4} />;
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

  if (viewer.isPending) return <GallerySkeleton cards={4} />;
  if (!owner) return <BackToSettings />;
  if (q.isPending)
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-10 w-72 max-w-full" />
        <Skeleton className="h-4 w-52 max-w-full" />
        <Skeleton className="h-56 w-full max-w-md rounded-xl" />
      </div>
    );
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
  const email = g.account.email;
  return (
    <>
      <PageHeader
        title={d.preset?.name ?? g.presetName ?? d.studio?.title ?? featureName(g.feature)}
        description={
          <>
            {email ? (
              <Link href={runsHref({ account: g.account.id })} className="underline-offset-2 hover:underline">
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
          </>
        }
      />

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
          <Section title="What happened">
            <Facts>
              <Fact label="Status">{STATUS_WORDS[g.status] ?? g.status}</Fact>
              <Fact label="Started">{new Date(g.createdAt).toLocaleString()}</Fact>
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
          </Section>

          <Section title="Model and settings">
            <Facts>
              <Fact label="Model">
                {d.model.name} <StateChip state={d.model.state} />
                {d.model.state === "changed" && d.model.defaultName && <span className="text-muted-foreground"> (default {d.model.defaultName})</span>}
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
              <th className="px-3 py-1.5 font-normal">Used</th>
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
function Seen({ g }: { g: AccountRun }) {
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
