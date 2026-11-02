import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { starterIds, starterOn } from "@/lib/starters/catalog";
import { STARTER_SURFACES, type StarterSurface } from "@/lib/starters/types";
import { StarterPage } from "./starter-page";

/*
 * The pages of a studio's ready-made starters (`<studio>/start/<id>`), server-rendered from the catalog: no stored
 * record, so a guest opens them like any page. Each studio's route file is a few lines over these.
 */

export const starterParams = (surface: StarterSurface) => starterIds(surface).map((id) => ({ id }));

export async function starterMetadata(surface: StarterSurface, params: Promise<{ id: string }>): Promise<Metadata> {
  const { id } = await params;
  const s = starterOn(surface, id);
  if (!s) return { title: "Not found" };
  // A starter visitors don't see yet (no real cover): its page is the owner's, kept out of search, its name unsaid.
  if (!s.cover) return { title: `Starter · ${STARTER_SURFACES[surface].name}`, robots: { index: false, follow: false } };
  return { title: `${s.name} · ${STARTER_SURFACES[surface].name}`, description: s.description };
}

async function Starter({ surface, params }: { surface: StarterSurface; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = starterOn(surface, id);
  if (!s) notFound();
  return <StarterPage s={s} />;
}

export function StarterRoute({ surface, params }: { surface: StarterSurface; params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={null}>
      <Starter surface={surface} params={params} />
    </Suspense>
  );
}
