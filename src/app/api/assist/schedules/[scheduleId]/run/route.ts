import { after } from "next/server";
import { ScheduleError, startSchedule } from "@/server/assist/schedules";

/**
 * Run a task now, off schedule: a new chat starts and the agent works in the background (202). No new
 * chat: 409 while the last run is still going; 422 with the reason when the run couldn't start (its
 * project is gone, so the task paused, or the chat failed to start).
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/assist/schedules/[scheduleId]/run">) {
  try {
    const started = await startSchedule((await ctx.params).scheduleId, { manual: true });
    if (started.threadId === null) return Response.json({ threadId: null, reason: started.reason, error: started.message }, { status: started.reason === "busy" ? 409 : 422 });
    after(() => started.done);
    return Response.json({ threadId: started.threadId }, { status: 202 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof ScheduleError ? e.status : 500 });
  }
}
