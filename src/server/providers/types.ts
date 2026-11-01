import type { GenerationFix, GenInput, MediaKind, ModelDef, ModelRoute, ProviderId } from "@/lib/catalog/types";

export interface SubmitContext {
  generationId: string;
  model: ModelDef;
  route: ModelRoute;
  input: GenInput;
}

export interface SubmitResult {
  externalId: string;
  /** Provider-specific state needed for polling (status URLs, client ids...). */
  meta?: Record<string, unknown>;
  /** The exact payload sent, stored for debugging/reproducibility. */
  payload?: unknown;
}

export interface RemoteOutput {
  url: string;
  draftId?: string;
  kind?: MediaKind;
  contentType?: string;
  /** Text results (transcripts): the content; `url` is then a data:text/plain URI holding the same text. */
  text?: string;
  /** Structured extras for OutputFile.meta (layer name/z/bbox, cues, textBlocks, stem, 3D preview…). */
  meta?: Record<string, unknown>;
  /** Extra headers needed to download (e.g. auth for a private ComfyUI). */
  headers?: Record<string, string>;
}

/**
 * What a poll found. A job on someone's own computer (comfyui.ts) also says when it reached their ComfyUI (`sentAt`: the
 * queue clock starts there, not while it waited for their tab), what to say if it waits too long (`timeoutError`), and
 * what was missing when it failed (`fix`: the tile's "Fix it").
 */
export type PollResult =
  | { state: "queued"; progress?: number; message?: string; sentAt?: number; timeoutError?: string }
  | { state: "running"; progress?: number; message?: string; sentAt?: number }
  | { state: "succeeded"; outputs: RemoteOutput[]; message?: string }
  | { state: "failed"; error: string; fix?: GenerationFix };

export interface PollContext {
  externalId: string;
  meta: Record<string, unknown>;
  route: ModelRoute;
  model: ModelDef;
  createdAt: number;
}

export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  isConfigured(): boolean;
  /**
   * Turn a local file into something the provider accepts (URL, data URI, uploaded filename). `route` is
   * the route the file is for (ComfyUI uploads an isolated-worker workflow's inputs to that worker).
   */
  prepareFile(data: Buffer, contentType: string, name: string, route?: ModelRoute): Promise<string>;
  submit(ctx: SubmitContext): Promise<SubmitResult>;
  poll(ctx: PollContext): Promise<PollResult>;
  cancel?(ctx: PollContext): Promise<void>;
  /**
   * Lightweight connectivity check for the settings page. `focus` is the setting the person is
   * checking (the Anthropic key, the isolated worker's address…), for a provider whose settings
   * reach more than one server; the others ignore it.
   */
  test?(opts?: { focus?: string }): Promise<{ ok: boolean; detail: string }>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
