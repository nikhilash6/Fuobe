import type { Metadata } from "next";
import { starterMetadata, starterParams, StarterRoute } from "@/components/starters/starter-route";

export function generateStaticParams() {
  return starterParams("assist");
}

export function generateMetadata({ params }: PageProps<"/assist/start/[id]">): Promise<Metadata> {
  return starterMetadata("assist", params);
}

export default function Page({ params }: PageProps<"/assist/start/[id]">) {
  return <StarterRoute surface="assist" params={params} />;
}
