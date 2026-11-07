import type { Metadata } from "next";
import { Suspense } from "react";
import { ThreadView } from "@/components/chat/thread-view";

export const metadata: Metadata = { title: "Chat" };

async function Thread({ params }: { params: PageProps<"/chat/[id]">["params"] }) {
  const { id } = await params;
  return <ThreadView id={id} />;
}

export default function Page({ params }: PageProps<"/chat/[id]">) {
  return (
    <Suspense>
      <Thread params={params} />
    </Suspense>
  );
}
