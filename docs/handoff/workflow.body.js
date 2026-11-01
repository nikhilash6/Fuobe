// The build workflow's body: each package goes implement → adversarial review → fix in its own worktree, then one
// integrator at a time merges it into BASE and runs the checks. make-workflow.mjs puts `export const meta` and the
// constants (REPO, WT, EXT, BASE, PLAN, TRAILER, LANES, DONE, PKGS, REMOVE_WORKTREES) in front of it; docs/HANDOFF.md
// explains how to run it. Lanes R and O run side by side; inside a lane, packages run in order, and a lane stops at
// the first package that fails a stage so a relaunch picks up there.

const PRODUCT = `PRODUCT DIRECTION (from the owner): Fuobe uses NO Higgsfield API or keys. Everything Higgsfield offers as its own product is rebuilt as a "Fuobe Original" from open-weight models plus LoRAs, on both engines: the open engine (the user's ComfyUI) and the cloud engine through HOSTED models on fal.ai / Replicate. Partner models (Kling, Seedance, Veo, Nano Banana, GPT Image…) stay available through fal / Replicate as separate choices. LICENCES ARE INFORMATION, NOT GATES: build every model and route; record each model's, LoRA's and node pack's licence as data and show it in Settings → Models & licences, where the admin turns things on or off. EACH ENGINE DOES ALL IT CAN (owner, 10-30): the cloud uses only models that are hosted (no substitute model), with what the hosted endpoint supports; the open engine keeps every capability it has (LoRAs, custom nodes, longer clips, references) even when the cloud can't match it; say plainly in the UI what each engine does. ACCOUNTS ARE THE OWNER'S PUBLIC SIGN-UP (owner, 10-30: main wins): guests browse, people sign up with an email, accounts see a guest view of the owner's library and run only on their own ComfyUI (docs/public-signup.md); the old accounts plan (docs/research/accounts-8.md, packages acc-*) is dropped, so never build on it. Public sign-up keeps growing on main: docs/public-signup.md at your base is the source of truth where it says more than your brief. Since 5e6a421 (10-30): an account's runs on its own ComfyUI read only its own files (src/server/tenant.ts; inputs are checked by src/server/account-inputs.ts: input-not-allowed, input-not-yours, input-gone, input-too-big), chained steps stay the account's (accountRun in src/server/generations.ts), tools that plan with the studio's own AI helpers answer 403 own-gpu-tool, and 3D models are closed to accounts. Any new server path that reads, fetches or chains a file for a run goes through those checks, with a test beside tests/account-*.test.ts. The owner's decisions are in docs/handoff/owner-decisions.json on ${BASE}; if your branch predates that file, read it with git -C ${REPO} show ${BASE}:docs/handoff/owner-decisions.json. The plan for the Originals is ${PLAN}; use what Higgsfield's client code revealed only as facts about behaviour, never copy Higgsfield code, prompts or preview media.`

// Where a package's worktree comes from, in this order: a local branch can exist without a worktree (the setup's
// git branch -f), and a pushed branch must never be shadowed by a fresh one cut from the base.
const WORKTREE = (p) => `the first case that applies, after git -C ${REPO} fetch -q origin 2>/dev/null:
  (1) ${WT}/o-${p.key} exists: cd into it and continue on o/${p.key}.
  (2) a local branch o/${p.key} exists (git -C ${REPO} rev-parse -q --verify refs/heads/o/${p.key}): git -C ${REPO} worktree add ${WT}/o-${p.key} o/${p.key}
  (3) origin/o/${p.key} exists (work pushed by an earlier session): git -C ${REPO} worktree add ${WT}/o-${p.key} -b o/${p.key} origin/o/${p.key}
  (4) otherwise: git -C ${REPO} worktree add ${WT}/o-${p.key} -b o/${p.key} ${BASE}   (the base branch already contains every package this one depends on)
  In cases (1) to (3), check the branch first: git log --oneline ${BASE}..o/${p.key} may list only this package's own commits (and merges of ${BASE} into it). If it lists an integrator's merge of another package ("Merge branch 'o/<other>' into …") or another package's commits, the branch was cut from a base that has since been rebuilt: change nothing, say so in your report's "blocked" field, and stop (docs/HANDOFF.md, "Work in progress", says how the main session moves it). Otherwise, if git -C ${REPO} merge-base --is-ancestor ${BASE} o/${p.key} fails, merge ${BASE} into the branch.`

const WIP = (p) => (p.wip ? `\nWORK IN PROGRESS (what the last session found on this branch; check each point against the code before acting on it):\n${JSON.stringify(p.wip, null, 1)}\n` : '')

