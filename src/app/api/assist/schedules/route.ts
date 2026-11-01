import { connection } from "next/server";
import { createSchedule, listSchedules, ScheduleError } from "@/server/assist/schedules";
import { ScheduleBody } from "@/server/assist/schemas";

const issue = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Check the schedule";

/** Scheduled tasks (all, `?project=<id>`, or `?project=none` for those outside projects). */
export async function GET(request: Request) {
  await connection();
  const project = new URL(request.url).searchParams.get("project");
  return Response.json({ items: listSchedules({ project: project === "none" ? null : (project ?? undefined) }) });
}

export async function POST(request: Request) {
  const parsed = ScheduleBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: issue(parsed.error) }, { status: 400 });
  try {
    return Response.json(createSchedule(parsed.data), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof ScheduleError ? e.status : 500 });
  }
}
