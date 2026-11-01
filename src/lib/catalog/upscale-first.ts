import { REGEN_DEFAULT_TIER, REGEN_MODEL } from "./regenerate";

/**
 * Upscale → Video's "before upscaling" steps: one list, so each finishing package adds its row here (archive-restore:
 * Restore archive footage first; n7-3: Regenerate in 2K). A row opens its tool with the step that upscales after it
 * already on, so the tool runs both as one job (Restore & colourise: `?then=upscale`), or, for Regenerate, this page on
 * the model that redraws and enlarges in one run.
 */
export interface UpscaleFirstStep {
  id: string;
  label: string;
  /** One line under the label: what the step does and that the upscale follows it. */
  hint: string;
  /** The tool that runs the step, then the upscale. */
  href: string;
  /** GPU-only (nobody hosts its model): hidden when Engine mode is "Paid APIs only". */
  openOnly?: true;
}

export const UPSCALE_FIRST_STEPS: UpscaleFirstStep[] = [
  {
    id: "restore",
    label: "Restore archive footage first",
    hint: "Old scans, tape or black and white: cleaned and colourised by Fuobe Restore, then upscaled, in one run",
    href: "/video-tools/restore?then=upscale",
  },
  {
    id: "regenerate",
    label: "Regenerate a soft AI clip in 2K",
    hint: "Open-H3 Regenerate redraws it at 2K on your GPU from its words: details may change; motion, layout and sound stay",
    href: `/upscale/video?model=${REGEN_MODEL}&resolution=${REGEN_DEFAULT_TIER}`,
    openOnly: true,
  },
];

/** The query a tool reads to switch its "then upscale" step on. */
export const THEN_UPSCALE = "upscale";