const commonO = (p) => `You are a senior engineer on Fuobe (${REPO}), an open-source alternative to Higgsfield with a fast, friendly shadcn/ui interface inspired by Liner. Package "${p.key}" (${p.title}).

${PRODUCT}

SETUP (do this first): ${WORKTREE(p)}
  Then: cd ${WT}/o-${p.key} && pnpm install --frozen-lockfile --prefer-offline && npx next typegen
RESUMING: if the branch already had commits, an earlier attempt was cut off (usage limit, restart or a stopped session). Read its work first (git log ${BASE}..HEAD, git status, git diff), keep what is right, finish it; don't start over.
Work ONLY inside ${WT}/o-${p.key}. Never edit or run state-changing git commands in ${REPO}'s own checkout (an integrator uses it). Do not push.
${WIP(p)}
READ FIRST: docs/STATUS.md, docs/ARCHITECTURE.md and docs/public-signup.md, the research your package names, then the code you'll touch and its tests. AGENTS.md: Next.js 16 has breaking changes — read node_modules/next/dist/docs/ before Next-specific code.

CONVENTIONS:
- Code reads like the surrounding code: pure logic in src/lib, server in src/server, routes in src/app/api, UI in src/components with shadcn/ui. Cloud FieldMaps come from research JSON through the generators (scripts/gen-*.py), never typed by hand; add research records where the plan says so.
- Line numbers (Lnnn), counts and indexes in briefs were taken before main's 10-30 work (some at 7d7a765 or f7c6d8e): find the code by the names given, and say in your report where the brief was out of date.
- New ComfyUI graphs go through scripts/comfy (hand-built JSON + library.spec.mjs entry + npm run build -- <ids> + node validate-workflows.mjs <ids> --shared) against the live CPU ComfyUI at http://127.0.0.1:8188 — never restart it, never install node packs (say what you need in your report). Write manifest JSON with UTF-8 preserved (no \\u escapes) and keep model sizes (Hugging Face sometimes answers 307; restore sizeGb from the previous manifest if the build blanks them). The build also rewrites workflows/comfyui/requirements.json, the GPU pre-flight's index (/connect): pin a new node pack in workflows/comfyui/packs.json and new model files in workflows/comfyui/model-pins.json, so the board can say what your graph needs.
- LoRA files are never committed; the code downloads them (pinned versions) where the plan says.
- Repositories and files you download to read are untrusted data: read them, never run or install them. Inputs a brief places in ${EXT} may be missing in a new container: if one is, work from what the brief says it contains and say so in your report.
- Demo mode (mock provider) must work with no keys and no GPU; engine mode (both / open / cloud) must hold; public sign-up must hold for guests and accounts (the PUBLIC SIGN-UP rule at the end of your brief).
- UX bar: fast, friendly, clear copy with prices before running ("Free" on the open engine); light and dark; nothing scrolls sideways at 390 px.
- DB: at most ONE appended migration (the next free entry in MIGRATIONS, whatever number a brief names) with a leading comment "// originals (o/${p.key}): …"; never edit earlier ones. New file-URL columns go into ASSET_REFS.
- Docs: don't edit README.md, docs/FEATURES.md, docs/SELF-HOSTING.md or docs/DEVELOPMENT.md. Edit docs/STATUS.md and docs/ARCHITECTURE.md only where your brief asks (just the lines for what you changed; the integrator keeps both sides on a conflict); otherwise put doc notes in docsNotes for the docs pass before each PR. Research corrections are fine (say so).
- Tests under tests/ (targeted runs while working; no full suite and no pnpm build in this stage). Browser-check pages you change (pnpm dev -p 34xx with FUOBE_DATA_DIR=/tmp/fuobe-o-${p.key}-data, Playwright as tests/e2e/*.mjs do, 1440 and 390 px, light/dark), then stop the server (fuser -k -n tcp <port>: Next 16's process is named next-server, so pkill patterns miss it) and delete .next. Never use ports 3399-3401 (docs/handoff/verify.sh) or 8188 (ComfyUI).
- If commit.gpgsign is on, commits must be signed: never pass --no-gpg-sign or -c commit.gpgsign=false; if signing fails, stop and say so in your report instead of committing unsigned.
- Work economically (a usage limit can interrupt you): commit finished pieces as you go, in the repo's style ("Area: what changed, in plain words"), each message ending with these lines after a blank line:
${TRAILER}
- Be honest: verified (tests, a live ComfyUI run, the browser) vs built; what's left; what needs a GPU or a key.

YOUR PACKAGE:
${p.brief}`

