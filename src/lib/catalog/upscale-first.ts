/**
 * Upscale → Video's "before upscaling" steps: one list, so each finishing package adds its row here (archive-restore:
 * Restore archive footage first; n7-3's Regenerate in 2K is meant to be the next). A row opens its tool with the
 * step that upscales after it already on, so the tool runs both as one job (Restore & colourise: `?then=upscale`).
 */
export interface UpscaleFirstStep {
  id: string;
  label: string;
  /** One line under the label: what the step does and that the upscale follows it. */
  hint: string;
  /** The tool that runs the step, then the upscale. */
  href: string;
}

export const UPSCALE_FIRST_STEPS: UpscaleFirstStep[] = [
  {
    id: "restore",
    label: "Restore archive footage first",
    hint: "Old scans, tape or black and white: cleaned and colourised by Fuobe Restore, then upscaled, in one run",
    href: "/video-tools/restore?then=upscale",
  },
];

/** The query a tool reads to switch its "then upscale" step on. */
export const THEN_UPSCALE = "upscale";
