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
| `runs:read` | `GET /api/admin/generations`: accounts' runs, prompts included (never the owner's own runs) |
| `runs:delete` | `DELETE /api/admin/generations/{id}`: a run still going is canceled first |
| `outputs:view` | `GET /api/admin/files/{path}`: an account's stored file, held ones too (never the owner's own). Each view is logged |
| `outputs:hide` | `POST /api/admin/outputs/hide` |
| `outputs:moderate` | `POST /api/admin/outputs/hide`, `/unhide` and `/remove` |
| `reports:read` | `GET /api/admin/reports` (reporters' emails included) |
| `workers:read` | `GET /api/admin/workers` |
| `workers:write` | `PATCH /api/admin/workers/{id}`: pause, resume, drain, hours, lanes, revoke |
| `workers:tokens` | `POST /api/admin/workers`, and `PATCH /api/admin/workers/{id}` with `rotate`: both answer with a worker token. A worker receives accounts' queued jobs with their input files and sends back the results, so give this scope only to a tool you'd trust with those |
| `queue:read` | `GET /api/admin/queue` |
| `audit:read` | `GET /api/admin/audit` |

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
| `GET /api/admin/accounts` | `q` (the email contains it, up to 100 characters), `email` (exactly that address), `format=csv` | `{ total, items, totals }`; with `q` or `email`, also `matched`. `total` and `totals` always cover every account. CSV: a `text/csv` download |
| `GET /api/admin/accounts/{id}` | | one account with its numbers; 404 `No such account` |
| `PATCH /api/admin/accounts/{id}` | exactly one of `{ disabled: boolean }` or `{ signOut: true }` | the account (no numbers) |
| `DELETE /api/admin/accounts/{id}` | | 204 |
| `GET /api/admin/generations` | `account`, `status` (`finished`, `running`, `failed`), `kind` (`image`, `video`, `audio`, `model3d`, `text`), `before` (the last page's `next`), `limit` (1 to 100, default 30) | `{ items, next }`; `next` is null on the last page. Each output has a `state`: `shown`, `held` (hidden, or waiting for its check) or `removed` (its file is gone) |
| `DELETE /api/admin/generations/{id}` | | 204; 404 for an unknown run or the owner's own |
| `POST /api/admin/outputs/hide` | `{ assetIds?, generationIds? }` (up to 500 each) | `{ hidden }` |
| `POST /api/admin/outputs/unhide` | the same | `{ shown }` |
| `POST /api/admin/outputs/remove` | the same, and `evidence?: true` to keep the files in a locked folder | `{ removed }` |
| `GET /api/admin/files/{path}` | `Range` works | the file; 404 for the owner's own files (held or not) and unknown paths |
| `GET /api/admin/reports` | `limit` (1 to 500, default 100) | `{ items }`, newest first |
| `GET /api/admin/queue` | | `{ lanes }` |
| `GET /api/admin/workers` | | `{ workers, lanes }` |
| `POST /api/admin/workers` | `{ name, pool? }` | 201 `{ id, token }`: the worker's token, once |
| `PATCH /api/admin/workers/{id}` | any of `paused`, `pauseNow`, `drain`, `autoResume`, `hours`, `allow`, `claimAfterMs`, `switchAfterMs`, `rotate` (needs `workers:tokens`), `revoke` | `{ worker, token? }`: a new worker token after `rotate`, once |
| `GET /api/admin/audit` | `before` (the last page's `next`), `limit` (1 to 200, default 50), `actor` (`owner` or `token`), `token` (a token id), `action`, `changes=1` (changes only: no reads, file views or refusals) | `{ items, next }` |
| `GET /api/admin/tokens/self` | | `{ id, name, prefix, scopes, expiresAt, createdAt }` |

A log row is `{ id, at, actor: "owner" | "token", token: { id, name } | null, action, target, detail, status }`.
`token.name` is the name the token had at the time. Actions: `account.disable`, `account.enable`, `account.signout`,
`account.delete`, `run.delete`, `outputs.hide`, `outputs.unhide`, `outputs.remove`, `worker.add`, `worker.change`,
`worker.rotate`, `worker.revoke`, `token.create`, `token.revoke`, `token.revoke_all`; a token's reads `accounts.list`, `accounts.csv`,
`account.read`, `runs.list`, `reports.list`, `audit.read` (one row per token and action every 10 minutes) and
`file.view` (one row per token and file every hour); and refusals `scope.denied` and `rate.limited`. The owner's own
reads in the browser aren't logged. Rows go after a year.

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
