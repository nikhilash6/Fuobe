"use client";

// The starters' icons, by lucide name (src/lib/starters/catalog.ts). Its own small map: a page loads only these.
import { FlaskConical, Gem, Landmark, Leaf, Sailboat, Scissors, Shirt, ShoppingBag, Sparkles, Sun, Waves, type LucideIcon } from "lucide-react";

export const STARTER_ICONS: Record<string, LucideIcon> = { FlaskConical, Gem, Landmark, Leaf, Sailboat, Scissors, Shirt, ShoppingBag, Sun, Waves };

export function StarterIcon({ name, className }: { name: string; className?: string }) {
  const Icon: LucideIcon = STARTER_ICONS[name] ?? Sparkles;
  return <Icon className={className} />;
}
