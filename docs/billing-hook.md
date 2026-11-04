# Billing hook: an optional external service

An install can connect an external billing service at `FUOBE_BILLING_URL`. Fuobe sends facts about each run that goes
to this install's GPUs (hosted runs, see [public-signup.md](public-signup.md#hosted-runs)); the service answers with what
the person sees and whether the run may start. With no service set, Fuobe makes no call at all, and runs on this
install's GPUs stay closed unless `FUOBE_HOSTED_FREE=1` makes them free for every account.

Fuobe has no words of its own for prices or balances. Every word on screen about them (the price on Run, the balance in
the top bar and the account menu, a refusal's text, a link, an offer) comes from the service's answers at runtime.

## Settings

| Variable | Meaning | Default |
|---|---|---|
| `FUOBE_BILLING_URL` | The service: `https://billing.example.com/base`, `http://…`, or a Unix socket on this machine, `unix:/path/to/billing.sock` | none: no billing |
| `FUOBE_BILLING_TOKEN` | Sent as `Authorization: Bearer <token>` with every call | none |
| `FUOBE_HOSTED_RUNS` | `1` lets accounts run on this install's GPUs (the only runs the service prices) | off |
| `FUOBE_HOSTED_FREE` | `1` opens those runs with no service set: free for every account, within the install's own limits | off |
| `FUOBE_POOL_WAIT_MIN` | How long a run may wait in line on this install's GPUs when the service doesn't say | 30 |

## When Fuobe calls the service

Only for runs on this install's GPUs (the place `pool`), plus an account's policy, its balance, account events and
offer clicks. A run on the account's own GPU or with its own key never asks the service. Every call is safe to send
twice: the service must treat a repeated call (the same `requestId`, or the same hold and run row) as the same call.

| Call | Timeout | When |
|---|---|---|
| `GET /v1/policy?account=<id>` | 1 s | before a run on this install's GPUs, and for the status (cached for the answer's `ttlS`) |
| `GET /v1/policy` | 1 s | a guest's status and price check: the policy for someone not signed in (cached the same way) |
| `POST /v1/quote` | 1 s | the price check before Run (`POST /api/generations?preview=1`), asked again 300 ms after each change |
| `POST /v1/reserve` | 2 s, one retry with the same `requestId` | just before the run's rows are made |
| `POST /v1/release` | 5 s, through the outbox | the rows couldn't be made after a reserve |
| `POST /v1/settle` | 5 s, through the outbox | each row that succeeded |
| `POST /v1/refund` | 5 s, through the outbox | each row that failed, was stopped, or was removed by an output check |
| `GET /v1/balance?account=<id>` | 1 s | the balance pill and the account menu's balance (cached 10 s) |
| `POST /v1/account-event` | 5 s, best effort | an account was made, verified, signed in or deleted |
| `POST /v1/interest` | 5 s | a person pressed an offer's button |

### Shapes

All JSON. Times are Unix milliseconds. Amounts are whole numbers in the service's own unit.

```ts
type AccountFacts = { id: string; email: string | null; emailVerified: boolean; signIn: "google" | "password"; createdAt: number; adultAt: number | null };
type Place = "own-gpu" | "own-key" | "pool" | "install-key";
type RunFacts = {
  place: Place; model: string; op: string | null; app: string | null; preset: string | null; studio: string;
  kind: "image" | "video" | "audio" | "text" | "model3d"; engine: "open" | "cloud"; provider: string;
  jobs: number; outputsPerJob: number; megapixels: number | null; seconds: number | null; fps: number | null;
  loras: number; inputs: { image: number; video: number; audio: number }; lane: string | null; providerUsd: number | null;
  steps?: { model: string; op: string | null; kind: RunFacts["kind"]; jobs: number; lane: string | null }[];
};
type QueueFacts = { lane: string; ahead: number; etaS: number | null; workersOnline: number; nextOpenAt: number | null; mine: { waiting: number; running: number } };
type Action = { label: string; url: string };              // Fuobe opens url as given (https, or a path on this site)
type Offer = { key: string; text: string; label: string };  // a click sends POST /v1/interest { account, key }
type RefuseCode = "top-up" | "limit" | "busy" | "not-offered" | "blocked" | "closed" | "paused";

type Quote = { allowed: boolean; amount: number; priceVersion: string; text: string; sub?: string; code?: RefuseCode; etaS?: number | null; action?: Action; offer?: Offer };
type Policy = {
  hosted: boolean;                                                // may this account use this install's GPUs at all
  pool: { allow?: string[]; deny?: string[]; apps?: { allow?: string[]; deny?: string[] } };  // models and apps there
  uploads: { image: boolean; video: boolean; audio: boolean };    // which of its own files those runs may use
  limits: { activeRuns: number; waiting: number; runsPerHour: number; outputsPerRun: number; maxMegapixels: number; maxSeconds: number; keepDays: number; spaceBytes: number; addressRunsPerHour?: number };
  prefer?: "pool" | "own";                                         // the default place (absent: "own")
  kinds?: { image?: boolean; video?: boolean; audio?: boolean; text?: boolean; model3d?: boolean };  // absent: all
  links?: Action[]; notice?: { id: string; text: string; url?: string }; ttlS: number;
};
```

