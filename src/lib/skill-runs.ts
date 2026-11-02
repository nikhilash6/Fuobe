/**
 * A run of a skill whose steps wait for each other across studios (package W7, src/server/skill-runs.ts): each step's
 * status, the results it made and the studio page it opened in. Types only.
 */

export type SkillRunStatus = "running" | "done" | "failed";
export type SkillStepStatus = "waiting" | "running" | "done" | "failed";

export interface SkillRunStep {
  key: string;
  /** "Dub", "Captions", "9:16 cut". */
  label: string;
  kind: "generate" | "tool";
  status: SkillStepStatus;
  /** The generations it started. */
  ids: string[];
  /** The studio its job opened in, and the page there. */
  studio?: string;
  href?: string;
  /** Why it failed, or why it didn't start. */
  error?: string;
}

export interface SkillRunView {
  id: string;
  skill: string;
  status: SkillRunStatus;
  createdAt: number;
  updatedAt: number;
  steps: SkillRunStep[];
  /** Which step failed and why. */
  error?: string;
}
