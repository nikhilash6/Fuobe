import type { Metadata } from "next";
import { starterMetadata, starterParams, StarterRoute } from "@/components/starters/starter-route";

export function generateStaticParams() {
  return starterParams("marketing");
}

export function generateMetadata({ params }: PageProps<"/marketing/start/[id]">): Promise<Metadata> {
  return starterMetadata("marketing", params);
}

export default function Page({ params }: PageProps<"/marketing/start/[id]">) {
  return <StarterRoute surface="marketing" params={params} />;
}
