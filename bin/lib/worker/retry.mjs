// One retry policy for the worker's calls to the studio (docs/gpu-workers.md). A studio that is restarting (a deploy), a
// proxy in front of it with nothing to say (502, 503, a CDN's 52x), a busy studio that says when to come back
// (429 with Retry-After) or a network that drops for a moment are waited out with a growing pause (1 s, 2 s, 4 s … at
// most 30 s at a time): up to 2 minutes for a call, and up to an hour for a part of a result. A beat is never waited
// out: the next one comes soon anyway. A call that may have reached the studio is sent again only when sending it twice
// is safe (a read; a part of a result, which the studio takes only at its own offset; or a claim, since a job the studio
// gave out on a claim whose answer was lost comes back on the next one). A proxy's page in place of an answer (a 403
// that isn't the studio's JSON) never stops the worker: it counts as no answer. A call that gets through on its second
// try (a second without the studio while it deploys, one dropped connection) says nothing: only trouble that lasts
// longer is logged, with the network's own reason (failure).

export const RETRY = { callMs: 2 * 60_000, uploadMs: 60 * 60_000, maxPauseMs: 30_000 };

/** Network failures where the call never reached the studio. */
const NOT_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);
/** Answers from a proxy that never reached the studio. */
const NOT_REACHED = new Set([502, 503, 521, 522, 523, 525, 526, 530]);
/** Answers that may come after the studio got the call (a slow answer): safe to send again only when that is harmless. */
const MAYBE_REACHED = new Set([500, 504, 520, 524, 527]);

const codeOf = (e) => e?.cause?.code ?? e?.code;

/** What went wrong with a call, for the log: the error and, for a network failure ("fetch failed"), its reason. */
export function failure(e) {
  const said = String(e?.message ?? e);
  const why = codeOf(e) ?? (e?.cause && e.cause !== e ? e.cause.message : undefined);
  return why && !said.includes(String(why)) ? `${said} (${why})` : said;
}
const isJson = (res) => /json/i.test(res.headers.get("content-type") ?? "");
/** A proxy's page in place of the studio's answer. */
const notTheStudio = (res) => res.status === 403 && !isJson(res);

/**
 * The worker's beats, for its log. A beat is never waited out, and the next one comes a few seconds later, so one beat
 * that didn't get through says nothing. The second in a row says the studio can't be reached, and why; the first beat
 * that gets through after that says it answers again.
 */
export class Reach {
  constructor(log) {
    this.log = log;
    this.missed = 0;
  }

  miss(e) {
    this.missed += 1;
    if (this.missed === 2) this.log(`Can't reach the studio: ${failure(e)}`);
  }

  back() {
    if (this.missed >= 2) this.log("The studio answers again.");
    this.missed = 0;
  }
}

/** Is this answer worth waiting out? `safe`: the call can be sent twice. */
export function passing(res, safe) {
  if (NOT_REACHED.has(res.status)) return true;
  if (MAYBE_REACHED.has(res.status)) return safe;
  if (res.status === 429) return !!res.headers.get("retry-after");
  return notTheStudio(res);
}

/** `fetchFn` with the policy. `o`: { now, sleep, signal, log }. */
export function retrying(fetchFn, o = {}) {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  return async (url, init = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    const upload = method === "PUT" && /\/outputs\/\d+/.test(String(url));
    const beat = /\/api\/gpu\/computer\/beat$/.test(String(url));
    const claim = method === "POST" && /\/api\/gpu\/computer\/claim$/.test(String(url));
    const safe = method === "GET" || upload || claim;
    const until = now() + (beat ? 0 : upload ? RETRY.uploadMs : RETRY.callMs);
    for (let i = 0; ; i++) {
      let res = null;
      let err = null;
      try {
        res = await fetchFn(url, init);
      } catch (e) {
        err = e;
      }
      const again = err ? (safe && !init.signal?.aborted) || NOT_SENT.has(codeOf(err)) : passing(res, safe);
      if (!again || now() >= until || o.signal?.aborted) {
        if (err) throw err;
        if (notTheStudio(res)) {
          res.body?.cancel().catch(() => {});
          return Response.json({ error: "The studio didn't answer" }, { status: 503 });
        }
        return res;
      }
      const after = res ? Number(res.headers.get("retry-after")) : NaN;
      res?.body?.cancel().catch(() => {});
      const pause = Math.min(RETRY.maxPauseMs, Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * 2 ** Math.min(i, 5), Math.max(0, until - now()));
      if (i === 1) o.log?.(`The studio didn't answer${res ? ` (HTTP ${res.status})` : ` (${failure(err)})`}: trying again.`);
      await sleep(pause);
    }
  };
}
