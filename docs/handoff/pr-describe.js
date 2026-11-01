export const meta = {
  name: 'fuobe-pr-describe',
  description: 'Write a Fuobe pull request description from the merged packages: area readers → writer → three fact-check lenses (accuracy, completeness, clarity) → reviser, which saves the title and body to files',
  whenToUse: 'Cutting a PR from a snapshot branch (docs/HANDOFF.md, "Cutting a PR"), after verify.sh; pass the args object described at the top of the script',
  phases: [{ title: 'Read' }, { title: 'Write' }, { title: 'Check' }, { title: 'Revise' }],
}

// The PR description template (docs/HANDOFF.md, "Cutting a PR"). Run it with the Workflow tool:
//   Workflow({ scriptPath: "docs/handoff/pr-describe.js", args: { … } })
// args (an object; the Workflow tool passes it to the script as `args`):
//   repo      the checkout to read from, read-only, by refs only (the main checkout is fine while others work in it)
//   head      the PR's branch, e.g. 'claude/fuobe-r5-batch-8'
//   base      main's commit this PR builds on (the last PR's merge on main, or git merge-base origin/main <head>)
//   pr        the PR's number (or the next one), used in wording only
//   round     how the title starts, e.g. 'Round 5, part 3'
//   reports   a folder holding <package>.json per merged package: { key, impl, review, fix, merge }, the build
//             workflow's reports: docs/handoff/reports, which save-reports.mjs fills before each session ends (or the
//             journal of a run in this container: node docs/handoff/save-reports.mjs <dir> <journal.jsonl>…)
//   out       a folder where the reviser writes title.txt, body.md and notes.md (the result you post)
//   history   a few sentences on how the branch was made: what was merged in which order (the first-parent merges and
//             their commits), main merged in, commits added on top
//   areas     [{ key, title, pkgs: [[packageKey, mergeCommit], …] }]: one reader per area; a merge commit may carry a
//             note after a space, e.g. 'f105d19 (integration fix 4e8359f)'
//   other     optional: commits outside the areas and what they are (research notes, the handoff, check fixes)
//   notInPr   what "Not in this PR" lists: the queue's next packages (docs/HANDOFF.md) and owner decisions pending
//   handoff   optional: what "Handoff for the next session" says (what docs/HANDOFF.md and docs/handoff/ now hold)
// The body keeps one <!-- CHECKS --> line under "## How it was checked": fill it from verify.sh's summary before posting.

const A = args || {}
const missing = ['repo', 'head', 'base', 'round', 'reports', 'out', 'history', 'areas', 'notInPr'].filter((k) => A[k] === undefined || A[k] === '')
if (missing.length) throw new Error(`pr-describe: missing args ${missing.join(', ')} (the comment at the top of the script lists them)`)
const { repo: REPO, head: HEAD, base: BASE, reports: REPORTS, out: OUT } = A
const PR = A.pr ? `PR #${A.pr}` : 'this PR'

const RULES = `Ground rules:
- Work read-only in ${REPO} using refs only: git log / git show / git diff / git show ${HEAD}:<path>. Do not checkout, merge, commit, stash or edit anything, and do not read the working tree's files (other agents may be changing that checkout); read files at the ref instead (git show ${HEAD}:path, git grep <pattern> ${HEAD} -- <paths>).
- The range for ${PR} is ${BASE}..${HEAD}. How the branch was made: ${A.history} Use git log --first-parent ${BASE}..${HEAD} and git diff ${BASE} ${HEAD} (the exact change this PR makes to main).
- Implementer/reviewer/fixer reports per package are in ${REPORTS}/<package>.json ({impl, review, fix, merge}; the fix stage ran last, so fix.finalSummary / fix.applied / fix.left are the most current; merge is the integrator's report). Reports can be stale or overstate: every claim you pass on must be backed by the diff or by a check the report names (say which). If code and report disagree, the code wins and you say so.
- Fuobe is an open-source alternative to Higgsfield: each feature runs on paid cloud models (fal.ai / Replicate with the user's own key) and on open-weight models through a ComfyUI ("open engine"), with a demo mode (mock provider, no keys). With public sign-up on (docs/public-signup.md), guests browse read-only and accounts run only on their own ComfyUI.`

