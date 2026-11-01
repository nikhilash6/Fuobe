import { z } from "zod";
import { ACCOUNT_MESSAGES } from "@/server/account-files";
import { GUEST_RUN_MESSAGE } from "@/lib/guest-access";
import { requestViewer } from "@/server/auth";
import { enter, hit } from "@/server/rate";
import { probeSource } from "@/server/shorts";
import { body, handle } from "@/server/shorts-schemas";
import { runAsTenant } from "@/server/tenant";

/**
 * An uploaded clip's length, size, frame rate and whether it has sound, from its header (MP4 / MOV, WebM).
 * The composer prices clip-length tools with it and says what comes out (Upscale hub: "24 → 60 fps").
 * An account reads only its own files (another's answers like one that is gone), no bigger than its uploads may be, 60
 * a minute and 2 at once (6 at once for all accounts together).
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { url } = await body(request, z.object({ url: z.string().startsWith("/api/files/").max(500) }), "Upload the clip first");
    const viewer = requestViewer(request);
    if (viewer.kind === "owner") return Response.json(await probeSource(url));
    if (viewer.kind !== "account") return Response.json({ error: GUEST_RUN_MESSAGE }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const { account } = viewer;
    const busy = () => Response.json({ error: ACCOUNT_MESSAGES.probeRate }, { status: 429, headers: { "Retry-After": "10", "Cache-Control": "no-store" } });
    if (!hit(`probe:${account.id}`, 60, 60_000).ok) return busy();
    const release = enter(`probe:${account.id}`, 2);
    if (!release) return busy();
    // And a few at once across every account: each check reads its clip (95 MB at most) into memory.
    const releaseAll = enter("probe:accounts", 6);
    if (!releaseAll) {
      release();
      return busy();
    }
    try {
      return Response.json(await runAsTenant({ kind: "account", id: account.id }, () => probeSource(url)));
    } finally {
      releaseAll();
      release();
    }
  }, request);
}
