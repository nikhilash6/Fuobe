import type { Metadata } from "next";
import { starterMetadata, starterParams, StarterRoute } from "@/components/starters/starter-route";

export function generateStaticParams() {
  return starterParams("faceless");
}

export function generateMetadata({ params }: PageProps<"/faceless/start/[id]">): Promise<Metadata> {
  return starterMetadata("faceless", params);
}

export default function Page({ params }: PageProps<"/faceless/start/[id]">) {
  return <StarterRoute surface="faceless" params={params} />;
}
