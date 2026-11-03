"use client";

// The icons of node types and templates, by lucide name. Its own file: the template cards and pages show them without
// loading the canvas editor's context (and through it the model catalog).
import {
  AtSign,
  Orbit,
  Rotate3d,
  AudioLines,
  AudioWaveform,
  Building2,
  Castle,
  Clapperboard,
  Columns3,
  Combine,
  Dog,
  Eraser,
  Feather,
  Film,
  Fish,
  Frame,
  GalleryHorizontal,
  Gem,
  ImageIcon,
  Languages,
  LayoutDashboard,
  LetterText,
  MessageSquareText,
  Mic2,
  MonitorPlay,
  Package,
  Palette,
  Sparkles,
  Star,
  StickyNote,
  Swords,
  Table,
  Type,
  UserRound,
  Waves,
  ZoomIn,
  type LucideIcon,
  Box,
  Music,
  Shirt,
} from "lucide-react";

export const ICONS: Record<string, LucideIcon> = {
  Type,
  LayoutDashboard,
  ImageIcon,
  Film,
  AudioLines,
  AtSign,
  Sparkles,
  Combine,
  Frame,
  ZoomIn,
  Eraser,
  Mic2,
  MonitorPlay,
  StickyNote,
  Clapperboard,
  MessageSquareText,
  Package,
  GalleryHorizontal,
  Columns3,
  AudioWaveform,
  UserRound,
  Languages,
  Table,
  // Kinetic
  LetterText,
  // Camera path and Fly around
  Orbit,
  Rotate3d,
  // Blockout to film
  Box,
  // Effects 2.0 chains (src/lib/catalog/canvas.ts EFFECT_CHAINS)
  Swords,
  Feather,
  Gem,
  Palette,
  Castle,
  Waves,
  Star,
  Building2,
  Fish,
  Dog,
  // Outfit lookbook, music video
  Shirt,
  Music,
};

/** A node type's or template's icon, by lucide name. */
export function NodeIcon({ name, className }: { name: string; className?: string }) {
  const Icon: LucideIcon = ICONS[name] ?? Sparkles;
  return <Icon className={className} />;
}
