export const meta = {
  name: 'fuobe-pr-docs',
  description: "Update Fuobe's docs for a PR on its branch: writers per doc group → accuracy and staleness checkers → reviser (uncommitted edits in the PR's worktree)",
  whenToUse: 'The docs pass before a PR (docs/HANDOFF.md, "Cutting a PR"), after pr-describe.js; pass the args object described at the top of the script',
  phases: [{ title: 'Write' }, { title: 'Check' }, { title: 'Revise' }],
}

// The docs pass template (docs/HANDOFF.md, "Cutting a PR"). Run it with the Workflow tool:
//   Workflow({ scriptPath: "docs/handoff/pr-docs.js", args: { … } })
// args (an object; the Workflow tool passes it to the script as `args`):
//   worktree  the PR branch's worktree, where the writers edit (nothing is committed: review the diff, then commit it)
//   docsBase  the commit on main the docs describe today (the last PR's merge on main)
//   pr        the PR's number, used in wording only
//   round     how the docs name this batch, e.g. 'round 5, part 3'
//   summary   what this PR adds, a paragraph: the features and packages, and what each runs on, on each engine
//   notYet    what is still not in the branch (the queue in docs/HANDOFF.md), for "what's next" only
//   facts     a folder holding the PR description as body.md (pr-describe.js's output; its "How it was checked" section
//             is the real verification of the branch) and the packages' reports as reports/<package>.json
//   files     optional: [{ key, files, brief }] to replace the default writer assignments below
// It returns nothing; the reviser's summary is logged, and the edits are in the worktree.

const A = args || {}
const missing = ['worktree', 'docsBase', 'round', 'summary', 'notYet', 'facts'].filter((k) => A[k] === undefined || A[k] === '')
if (missing.length) throw new Error(`pr-docs: missing args ${missing.join(', ')} (the comment at the top of the script lists them)`)
const { worktree: WT, docsBase: BASE, facts: F } = A
const PR = A.pr ? `PR #${A.pr}` : 'this PR'

const DOCS = 'README.md, docs/FEATURES.md, docs/SELF-HOSTING.md, docs/DEVELOPMENT.md, docs/STATUS.md, docs/ARCHITECTURE.md, docs/public-signup.md, docs/cli.md, docs/research/README.md, scripts/comfy/README.md, scripts/eval/README.md and skills/README.md'

const CONTEXT = `Fuobe is an open-source alternative to Higgsfield: every studio runs on paid cloud models (fal.ai / Replicate with the user's own key) and on open-weight models through the user's own ComfyUI ("Open source" engine), with a demo mode that needs neither. The owner's decisions (docs/handoff/owner-decisions.json): Fuobe uses no Higgsfield models and no Higgsfield API; licences are information, not gates (Settings → Models & licences); each engine does all it can (the cloud uses only models that are hosted, with no substitute model, and the open engine keeps every capability it has even when the cloud can't match it); and accounts are the owner's public sign-up (docs/public-signup.md: guests browse, accounts see a guest view of the owner's library and run only on their own ComfyUI). You are updating the documentation in the git worktree ${WT}, the branch of ${PR}, which already contains main.

The docs describe main as of ${BASE}. ${PR} is ${A.round}: ${A.summary} Read the range with git log --first-parent --format='%h %s' ${BASE}..HEAD and git diff ${BASE} HEAD.
Facts already checked against the code: the PR description is ${F}/body.md (its "How it was checked" section is the real verification of this branch). Per-package reports: ${F}/reports/<package>.json (fix.finalSummary / fix.applied / fix.left are the most current; code wins over reports). docs/HANDOFF.md lists what is queued and what is waiting on the owner.
Still NOT in this branch (for "what's next" only, never described as available): ${A.notYet}

Where things live (main's layout): README.md is the product page (short sections, a feature grid, a quick start, "Upgrading from an earlier version" under "Self-hosting and security"; details go to the docs it links); docs/FEATURES.md is the full feature list; docs/SELF-HOSTING.md covers install, engine mode, the AI helper, keys, security, environment variables and ComfyUI; docs/DEVELOPMENT.md covers checks, browser checks, the evaluation harness and where things are; docs/STATUS.md is what is verified and the feature matrix; docs/ARCHITECTURE.md is how it is built.

Rules:
- Edit only the files you are assigned, in ${WT}. Do not commit, stash, switch branches or touch any other checkout. Read code at HEAD of ${WT} to confirm facts; git log/show/diff are fine.
- Update, don't rewrite: keep each doc's structure, tone, tables and legend; change what is now wrong, add what is new, remove only what is no longer true. Plain words, short sentences, in the docs' existing voice. Dated history (what an earlier round or PR did) stays as history. Keep README.md short: new detail goes to the doc it links.
- Be honest about verification, using STATUS.md's legend: ✅ verified (actually run here: tests, a live CPU ComfyUI, the browser), 🟢 built (not run with real keys or GPU weights), 🟡 partial, ⬜ not started. Say plainly when no paid key and no GPU were used.
- Every number, route, model id, workflow id, price and name you write must be backed by the code at HEAD or by the fact-checked files above. If you can't back it, leave it out.
- No local paths like /home/... or /tmp/... in the docs, no secrets, no email addresses, no assistant model names.`

