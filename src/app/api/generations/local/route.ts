import { z } from "zod";
import { LIBRARY_MESSAGE } from "@/lib/guest-access";
import { RECIPE_MAX_BYTES, RecipeSchema } from "@/lib/motion/recipe";
import { ACCOUNT_LIMITS, ACCOUNT_MESSAGES, diskHasRoom } from "@/server/account-files";
import { fileAccount } from "@/server/account-library";
import { accountInputProblem } from "@/server/account-inputs";
import { requestViewer } from "@/server/auth";
import { getGeneration, recordLocalGeneration } from "@/server/generations";
import { moderateRun } from "@/server/hosted-run";
import { holdForCheck } from "@/server/output-checks";
import { hit, unhit } from "@/server/rate";
import { db } from "@/server/db";
import { contentTypeFor, filesRel } from "@/server/storage";
import { runAsTenant } from "@/server/tenant";

const Body = z
  .object({
    feature: z.string().min(1).max(80),
    modelId: z.string().min(1),
    op: z.enum(["grade", "relight", "motion"]),
    prompt: z.string().max(2000),
    title: z.string().max(200).optional(),
    inputs: z.object({ images: z.array(z.string().max(500)).max(4).optional(), video: z.string().max(500).optional() }),
    params: z.object({ extra: z.record(z.string(), z.unknown()).optional() }).optional(),
    output: z.object({
      url: z.string().startsWith("/api/files/").max(500),
      kind: z.enum(["image", "video"]),
      contentType: z.string().optional(),
      /** A clip's poster (its last frame), shown on its tile. */
      meta: z.object({ poster: z.string().startsWith("/api/files/").max(500) }).strict().optional(),
    }),
  })
  .superRefine((b, ctx) => {
    // A grade or a Relight blend is made from one picture; a motion clip from its logo and product (up to 4).
    if (b.op !== "motion" && (b.inputs.images?.length ?? 0) > 1) ctx.addIssue({ code: "custom", path: ["inputs", "images"], message: "One picture" });
    if (b.op === "motion") {
      const recipe = b.params?.extra?.motion;
      if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) ctx.addIssue({ code: "custom", path: ["params", "extra", "motion"], message: "The recipe" });
      else if (JSON.stringify(recipe).length > RECIPE_MAX_BYTES) ctx.addIssue({ code: "custom", path: ["params", "extra", "motion"], message: "The recipe is too big" });
      else if (!RecipeSchema.safeParse(recipe).success) ctx.addIssue({ code: "custom", path: ["params", "extra", "motion"], message: "The recipe" });
      if (b.output.kind !== "video" || !/^video\/(mp4|webm)$/.test(b.output.contentType ?? "")) ctx.addIssue({ code: "custom", path: ["output"], message: "An MP4 or WebM clip" });
      // A clip is made from pictures (its logo, its product): never from a video.
      if (b.inputs.video) ctx.addIssue({ code: "custom", path: ["inputs", "video"], message: "No video" });
    }
  });

const NOT_FOUND = "We can't find that.";
const refuse = (status: number, error: string, extra: Record<string, unknown> = {}) => Response.json({ error, ...extra }, { status, headers: { "Cache-Control": "no-store" } });

/** The asset behind a stored file's address, for the output check. */
function assetIdOf(url: string): string | undefined {
  const rel = filesRel(url);
  if (!rel) return undefined;
  const native = rel.split("/").join(process.platform === "win32" ? "\\" : "/");
  return (db().prepare("SELECT id FROM assets WHERE rel_path IN (?, ?) LIMIT 1").get(rel, native) as { id: string } | undefined)?.id;
}

/** The stored file's own type differs from what the result says it is (a picture is never recorded as a clip). */
function typeProblem(rel: string, output: { kind: string; contentType?: string }, op: string): boolean {
  const stored = contentTypeFor(rel);
  if (!stored.startsWith(`${output.kind}/`)) return true;
  if (output.contentType && output.contentType.split(";")[0].trim().toLowerCase() !== stored) return true;
  return op === "motion" && !/^video\/(mp4|webm)$/.test(stored);
}

/** The files a motion recipe names: its logo when it is stored here, its product and its pictures. */
function recipeFiles(extra: Record<string, unknown> | undefined): Record<string, string | string[]> {
  const r = RecipeSchema.safeParse(extra?.motion);
  if (!r.success) return {};
  const out: Record<string, string | string[]> = {};
  // A stored logo is checked as a file; the kit's own link is only kept (the server never fetches it for an account).
  // (" /api/files/…" is no stored file's path: it is checked, and refused, as written.)
  const logo = r.data.brand.logo;
  if (logo?.includes("/api/files/")) out._logo = logo;
  if (r.data.media?.product) out._product = r.data.media.product;
  if (r.data.media?.images?.length) out._media = r.data.media.images;
  return out;
}

