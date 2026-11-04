import type { Metadata } from "next";
import { starterMetadata, starterParams, StarterRoute } from "@/components/starters/starter-route";

export function generateStaticParams() {
  return starterParams("ads");
}

export function generateMetadata({ params }: PageProps<"/ads/start/[id]">): Promise<Metadata> {
  return starterMetadata("ads", params);
}

export default function Page({ params }: PageProps<"/ads/start/[id]">) {
  return <StarterRoute surface="ads" params={params} />;
}
