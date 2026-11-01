import { z } from "zod";
import { ACCOUNT_LIBRARY_MESSAGE, GUEST_RUN_MESSAGE, LIBRARY_MESSAGE } from "@/lib/guest-access";
import { generationAccount } from "@/server/account-library";
import { requestViewer } from "@/server/auth";
import { deleteForever, moveToFolder, restoreGenerations, setFavorites, setPinned, setReview, trashGenerations } from "@/server/library";

const Body = z.object({
  action: z.enum(["trash", "restore", "delete", "favorite", "unfavorite", "move", "pin", "unpin", "review"]),
  ids: z.array(z.string().min(1).max(40)).min(1).max(500),
  /** For "move": the folder, or null for the library root. */
  folderId: z.string().max(40).nullable().optional(),
  /** For "review": the status, or null to clear it. */
  review: z.enum(["in-progress", "needs-review", "approved", "rejected"]).nullable().optional(),
});

/** What an account (public sign-up) may do to its own runs here: no Trash, folders or restore (the owner's library has those). */
const ACCOUNT_ACTIONS = new Set(["favorite", "unfavorite", "pin", "unpin", "review"]);

/** One action on many generations: Trash / Restore / Delete forever / (un)favorite / move to a folder / (un)pin / review status. */
export async function POST(request: Request) {
  const viewer = requestViewer(request);
  if (viewer.kind === "guest") return Response.json({ error: GUEST_RUN_MESSAGE }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pick something first" }, { status: 400 });
  const { action, ids, folderId, review } = parsed.data;
  // An account (the proxy lets its bulk changes through to here): its own runs only, and only a like, a pin or a review.
  if (viewer.kind === "account") {
    if (!ACCOUNT_ACTIONS.has(action)) return Response.json({ error: LIBRARY_MESSAGE, code: "library" }, { status: 403 });
    if (ids.some((id) => generationAccount(id) !== viewer.account.id)) return Response.json({ error: ACCOUNT_LIBRARY_MESSAGE }, { status: 403 });
  }
  try {
    const count =
      action === "trash"
        ? trashGenerations(ids)
        : action === "restore"
          ? restoreGenerations(ids)
          : action === "delete"
            ? await deleteForever(ids)
            : action === "move"
              ? moveToFolder(ids, folderId ?? null)
              : action === "pin" || action === "unpin"
                ? setPinned(ids, action === "pin")
                : action === "review"
                  ? setReview(ids, review ?? null)
                  : setFavorites(ids, action === "favorite");
    return Response.json({ count });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
