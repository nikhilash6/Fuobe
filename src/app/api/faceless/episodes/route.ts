import { connection } from "next/server";
import { z } from "zod";
import { CF_LENGTH_VALUES } from "@/lib/catalog/content-factory";
import { FACELESS_LENGTHS, MAX_SCRIPT, MAX_TOPIC } from "@/lib/catalog/faceless";
import { body, createEpisode, FacelessError, getChannel, handle, listEpisodes, SettingsSchema } from "@/server/faceless";

const Create = z.object({
  channelId: z.string().max(40),
  topic: z.string().max(MAX_TOPIC, "Keep the topic under 5,000 characters"),
  script: z.string().max(MAX_SCRIPT, "That script is too long to narrate. Shorten it and try again.").optional(),
  settings: SettingsSchema,
  /** Save this episode's look and sound as the channel's (default: only for its first episode). */
  saveLook: z.boolean().optional(),
});

/** Episodes, newest first (`?channel=` for one channel). */
export async function GET(request: Request) {
  await connection();
  return handle(() => {
    const p = new URL(request.url).searchParams;
    return Response.json({ items: listEpisodes({ channelId: p.get("channel") ?? undefined, kind: "faceless", q: p.get("q") ?? undefined, limit: 200 }) });
  });
}

/** A new episode: the script is written (or your pasted script split into scenes) in the background, then it waits for your review. */
export async function POST(request: Request) {
  return handle(async () => {
    const input = await body(request, Create, "Pick a topic and the video settings");
    // A Content Factory channel (its settings carry a style brief) also makes 30-second episodes.
    const lengths = getChannel(input.channelId)?.settings.brief ? CF_LENGTH_VALUES : FACELESS_LENGTHS;
    if (!lengths.includes(input.settings.length)) throw new FacelessError("Choose one of the offered video lengths");
    return Response.json(createEpisode({ kind: "faceless", channelId: input.channelId, topic: input.topic, script: input.script, settings: input.settings, saveLook: input.saveLook }), { status: 201 });
  }, request);
}