`megapixels` is the size of each picture or frame the run makes, about, as its workflow makes it: the canvas the
workflow binds (a canvas the request names counts only there; else the aspect ratio and resolution, the model's
defaults where the request names none), or for a workflow sized by its input (an edit, an upscale, a face swap) the
input's size, an upscale's times its factor, within the workflow's limits. It is null for sound, text and 3D.

`steps` lists every step of the run that uses this install's GPUs, the run's own step first: a chain (a film of
several shots, a picture and then a step on it) is priced once, with one quote and one hold, for one press of Run.
Steps that need no model (joins, trims) are left out: they cost nothing. Every step must be one the policy allows
(`pool`, `kinds`) and one this install's GPUs can run (a ComfyUI step: not a text step, a step made in the browser or
a cloud model), or the run isn't offered here. It is refused before Run, never part way through.

3D runs (Image to 3D and the other 3D tools) aren't offered on this install's GPUs yet, whatever `kinds.model3d` says.
They run on the account's own GPU, as before. An account with no GPU of its own is told the tool isn't available here
(403, `code: "own-gpu-tool"`).

The policy's limits count runs on this install's GPUs only, never runs on the account's own GPU or key (those keep the
install's own limits). A run is one press of Run: its jobs and chain steps count once. `activeRuns` counts runs going
now (waiting or running), `waiting` those not started yet, `runsPerHour` those started in the last hour, and
`addressRunsPerHour` those started from one client address in the last hour, across accounts (only when the install
trusts its proxy, `FUOBE_TRUST_PROXY=1`; the address is kept as a salted hash, and every run's entry is removed two
hours on, whether or not more runs come). 0 or absent means no such
limit. Fuobe counts them in its database together with making the run's rows, so requests that arrive together (or
reach two servers during a deploy) never pass a limit together. They apply with or without a billing service.

`prefer: "pool"` sends a run to this install's GPUs first even when the account's own GPU is online. A place the
request names always wins, so the account can still pick its own GPU. When the account's own GPU doesn't answer and the
run named no place, Fuobe asks (409, `code: "own-gpu-offline"`, header `x-fuobe-place-ask`) instead of moving the run
to this install's GPUs, but only for a run this install's GPUs would take. Any other run goes to the account's own GPU,
as before. While the policy is cached, a run on an account's own GPU never waits for the service; when a policy call
gets no answer, the last answer (or none) stands for 5 seconds (60 for a guest) before the service is asked again.

| Call | Request | Answer |
|---|---|---|
| `POST /v1/quote` | `{ account: AccountFacts \| null, run: RunFacts, queue: QueueFacts \| null }` | `Quote` |
| `POST /v1/reserve` | `{ requestId, account: AccountFacts, run: RunFacts, queue: QueueFacts \| null, shown: { amount, priceVersion } }` | `{ ok: true, holdId, amount, boostMs, maxWaitMs, pools?, class?, text }` or `{ ok: false, code: RefuseCode \| "price-changed", text, quote?, action?, offer? }` |
| `POST /v1/release` | `{ holdId, reason: "not-created" }` | `{ ok: true }` |
| `POST /v1/settle` | `{ holdId, generationId, rows, status: "succeeded", final: { outputs, megapixels, seconds }, providerUsd, gpuMs, device, reachedProvider }` | `{ ok: true, charged }` |
| `POST /v1/refund` | `{ holdId, generationId, rows, status: "failed" \| "canceled" \| "hidden" \| "unchecked", reason, reachedProvider, gpuMs, device }` | `{ ok: true, text }` |
| `GET /v1/balance` | | `{ amount, chip, text, sub?, refillAt?, detail: { label, text }[], action?, offer? }` |
| `POST /v1/account-event` | `{ event: "created" \| "verified" \| "signed-in" \| "deleted", account: AccountFacts }` | `{ ok: true }` |
| `POST /v1/interest` | `{ account, key }` | `{ ok: true, text }` |