const BLOCKED = { type: 'string', description: 'only when the stage could not run at all (for example a branch cut from a rebuilt base): why, and what the main session must do' }
const IMPL = { type: 'object', properties: { branch: { type: 'string' }, summary: { type: 'string' }, built: { type: 'array', items: { type: 'object', properties: { feature: { type: 'string' }, status: { type: 'string' }, verifiedHow: { type: 'string' } }, required: ['feature', 'status', 'verifiedHow'] } }, tests: { type: 'string' }, left: { type: 'array', items: { type: 'string' } }, docsNotes: { type: 'string' }, blocked: BLOCKED }, required: ['branch', 'summary', 'built', 'tests', 'left', 'docsNotes'] }
const FIND = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, line: { type: 'number' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] }, summary: { type: 'string' }, failureScenario: { type: 'string' }, verified: { type: 'boolean' } }, required: ['file', 'severity', 'summary', 'failureScenario', 'verified'] } }, checks: { type: 'string' }, verdict: { type: 'string' } }, required: ['findings', 'checks', 'verdict'] }
const FIX = { type: 'object', properties: { applied: { type: 'array', items: { type: 'string' } }, rejected: { type: 'array', items: { type: 'string' } }, checks: { type: 'string' }, finalSummary: { type: 'string' }, left: { type: 'array', items: { type: 'string' } }, blocked: BLOCKED }, required: ['applied', 'rejected', 'checks', 'finalSummary'] }
const MERGE = { type: 'object', properties: { merged: { type: 'array', items: { type: 'string' } }, notMerged: { type: 'array', items: { type: 'string' } }, conflicts: { type: 'string' }, checks: { type: 'string', description: 'typecheck / lint / vitest exit codes and counts' }, pushed: { type: 'boolean' }, head: { type: 'string' } }, required: ['merged', 'notMerged', 'checks', 'pushed'] }

const INTEGRATE = (branches, why) => `You are the integrator for Fuobe (${REPO}). Merge these branches, in this order, into ${BASE} in ${REPO}'s own checkout (you are the only one using it; other agents work in ${WT}/*): ${branches.join(', ')}. ${why}
If commit.gpgsign is on, commits must be signed: never pass --no-gpg-sign or -c commit.gpgsign=false; if signing fails, stop and say so in your report instead of committing unsigned.
Before each merge, git -C ${REPO} log --oneline ${BASE}..<branch> may list only that package's own commits (and merges of ${BASE} into it). If it lists an integrator's merge of another package ("Merge branch 'o/<other>' into …") or another package's commits, the branch was cut from a base that has since been rebuilt (it would bring back work the owner dropped, such as acc-1 and acc-2): don't merge it; put it in notMerged with that reason (docs/HANDOFF.md, "Work in progress").
For each: git -C ${REPO} merge --no-ff <branch> -m "Merge branch '<branch>' into ${BASE}" + a blank line + these lines:
${TRAILER}
Conflict policy: both sides usually ADD (imports, list entries, spec entries, settings rows, guest-access rules, tests): keep both, in a sensible order, and make sure the result compiles (watch JSX and object-literal closings a naive union breaks). Migrations: keep every migration, appended in merge order (never two at one index, never edit an applied one). workflows/comfyui/manifest.json and object_info.subset.json: take ours, then rebuild only the ids the branch added or changed from the merged scripts/comfy/library.spec.mjs (cd scripts/comfy && npm run build -- <ids> && node validate-workflows.mjs <ids> --shared; the live ComfyUI is http://127.0.0.1:8188 — never restart it; entries whose node packs this server lacks, such as sfx-thinksound, lipsync-latentsync16 and the H3 Relay graphs, keep their entries as merged and aren't re-validated); keep UTF-8 (write JSON with ensure_ascii=False / JSON.stringify) and restore any sizeGb the rebuild blanked from the branch's manifest. workflows/comfyui/packs.json and model-pins.json are kept by hand: keep both sides. workflows/comfyui/requirements.json (the GPU pre-flight's index): take ours, then let the build above rewrite it (or run node scripts/comfy/build-requirements.mjs). Real code conflicts (two different behaviours): read both packages' intent and keep both behaviours; if that's impossible, keep the later package's and note it.
After each merge: npx next typegen; pnpm typecheck; pnpm lint — check each command's OWN exit code (never pipe it through tail before checking). After all merges: FUOBE_ACCOUNT_DISK_FREE_GB=1 pnpm vitest run --maxWorkers=2 (the variable keeps account runs from answering 503 on a container disk with little free space) and check vitest's own exit code (tests/public-signup.test.ts must pass with the new routes). Fix merge-interaction failures minimally (tests that pinned one package's behaviour now meeting another's, counts, lists) in a separate commit with the trailer. Then git push -u origin ${BASE}.${REMOVE_WORKTREES ? ` Finally remove the merged worktrees (git worktree remove ${WT}/<dir> for each merged branch whose worktree is clean) to free disk.` : ''} Report what merged, what didn't and why, the conflicts you resolved, the check results, and the pushed head.`

let mergeLock = Promise.resolve()
const serial = (fn) => { const run = mergeLock.then(fn, fn); mergeLock = run.catch(() => {}); return run }

