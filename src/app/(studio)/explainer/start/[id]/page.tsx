import type { Metadata } from "next";
import { starterMetadata, starterParams, StarterRoute } from "@/components/starters/starter-route";

export function generateStaticParams() {
  return starterParams("explainer");
}

export function generateMetadata({ params }: PageProps<"/explainer/start/[id]">): Promise<Metadata> {
  return starterMetadata("explainer", params);
}

export default function Page({ params }: PageProps<"/explainer/start/[id]">) {
  return <StarterRoute surface="explainer" params={params} />;
}
