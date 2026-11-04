# Moderation hook: optional run and output checks

An install can connect an external moderation service at `FUOBE_MODERATION_URL`. Fuobe asks it about an account's run
before the run is made, and, when the service asks for it, about each output before the account sees it. With no
service set, nothing is checked (the studio as it was), and "Report this result" goes to a list the owner reads.

The owner's own runs are never sent to the service.

## Settings

| Variable | Meaning | Default |
|---|---|---|
| `FUOBE_MODERATION_URL` | The service: `https://moderation.example.com`, `http://…`, or `unix:/path/to/moderation.sock` | none: no checks |
| `FUOBE_MODERATION_TOKEN` | Sent as `Authorization: Bearer <token>` | none |
| `FUOBE_MODERATION_MAX_WAIT_H` | How long an output may wait for its check before the run fails (and, with a billing hold, is refunded) | 24 |

## Calls

| Call | Timeout | Request | Answer |
|---|---|---|---|
| `POST /v1/check-run` | 10 s | `{ requestId, account: { id }, run: RunFacts, prompt, negative, inputs: { n, kind, sha256, preview }[], consent: null }` | `{ allowed: true, checkOutputs?: boolean }` or `{ allowed: false, code: "blocked" \| "consent", text }` |
| `POST /v1/check-output` | 30 s | the file's bytes; headers `X-Fuobe-Generation`, `X-Fuobe-Account`, `X-Fuobe-Asset`, `X-Fuobe-Kind` (`image`, `video`, `audio`), `X-Fuobe-Sha256`, `Content-Type` | `{ decision: "show" }`, `{ decision: "hide", text }` or `{ decision: "wait", retryAfterS }` |
| `POST /v1/report` | 5 s | `{ target: { generationId?, assetId?, shareId? }, category: "intimate" \| "minor" \| "violence" \| "impersonation" \| "copyright" \| "other", text, reporter: { account, email } }` | `{ ok: true, hidden, text }` |

`RunFacts` is the same shape the billing hook uses ([billing-hook.md](billing-hook.md)). `preview` is `null` for now.

## The run check

The check comes first, before a billing hold. `{ allowed: false }` stops the run: nothing is made, nothing is charged,
and the person sees the service's `text` (403). No answer in time: the run is refused (503). On this install's GPUs it
says "Try again in a moment.", as when the billing service doesn't answer. On the account's own GPU or key it says
"Checks are paused for a moment. Try again soon."

## The output check, and when a service may skip it

`checkOutputs` says whether this run's outputs go to `check-output` before they show. **A missing field means `true`**,
the safe default for any service. A service may skip output checks for a run by answering `checkOutputs: false`: the
outputs then show as soon as the run succeeds and `check-output` is never called for them.

When outputs are checked:

1. The run's files are saved and **held**: never served to the account, never by a shared link. The row stays running
   with the stage "Checking", and the tile says so.
2. Each file goes to `check-output`. "wait", or no answer, asks again later.
3. Every file "show": the files are served and the run succeeds.
4. Any file "hide": that file is deleted, the others with it, and the run fails with the service's `text`. A billing
   hold is refunded as `hidden`.
5. Past `FUOBE_MODERATION_MAX_WAIT_H`: the run fails with "This result couldn't be checked in time" and its files are
   deleted. A billing hold is refunded as `unchecked`.

## Reports

"Report this result" (`POST /api/reports`, anyone who can see the result or the shared link) goes to `/v1/report`. If
the service doesn't answer, or none is set, the report is kept in a list the owner reads (`GET /api/reports`).

## Taking results down

The owner can hide, show again and remove results by asset id or run id:

- `POST /api/admin/outputs/hide` `{ assetIds?, generationIds? }`: served to no account and by no link; kept.
- `POST /api/admin/outputs/unhide`: the same, undone (a file still waiting for its check stays held).
- `POST /api/admin/outputs/remove` `{ …, evidence?: true }`: deleted; with `evidence`, moved to `<data>/evidence`
  (mode 0600) instead.