The price check before Run shows the quote's `text` (and `sub`) as they are. Under the toolbar (and in the price's
tooltip) it shows where a new run would stand in line and the wait, about: the quote's `etaS`, else the line's own
estimate. A quote with `allowed: false` turns Run off and puts its `text` in the price slot, with its `action` link or
`offer`. Fuobe also refuses the check itself, with the words the run would get, for the policy's limits
(`code: "limit"`) and for what this install's GPUs don't take (`code: "not-offered"`: a model, a kind, LoRAs, files
or a chain's later step), so Run never fails on them once pressed. The page asks for a quote again by itself: every
15 s while it is refused, every 30 s while it is allowed, and at once when a run starts or ends.

`shown` is the price the person saw before pressing Run. A service must never charge more than it: when the price would
be higher, it refuses with `price-changed` and the new quote, and the person sees the new price before running again.

A reserve's `text` is shown on the result once it succeeded ("7 units"). A run that fails or is removed says "Not
charged" only when its reserve answer set an amount aside (`amount` above 0). `maxWaitMs` is how long the run may wait
in line before a GPU first takes it; past it the row fails and is refunded. Once a GPU has taken it, the limit is over:
a run that goes back in line (a GPU paused or restarted) keeps its place and waits there.

`class` puts the run in a class of the line: `"paid"` runs go before `"free"` ones (no `class`: `"free"`). The
install's own jobs come after both. `boostMs` is a head start inside the class, at most a day: the run stands in line as
if it had come that much earlier. Both are kept for every row of the run, and a browser never sees them.

On the workers ([gpu-workers.md](gpu-workers.md)), `queue` counts the line the way the workers serve it: `ahead` is
every task the workers that may run this one would serve first, whatever its model, and `lane` is the workflow's lane.
`mine` counts the account's runs on this install's GPUs the way the limits do: one press of Run is one run, however
many jobs or chain steps it has (`waiting`: none of its rows has started).
A report's `gpuMs` is the time the workers' ComfyUI spent running the row's jobs, as they measured it (no waits, no
files, no upload). A job that ran more than once counts once, for the attempt whose result was kept. `device` is the
GPU's name. A row on the workers none of whose jobs finished there has `gpuMs` and `device` null: its time in line
never counts. Elsewhere `gpuMs` is the row's time from its start to its end, and `device` is null.

Example (arbitrary numbers):

```json
POST https://billing.example.com/v1/reserve
{ "requestId": "r_9Xk2", "account": { "id": "acct_1", "email": "a@example.com", "emailVerified": true, "signIn": "password",
  "createdAt": 1767225600000, "adultAt": null },
  "run": { "place": "pool", "model": "oss-example", "op": "t2i", "app": null, "preset": null, "studio": "image", "kind": "image",
  "engine": "open", "provider": "comfyui", "jobs": 1, "outputsPerJob": 1, "megapixels": null, "seconds": null, "fps": null,
  "loras": 0, "inputs": { "image": 0, "video": 0, "audio": 0 }, "lane": "comfyui", "providerUsd": 0 },
  "queue": { "lane": "comfyui", "ahead": 2, "etaS": 40, "workersOnline": 1, "nextOpenAt": null, "mine": { "waiting": 0, "running": 0 } },
  "shown": { "amount": 7, "priceVersion": "v7" } }
→ { "ok": true, "holdId": "h_1", "amount": 7, "boostMs": 7000, "maxWaitMs": 700000, "text": "7 units" }
```

## What the person sees when a run is refused

The run route answers a refusal with the service's `text` as `error`, a status by code, and the header
`x-fuobe-billing: <code>`. The page opens one card with the text, the `action` link or the `offer` button, and a way to
run for free on one's own GPU.

| Code | HTTP |
|---|---|
| `price-changed` | 409 (the body has the new `quote`) |
| `top-up` | 402 |
| `limit` | 429 |
| `busy`, `paused` | 503 |
| `blocked`, `not-offered`, `closed` | 403 |

## Holds and the outbox

Every row a run makes (its jobs, and every step its chains queue) carries the reserve's hold. The server stamps it; a
client can never set it. Once none of a hold's rows is still queued or running, each row is reported once: `settle` for
a row that succeeded, `refund` for any other, each with `rows` (how many rows share the hold), so the service knows when
the hold is closed. Reports are written to an outbox table first and sent from there, retried with backoff (10 s,
doubling, up to 10 minutes) for 7 days. A restart loses nothing: the outbox finds every finished row with a hold and no
report from what is stored. A run whose rows couldn't be made after its reserve sends one `release`.

## When the service is down

| Situation | What happens |
|---|---|
| No `FUOBE_BILLING_URL` | No call. Runs on this install's GPUs are closed, or free and allowed with `FUOBE_HOSTED_FREE=1`. |
| Set, and it answers | As above. |
| Set, and no answer in time | Runs on this install's GPUs are refused (503, "Runs are paused for a moment. Try again soon."). Run shows "Price unavailable". Runs on the account's own GPU or key go on. Reports wait in the outbox and are sent when it is back. Runs that already have a hold keep running. |

The service's address and its errors are written to the server's log only. A browser never sees them.
