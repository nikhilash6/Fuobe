"use client";

// The starters' icons, by lucide name (src/lib/starters/catalog.ts). Its own small map: a page loads only these.
import {
  AudioLines,
  Castle,
  Clapperboard,
  Droplet,
  FlaskConical,
  Gem,
  Image,
  Landmark,
  Leaf,
  Moon,
  Palette,
  Sailboat,
  Scissors,
  Ship,
  Shirt,
  ShoppingBag,
  Sparkles,
  Star,
  Sun,
  User,
  Waves,
  type LucideIcon,
} from "lucide-react";

export const STARTER_ICONS: Record<string, LucideIcon> = {
  AudioLines,
  Castle,
  Clapperboard,
  Droplet,
  FlaskConical,
  Gem,
  Image,
  Landmark,
  Leaf,
  Moon,
  Palette,
  Sailboat,
  Scissors,
  Ship,
  Shirt,
  ShoppingBag,
  Star,
  Sun,
  User,
  Waves,
};

export function StarterIcon({ name, className }: { name: string; className?: string }) {
  const Icon: LucideIcon = STARTER_ICONS[name] ?? Sparkles;
  return <Icon className={className} />;
}
