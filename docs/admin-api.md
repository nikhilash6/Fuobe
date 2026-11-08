# Manage your Fuobe from your own tools

An install can be managed from your own tools with an **admin API token**: a script, a dashboard or a small admin app
of your own can list accounts, switch them off, read and delete their runs, take results down, read reports and run
the workers, without signing in as the owner.

An admin token:

- works **only on `/api/admin/*`**. Anywhere else (pages, Settings, sign-in, the studio's API, `/api/mcp`) it gets
  `403 "An admin token only works on the admin API."`;
- does **only what you ticked** when you made it (its scopes);
- is **never the owner**: it can't sign in, change settings or keys, or make or revoke tokens;
- stands on its own: a session cookie sent with it is ignored;
- is stored only as its SHA-256. You see the token once, when you make it.

Every change made through the admin API is written to the **admin log**, and so is every file a token opens and its
reads of people's data. The log never holds a token, a password, a prompt or an IP address.

## Make a token

1. Open **Settings → Security** in the owner's signed-in browser.
2. Under **Admin tokens**, press **New admin token**.
3. Name it, tick what it may do (**Read only** and **Full admin** tick sets for you), pick an expiry and press
   **Create admin token**.
4. Copy the token (`fuobe_adm_…`, 53 characters). It isn't shown again.

The list shows each token's first characters, its scopes, when it was made and last used, and when it expires.
**Revoke** stops it at once. **Sign everyone out** with **Also revoke every API token** revokes admin tokens too. An
install keeps at most 20 live admin tokens.

Keep the token out of URLs, logs and shared files. Send it only in the `Authorization` header, and only over HTTPS.

## Scopes

| Scope | Lets the token |
|---|---|
| `accounts:read` | `GET /api/admin/accounts` (JSON or CSV), `GET /api/admin/accounts/{id}` |
| `accounts:write` | `PATCH /api/admin/accounts/{id}` with `{ "disabled": true \| false }` or `{ "signOut": true }` (its paired ComfyUIs stop too) |
| `accounts:delete` | `DELETE /api/admin/accounts/{id}`: its runs, files and record go. It can't be undone |
| `runs:read` | `GET /api/admin/generations`: runs, each one's facts only (when, which model and app, how it ended, how many results). Accounts' and guests' runs by default; the owner's own with `whose=ours` or `whose=everyone`. With `outputs:view`, `GET /api/admin/generations/{id}` too |
| `runs:delete` | `DELETE /api/admin/generations/{id}`: a run still going is canceled first |
| `outputs:view` | `GET /api/admin/files/{path}`: a stored file, an account's or the owner's own, held ones too. Each view is logged. With `runs:read`, the runs' prompts, inputs and results too, and one run in full |
| `outputs:hide` | `POST /api/admin/outputs/hide` |
| `outputs:moderate` | `POST /api/admin/outputs/hide`, `/unhide` and `/remove` |
| `reports:read` | `GET /api/admin/reports` (reporters' emails only with `accounts:read`) |
| `workers:read` | `GET /api/admin/workers`, `GET /api/admin/workers/jobs`, `GET /api/admin/workers/events` |
| `workers:write` | `PATCH /api/admin/workers/{id}`: pause, resume, drain, hours, lanes, revoke; and `POST /api/admin/workers/{id}/update` |
| `workers:update` | `POST /api/admin/workers/{id}/update` only: ask a worker to update its program now |
| `workers:tokens` | `POST /api/admin/workers`, and `PATCH /api/admin/workers/{id}` with `rotate`: both answer with a worker token. A worker receives accounts' queued jobs with their input files and sends back the results, so give this scope only to a tool you'd trust with those |
| `queue:read` | `GET /api/admin/queue`, `GET /api/admin/queue/settings`, `GET /api/admin/queue/overrides` |
| `queue:write` | `PATCH /api/admin/queue/settings`: the run ceiling, the owner's wait limit, fair share, the pick allowance and the paused budget (`pausedBudgetS`: how long a run that has started may spend back in line) |
| `queue:control` | `POST /api/admin/queue/mode`, `POST /api/admin/queue/overrides`, `DELETE /api/admin/queue/overrides/{id}`, `POST /api/admin/queue/cancel`: who the GPUs serve first, runs and people sent first or held, and cancelling a run ([gpu-workers.md](gpu-workers.md#who-goes-first)) |
| `site:read` | `GET /api/admin/site/uploads` |
| `site:write` | `PATCH /api/admin/site/uploads`: the upload switches |
| `audit:read` | `GET /api/admin/audit` |

The read-only preset in Settings ticks `runs:read`, `reports:read`, `workers:read`, `queue:read` and `audit:read`:
no emails, no prompts and no results. With `runs:read`, an account's email in a run needs `accounts:read`. Without it a
run's `account` is `{ id, emailHidden: true }`; `email: null` always means the account was deleted.

Any valid admin token may call `GET /api/admin/tokens/self`, which says the token's name and scopes, so a tool can
offer only what it may do. `/api/admin/tokens` itself (make, list, revoke) is the owner's signed-in browser's only.

## Examples

```sh
export FUOBE=https://fuobe.example.com
export TOKEN=fuobe_adm_...   # from Settings → Security → Admin tokens

# Which token is this, and what may it do?
curl -s "$FUOBE/api/admin/tokens/self" -H "Authorization: Bearer $TOKEN"

# Accounts, with their runs and space; one by email; every email containing "studio"
curl -s "$FUOBE/api/admin/accounts" -H "Authorization: Bearer $TOKEN"
curl -s "$FUOBE/api/admin/accounts?email=ann@example.com" -H "Authorization: Bearer $TOKEN"
curl -s "$FUOBE/api/admin/accounts?q=studio" -H "Authorization: Bearer $TOKEN"

# Switch an account off, sign it out everywhere, delete it
curl -s -X PATCH "$FUOBE/api/admin/accounts/ACCOUNT_ID" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"disabled": true}'
curl -s -X PATCH "$FUOBE/api/admin/accounts/ACCOUNT_ID" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"signOut": true}'
curl -s -X DELETE "$FUOBE/api/admin/accounts/ACCOUNT_ID" -H "Authorization: Bearer $TOKEN"

# Accounts' failed video runs, 50 a page; then the next page
curl -s "$FUOBE/api/admin/generations?status=failed&kind=video&limit=50" -H "Authorization: Bearer $TOKEN"
curl -s "$FUOBE/api/admin/generations?status=failed&kind=video&limit=50&before=NEXT" -H "Authorization: Bearer $TOKEN"

# Open a result's file (an output's url is /api/files/<path>: ask /api/admin/files/<path>)
curl -s -o result.png "$FUOBE/api/admin/files/PATH" -H "Authorization: Bearer $TOKEN"

# Hide a run's results
curl -s -X POST "$FUOBE/api/admin/outputs/hide" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"generationIds": ["RUN_ID"]}'

# The admin log, newest first
curl -s "$FUOBE/api/admin/audit?limit=50" -H "Authorization: Bearer $TOKEN"
```

## Calls

Times are epoch milliseconds and sizes are bytes. Every answer is `Cache-Control: no-store`.

| Call | Request | Answer |
|---|---|---|
| `GET /api/admin/accounts` | `q` (the email contains it, up to 100 characters), `email` (exactly that address), `format=csv` | `{ total, items, totals, signInNotices }`; with `q` or `email`, also `matched`. `total` and `totals` always cover every account. `signInNotices` lists each `auth.json` that was found in the data folder after the sign-in data moved into the database. Each one was set aside without being read ([Sign-in data](SELF-HOSTING.md#sign-in-data)). An entry gives `{ file, foundAt, reason, counts }`. `reason` is `stray`, `unreadable`, `link` (a symbolic link, never followed) or `import-failed`. `counts` is `{ accounts, tokens, accountsNotInDatabase }`, or `null` when the file isn't sign-in data or is a link. An entry stays in the list until you delete its file. CSV: a `text/csv` download |
| `GET /api/admin/accounts/{id}` | | one account with its numbers; 404 `No such account` |
| `PATCH /api/admin/accounts/{id}` | exactly one of `{ disabled: boolean }` or `{ signOut: true }` | the account (no numbers) |
| `DELETE /api/admin/accounts/{id}` | | 204 |
| `GET /api/admin/generations` | `account` (one account), else `whose` (`people`: accounts' and guests' runs, the default; `ours`: the owner's own; `everyone`); `source` (the owner's runs only: `hands-on`, or `batch` for any automated run: `batch`, `drill`, `example`, `test`, `api`); `where` (`pool`: this install's GPUs, the owner's runs on its ComfyUI too; `provider`: a cloud provider; `own`: an account's own GPU); `status` (`finished` or `done`, `failed`, `canceled`, `waiting`, `started`, and `running` for waiting and started); `kind` (`image`, `video`, `audio`, `model3d`, `text`); `model` (letters of the model id); `from` and `to` (`yyyy-mm-dd` in UTC, both days included); `q` (words of the prompt, or a run id); `ids` (a comma list of up to 100 run ids: those runs, whoever's they are); `before` (the last page's `next`); `limit` (1 to 100, default 30) | `{ items, next }`; `next` is null on the last page. Each run has `whose`: `account`, `guest` or `owner`. Each output has a `state`: `shown`, `held` (hidden, or waiting for its check) or `removed` (its file is gone). A failed run on this install's GPUs (and the owner's own failed run) also has `detail`: the technical reason, which the account never sees. `account` is `{ id, email }` (`email` null: a deleted account), `{ id, emailHidden: true }` without `accounts:read`, or `null` for the owner's own run, which has `source` too (`hands-on` from the site; `batch`, `drill`, `example`, `test` as its script said; `api` for a run sent with an API token that said none) and `sourceName` when its script gave one |
| `GET /api/admin/generations/{id}` | needs `runs:read` and `outputs:view` | One run in full, an account's, a guest's or the owner's own: `{ run, stored, fix, trouble, where, model, preset, studio, prompt, negativePrompt, asked, settings, inputs, batch, near, chain, sent, timing, jobs, workerLog, money, madeBy, surface, providerId, progress, checks }`. `stored.detail` is the technical reason for the owner; `comfyReason`, when there is one, is ComfyUI's own reason in one short line (a node that isn't installed, a model file not in its list, an error in a node), and each of `jobs` has it as `comfyWhy`. `inputs` lists each input file by slot, with its `state` (`kept` with its `url`, `removed`, `example`, `inline`, `link`). `chain` is `{ before, after }`: the steps it waits for and the steps that wait for it. Keys, tokens and GPU addresses are never part of it. 404 for an unknown run |
| `DELETE /api/admin/generations/{id}` | | 204; 404 for an unknown run or the owner's own |
| `POST /api/admin/outputs/hide` | `{ assetIds?, generationIds? }` (up to 500 each) | `{ hidden }` |
| `POST /api/admin/outputs/unhide` | the same | `{ shown }` |
| `POST /api/admin/outputs/remove` | the same, and `evidence?: true` to keep the files in a locked folder | `{ removed }` |
| `GET /api/admin/files/{path}` | `Range` works | the file, an account's or the owner's own (held ones too); 404 for unknown paths |
| `GET /api/admin/reports` | `limit` (1 to 500, default 100) | `{ items }`, newest first |
| `GET /api/admin/queue` | | `{ held, lanes, running, holding, queued, next, nextTotal, text, controls, now }`. `queued` is in the order the workers serve it, each with `rank` (null while no worker takes it), `why`, `code` (`class`, `next`, `boost`, `held`, `pinned`, `paused`), `override` and `person` (a key, never an account id). A `holding` row for a worker that holds back the line (`task` null) names the job it would take first (`generationId`, `model`, `op`, `principal`). A run of the owner's that the owner made by hand (no `source`) has `handsOn: true` in `queued`, `running` and `holding`: it waits with people's runs, and its `why` says "Your run". `controls`: `{ pools, workers, overrides, ended, modes }` ([gpu-workers.md](gpu-workers.md#the-queue)) |
| `POST /api/admin/queue/mode` | `{ pool?, worker?, mode, forMin? }`: `mode` is `people-first`, `people-only`, `ours-first`, `balanced`, or `null` (back to normal); `forMin` is 1 to 10080, or `null` (until switched back) | `{ mode, before }`; 400 for a value out of bounds, 404 for no such worker |
| `GET /api/admin/queue/overrides` | | `{ live, ended }` (the last 20 that ended) |
| `POST /api/admin/queue/overrides` | `{ kind: "run", generationId, action: "next" | "hold", worker?, forMin? }` or `{ kind: "person", person | account, action: "boost" | "hold", forMin }` (`forMin` is needed for a boost) | 201 `{ override, replaced }`; 404 for no such run, worker or person with a run on the GPUs; 409 for a run that ended |
| `DELETE /api/admin/queue/overrides/{id}` | | `{ override }` (ended now); 404 when it isn't in effect |
| `POST /api/admin/queue/cancel` | `{ generationId }` | `{ generationId, status }`: the run ends as the person's own Cancel ends it; 404 for no such run, 409 for one that ended |
| `GET /api/admin/queue/settings` | | `{ settings: { runCeilingS: { default, lanes }, ownerWaitLimitS, fairShare, pickAllowanceMs, pausedBudgetS } }` ([gpu-workers.md](gpu-workers.md#the-queue)) |
| `PATCH /api/admin/queue/settings` | any of `runCeilingS: { default, lanes? }` (seconds, 60 to 86400; a given `runCeilingS` replaces the default and every lane's value), `ownerWaitLimitS` (seconds, 60 to 604800, or `null` for no limit), `fairShare` (boolean), `pickAllowanceMs` (0 to 3600000), `pausedBudgetS` (seconds, 0 to 604800) | `{ settings }`; 400 with the reason for a value out of bounds, an unknown setting or an unknown lane |
| `GET /api/admin/site/uploads` | | `{ switches: { soundConvert, soundTrim, videoTrim, photoConvert, photoCrop } }`: what a browser may do to a file that doesn't fit a tool before it is uploaded (convert a sound to MP3, offer a part of a sound or clip, convert or shrink a photo, offer a crop). All `true` by default. Every visitor reads the same values at `GET /api/site/uploads` |
| `PATCH /api/admin/site/uploads` | any of the five, each `true` or `false` | `{ switches }`; 400 with the reason for an unknown switch or a value that isn't a boolean. A switch that is off leaves that kind of file as it is: the tool says why it can't take it, and the server's checks apply. Browsers pick it up when they next load a page |
| `GET /api/admin/workers` | | `{ workers, lanes }`. Each worker adds `asked: { at, words }` or null, `jobs` (each job it holds: `{ taskId, generationId, slot, lane, laneLabel, stage, state, claimedAt, startedAt, progress, progressAt, typicalMs, etaS, owners, feature?, modelName? }`) and `lastEvent: { at, kind, event, words }` or null |
| `POST /api/admin/workers` | `{ name, pool? }` | 201 `{ id, token }`: the worker's token, once |
| `POST /api/admin/workers/{id}/update` | none | `{ worker }`: its next beat answer asks it to update now. It looks for new code at once and restarts on it after the job in hand (a person's job is never cut off). Each worker in `GET /api/admin/workers` has `update`: `state` (`current`, `updating` while behind the site's version for under 3 minutes, `behind` after), `since`, `behindMs`, `site`, `worker`, `commit` (first 12 hex), `peopleHeld`, `peopleWaiting`, `askedAt`, `words` and `needsOwner` |
| `PATCH /api/admin/workers/{id}` | any of `paused`, `pauseNow`, `drain`, `autoResume`, `hours`, `allow`, `claimAfterMs`, `switchAfterMs`, `rotate` (needs `workers:tokens`), `revoke` | `{ worker, token? }`: a new worker token after `rotate`, once |
| `GET /api/admin/workers/jobs` | `before`, `limit` (1 to 200, 50), `worker`, `generation` | `{ items, next }`: the workers' log, newest first. Each item: `{ id, at, event, workerId, workerName, taskId, generationId, principal, lane, execMs, device }` ([gpu-workers.md](gpu-workers.md)) |
| `GET /api/admin/workers/events` | `worker`, `kinds` (a comma list of `state`, `job`, `stage`, `looking`, `admin`, `version`, `log`; all when not given), `before`, `after`, `generation`, `limit` (1 to 500, 100) | `{ items, next, latest }`: the workers' timeline, newest first. Each item: `{ id, at, workerId, workerName, kind, event, words, taskId, generationId, lane, laneLabel, state, detail }`. `next` pages back (as `before`); `latest` is the newest row id (as `after`, for new rows only) ([gpu-workers.md](gpu-workers.md)) |
| `GET /api/admin/audit` | `before` (the last page's `next`), `limit` (1 to 200, default 50), `actor` (`owner`, `token` or `system`), `token` (a token id), `action`, `changes=1` (changes only: no reads, file views or refusals) | `{ items, next }` |
| `GET /api/admin/tokens/self` | | `{ id, name, prefix, scopes, expiresAt, createdAt }` |

A log row is `{ id, at, actor: "owner" | "token" | "system", token: { id, name } | null, action, target, detail, status }`.
`token.name` is the name the token had at the time. Actions: `account.disable`, `account.enable`, `account.signout`,
`account.delete`, `run.delete`, `outputs.hide`, `outputs.unhide`, `outputs.remove`, `worker.add`, `worker.change`,
`worker.rotate`, `worker.revoke`, `worker.revoke_all` (Sign everyone out with every API token), `queue.settings` (with
the values before and after), `queue.mode`, `queue.override`, `queue.override.end`, `queue.cancel`, `queue.mode.end`
(actor `system` when a mode, a hold or a boost ended by itself), `site.uploads` (the upload switches, with the values before and after), `token.create`, `token.revoke`,
`token.revoke_all`, `settings.comfy_where` (where ComfyUI runs, with the values before and after); a token's reads
`accounts.list`, `accounts.csv`, `account.read`, `runs.list`, `reports.list`, `audit.read` (one row per token and action
every 10 minutes); reads of accounts' content by a token or the owner: `runs.content` (one row per reader and account
every 10 minutes, the account as its target, or `owner` for the owner's own runs) and `file.view` (one row per reader and file every hour); refusals
`scope.denied` and `rate.limited`; and the studio's own alerts `worker.alert` (actor `system`: a worker's token used
from a new country, a new network, or two networks at once; [gpu-workers.md](gpu-workers.md#the-protocol)) and
`runs.waiting` (actor `system`, at most once every 5 minutes: runs on this install's GPUs that have waited longer than
5 minutes for the billing or moderation service to answer, as counts only: `waiting`, `billing`, `moderation`,
`oldestMin`). The owner's other reads in the browser aren't logged. Rows go after a year. `actor` can be `system`, and
the `actor` filter takes it.

A row is written once the change is made. If the server can't write it (a full disk, say), the change still stands and
the server's own log notes the missing row.

## Errors and limits

Errors are `{ "error": "…" }`, with a `code` where a tool may want to act on it:

| Status | When | Body |
|---|---|---|
| 400 | a wrong body or query | `{ error }` |
| 401 | the token is unknown, revoked or expired | `{ error: "This admin token isn't valid.", code: "token" }` |
| 403 | the token doesn't have the scope | `{ error: "This admin token can't do that.", code: "scope", scope }` |
| 403 | an admin token outside `/api/admin` | `{ error: "An admin token only works on the admin API." }` |
| 404 | not found | `{ error }` |
| 429 | too many requests | `{ error: "Too many requests. Try again in a minute.", code: "rate" }` and `Retry-After` |

Each minute, a token may send 120 reads, 30 changes and 600 file views (`/api/admin/files`), each counted on its own,
so a page of previews never uses up the next change. Wrong tokens count against their sender only (10 a minute per
client behind a trusted proxy, `FUOBE_TRUST_PROXY=1`; else 60 a minute together) and never slow down a valid token.

The limits are kept in the server's memory: a restart starts them again.

## Behind a proxy or a CDN

The `Authorization` header must reach Fuobe: most reverse proxies forward it as it is. If a CDN or a bot check sits in
front of the site, a script's request may get a challenge page instead of JSON. Let `/api/admin/` requests that carry
`Authorization: Bearer fuobe_adm_…` through without a challenge. Call the site's own HTTPS address, and don't follow
redirects with the token.
