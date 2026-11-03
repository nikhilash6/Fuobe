import type { Metadata } from "next";
import { starterMetadata, starterParams, StarterRoute } from "@/components/starters/starter-route";

export function generateStaticParams() {
  return starterParams("elements");
}

export function generateMetadata({ params }: PageProps<"/elements/start/[id]">): Promise<Metadata> {
  return starterMetadata("elements", params);
}

export default function Page({ params }: PageProps<"/elements/start/[id]">) {
  return <StarterRoute surface="elements" params={params} />;
}
