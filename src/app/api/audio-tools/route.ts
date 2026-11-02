import { AudioToolBody, AudioToolError, previewAudioTool, runAudioTool } from "@/server/audio-tools";
import { connectRefusal } from "@/server/connect-refusal";
import { ConnectComfyError } from "@/server/generations";
import { priceAs } from "@/server/visitor";

/** What a field that doesn't check out means, in words the page shows. */
const MESSAGES: Record<string, string> = {
  media: "Add the audio or video to split",
  video: "Add the video to put the mix on",
  audio: "Add the audio to loop",
  duration: "Pick a length up to 10 minutes",
  crossfade: "Keep the crossfade between 0 and 10 seconds",
  musicDb: "Lower the music by 0 to 30 dB",
};

/**
 * Audio → Loop / extend, Join, Split soundtrack (and its Clean up dialogue) and Clean up voice (and a split's mix put back on its video), and Video
 * tools → Remove dialogue: start a run; `?preview=1` only plans and prices it.
 */
async function post(request: Request) {
  const raw: unknown = await request.json().catch(() => null);
  const parsed = AudioToolBody.safeParse(raw);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path.join(".") ?? "";
    const tool = (raw as { tool?: unknown } | null)?.tool;
    const msg = path.startsWith("clips")
      ? "Add 2 to 10 audio clips to join"
      : tool === "remux" && path === "audio"
        ? "Export the mix first"
        : tool === "remove-dialogue" && path === "video"
          ? "Add the video to take the dialogue out of"
          : (tool === "clean" || tool === "clean-dialogue") && path === "media"
            ? "Add the audio or video to clean"
            : (MESSAGES[path] ?? "Check the settings");
    return Response.json({ error: msg }, { status: 400 });
  }
  const preview = new URL(request.url).searchParams.get("preview") === "1";
  try {
    if (preview) return Response.json(await previewAudioTool(parsed.data));
    return Response.json(await runAudioTool(parsed.data), { status: 201 });
  } catch (e) {
    if (e instanceof AudioToolError) return Response.json({ error: e.message }, { status: 422 });
    // Nothing connected runs it: the connect card in the owner's browser (a price check just says so).
    if (e instanceof ConnectComfyError) return connectRefusal(e, request, preview) ?? Response.json({ error: e.message }, { status: 422 });
    console.error("[audio-tools]", e);
    return Response.json({ error: (e as Error).message || "Something went wrong" }, { status: 500 });
  }
}

/** A visitor (public sign-up) gets the price of its run on its own GPU, never a demo (src/server/visitor.ts). */
export async function POST(request: Request) {
  return priceAs(request, () => post(request));
}
