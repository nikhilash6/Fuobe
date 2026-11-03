import { notFound } from "next/navigation";
import { KineticCovers } from "./covers";

/**
 * A development-only page that renders Marketing's code-drawn templates with the engine itself, for their covers
 * (scripts/kinetic/render-covers.mjs drives it). It does not exist in a production build.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <KineticCovers />;
}
