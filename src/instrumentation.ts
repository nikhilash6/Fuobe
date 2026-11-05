/**
 * Runs once when the server starts: start the generation runner right away, so jobs that were in
 * flight before a restart keep advancing (and live updates flow) even when the UI only lists them.
 * Also empties what has been in the Trash for 30 days (then daily), starts Assist's scheduled tasks and Character
 * Swap Studio's sweep. On SIGTERM or SIGINT, ends the live-updates streams and stops these runners, so the server
 * stops at once (src/server/shutdown.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { drainOnSignals } = await import("./server/shutdown");
  drainOnSignals();
  // Sign-in data: an older install's auth.json moves into the database now, before the first request.
  const { ensureAuthStore } = await import("./server/auth-store");
  ensureAuthStore();
  const { ensureRunner } = await import("./server/generations");
  ensureRunner();
  const { ensureTrashPurge } = await import("./server/library");
  ensureTrashPurge();
  // Public sign-up: accounts' uploads leave after 14 days and their runs after 30 (then daily); a deleted account's files go.
  const { ensureAccountSweep } = await import("./server/account-sweep");
  ensureAccountSweep();
  // "Use the ComfyUI on this computer": jobs whose run stopped going end, and the relay's leftover files go.
  const { ensureRelaySweep } = await import("./server/computer/tasks");
  const { onAccountDeleted } = await import("./server/account-files");
  ensureRelaySweep(onAccountDeleted);
  // Where a deleted account's runs went (its pick of a place, hosted runs) goes with it.
  const { clearRunOn } = await import("./server/run-on");
  onAccountDeleted(clearRunOn);
  // Its runs waiting to enter the line on this install's GPUs (hosted runs) go with it too.
  const { clearHolds } = await import("./server/pool-holds");
  onAccountDeleted(clearHolds);
  // Faceless / Explainer renders whose narration was timed while the server was down continue with their scenes.
  const { ensureFacelessRunner } = await import("./server/faceless");
  ensureFacelessRunner();
  // Assist's scheduled tasks: a 30 s sweep starts the runs that are due (a run missed while the server was off happens once, a few seconds after boot).
  const { ensureScheduleRunner } = await import("./server/assist/schedules");
  ensureScheduleRunner({ soon: true });
  // Skills whose steps wait across studios: each waiting step starts when the step it takes a result from is done.
  const { ensureSkillRunRunner } = await import("./server/skill-runs");
  ensureSkillRunRunner();
  // Character Swap Studio: takes queued behind the segments they continue from launch (or stop) when those finish.
  const { ensureSwapStudioRunner } = await import("./server/swap-studio");
  ensureSwapStudioRunner();
}
