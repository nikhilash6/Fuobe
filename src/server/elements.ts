import "server-only";
import { nanoid } from "nanoid";
import { handleFor, MAX_ELEMENT_PHOTOS, type ElementKind, type ElementLora, type ElementVoice, type StudioElement } from "@/lib/catalog/elements";
import { db } from "./db";

interface Row {
  id: string;
  name: string;
  handle: string | null;
  kind: ElementKind;
  description: string | null;
  reference_asset_ids_json: string;
  loras_json: string | null;
  voice_json?: string | null;
  status: StudioElement["status"];
  created_at: number;
}

const toElement = (r: Row): StudioElement => ({
  id: r.id,
  name: r.name,
  handle: r.handle ?? handleFor(r.name),
  kind: r.kind,
  description: r.description,
  references: JSON.parse(r.reference_asset_ids_json) as string[],
  loras: r.loras_json ? (JSON.parse(r.loras_json) as ElementLora[]) : [],
  ...(r.voice_json && { voice: JSON.parse(r.voice_json) as ElementVoice }),
  status: r.status,
  createdAt: r.created_at,
});

export function listElements(kind?: ElementKind): StudioElement[] {
  const rows = kind
    ? db().prepare("SELECT * FROM characters WHERE kind = ? ORDER BY created_at DESC").all(kind)
    : db().prepare("SELECT * FROM characters ORDER BY created_at DESC").all();
  return (rows as Row[]).map(toElement);
}

export function getElement(id: string): StudioElement | null {
  const r = db().prepare("SELECT * FROM characters WHERE id = ?").get(id) as Row | undefined;
  return r ? toElement(r) : null;
}

/** A handle nobody else uses: Maya, Maya_2, Maya_3… */
function uniqueHandle(name: string, exceptId?: string): string {
  const base = handleFor(name);
  const taken = new Set(
    (db().prepare("SELECT id, handle FROM characters").all() as { id: string; handle: string | null }[])
      .filter((r) => r.id !== exceptId)
      .map((r) => (r.handle ?? "").toLowerCase()),
  );
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`.toLowerCase())) return `${base}_${i}`;
}

export function createElement(input: { name: string; kind: ElementKind; description?: string; references: string[]; voice?: ElementVoice }): StudioElement {
  const now = Date.now();
  const name = input.name.trim().slice(0, 60);
  const row = {
    id: nanoid(10),
    name,
    handle: uniqueHandle(name),
    kind: input.kind,
    description: input.description?.trim() || null,
    reference_asset_ids_json: JSON.stringify(input.references.slice(0, MAX_ELEMENT_PHOTOS)),
    loras_json: null,
    // A designed voice (Design a voice) keeps its model and words; only a voice element has one.
    voice_json: input.kind === "voice" && input.voice ? JSON.stringify(input.voice) : null,
    status: "ready" as const,
    created_at: now,
  };
  db()
    .prepare(
      `INSERT INTO characters (id, name, handle, kind, description, reference_asset_ids_json, loras_json, voice_json, status, created_at, updated_at)
       VALUES (@id, @name, @handle, @kind, @description, @reference_asset_ids_json, @loras_json, @voice_json, @status, @created_at, @created_at)`,
    )
    .run(row);
  return toElement(row);
}

export function updateElement(
  id: string,
  patch: { name?: string; description?: string | null; references?: string[]; loras?: ElementLora[]; voice?: ElementVoice | null; status?: StudioElement["status"] },
): StudioElement | null {
  const cur = getElement(id);
  if (!cur) return null;
  const name = patch.name?.trim().slice(0, 60) || cur.name;
  db()
    .prepare(
      `UPDATE characters SET name = @name, handle = @handle, description = @description, reference_asset_ids_json = @refs,
       loras_json = @loras, voice_json = @voice, status = @status, updated_at = @now WHERE id = @id`,
    )
    .run({
      id,
      name,
      handle: name === cur.name ? cur.handle : uniqueHandle(name, id),
      description: patch.description === undefined ? cur.description : patch.description?.trim() || null,
      refs: JSON.stringify((patch.references ?? cur.references).slice(0, MAX_ELEMENT_PHOTOS)),
      loras: JSON.stringify(patch.loras ?? cur.loras),
      // A new recording replaces a designed voice's clip: its embedding (of the old clip) goes unless the patch keeps one.
      voice: voiceAfter(cur, patch),
      status: patch.status ?? cur.status,
      now: Date.now(),
    });
  return getElement(id);
}

/** A voice element's voice after a patch: the patch's, or the old one without an embedding of a clip it no longer has. */
function voiceAfter(cur: StudioElement, patch: { references?: string[]; voice?: ElementVoice | null }): string | null {
  if (cur.kind !== "voice") return null;
  if (patch.voice !== undefined) return patch.voice ? JSON.stringify(patch.voice) : null;
  if (!cur.voice) return null;
  const sameClip = !patch.references || patch.references[0] === cur.references[0];
  if (sameClip) return JSON.stringify(cur.voice);
  const { embedding: _gone, transcript: _old, ...rest } = cur.voice;
  return JSON.stringify(rest);
}

export function deleteElement(id: string): void {
  db().prepare("DELETE FROM characters WHERE id = ?").run(id);
}
