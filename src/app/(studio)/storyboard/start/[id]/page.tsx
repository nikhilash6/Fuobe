import type { Metadata } from "next";
import { starterMetadata, starterParams, StarterRoute } from "@/components/starters/starter-route";

export function generateStaticParams() {
  return starterParams("storyboard");
}

export function generateMetadata({ params }: PageProps<"/storyboard/start/[id]">): Promise<Metadata> {
  return starterMetadata("storyboard", params);
}

export default function Page({ params }: PageProps<"/storyboard/start/[id]">) {
  return <StarterRoute surface="storyboard" params={params} />;
}
