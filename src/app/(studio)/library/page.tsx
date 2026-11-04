import type { Metadata } from "next";
import { LibraryView } from "@/components/library-view";
import { starterCards } from "@/lib/starters/catalog";

export const metadata: Metadata = { title: "Library" };

export default function Page() {
  return <LibraryView starters={starterCards("library")} />;
}
