import type { Metadata } from "next";
import { starterMetadata, starterParams, StarterRoute } from "@/components/starters/starter-route";

export function generateStaticParams() {
  return starterParams("cinema");
}

export function generateMetadata({ params }: PageProps<"/cinema/start/[id]">): Promise<Metadata> {
  return starterMetadata("cinema", params);
}

export default function Page({ params }: PageProps<"/cinema/start/[id]">) {
  return <StarterRoute surface="cinema" params={params} />;
}