const PKG_SCHEMA = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    packages: { type: 'array', items: { type: 'object', properties: {
      key: { type: 'string' },
      mergeCommit: { type: 'string' },
      oneLine: { type: 'string', description: 'what this package gives a user, one plain sentence' },
      userFacing: { type: 'array', items: { type: 'string' }, description: 'what a person can now do, where (page/studio/button), in plain words' },
      cloud: { type: 'array', items: { type: 'string' }, description: 'cloud models/endpoints used and what they do (with prices only if the code shows them)' },
      open: { type: 'array', items: { type: 'string' }, description: 'ComfyUI workflows/model ids used, custom node packs or model downloads they need' },
      routesAndPages: { type: 'array', items: { type: 'string' }, description: 'new or changed pages and API routes (path + one phrase), and what guests and accounts get from them under public sign-up' },
      migrations: { type: 'array', items: { type: 'string' } },
      fixesToExisting: { type: 'array', items: { type: 'string' }, description: 'behaviour of features that already existed that changed or got fixed' },
      verified: { type: 'array', items: { type: 'string' }, description: 'what was actually checked and how (tests, live ComfyUI run on CPU, browser screenshots at 1440/390 light/dark…), per the report AND consistent with the diff' },
      notVerifiedOrLeft: { type: 'array', items: { type: 'string' }, description: 'built but not run end to end, known gaps, things left for later' },
      reviewerNotes: { type: 'array', items: { type: 'string' }, description: 'risky spots or things a reviewer should look at' },
      evidence: { type: 'array', items: { type: 'string' }, description: 'files / commits backing the key claims' },
    }, required: ['key', 'oneLine', 'userFacing', 'verified', 'notVerifiedOrLeft', 'evidence'] } },
    crossCutting: { type: 'array', items: { type: 'string' } },
    discrepancies: { type: 'array', items: { type: 'string' }, description: 'places where a report claims something the diff does not back, or vice versa' },
  },
  required: ['area', 'packages', 'crossCutting', 'discrepancies'],
}