/** The words a motion clip shows (its typed fields and the brand's name) and its title: what the studio's checks read. */
function shownWords(extra: Record<string, unknown> | undefined, title: string | undefined): string {
  const r = RecipeSchema.safeParse(extra?.motion);
  const words = r.success ? [...Object.values(r.data.fields), r.data.brand.name] : [];
  return [...new Set([...words, title ?? ""].map((w) => w.trim()).filter(Boolean))].join(" · ").slice(0, 2000);
}

/**
 * Record a result rendered in the browser (a colour grade, a Relight blend, a Kinetic Motion clip) so it shows up in the
 * library. The owner records their own files. An account (public sign-up) records Kinetic Motion clips only, each from
 * files it uploaded itself: the result is its own run (its own list, never the owner's Library), counted with its runs,
 * and through the studio's checks when they are on.
 */
export async function POST(request: Request) {
  const viewer = requestViewer(request);
  if (viewer.kind === "guest") return refuse(401, "Create a free account to run this.");
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return refuse(400, "Invalid result");
  const body = parsed.data;
  const rel = filesRel(body.output.url);
  if (rel === null) return refuse(403, NOT_FOUND);
  if (typeProblem(rel, body.output, body.op)) return refuse(400, "Invalid result");
  const poster = body.output.meta?.poster;
  if (poster && (body.output.kind !== "video" || !contentTypeFor(filesRel(poster) ?? "").startsWith("image/"))) return refuse(400, "Invalid result");

  if (viewer.kind === "owner") {
    // The owner's own files only: never an account's file recorded as the owner's result.
    const named = Object.values(recipeFiles(body.params?.extra)).flat();
    const refs = [body.output.url, ...(poster ? [poster] : []), ...(body.inputs.images ?? []), ...(body.inputs.video ? [body.inputs.video] : []), ...named].filter((r) => r.startsWith("/api/files/"));
    for (const ref of refs) {
      const r = filesRel(ref);
      if (r === null || typeof fileAccount(r) === "string") return refuse(403, NOT_FOUND);
    }
    try {
      return Response.json(recordLocalGeneration(body), { status: 201 });
    } catch (e) {
      return refuse(422, (e as Error).message);
    }
  }

  const account = viewer.account;
  // Accounts have their own runs, not the owner's Library: only Kinetic Motion results, recorded as their runs.
  if (body.op !== "motion") return refuse(403, LIBRARY_MESSAGE, { code: "library" });
  if (fileAccount(rel) !== account.id) return refuse(403, NOT_FOUND);
  // Every file the clip names is the account's own: its inputs, its poster, and the recipe's logo, product and pictures.
  const problem = accountInputProblem({ inputs: body.inputs, params: { extra: { ...recipeFiles(body.params?.extra), ...(poster && { _poster: poster }) } } }, account.id);
  if (problem) return refuse(problem.status === 404 ? 403 : problem.status, problem.status === 404 || problem.code === "input-not-yours" ? NOT_FOUND : problem.error, { code: problem.code });
  if (!diskHasRoom()) return refuse(503, ACCOUNT_MESSAGES.diskLow);
  // A saved clip is one of the account's runs: the same hourly budget.
  const bucket = `run:${account.id}`;
  const rate = hit(bucket, ACCOUNT_LIMITS.runsPerHour, 60 * 60_000);
  if (!rate.ok) return Response.json({ error: ACCOUNT_MESSAGES.runRate }, { status: 429, headers: { "Retry-After": String(rate.retryAfterS), "Cache-Control": "no-store" } });
  // The words drawn on the clip and its title (never the page's own summary of them) go through the studio's checks,
  // and are what the run keeps.
  const prompt = shownWords(body.params?.extra, body.title);
  const place = account.gpu ? ("own-gpu" as const) : account.keys?.fal || account.keys?.replicate ? ("own-key" as const) : ("pool" as const);
  const checked = await moderateRun(account, { feature: body.feature, modelId: body.modelId, op: body.op, prompt, inputs: body.inputs }, null, "own", { kind: "video", place });
  if (!checked.ok) {
    unhit(bucket);
    return refuse(422, checked.refusal.body.error, { code: checked.refusal.body.code });
  }
  try {
    const g = runAsTenant({ kind: "account", id: account.id }, () => recordLocalGeneration({ ...body, prompt }));
    if (checked.checkOutputs) {
      // Held until the output check answers, as any account run's files are.
      const assetId = assetIdOf(body.output.url);
      holdForCheck(g.id, [{ ...body.output, ...(assetId && { assetId }) }]);
      return Response.json(getGeneration(g.id) ?? g, { status: 201 });
    }
    return Response.json(g, { status: 201 });
  } catch (e) {
    unhit(bucket);
    return refuse(422, (e as Error).message);
  }
}
