"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useViewer } from "@/lib/api";
import type { Generation } from "@/lib/catalog/types";
import { entryBySlug, entryForRecipe, exampleRecipe, kineticHref, normalizeKinetic, startRecipe, type KineticEntry, type KineticExample } from "@/lib/motion/kinetic-catalog";
import { brandOf, docFiles, docFrom, setBrand, setClip, setProduct, switchScene, type KineticDoc } from "@/lib/motion/kinetic-doc";
import { END_CARD_VARIANTS, type EndCardVariant } from "@/lib/motion/scenes/end-card/shared";
import { readDraft, writeDraft } from "./draft";
import { Editor } from "./editor";
import { ScenePicker } from "./scene-picker";
import { useKineticEditor } from "./use-editor";
import { recipeOfResult } from "./versions-sheet";

/**
 * Fuobe Kinetic Motion's page (/kinetic): the scene picker, or the editor on one scene. The address names what is open
 * (`scene`, the end card's `style`, or a saved result to open with `from`); a change of scene replaces it, so tweaks never
 * add history entries. The open recipe is kept as a draft in this browser, per viewer and scene.
 */

const styleOf = (v: string | null): EndCardVariant | null => (v && (END_CARD_VARIANTS as readonly string[]).includes(v) ? (v as EndCardVariant) : null);

/** A short, stable stand-in for who is looking (drafts are kept per viewer). */
function viewerKey(v: { owner: boolean; signedIn: boolean; account?: { email: string } } | undefined): string | null {
  if (!v) return null;
  if (v.owner) return "owner";
  if (!v.account) return "guest";
  let h = 5381;
  for (const c of v.account.email) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return `a${h.toString(36)}`;
}

/** The style a recipe plays, for the address (end cards only). */
const recipeStyle = (d: KineticDoc) => (d.recipe.scene.startsWith("end-card/") ? d.recipe.scene.split("/")[1] : null);

/** The person's files a draft names that are gone now (404), dropped from it. */
async function dropGone(d: KineticDoc): Promise<{ doc: KineticDoc; missing: Set<string> }> {
  const missing = new Set<string>();
  const urls = [...docFiles(d.recipe), ...(d.recipe.layers?.video ? [d.recipe.layers.video.src] : [])];
  const gone = new Set<string>();
  await Promise.all(
    urls.map(async (u) => {
      try {
        const res = await fetch(u, { method: "HEAD" });
        if (res.status === 404) gone.add(u);
      } catch {}
    }),
  );
  let doc = d;
  if (doc.recipe.brand.logo && gone.has(doc.recipe.brand.logo)) {
    doc = setBrand(doc, { ...brandOf(doc), logo: null });
    missing.add("logo");
  }
  if (doc.recipe.media?.product && gone.has(doc.recipe.media.product)) {
    doc = setProduct(doc, null);
    missing.add("product");
  }
  if (doc.recipe.layers?.video && gone.has(doc.recipe.layers.video.src)) {
    doc = setClip(doc, null);
    missing.add("clip");
  }
  return { doc, missing };
}

export function KineticStudio() {
  const params = useSearchParams();
  const router = useRouter();
  const viewer = useViewer();
  const who = viewer.isError ? "guest" : viewerKey(viewer.data);
  const editor = useKineticEditor();
  const [view, setView] = useState<"loading" | "picker" | "editor">("loading");
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  const booted = useRef(false);

  /** Opens a document in the editor (from a draft when this viewer has one for the scene and `fresh` isn't asked). */
  const openDoc = useCallback(
    async (entry: KineticEntry, o: { style?: EndCardVariant | null; fresh?: boolean; example?: KineticExample } = {}) => {
      const draft = !o.fresh && who ? readDraft(who, entry.slug) : null;
      let doc = docFrom(o.example ? exampleRecipe(o.example) : startRecipe(entry, { style: o.style }));
      let gone = new Set<string>();
      if (draft) {
        const n = normalizeKinetic(draft.recipe);
        if (n && n.entry.slug === entry.slug) {
          const checked = await dropGone({ recipe: n.recipe, logo: draft.logo });
          doc = checked.doc;
          gone = checked.missing;
        }
      }
      setMissing(gone);
      editor.open(doc);
      setView("editor");
    },
    [who, editor],
  );

  // The first open: a saved result (`from`), a scene (`scene`, `style`), or the picker.
  useEffect(() => {
    if (booted.current || !who) return;
    booted.current = true;
    const from = params.get("from");
    const entry = entryBySlug(params.get("scene"));
    void (async () => {
      if (from) {
        if (who === "guest") {
          // Nothing of a guest's to open: the picker, with no message.
          setView("picker");
          router.replace("/kinetic", { scroll: false });
          return;
        }
        try {
          const res = await fetch(`/api/generations/${encodeURIComponent(from)}`);
          const g = res.ok ? ((await res.json()) as Generation) : null;
          const n = g && g.modelId === "local-motion" ? normalizeKinetic(recipeOfResult(g)) : null;
          if (!n) throw new Error("gone");
          editor.open(docFrom(n.recipe));
          setView("editor");
        } catch {
          toast("We can't open that one.");
          setView("picker");
          router.replace("/kinetic", { scroll: false });
        }
        return;
      }
      if (entry) await openDoc(entry, { style: styleOf(params.get("style")) });
      // A tile picked while the page was still finding out who is looking has opened the editor already.
      else setView((v) => (v === "loading" ? "picker" : v));
    })();
  }, [who, params, editor, openDoc, router]);

  const doc = editor.doc;
  const entry = doc ? entryForRecipe(doc.recipe) : undefined;

  // The address follows the open scene (replaced, never pushed); the first one keeps what it was opened with.
  const shown = useRef<string | null>(null);
  const href = view === "editor" && entry && doc ? kineticHref(entry, recipeStyle(doc)) : view === "picker" ? "/kinetic" : null;
  useEffect(() => {
    if (!href) return;
    if (shown.current === null) {
      shown.current = href;
      return;
    }
    if (shown.current === href) return;
    shown.current = href;
    router.replace(href, { scroll: false });
  }, [href, router]);

  // The draft: the open recipe, per viewer and scene, a moment after each change.
  useEffect(() => {
    if (view !== "editor" || !doc || !entry || !who) return;
    const id = setTimeout(() => writeDraft(who, entry.slug, doc), 300);
    return () => clearTimeout(id);
  }, [doc, entry, who, view]);

  // While it finds out who is looking, the opening screen shows at once (as the static page does) unless the address
  // names a scene or a saved result.
  if (view === "loading" && (params.has("scene") || params.has("from"))) return <div className="min-h-[60svh]" aria-busy="true" />;
  if (view === "loading" || view === "picker" || !doc || !entry)
    return (
      <ScenePicker
        onOpen={(e: KineticEntry, x?: KineticExample) => {
          // Opened from the opening screen: the address follows to the scene from here.
          shown.current ??= "/kinetic";
          window.scrollTo({ top: 0 });
          void openDoc(e, { style: x?.style, fresh: !!x, example: x });
        }}
      />
    );
  return (
    <Editor
      editor={editor}
      doc={doc}
      entry={entry}
      missing={missing}
      onBack={() => setView("picker")}
      onScene={(to) => {
        if (to.slug === entry.slug) return;
        setMissing(new Set());
        const draft = who ? readDraft(who, to.slug) : null;
        const n = draft ? normalizeKinetic(draft.recipe) : null;
        editor.open(n && n.entry.slug === to.slug ? { recipe: n.recipe, logo: draft!.logo } : switchScene(doc, to, brandOf(doc)));
      }}
    />
  );
}
