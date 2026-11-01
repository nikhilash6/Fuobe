import { LIVE_NODES_FILE_NAME, LIVE_NODES_SOURCE } from "@/lib/comfy-live-nodes";

/**
 * Fuobe's live edit nodes for ComfyUI (fuobe_live.py), as a download: put it in ComfyUI's custom_nodes folder and
 * restart ComfyUI. The same file the Windows start file writes; open source, so anyone may fetch it.
 */
export function GET() {
  return new Response(LIVE_NODES_SOURCE, {
    headers: {
      "Content-Type": "text/x-python; charset=utf-8",
      "Content-Disposition": `attachment; filename="${LIVE_NODES_FILE_NAME}"`,
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
