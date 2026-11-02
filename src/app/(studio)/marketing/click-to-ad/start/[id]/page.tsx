import type { Metadata } from "next";
import { starterMetadata, starterParams, StarterRoute } from "@/components/starters/starter-route";

export function generateStaticParams() {
  return starterParams("click-to-ad");
}

export function generateMetadata({ params }: PageProps<"/marketing/click-to-ad/start/[id]">): Promise<Metadata> {
  return starterMetadata("click-to-ad", params);
}

export default function Page({ params }: PageProps<"/marketing/click-to-ad/start/[id]">) {
  return <StarterRoute surface="click-to-ad" params={params} />;
}