const readArea = (a) => agent(`${RULES}

You are summarising one area of a large pull request so that its description is accurate and complete. Area: ${a.title}.
Packages and the merge commits that brought them in (first-parent merges on ${HEAD}):
${a.pkgs.map(([k, m]) => { const c = m.split(' ')[0]; return `- ${k}: merge ${m} (its changes: git diff ${c}^1 ${c}, plus the integration fix commit if named; its commits: git log --oneline ${c}^1..${c}^2; report: ${REPORTS}/${k}.json, whose merge field, if present, is the integrator's report)` }).join('\n')}

For each package: read the report, then the diff and commit messages, and the key files at ${HEAD}. Produce what a person merging this PR needs to know: what users can now do and where, what each engine uses (cloud model endpoints; open ComfyUI workflow ids, custom node packs, model downloads), new pages and API routes (and how they answer guests and accounts under public sign-up), DB migrations (src/server/db.ts MIGRATIONS entries this package added), changes to existing behaviour, what was verified and how vs only built, what is left, and spots a reviewer should look at. Be concrete (names of studios, buttons, routes, model ids) and plain-spoken. Note any report claim the code does not back under discrepancies.`, { label: `read:${a.key}`, phase: 'Read', schema: PKG_SCHEMA })

const CROSS_SCHEMA = {
  type: 'object',
  properties: {
    standaloneCommits: { type: 'array', items: { type: 'object', properties: { commit: { type: 'string' }, summary: { type: 'string' } }, required: ['commit', 'summary'] } },
    research: { type: 'array', items: { type: 'string' }, description: 'research docs added/changed in the range and what each says, in one or two lines' },
    migrations: { type: 'array', items: { type: 'string' }, description: 'every MIGRATIONS entry added in the range, with what it changes and which package added it' },
    newRoutes: { type: 'array', items: { type: 'string' }, description: 'every new src/app/api route and every new page under src/app in the range' },
    comfyLibrary: { type: 'string', description: 'workflow count before/after in workflows/comfyui/manifest.json, new workflow ids grouped by feature, any new custom node packs (customNodes, workflows/comfyui/packs.json) and large model downloads (sizeGb), and whether workflows/comfyui/requirements.json (the GPU pre-flight index) covers them' },
    dependencies: { type: 'array', items: { type: 'string' }, description: 'package.json / lockfile dependency changes, Python/uv deps, scripts' },
    settingsAndEnv: { type: 'array', items: { type: 'string' }, description: 'new settings, env vars, keys, data dir changes' },
    publicSignup: { type: 'array', items: { type: 'string' }, description: 'how the new routes, pages and runs follow public sign-up (src/lib/guest-access.ts, tests/public-signup.test.ts) and the GPU pre-flight board (src/server/gpu/tools.ts), and any that do not' },
    tests: { type: 'string', description: 'test files added/changed (count and the notable ones); e2e scripts added' },
    upgradeNotes: { type: 'array', items: { type: 'string' }, description: 'what someone upgrading an existing install must know (migrations run automatically or not, new ComfyUI nodes/models to install, breaking changes, removed things)' },
    mainInteraction: { type: 'string', description: "main's docs (README.md, docs/FEATURES.md, docs/SELF-HOSTING.md, docs/DEVELOPMENT.md, docs/STATUS.md, docs/ARCHITECTURE.md, docs/research/README.md) describe main as of the base. What in this PR makes them out of date (new features, counts, settings, upgrade steps, what is next)? List what the docs would need to say." },
    uncovered: { type: 'array', items: { type: 'string' }, description: 'anything in the range not part of the areas or the other commits named' },
  },
  required: ['standaloneCommits', 'research', 'migrations', 'newRoutes', 'comfyLibrary', 'dependencies', 'settingsAndEnv', 'publicSignup', 'tests', 'upgradeNotes', 'mainInteraction', 'uncovered'],
}

const AREA_KEYS = A.areas.flatMap((a) => a.pkgs.map(([k]) => k)).join(', ')

const readCross = () => agent(`${RULES}

You cover the cross-cutting parts of this PR (the area readers cover the packages: ${AREA_KEYS}). First-parent history: git log --first-parent --oneline ${BASE}..${HEAD}. ${A.other ? `Commits that are not in the areas: ${A.other}` : 'Name every first-parent commit that is not one of the areas\' merges.'} The integrator's reports are the merge field of ${REPORTS}/<package>.json. Also cover the owner's decisions behind the build (docs/handoff/owner-decisions.json at ${HEAD}): no Higgsfield models or API (confirm with git grep -i higgsfield ${HEAD} -- src scripts bin skills workflows package.json that only history/comparison wording is left); licences are information, not gates (Settings → Models & licences: check new models, packs and libraries record theirs); each engine does all it can (the cloud uses only hosted models, with no substitute model; the open engine keeps every capability it has); and public sign-up (new routes, pages and runs follow src/lib/guest-access.ts and tests/public-signup.test.ts; new studios show on the GPU pre-flight board). Check where this PR follows them and where it doesn't.
Then take whole-range inventories with git (diff ${BASE} ${HEAD}): every DB migration added to MIGRATIONS in src/server/db.ts (and which package added it), every new API route and page, the ComfyUI workflow library change (manifest.json counts before/after, new ids, customNodes packs, model sizes, requirements.json), dependency changes (package.json, pnpm-lock.yaml, Python), new settings/env vars and data files, tests added (count, notable; e2e scripts), research docs (docs/research/*) added or changed. Also say what in main's docs this PR makes out of date. Finish with upgrade notes for someone with an existing install.`, { label: 'read:cross-cutting', phase: 'Read', schema: CROSS_SCHEMA })

phase('Read')
const reads = await parallel([...A.areas.map((a) => () => readArea(a)), () => readCross()])
const areaSummaries = reads.slice(0, A.areas.length).filter(Boolean)
const cross = reads[A.areas.length]
log(`Read: ${areaSummaries.length}/${A.areas.length} areas${cross ? ' + cross-cutting' : ' (cross-cutting reader failed)'}`)

const BODY = {
  type: 'object',
  properties: { title: { type: 'string' }, body: { type: 'string' }, notes: { type: 'string' } },
  required: ['title', 'body'],
}

const STYLE = `Style for the PR text:
- Audience: the repo owner (product-minded, merges and runs Fuobe, also on Windows via start.bat) and any reviewer. Plain words, short sentences, no jargon a user wouldn't know without a gloss. Lead with what people can now do; engineering detail goes lower.
- Title: a plain summary under ~100 characters, starting "${A.round}:".
- Body in GitHub Markdown: a short opening paragraph (what this PR is, from the history above; counts of commits and files); "## What's new" with one ### per feature area (bullets: what you can do, where, cloud vs open engine, and what guests and accounts get under public sign-up where it matters; a compact table per area is fine where it reads better); "## Fixes and changes to existing features"; "## Under the hood" (migrations, API routes, ComfyUI library and the GPU pre-flight index, dependencies, settings); "## Research" only if research notes changed (a plan is not a feature); ${A.handoff ? `"## Handoff for the next session" (${A.handoff}; a few bullets, linking docs/HANDOFF.md); ` : ''}"## Upgrading" (only what someone with an existing install must do or know); "## How it was checked" containing exactly the line <!-- CHECKS --> and nothing else (filled in later from the real run); "## Known gaps" (real ones only, from the verified notVerifiedOrLeft items); "## Not in this PR" (short: ${A.notInPr}); "## Docs" (one line: the PR branch carries the docs update for this batch in README.md, docs/FEATURES.md, docs/SELF-HOSTING.md, docs/DEVELOPMENT.md, docs/STATUS.md and docs/ARCHITECTURE.md, as far as the docs pass changed them).
- Be exact and honest: say "verified" only for what was actually run (tests, a live CPU ComfyUI run, a browser check) and "built" for what wasn't run end to end. No marketing adjectives. No claims you can't back from the summaries.
- Never mention AI model identifiers of the assistant that wrote this; model names of the image/video/audio models the app uses are fine. No local file paths (/home/..., /tmp/...), no internal hostnames, no secrets, no email addresses. No bare @handles (GitHub would notify them): put such text in backticks. Do not add a signature or footer; one is appended later.
- Aim for a body that a person can scan in a few minutes: roughly 6–14k characters. Collapse long inventories (routes, workflow ids, test files) inside <details><summary>…</summary> blocks.`

phase('Write')
const draft = await agent(`You write the pull request description for Fuobe ${A.round} (${BASE}..${HEAD}). Facts to work from (only these; each was checked against the diff by a reader):
AREA SUMMARIES:
${JSON.stringify(areaSummaries, null, 1)}
CROSS-CUTTING:
${JSON.stringify(cross, null, 1)}

${STYLE}

You may spot-check facts with read-only git commands in ${REPO} (git show ${HEAD}:<path>, git diff ${BASE} ${HEAD} -- <path>); never change anything. Return the title and the body, and in notes anything you left out or were unsure about.`, { label: 'write:draft', phase: 'Write', schema: BODY })

const CHECK = {
  type: 'object',
  properties: {
    issues: { type: 'array', items: { type: 'object', properties: {
      kind: { type: 'string', enum: ['wrong', 'overstated', 'missing', 'unclear', 'style'] },
      severity: { type: 'string', enum: ['high', 'medium', 'low'] },
      quote: { type: 'string', description: 'the exact text in the draft this is about (empty for missing)' },
      evidence: { type: 'string', description: 'git command output / file+line that shows the problem' },
      correction: { type: 'string', description: "the replacement or addition, written in the PR's style" },
    }, required: ['kind', 'severity', 'evidence', 'correction'] } },
    verdict: { type: 'string' },
  },
  required: ['issues', 'verdict'],
}

const LENSES = [
  { key: 'accuracy', prompt: 'ACCURACY lens. Go through the draft claim by claim (every bullet, table cell, number and name: routes, model ids, workflow ids, migrations, counts, prices, "verified" statements). For each, find the backing in the diff or the reports; flag anything wrong, misnamed, or overstated (especially "verified" claims that were only built, and anything claimed for an engine that the code doesn\'t wire). Default to flagging when you cannot find backing.' },
  { key: 'completeness', prompt: `COMPLETENESS lens. Independently sweep the diff (git diff --stat ${BASE} ${HEAD}; new files; src/app routes and pages; MIGRATIONS; manifest.json and requirements.json; package.json; settings; docs/research) and the commit messages (git log --no-merges --format='%h %s' ${BASE}..${HEAD}) for user-visible features, behaviour changes, migrations, new dependencies or ComfyUI requirements, public sign-up behaviour, and upgrade-relevant changes that the draft leaves out or under-explains. Only flag things a person merging or upgrading would want to know; give the exact addition.` },
  { key: 'clarity', prompt: 'CLARITY lens, as the repo owner reading it on a phone: is it scannable, plain, and does it lead with what people can do? Flag jargon without a gloss, vague lines that don\'t say where to find a feature, walls of text that belong in <details>, inconsistent names for the same thing, and anything in the "Not in this PR" / "Known gaps" sections that would confuse. Also check the style rules: no assistant model ids, no local paths or hostnames, no bare @handles, no footer, contains exactly one <!-- CHECKS --> line under "## How it was checked".' },
]

phase('Check')
const checks = draft ? (await parallel(LENSES.map((l) => () => agent(`${RULES}

You fact-check a pull request description before it is posted. ${l.prompt}

${STYLE}

THE DRAFT (title, then body):
${draft.title}
---
${draft.body}`, { label: `check:${l.key}`, phase: 'Check', schema: CHECK })))).filter(Boolean) : []
log(`Check: ${checks.map((c) => `${c.issues.length} issues`).join(', ') || 'no draft to check'}`)

phase('Revise')
const final = draft ? await agent(`${RULES}

You produce the final pull request title and body. Start from the draft, apply every correction below that you confirm (re-check high/medium ones with read-only git yourself; drop corrections that don't hold and list them in notes with why), and keep the style rules.

${STYLE}

DRAFT TITLE: ${draft.title}
DRAFT BODY:
${draft.body}

CHECKER FINDINGS:
${JSON.stringify(checks, null, 1)}

Then save the result as files (create the folder if needed; write nothing else anywhere): the final title on one line in ${OUT}/title.txt, the final body (still containing exactly one <!-- CHECKS --> line under "## How it was checked") in ${OUT}/body.md, and in ${OUT}/notes.md what you changed and what you rejected. Return the same title, body and notes.`, { label: 'revise:final', phase: 'Revise', schema: BODY }) : null
log(final ? `Saved ${OUT}/title.txt, ${OUT}/body.md and ${OUT}/notes.md: "${final.title}"` : 'No description: the writer or the reviser failed (see the agents above)')