const FILES = A.files || [
  { key: 'status', files: 'docs/STATUS.md', brief: `docs/STATUS.md: set "Last updated" to ${A.round}. Section 1: replace the checks for the current state with the PR description's "How it was checked" and add rows for what each package verified (per its report and the description), keeping rows that still hold, marked as earlier. Section 2 (feature matrix): add or update rows for this PR's features; say what each runs on, on each engine, what guests and accounts get under public sign-up where it matters, and how it was verified. Section 3: add the real known gaps from the description. Section 4 (what's next): the "Still NOT in this branch" list, pointing to docs/HANDOFF.md for the queue and order. Section 5: add new browser checks and scripts.` },
  { key: 'architecture', files: 'docs/ARCHITECTURE.md', brief: 'docs/ARCHITECTURE.md: describe this PR\'s changes where they belong, architecturally with file paths: catalog entries per engine, new ComfyUI graphs (and their entries in workflows/comfyui/requirements.json for the GPU pre-flight), providers, routes and how they follow public sign-up (src/lib/guest-access.ts), migrations (update the storage section\'s list), new libraries and settings. Add short pointers to new research notes (plans, not features) and keep the pointer to docs/HANDOFF.md for how the build continues. Keep it architectural.' },
  { key: 'product', files: 'README.md, docs/FEATURES.md, docs/SELF-HOSTING.md and docs/DEVELOPMENT.md', brief: `README.md: keep it a short product page; add this PR's features to the feature grid or the lines that link to docs/FEATURES.md only where they belong there, keep every count it states consistent with HEAD, and make "Upgrading from an earlier version" right for this PR (migrations added, dependencies added in package.json since ${BASE}, new ComfyUI workflows, packs or weights to install, data files to back up). docs/FEATURES.md: the new features in plain words, each with where to find it and what each engine runs. docs/SELF-HOSTING.md: new settings, environment variables, ComfyUI packs or weights. docs/DEVELOPMENT.md: new checks, browser checks, scripts and counts (test files and tests, if stated).` },
  { key: 'references', files: 'docs/research/README.md, docs/cli.md, docs/public-signup.md, scripts/comfy/README.md, scripts/eval/README.md and skills/README.md (only where this PR makes them wrong)', brief: 'docs/research/README.md: every new research note has a row and every row\'s "used by" says what this branch actually uses. scripts/comfy/README.md: the library counts (workflows and validated) must match workflows/comfyui/manifest.json at HEAD, and new graphs\' sections must match the code. docs/public-signup.md: only if this PR adds routes or rules guests and accounts see. docs/cli.md, scripts/eval/README.md and skills/README.md: fix only what this PR made wrong.' },
]

phase('Write')
const writes = await parallel(FILES.map((f) => () => agent(`${CONTEXT}

YOUR ASSIGNMENT: ${f.files}.
${f.brief}

When done, return a short summary of what you changed and anything you were unsure about (and left out).`, { label: `write:${f.key}`, phase: 'Write' })))
log(`Write: ${writes.filter(Boolean).length}/${FILES.length} writers finished`)

const CHECK = {
  type: 'object',
  properties: {
    issues: { type: 'array', items: { type: 'object', properties: {
      file: { type: 'string' }, quote: { type: 'string' },
      kind: { type: 'string', enum: ['wrong', 'overstated', 'stale', 'missing', 'inconsistent', 'style'] },
      severity: { type: 'string', enum: ['high', 'medium', 'low'] },
      evidence: { type: 'string' }, correction: { type: 'string' },
    }, required: ['file', 'kind', 'severity', 'evidence', 'correction'] } },
    verdict: { type: 'string' },
  },
  required: ['issues', 'verdict'],
}

const LENSES = [
  { key: 'accuracy', prompt: `ACCURACY lens: read git -C ${WT} diff (the writers' uncommitted changes). Check every added or changed claim (numbers, routes, file paths, model ids, workflow ids, prices, statuses ✅/🟢/🟡, "verified" wording) against the code at HEAD and the fact-checked files. Flag anything wrong, overstated (especially ✅ for things only built) or unbacked; also check that relative links in the changed lines point at files that exist.` },
  { key: 'staleness', prompt: `STALENESS + CONSISTENCY lens: read ${DOCS} in full as they are now in ${WT}. Find statements this PR's changes made false that the writers left in place: features of this PR described as coming later or not started; test, model, migration or workflow counts presented as current that no longer match HEAD; contradictions between the docs (and with docs/HANDOFF.md and docs/public-signup.md); the same feature named differently; and anything from the "Still NOT in this branch" list described as available. Also: no doc may describe Higgsfield as a provider, key, setting or API Fuobe calls (history and comparisons are fine). Historical statements clearly marked as from an earlier round are fine.` },
]

phase('Check')
const checks = (await parallel(LENSES.map((l) => () => agent(`${CONTEXT}

You check documentation edits before they are committed. Do not edit files. ${l.prompt}`, { label: `check:${l.key}`, phase: 'Check', schema: CHECK })))).filter(Boolean)
log(`Check: ${checks.map((c) => `${c.issues.length} issues`).join(', ') || 'no checker finished'}`)

phase('Revise')
const revise = await agent(`${CONTEXT}

You finish the documentation update in ${WT}. The writers' summaries:
${JSON.stringify(writes, null, 1)}

The checkers' findings:
${JSON.stringify(checks, null, 1)}

Confirm each finding against the code / facts and fix the ones that hold, in ${DOCS} only. Reject findings that don't hold. Then re-read the full diff (git -C ${WT} diff) once more for anything wrong, overstated or unclear, and check every relative link in the edited files resolves (a quick script is fine). Do not commit. Return: what you fixed, what you rejected and why, and a 5–10 line summary of what the docs now say that they didn't before.`, { label: 'revise', phase: 'Revise' })
log(revise ? `Revise: ${revise}` : 'Revise failed: the writers\' edits are in the worktree unchecked')
