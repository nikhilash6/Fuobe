import { connection } from "next/server";
import { computerView, visitorStatus } from "@/server/account-gpu";
import { requestViewer } from "@/server/auth";
import { aiHelper, localSummary } from "@/server/llm";
import { PROVIDERS } from "@/server/providers";
import { comfyRam, probeComfy } from "@/server/providers/comfyui";
import { llmBackends } from "@/server/providers/llm";
import { nothingConnected, type EngineModeName } from "@/lib/connections";
import { getSetting, setSetting } from "@/server/settings";
import { offeredSummary } from "@/server/model-access";
import { poolOwnModels } from "@/server/pool-own-setup";
import { placeName } from "@/server/place-name";
import { helperKnown, helperLive } from "@/server/text-helper";

/** Which providers are usable right now — drives badges, the demo-mode notice and Home's first-run guide. */
export async function GET(request?: Request) {
  await connection();
  // A guest or an account (public sign-up) sees its own GPU, never the install's providers or servers.
  const viewer = request ? requestViewer(request) : ({ kind: "owner" } as const);
  if (viewer.kind !== "owner") return Response.json(await visitorStatus(viewer.kind === "account" ? viewer.account : null), { headers: { "Cache-Control": "no-store" } });
  // Both asked first, so the llm provider's label and routing read fresh answers without waiting.
  const [comfy, local] = await Promise.all([probeComfy(true), localSummary()]);
  const ram = comfy ? comfyRam() : undefined;
  const providers = Object.fromEntries(
    Object.values(PROVIDERS).map((p) => [
      p.id,
      // ComfyUI's RAM: the composer checks the tools that hold a whole clip against it before Generate.
      { label: p.label, configured: p.id === "comfyui" ? comfy : p.id === "mock" ? true : p.isConfigured(), ...(p.id === "comfyui" && ram ? { ramBytes: ram } : {}) },
    ]),
  );
  const engineMode = getSetting("engineMode") as EngineModeName;
  const access = offeredSummary();
  // The first time something this engine mode generates with is connected, the first-run guide has
  // done its job: remember it, so a ComfyUI that is offline one morning doesn't bring "Get started" back.
  let onboarded = getSetting("onboarded") === "1";
  if (!onboarded && !nothingConnected({ providers, engineMode })) {
    setSetting("onboarded", "1");
    onboarded = true;
  }
  // ComfyUI runs on the owner's computer: what the owner's Fuobe tab there last said (ComfyUI stays "configured", so runs
  // wait for that tab instead of turning into demos).
  const ownerGpu = getSetting("comfyWhere") === "computer" ? computerView("owner") : undefined;
  // ComfyUI runs on the workers: the open models none of them can run now (the same set a visitor's pickers read), so
  // the owner's pickers order, tag and default as his runs will go (src/lib/runnable-here.ts).
  const ownerPool = getSetting("comfyWhere") === "workers" ? { own: poolOwnModels() } : undefined;
  return Response.json({
    providers,
    demoMode: getSetting("demoMode"),
    engineMode,
    cloudProvider: getSetting("cloudProvider"),
    onboarded,
    ...(ownerGpu && { ownerGpu }),
    ...(ownerPool && { pool: ownerPool }),
    // Settings → Models & licences: the models switched off, so pickers leave them out (absent while everything is on).
    ...(access && { access }),
    // The text LLM: the AI helper setting, whether Claude takes text steps, the local server (no keys), and the free
    // helper on the workers' text slots (with the name visitors read for them).
    llm: { helper: aiHelper(), claude: llmBackends({ endpoint: "auto" })[0] === "claude", ...local, free: { live: helperLive(), known: helperKnown(), label: placeName() } },
  });
}
