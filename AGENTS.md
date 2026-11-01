<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Continuing the build

Fuobe is built package by package from a queue. Before starting work, read [`docs/HANDOFF.md`](docs/HANDOFF.md) and follow its "Start here" list. It covers:

- where things stand
- the owner's binding rules and open questions
- the queued packages with their full briefs (`docs/handoff/queue.json`)
- the branches with work in progress
- how to set up a new session (including rebuilding the integration branch from main, and bringing main's newer work into it every session)
- how to run the build workflow, or the same stages one package at a time without it (`docs/handoff/next-prompt.mjs`)
- what to push and save before a session ends (`docs/handoff/save-reports.mjs`)
- how to cut a PR (`docs/handoff/pr-describe.js` and `docs/handoff/pr-docs.js`)

Accounts are the owner's public sign-up on main (`docs/public-signup.md`, which keeps growing there): every route, page and run follows its rules. The old accounts plan (acc-1 to acc-57) is dropped, and new accounts work starts from a plan written with the owner.
