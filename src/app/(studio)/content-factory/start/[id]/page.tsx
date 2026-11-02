import type { Metadata } from "next";
import { starterMetadata, starterParams, StarterRoute } from "@/components/starters/starter-route";

export function generateStaticParams() {
  return starterParams("content-factory");
}

export function generateMetadata({ params }: PageProps<"/content-factory/start/[id]">): Promise<Metadata> {
  return starterMetadata("content-factory", params);
}

export default function Page({ params }: PageProps<"/content-factory/start/[id]">) {
  return <StarterRoute surface="content-factory" params={params} />;
}
