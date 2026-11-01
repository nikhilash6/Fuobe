import type { Metadata } from "next";
import { PageHeader, PageShell } from "@/components/page-shell";
import { WorkflowsView } from "@/components/workflows-view";
import { MODELS } from "@/lib/catalog";
import { WORKFLOWS_ON_GITHUB } from "@/lib/comfy-install";

export const metadata: Metadata = { title: "ComfyUI workflows" };

/** Which open models run each workflow; computed here so the view needs no catalog in the browser. */
const ROUTES = MODELS.flatMap((m) => m.routes.filter((r) => r.provider === "comfyui").map((r) => ({ endpoint: r.endpoint, name: m.name })));

export default function Page() {
  return (
    <PageShell wide>
      <PageHeader
        title="ComfyUI workflows"
        description={
          <>
            The open-source engine. Each workflow is an API-format ComfyUI graph exported from the official templates, with bindings Fuobe uses to inject prompts, images and
            settings. Download one below, or browse them all{" "}
            <a href={WORKFLOWS_ON_GITHUB} target="_blank" rel="noreferrer" className="text-brand-text underline underline-offset-2">
              on GitHub
            </a>
            .
          </>
        }
      />
      <WorkflowsView routes={ROUTES} />
    </PageShell>
  );
}
