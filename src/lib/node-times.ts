/**
 * Node times: how long each node of a job ran on a worker's ComfyUI, from its live socket (each "executing" event starts
 * a node and ends the one before; a node's first "progress" event is its first step, so the time before it is the node's
 * own loading). A worker sends the slowest nodes with its "finished" report, and the run's details show them to the
 * owner, so a slow run says where its time went (a model loading, its steps, its decode). Only node ids, class names,
 * times and step counts: never a prompt, a file name or a value.
 *
 * Pure: the job runner (src/lib/computer-runner.ts, in the worker build), the server and the tests share it.
 */

/** One node's time on its ComfyUI. */
export interface NodeTime {
  /** The node's id in the graph. */
  node: string;
  /** Its class (KSampler, VAEDecode, …), when the graph says. */
  type?: string;
  /** From its start to the next node's start (or the prompt's end). */
  ms: number;
  /** A node with steps: the time before its first step (its models loading, its text encoding), and its steps. */
  beforeStepsMs?: number;
  steps?: number;
}

/** The most nodes a report carries (the slowest), and the shortest time worth naming. */
export const NODE_TIMES = { most: 12, minMs: 50 } as const;

const NODE_ID = /^[\w:.-]{1,64}$/;
const TYPE = /^[\w .:+()-]{1,80}$/;

/** One prompt's clock, fed with its socket's events in order (`now` is the worker's own clock). */
export class NodeClock {
  private current: { node: string; at: number; firstStepAt?: number; steps?: number } | null = null;
  private readonly done = new Map<string, NodeTime>();

  /** A node starts (`null`: the prompt is done): the one before it ends now. */
  executing(node: string | null, now: number): void {
    this.close(now);
    if (node && NODE_ID.test(node)) this.current = { node, at: now };
  }

  /** A step: the running node's (ComfyUI sends a step while the node that makes it runs; the id it names isn't needed). */
  progress(_node: string | undefined, max: number, now: number): void {
    const c = this.current;
    if (!c) return;
    if (c.firstStepAt === undefined) c.firstStepAt = now;
    if (Number.isFinite(max) && max > 0) c.steps = Math.round(max);
  }

  /** The prompt ended (done, failed or stopped). */
  end(now: number): void {
    this.close(now);
  }

  private close(now: number) {
    const c = this.current;
    this.current = null;
    if (!c) return;
    const ms = Math.max(0, now - c.at);
    // A node that runs twice in one prompt (a loop) adds up.
    const before = this.done.get(c.node);
    const beforeSteps = c.firstStepAt !== undefined ? Math.max(0, c.firstStepAt - c.at) : undefined;
    this.done.set(c.node, {
      node: c.node,
      ms: (before?.ms ?? 0) + ms,
      ...((beforeSteps !== undefined || before?.beforeStepsMs !== undefined) && { beforeStepsMs: (before?.beforeStepsMs ?? 0) + (beforeSteps ?? 0) }),
      ...((c.steps ?? before?.steps) !== undefined && { steps: c.steps ?? before?.steps }),
    });
  }

  /**
   * The slowest nodes, slowest first, each with its class from the graph when it has one (`graph`: the prompt as its
   * ComfyUI ran it, node id → { class_type }).
   */
  times(graph?: unknown): NodeTime[] {
    const types = graph && typeof graph === "object" ? (graph as Record<string, { class_type?: unknown } | undefined>) : {};
    return [...this.done.values()]
      .filter((t) => t.ms >= NODE_TIMES.minMs)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, NODE_TIMES.most)
      .map((t) => {
        const type = types[t.node]?.class_type;
        return typeof type === "string" && TYPE.test(type) ? { ...t, type } : t;
      });
  }
}

const ms = (v: unknown, most: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), most) : undefined);

/**
 * Node times as a report or the database holds them, cleaned: at most NODE_TIMES.most, ids and classes in their plain
 * shapes, each time at most `mostMs` (the job's own limit). Anything else is left out; undefined when nothing is left.
 */
export function cleanNodeTimes(v: unknown, mostMs = 24 * 3_600_000): NodeTime[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: NodeTime[] = [];
  for (const x of v.slice(0, NODE_TIMES.most)) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const time = ms(r.ms, mostMs);
    if (typeof r.node !== "string" || !NODE_ID.test(r.node) || time === undefined) continue;
    const before = ms(r.beforeStepsMs, time);
    const steps = typeof r.steps === "number" && Number.isInteger(r.steps) && r.steps > 0 && r.steps <= 100_000 ? r.steps : undefined;
    out.push({
      node: r.node,
      ...(typeof r.type === "string" && TYPE.test(r.type) && { type: r.type }),
      ms: time,
      ...(before !== undefined && { beforeStepsMs: before }),
      ...(steps !== undefined && { steps }),
    });
  }
  return out.length ? out : undefined;
}
