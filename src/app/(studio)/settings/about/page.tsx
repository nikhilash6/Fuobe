import fs from "node:fs/promises";
import path from "node:path";
import { ArrowLeft, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LicencesView } from "@/components/licences-view";
import { PageHeader, PageShell } from "@/components/page-shell";
import { MODELS, modelCounts } from "@/lib/catalog";
import type { Manifest } from "@/lib/comfy";
import { FUOBE_REPO } from "@/lib/connections";
import { ATTRIBUTIONS, buildLicenceList } from "@/lib/licences";

export const metadata: Metadata = { title: "About & licences" };

/** A JSON file's contents, or null when it's missing or unreadable. */
async function readJson<T>(text: Promise<string>): Promise<T | null> {
  try {
    return JSON.parse(await text) as T;
  } catch {
    return null;
  }
}

/** Fuobe's version and every open model's licence, from package.json, the ComfyUI manifest and the catalog. */
async function readAbout() {
  "use cache";
  // Each path is spelled out, so the build traces these two files, not the whole project.
  const [pkg, manifest] = await Promise.all([
    readJson<{ version?: string }>(fs.readFile(path.join(process.cwd(), "package.json"), "utf8")),
    readJson<Manifest & { comfyuiVersion?: string }>(fs.readFile(path.join(process.cwd(), "workflows", "comfyui", "manifest.json"), "utf8")),
  ]);
  const workflows = manifest?.workflows ?? [];
  return {
    version: pkg?.version ?? "dev",
    comfyui: manifest?.comfyuiVersion,
    builtAt: manifest?.generatedAt?.slice(0, 10),
    workflowCount: workflows.length,
    list: buildLicenceList(
      MODELS.map((m) => ({ id: m.id, name: m.name, vendor: m.vendor, kind: m.kind, hidden: m.hidden, routes: m.routes.map((r) => ({ provider: r.provider, endpoint: r.endpoint })) })),
      workflows.map((w) => ({ id: w.id, title: w.title, capability: w.capability, license: w.license, models: w.models.map((m) => ({ url: m.url, sizeGb: m.sizeGb })) })),
    ),
  };
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[14px] [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export default async function Page() {
  const about = await readAbout();
  const { list } = about;
  const library = list.rows.filter((r) => !r.inCatalog).length;
  const models = modelCounts();
  return (
    <PageShell>
      <Link href="/settings" className="mb-3 inline-flex items-center gap-1.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Settings
      </Link>
      <PageHeader
        title="About & licences"
        description="Fuobe's code is open source (MIT). The open models it runs on your GPU each have their own licence: most allow commercial use, some don't, and a few leave out some countries. Paid models follow the terms of the provider you connect."
      />

      <dl className="grid grid-cols-1 gap-4 rounded-2xl border p-5 sm:grid-cols-2 lg:grid-cols-5">
        <Fact label="Fuobe">Version {about.version}</Fact>
        <Fact label="Source code">
          <a href={FUOBE_REPO} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-text underline underline-offset-2">
            GitHub <ExternalLink className="size-3" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </Fact>
        <Fact label="Licence">
          <a href={`${FUOBE_REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-text underline underline-offset-2">
            MIT <ExternalLink className="size-3" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </Fact>
        <Fact label="Open engine">
          {about.workflowCount} ComfyUI workflows{about.comfyui ? `, built for ComfyUI ${about.comfyui}` : ""}
          {about.builtAt ? <span className="text-muted-foreground"> · {about.builtAt}</span> : null}
        </Fact>
        <Fact label="Paid models">fal.ai and Replicate with your key: their terms and prices apply</Fact>
      </dl>

      {list.notices.length > 0 && (
        <section aria-labelledby="notices" className="mt-8">
          <h2 id="notices" className="text-[15px] font-semibold">
            Notices
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">Some licences ask the app that runs their model to say so.</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {list.notices.map((n) => (
              <li key={n.text} className="rounded-xl bg-muted/60 px-4 py-3">
                <p className="text-[15px] font-semibold">{n.text}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground [overflow-wrap:anywhere]">For {n.models.join(", ")}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="credits" className="mt-8">
        <h2 id="credits" className="text-[15px] font-semibold">
          Credits
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">Attributions the licences of the data and code behind Fuobe&apos;s open models ask for.</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {ATTRIBUTIONS.map((a) => (
            <li key={a.text} className="min-w-0 rounded-xl border px-4 py-3">
              <p className="text-[13px] [overflow-wrap:anywhere]">
                {a.url ? (
                  <a href={a.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-brand-text">
                    {a.text}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  a.text
                )}
              </p>
              <p className="mt-0.5 text-[12px] text-muted-foreground [overflow-wrap:anywhere]">
                {a.licence} · for {a.for}
              </p>
              {a.note && <p className="mt-1 text-[12px] text-muted-foreground [overflow-wrap:anywhere]">{a.note}</p>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="licences" className="mt-10">
        <h2 id="licences" className="font-heading text-[24px] leading-tight">
          Open model licences
        </h2>
        <p className="mt-1 mb-5 max-w-2xl text-[13px] text-muted-foreground">
          Fuobe&apos;s studios offer {models.open} open-source models and tools. The list below has {list.counts.all} entries, one for each set of open weights Fuobe
          runs: the studios&apos; models, the helper steps presets run, and {library} more workflows in the library. Tools with no weights aren&apos;t listed.
          {" "}{list.counts.clear} allow commercial use, {list.counts.conditions} with conditions (revenue limits or use rules), {list.counts["non-commercial"]} non-commercial
          and {list.counts.territory} not available everywhere. Read the licence itself before you sell what you make; this list is a guide, not legal advice. Which models this install offers
          is set in{" "}
          <Link href="/settings/models" className="text-brand-text underline underline-offset-2">
            Models &amp; licences
          </Link>
          , which counts every model in the catalog, paid ones included.
        </p>
        <LicencesView list={list} />
      </section>

      <section aria-labelledby="elsewhere" className="mt-10 border-t pt-6">
        <h2 id="elsewhere" className="text-[15px] font-semibold">
          Elsewhere
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-muted-foreground">
          <li>
            Models you run in Ollama, LM Studio or Unsloth Studio for Assist and prompt enhancement carry their own licences: see each model&apos;s card, or{" "}
            <code className="font-mono text-[12px]">ollama show &lt;model&gt; --license</code> in Ollama.
          </li>
          <li>The optional TRIBE v2 worker for the Virality page isn&apos;t bundled; its weights are CC BY-NC 4.0 (non-commercial).</li>
          <li>
            Each workflow&apos;s models, sizes and download links are on the{" "}
            <Link href="/workflows" className="text-brand-text underline underline-offset-2">
              Workflows
            </Link>{" "}
            page.
          </li>
        </ul>
      </section>
    </PageShell>
  );
}
