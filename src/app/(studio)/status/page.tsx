import fs from "node:fs/promises";
import path from "node:path";
import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { PageHeader, PageShell } from "@/components/page-shell";
import { modelCounts } from "@/lib/catalog";
import type { Manifest } from "@/lib/comfy";
import { FUOBE_REPO } from "@/lib/connections";
import { headingId, STATUS_ON_GITHUB, statusBody, statusDate, statusLink, statusOutline } from "@/lib/status-page";

export const metadata: Metadata = { title: "Project status" };

async function readStatus(): Promise<string> {
  "use cache";
  try {
    return await fs.readFile(path.join(process.cwd(), "docs", "STATUS.md"), "utf8");
  } catch {
    return "# Project status\n\ndocs/STATUS.md is missing.";
  }
}

/** The workflow library's size, from the manifest the Workflows page lists. */
async function readWorkflows(): Promise<{ all: number; validated: number }> {
  "use cache";
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(process.cwd(), "workflows", "comfyui", "manifest.json"), "utf8")) as Manifest;
    return { all: manifest.workflows.length, validated: manifest.workflows.filter((w) => w.validated).length };
  } catch {
    return { all: 0, validated: 0 };
  }
}

type HastNode = { type: string; value?: string; children?: HastNode[] };
const textOf = (n?: HastNode): string => (n?.type === "text" ? (n.value ?? "") : (n?.children ?? []).map(textOf).join(""));

/** The log's headings get ids (the contents link to them); its links open the repo's docs on GitHub, in a new tab. */
const LOG: Components = {
  h2: ({ node, ...props }) => <h2 id={headingId(textOf(node as HastNode))} className="scroll-mt-20" {...props} />,
  h3: ({ node, ...props }) => <h3 id={headingId(textOf(node as HastNode))} className="scroll-mt-20" {...props} />,
  a: ({ href, title, children }) =>
    href?.startsWith("#") ? (
      <a href={href} title={title}>
        {children}
      </a>
    ) : (
      <a href={href} title={title} target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[14px] [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

const link = "text-brand-text underline underline-offset-2";

export default async function Page() {
  const [md, workflows] = await Promise.all([readStatus(), readWorkflows()]);
  // The same numbers as Home and /models: models a visitor can pick, each once.
  const models = modelCounts();
  const updated = statusDate(md);
  const outline = statusOutline(md);
  return (
    <PageShell>
      <PageHeader
        title="Project status"
        description="Fuobe is an open-source creative studio on ComfyUI. Here is what works today, and below it the engineering log its builders keep after every round of work."
      />

      <dl className="grid grid-cols-1 gap-4 rounded-2xl border p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="ComfyUI workflows">
          <Link href="/workflows" className={link}>
            {workflows.all} workflows
          </Link>
          <span className="text-muted-foreground"> · {workflows.validated} validated on a real ComfyUI</span>
        </Fact>
        <Fact label="Models">
          <Link href="/models" className={link}>
            {models.open} open-source models and tools
          </Link>
          <span className="text-muted-foreground"> · {models.cloud} partner models in the cloud</span>
        </Fact>
        <Fact label="Licence">
          <a href={`${FUOBE_REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer" className={link}>
            MIT
          </a>
          <span className="text-muted-foreground"> · open source</span>
        </Fact>
        <Fact label="Last updated">{updated ?? "—"}</Fact>
      </dl>

      <section aria-labelledby="today" className="mt-8 max-w-3xl">
        <h2 id="today" className="text-[15px] font-semibold">
          What works today
        </h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed">
          <li>
            <span className="font-medium">Browse everything.</span> Every studio, app, camera motion and effect, the{" "}
            <Link href="/models" className={link}>
              models
            </Link>{" "}
            and the{" "}
            <Link href="/workflows" className={link}>
              workflow library
            </Link>{" "}
            can be browsed without an account.
          </li>
          <li>
            <span className="font-medium">Free accounts.</span> Sign up with an email, then{" "}
            <Link href="/connect" className={link}>
              connect your own ComfyUI
            </Link>{" "}
            (Your GPU): your runs go to your GPU. Or add your own fal.ai or Replicate key in Settings → Your keys to use paid models like Nano Banana, Kling and
            Veo, billed to your own account with them.
          </li>
          <li>
            <span className="font-medium">The open engine.</span> Each open-source model runs as a ComfyUI workflow; {workflows.validated} of the {workflows.all} graphs are
            accepted by a real ComfyUI. Every preview clip and still on this site was rendered locally on ComfyUI, on one RTX 5090.
          </li>
          <li>
            <span className="font-medium">Your own studio.</span> Fuobe is MIT-licensed. Run it yourself, with no account limits: the open models on your own GPU and the
            frontier ones on your own fal.ai or Replicate key, all on your own machine.
          </li>
        </ul>
      </section>

      <nav aria-labelledby="contents" className="mt-8 max-w-3xl rounded-2xl bg-muted/60 px-5 py-4">
        <h2 id="contents" className="text-[15px] font-semibold">
          In the engineering log
        </h2>
        <ol className="mt-2 space-y-1 text-[14px]">
          {outline.map((h) => (
            <li key={h.id} className={h.depth === 3 ? "pl-4 text-[13px]" : undefined}>
              <a href={`#${h.id}`} className="text-brand-text underline-offset-2 hover:underline">
                {h.text}
              </a>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
          The log is written by the coding agents that build Fuobe, on machines with no GPU and no paid keys, so “here” in it means those machines: what needs real
          weights or a paid key is marked built (🟢) rather than verified there.{" "}
          <a href={STATUS_ON_GITHUB} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-text underline underline-offset-2">
            The log on GitHub <ExternalLink className="size-3" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </p>
      </nav>

      <article className="prose-fuobe mt-10 max-w-3xl border-t pt-6">
        <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={statusLink} components={LOG}>
          {statusBody(md)}
        </ReactMarkdown>
      </article>
    </PageShell>
  );
}
