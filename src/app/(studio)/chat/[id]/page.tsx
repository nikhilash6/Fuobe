import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ThreadView } from "@/components/chat/thread-view";
import { recordFor } from "@/server/records";

export const metadata: Metadata = { title: "Chat" };

async function Thread({ params }: { params: PageProps<"/chat/[id]">["params"] }) {
  const { id } = await params;
  await connection();
  // Someone else's chat, or one that's gone: a real not-found (the proxy answers a page load first).
  if (!recordFor({ kind: "chat", ids: [id] }, await headers())) notFound();
  return <ThreadView id={id} />;
}

export default function Page({ params }: PageProps<"/chat/[id]">) {
  return (
    <Suspense>
      <Thread params={params} />
    </Suspense>
  );
}
