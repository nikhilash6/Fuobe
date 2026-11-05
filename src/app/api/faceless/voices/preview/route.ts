import { z } from "zod";
import { asViewer, guestRun, onceForAccount, pressIdOf, runAccountTool, toolViewer } from "@/server/account-tool-run";
import { body, handle, voicePreview, voicePreviewPlan } from "@/server/faceless";
import { planned } from "@/server/faceless-account";

const Ask = z.object({ id: z.string().min(1).max(80) });

/**
 * A short sample of a premade narrator voice: one speech generation, reused once it exists. An account's is its own
 * (on its own key, after the checks a studio run gets), reused for it only; a guest signs up first.
 */
export async function POST(request: Request) {
  const viewer = toolViewer(request);
  if (viewer.kind === "guest") return guestRun();
  return handle(async () => {
    const { id } = await body(request, Ask, "Pick a voice");
    const voice = { kind: "preset" as const, id };
    if (viewer.kind === "owner") return Response.json(voicePreview(voice));
    const p = asViewer(viewer, () => voicePreviewPlan(voice));
    if ("made" in p) return Response.json(p.made);
    // On this install's GPUs, a resend of this press (its id in the header) gets the sample the first one started.
    return onceForAccount(
      viewer.account,
      `faceless-voice:${voice.id}`,
      pressIdOf(request),
      () => runAccountTool(request, viewer.account, { tool: "faceless", files: [], plan: () => planned(() => [{ request: p.request }]), start: () => voicePreview(voice) }),
      ({ value }) => Response.json(value),
    );
  }, request);
}
