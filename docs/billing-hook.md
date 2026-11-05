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
| `POST /v1/reserve` | 2 s a try; with no answer, a 5xx or a 429, tried again with the same `requestId` for up to 40 s in all, the last try included (backoff from 0.5 s, doubling, up to 8 s). Any other answer is not tried again. | just before the run's rows are made |
| `POST /v1/release` | 5 s, through the outbox | the rows couldn't be made after a reserve; or a reserve was given up after a try that may have made a hold (sent a minute later) |
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
  cardText?: string;                                               // preset cards' words for a run there (absent: none)
  links?: Action[]; notice?: { id: string; text: string; url?: string }; ttlS: number;
};
```

`cardText` is what a preset card says when its run would go to this install's GPUs for the viewer, such as "Try free"
(at most 40 characters). With a service set, the cards say only these words, and nothing when the policy has none.
With no service, runs there are free (`FUOBE_HOSTED_FREE=1`), and the cards say "Try free".

`megapixels` is the size of each picture or frame the run makes, about, as its workflow makes it: the canvas the
workflow binds (a canvas the request names counts only there; else the aspect ratio and resolution, the model's
defaults where the request names none), or for a workflow sized by its input (an edit, an upscale, a face swap) the
input's size, an upscale's times its factor, within the workflow's limits. It is null for sound, text and 3D.

`steps` lists every step of the run that uses this install's GPUs, the run's own step first: a chain (a film of
several shots, a picture and then a step on it) is priced once, with one quote and one hold, for one press of Run.
Steps of CPU work are left out: they cost nothing. The requirements index marks these `cpu`: no model file, no
graphics memory and no card their nodes need, such as filters, trims, joins, adding sound and Ken Burns moves. A step
whose nodes run on the card (RTX Video) is GPU work. A text step inside the run (a script, lyrics, a translation)
is written by the install's AI helper: it is left out too, and never counted. Every other step must be one the policy
allows (`pool`, `kinds`) and one this install's GPUs can run (a ComfyUI step: not a step made in the browser or a
cloud model), or the run isn't offered here. It is refused before Run, never part way through.

A tool's run (Shorts, Cinema Studio, Storyboard, the apps, the palette lock and every other tool an account runs) goes
through the same gate as a studio run: every step is checked, the run is priced once from every step, held once, and
counted once. Its price check answers `{ place: "pool", quote, line }` beside the tool's own answer when the run would
go to this install's GPUs, and the tool's own answer is then priced as a run there (so an account with no GPU of its
own is priced, not asked to connect one). A tool whose body has no field for the place or the price shown reads them
from the request's headers: `x-fuobe-place` (`own` or `pool`) and `x-fuobe-shown` (`{ amount, priceVersion }` as
URI-encoded JSON). A field in the body wins.

A tool makes its own requests, so each of its steps is priced as it asks. A step that asks for more outputs at once
than `outputsPerRun` allows (or Fuobe's own cap of 4) is refused before Run with words that say how many a run there
makes. It is never priced as a smaller run. The studios' own runs are cut to the cap instead, and say so. Before
anything of a tool's run is sent, Fuobe checks the rows its start made against what was priced and held: no more jobs
of any model, no more outputs at once than the cap, and only CPU work for a run held as CPU work. A run whose rows
don't match is stopped (403, `code: "not-offered"`): its rows are canceled, and their reports close its hold. A hold
gets a `release` only when none of its rows were made, never as well as its rows' reports. A tool run whose start makes
no rows at all (it kept its own error, say) sends nothing: its hold gets a `release`, and the run doesn't count toward
the hour. The palette lock spreads the pictures a person picks over separate jobs of one picture each: on this install's
GPUs it makes no more of them than `outputsPerRun` allows, as a studio run there is cut.

One press of Run is one hold and one run, however often it is sent. A tool page sends its own id for each press
(`requestId` in the body, or the `x-request-id` header for a tool whose body has no field for it). With hosted runs on,
a press whose run goes to this install's GPUs is kept in the database for a day: a resend that reaches another server
process, or comes after a restart, gets the first answer and makes nothing. The reserve's `requestId` is made from the
account and the press (a hash, so one account can never name another's hold). A press refused after its hold was made
gives that hold back; a resend of it is a new try that asks for a new hold under a new `requestId`. A run on the
account's own GPU or with its own key keeps nothing of its press in the database, as before.

The limits on runs at once and in line count a tool run from the moment it is let in. A tool whose start waits for
something (a channel, a plan) before it makes its rows still counts as one run going, and one in line, until its rows
exist, so requests sent together can't all pass the limits.

Some models, modes and options run on a visitor's own setup only (`src/lib/own-setup.ts`), and so does a workflow that
none of this install's GPUs can run right now (none holds its files, serves its kind of work, or has the memory it
needs). A run that asks for one, on any step, is refused before Run. The price check answers `allowed: false` with the
label's words as `text` and the setup itself as `ownSetup` (`{ need: "gpu", vramGb? }` or `{ need: "key", provider }`),
and Run opens that setup (Connect your GPU, or Add your key) instead of staying off. The run itself is refused with
403, `code: "connect-gpu"` or `"add-key"`. A mode whose own check refuses it while it is planned here (MiniMax H3 at
2K, Kandinsky 6.0 Pro) gets the same answer, but with no plan in it: only `modelId`, `place`, `quote` and `line`.
When the account has its own GPU, these runs go to that GPU, as before. `GET /api/status` lists the open models these
GPUs can't run right now (`viewer.pool.own`), so the pickers can label them. An item whose graphs the workflow manifest
marks validated runs here like any other, as its label leaves the pages, with no code change. Restore & colourise names
a GPU of the visitor's own only: its gated LoRA is never sent with a visitor's key.

A tool page whose price check answers `{ place: "pool", quote, line }` shows the service's words and the place in line
in its price slot, not its own words for a run on the visitor's own GPU. When the quote is refused, Run sends nothing
and says why, or opens the visitor's own setup when `ownSetup` names one.

For a visitor with no GPU of its own, the pickers never leave out what these GPUs keep off. The model picker, the preset
galleries and the camera motion, effect and Mix pickers show each such item with its label ("Runs on your own GPU ·
48 GB", "Use your own fal.ai key"). A preset card says the `cardText` ("Try free") only when these GPUs run it. An app's
own tool says the label in its place chip, and its Run opens the setup too. "Connect your GPU" says the label under
its title.

A run made only of CPU work is free and never counted. Fuobe asks the service for no quote and no hold, and the run
counts against none of the policy's limits. A worker with a CPU slot runs it beside its GPU's job, in a line of its
own ([gpu-workers.md](gpu-workers.md), "The CPU slot"). A worker with none runs it in its GPU's line, as before.

A 3D model whose GLB gets its finish (an image-to-3D model, or Hi3D's refine of one) runs on this install's GPUs while
a worker's CPU slot runs that finish ([gpu-workers.md](gpu-workers.md), "The CPU slot"); then `kinds.model3d` says, as
for any other kind. Every other 3D run (a splat, a scene, a still made into 3D in one chain), and any 3D run while no
CPU slot finishes it, runs on the account's own GPU, as before. An account with no GPU of its own is then told the
tool isn't available here (403, `code: "own-gpu-tool"`).

The policy's limits count runs on this install's GPUs only, never runs on the account's own GPU or key (those keep the
install's own limits). A run is one press of Run: its jobs and chain steps count once. `activeRuns` counts runs going
now (waiting or running), and `waiting` those that are going but none of whose rows has started yet. `runsPerHour`
counts runs made in the last hour: Run was pressed and the run was let in, whether it has started yet or not.
`addressRunsPerHour` counts runs made from one client address in the last hour, across accounts (only when the install
trusts its proxy, `FUOBE_TRUST_PROXY=1`; the address is kept as a salted hash, and every run's entry is removed two
hours on, whether or not more runs come). 0 or absent means no such limit. Fuobe counts them in its database together with making the run's rows, so requests that arrive together (or
reach two servers during a deploy) never pass a limit together. They apply with or without a billing service.

`prefer: "pool"` sends a run to this install's GPUs first even when the account's own GPU is online. A place the
request names always wins, so the account can still pick its own GPU. When the account's own GPU doesn't answer and the
run named no place, Fuobe asks (409, `code: "own-gpu-offline"`, header `x-fuobe-place-ask`) instead of moving the run
to this install's GPUs, but only for a run this install's GPUs would take. Any other run goes to the account's own GPU,
as before. While the policy is cached, a run on an account's own GPU never waits for the service; when a policy call
gets no answer, the last answer (or none) stands for 5 seconds (60 for a guest) before the service is asked again. The
last answer the service gave stands for up to 10 minutes while it doesn't answer. After that, a run on this install's
GPUs is refused in plain words (503, "Try again in a moment."), and the price check turns Run off until the service
answers again.

| Call | Request | Answer |
|---|---|---|
| `POST /v1/quote` | `{ account: AccountFacts \| null, run: RunFacts, queue: QueueFacts \| null }` | `Quote` |
| `POST /v1/reserve` | `{ requestId, account: AccountFacts, run: RunFacts, queue: QueueFacts \| null, shown: { amount, priceVersion }, timing?: { runMs, pausedMs } }` | `{ ok: true, holdId, amount, boostMs, maxWaitMs, pools?, class?, text }` or `{ ok: false, code: RefuseCode \| "price-changed", text, quote?, action?, offer? }` |
| `POST /v1/release` | `{ holdId, reason: "not-created" }` or `{ requestId, reason: "not-created" }` | `{ ok: true }` |
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

`requestId` names one press of Run. The page sends an id with each press, and sends the same press again when its
answer is lost on the way (the network dropped, or a proxy in between gave up on a slow answer). Fuobe makes the
reserve's `requestId` from the account, that id and the press's try, so every send of one try reserves under one id,
and no other account's press can name it. Fuobe makes the run once: a resend gets the run the first send made. A try
ends when its hold goes back before a run was made (refused after the hold was made, or no answer in time): the press's
next send is a new try under a new `requestId`, so no run is ever made against a hold that went back. A request with
no page id (a script) reserves under an id of its own. Only runs on this install's GPUs reserve, so only they use it.

A release names the hold, or, when no try of a reserve got an answer that said what happened, the reserve's
`requestId`. The service releases whatever it holds for that id, and nothing when it holds none. Fuobe sends a release
by `requestId` a minute after it gave up, so the reserve comes first. A resend of that press is a new try, under a new
`requestId`.

`shown` is the price the person saw before pressing Run. A service must never charge more than it: when the price would
be higher, it refuses with `price-changed` and the new quote, and the person sees the new price before running again.
The card that shows it offers "Run at this price": the same run is sent again with the new price in `x-fuobe-shown`, so
a run started without a price check (a result's Upscale, a retry, Run again) runs at the price the person accepted.

A reserve's `text` is shown on the result once it succeeded ("7 units"). A run that fails or is removed says "Not
charged" only when its reserve answer set an amount aside (`amount` above 0). `maxWaitMs` is how long the run may wait
in line before a GPU first takes it; past it the row fails and is refunded. Once a GPU has taken it, the limit is over:
a run that goes back in line (a GPU paused or restarted) keeps its place and waits there.

`timing` says how long the hold must stay open after a GPU first takes the run, so the run's reports always come
before the hold's deadline. `runMs` gives every job of every step all its attempts, each at its lane's run ceiling
with the time to send its files and results. `pausedMs` is the time a started run may spend back in line (the queue's
`pausedBudgetS`, two hours unless the owner sets another). A service sets the deadline to at least now + `maxWaitMs` +
`runMs` + `pausedMs`. A run past it still delivers its result. A service that doesn't read `timing` keeps its own rule.

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
report from what is stored. A run whose rows couldn't be made after its reserve sends one `release`. Two app processes
on one database (during a deploy) never send the same report: a process takes a report before it sends it, and only one
process saves a finished run's results. A process that stops while it saves a result gives that turn back as it exits,
so the next process saves the result at once. A process that is killed loses the turn once it has been quiet for 20
seconds. A stop that comes after the result was saved leaves the run saved, so its report is a `settle`.

## When the service is down

| Situation | What happens |
|---|---|
| No `FUOBE_BILLING_URL` | No call. Runs on this install's GPUs are closed, or free and allowed with `FUOBE_HOSTED_FREE=1`. |
| Set, and it answers | As above. |
| Set, and no answer in time | A press of Run waits while the reserve is tried again for up to 40 seconds (a restart of the service), and the feed shows the run as "In line" meanwhile. Then the run is made with its place in line. Past that, the run is refused (503, "Try again in a moment.") and nothing is made. The last policy stands for 10 minutes (above). Before Run, the price slot says "Ready in a moment" and Run is off; the price check asks again by itself, and Run comes back on with its answer. Runs on the account's own GPU or key go on. Reports wait in the outbox and are sent when it is back. Runs that already have a hold keep running. |

The service's address and its errors are written to the server's log only. A browser never sees them.
