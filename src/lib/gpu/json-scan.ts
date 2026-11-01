/**
 * Read a big JSON object (GET /object_info: every node class, tens of MB with many packs) chunk by chunk
 * without parsing all of it: the top-level keys, plus the values of the few keys asked for (the loader
 * classes whose combo lists say which model files that ComfyUI can load). Memory stays at about the size
 * of the captured values, never the whole body.
 */
export class TopLevelScanner {
  private decoder = new TextDecoder();
  private depth = 0;
  private inString = false;
  private escape = false;
  /** The string being read, when it may be a top-level key. */
  private keyBuf: string[] | null = null;
  private lastKey: string | null = null;
  /** After a top-level key and its colon: the value starts at the next non-space character. */
  private awaitingValue = false;
  private capturing: { key: string; parts: string[] } | null = null;
  private started = false;
  readonly keys: string[] = [];
  readonly captured: Record<string, unknown> = {};
  /** False once the text stops looking like one JSON object. */
  ok = true;

  constructor(private readonly wanted: Set<string>) {}

  push(chunk: Uint8Array | string): void {
    const text = typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });
    if (!this.ok) return;
    let captureFrom = this.capturing ? 0 : -1;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (this.inString) {
        if (this.keyBuf) this.keyBuf.push(ch);
        if (this.escape) this.escape = false;
        else if (ch === "\\") this.escape = true;
        else if (ch === '"') {
          this.inString = false;
          if (this.keyBuf) {
            this.keyBuf.pop(); // the closing quote
            try {
              this.lastKey = JSON.parse(`"${this.keyBuf.join("")}"`) as string;
            } catch {
              this.lastKey = this.keyBuf.join("");
            }
            this.keyBuf = null;
          }
        }
        continue;
      }
      if (this.awaitingValue && !/\s/.test(ch)) {
        this.awaitingValue = false;
        if (this.lastKey !== null && this.wanted.has(this.lastKey)) {
          this.capturing = { key: this.lastKey, parts: [] };
          captureFrom = i;
        }
      }
      switch (ch) {
        case '"':
          this.inString = true;
          // A string at depth 1 that isn't a value is a key.
          this.keyBuf = this.depth === 1 && !this.capturing && this.expectKey ? [] : null;
          break;
        case "{":
        case "[":
          if (!this.started) {
            if (ch !== "{") this.ok = false;
            this.started = true;
            this.expectKey = true;
          }
          this.depth++;
          break;
        case "}":
        case "]":
          this.depth--;
          if (this.depth === 1 && this.capturing) {
            this.finishCapture(text, captureFrom, i + 1);
            captureFrom = -1;
          } else if (this.depth === 0 && this.capturing) {
            // A plain value (a number, a string) was the last one.
            this.finishCapture(text, captureFrom, i);
            captureFrom = -1;
          }
          if (this.depth < 0) this.ok = false;
          break;
        case ":":
          if (this.depth === 1 && this.lastKey !== null && this.expectKey) {
            this.keys.push(this.lastKey);
            this.expectKey = false;
            this.awaitingValue = true;
          }
          break;
        case ",":
          if (this.depth === 1) {
            if (this.capturing) {
              this.finishCapture(text, captureFrom, i);
              captureFrom = -1;
            }
            this.expectKey = true;
            this.lastKey = null;
          }
          break;
        default:
          if (!this.started && !/\s/.test(ch)) this.ok = false;
      }
      if (!this.ok) return;
    }
    if (this.capturing && captureFrom >= 0) this.capturing.parts.push(text.slice(captureFrom));
  }

  private expectKey = false;

  private finishCapture(text: string, from: number, to: number): void {
    const c = this.capturing!;
    if (from >= 0) c.parts.push(text.slice(from, to));
    this.capturing = null;
    try {
      this.captured[c.key] = JSON.parse(c.parts.join("").trim());
    } catch {
      // A value we can't read counts as not captured.
    }
  }

  /** The object ended: true when it was a whole JSON object. */
  done(): boolean {
    return this.ok && this.started && this.depth === 0 && !this.inString;
  }
}

/** The options of a combo input in an /object_info entry: legacy `[[...], {...}]` or `["COMBO", {options: [...]}]`. */
export function comboOptions(info: unknown, input: string): string[] | null {
  const i = (info as { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } } | null)?.input;
  const spec = i?.required?.[input] ?? i?.optional?.[input];
  if (!Array.isArray(spec)) return null;
  if (Array.isArray(spec[0])) return spec[0].filter((x): x is string => typeof x === "string");
  if (spec[0] === "COMBO") {
    // A combo the frontend fills from another route (`remote`) says nothing here.
    if ((spec[1] as { remote?: unknown } | undefined)?.remote) return null;
    const opts = (spec[1] as { options?: unknown } | undefined)?.options;
    return Array.isArray(opts) ? opts.filter((x): x is string => typeof x === "string") : [];
  }
  return null;
}