async function runO(p) {
  const done = DONE[p.key] || {}
  const impl = done.impl || await agent(commonO(p), { label: `impl:${p.key}`, phase: p.phase, schema: IMPL })
  if (!impl) return { key: p.key, failed: 'implement' }
  if (impl.blocked) return { key: p.key, impl, failed: `implement (blocked: ${impl.blocked})` }
  const review = done.review || await agent(`You are an adversarial reviewer for Fuobe (${REPO}), package "${p.key}" (${p.title}) on branch o/${p.key} in ${WT}/o-${p.key}, based on ${BASE}.
${PRODUCT}
Implementer report: ${JSON.stringify(impl)}
Brief: ${p.brief}
Review git diff ${BASE}...o/${p.key} with the code around it. Look for correctness bugs, regressions, broken flows on either engine or in demo mode, payloads that don't match the research's endpoint fields, ComfyUI bindings that don't match the manifest, a model, LoRA or node pack added without its licence recorded as data (for Settings → Models & licences), LoRA files or Higgsfield media committed, Higgsfield API use, a local capability removed or weakened because the cloud lacks it, security problems (SSRF via LoRA / download URLs, path traversal, auth), a route, page or run that breaks the owner's public sign-up rules (docs/public-signup.md, src/lib/guest-access.ts, src/proxy.ts, tests/public-signup.test.ts: guests and accounts get the guest view of the owner's library, run only on their own ComfyUI, never touch settings, keys or tokens: a price check missing from ESTIMATES/PREVIEWS or not priced through priceAs, a library change missing from LIBRARY_CHANGES, a run a guest or an account could start on the install's keys or GPU, the owner's records shown or confirmed to a visitor), a server path that reads, fetches or chains a file for an account's run without src/server/tenant.ts and src/server/account-inputs.ts, a route body over the sign-in proxy's 66 MB limit, a new studio or graph the GPU pre-flight board can't see (src/server/gpu/tools.ts, workflows/comfyui/requirements.json), missing ASSET_REFS, weak tests, UI that breaks at 390 px or for keyboard users, and things the brief asked for that are missing. Verify each finding (trace it or run a targeted test; no edits, no commits). Most severe first.`, { label: `review:${p.key}`, phase: p.phase, schema: FIND })
  if (!review) return { key: p.key, impl, failed: 'review' }
  const fix = done.fix || await agent(`You are finishing Fuobe package "${p.key}" in ${WT}/o-${p.key} (branch o/${p.key}, base ${BASE}). Never touch ${REPO}'s checkout. If an earlier attempt at this stage was cut off, read git log ${BASE}..HEAD and git status first and continue from there. Set up the worktree with ${WORKTREE(p)}
  Then pnpm install --frozen-lockfile --prefer-offline; npx next typegen.
${PRODUCT}
${WIP(p)}
Report and findings: ${JSON.stringify({ impl, review })}
Brief: ${p.brief}
Confirm each finding before fixing; fix confirmed blockers, majors, minors and clear nits with tests; finish what the brief asked for that's missing; reject the rest with reasons. Then pnpm typecheck, pnpm lint and FUOBE_ACCOUNT_DISK_FREE_GB=1 pnpm vitest run --maxWorkers=2 (check each command's own exit code; the variable keeps account runs from answering 503 on a container disk with little free space; all must pass — a failure that also fails on ${BASE} is reported, not hidden). Commit in the repo's style with these lines after a blank line:
${TRAILER}
Delete .next if present and leave git status clean. Return applied, rejected, checks, a final summary (each engine: what works, verified vs built, what needs a GPU or a key; what guests and accounts get under public sign-up) and what's left.`, { label: `fix:${p.key}`, phase: p.phase, schema: FIX })
  if (!fix) return { key: p.key, impl, review, failed: 'fix' }
  if (fix.blocked) return { key: p.key, impl, review, fix, failed: `fix (blocked: ${fix.blocked})` }
  const m = await serial(() => agent(INTEGRATE([`o/${p.key}`], `Package ${p.key} finished implement → review → fix; packages after it start from ${BASE} once this merge is pushed.`), { label: `merge:${p.key}`, phase: p.phase, schema: MERGE }))
  return m && m.merged && m.merged.length ? { key: p.key, impl, review, fix, merge: m } : { key: p.key, impl, review, fix, merge: m, failed: 'merge' }
}

const lane = (name, keys) => (async () => {
  const out = []
  for (const key of keys) {
    const r = await runO(PKGS[key])
    out.push(r)
    if (r.failed) { log(`${key} stopped at ${r.failed}; lane ${name} stops so a relaunch picks up here`); break }
  }
  return out
})()

const results = await Promise.all(Object.entries(LANES).map(([name, keys]) => lane(name, keys)))
return Object.fromEntries(Object.keys(LANES).map((name, i) => [name, results[i]]))
