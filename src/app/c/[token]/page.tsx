import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache, Suspense } from "react";
import { ChatSharePage } from "../share-page";
import { countsAsView } from "@/lib/share";
import { countShareView, findChatShare } from "@/server/chat/store";

/** The share, once per request (metadata and the page both read it). */
const load = cache((token: string) => findChatShare(token));

const PRIVATE: Metadata = {
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false, noimageindex: true } },
  referrer: "no-referrer",
};

async function requestBase(): Promise<URL | null> {
  const h = await headers();
  const host = h.get("x-forwarded-host")?.split(",")[0].trim() || h.get("host");
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() === "https" ? "https" : "http";
  return host && /^[\w.-]+(:\d+)?$|^\[[\da-f:.]+\](:\d+)?$/i.test(host) ? new URL(`${proto}://${host}`) : null;
}

export async function generateMetadata({ params }: PageProps<"/c/[token]">): Promise<Metadata> {
  const { token } = await params;
  await connection();
  const s = load(token);
  if (!s) return { ...PRIVATE, title: { absolute: "Chat unavailable · Fuobe" } };
  const snap = s.snapshot;
  const title = snap.character ? `A chat with ${snap.character.name}` : snap.title;
  const first = snap.mature ? null : snap.messages.find((m) => m.role === "assistant")?.content.replace(/[*#_`>]/g, "").replace(/\s+/g, " ").slice(0, 160);
  const base = await requestBase();
  return {
    ...PRIVATE,
    ...(base && { metadataBase: base }),
    title: { absolute: `${title} · Fuobe` },
    description: first ?? "A chat shared from Fuobe.",
    openGraph: { title, description: first ?? undefined, type: "article" },
    twitter: { card: "summary_large_image", title },
  };
}

async function Content({ params }: { params: PageProps<"/c/[token]">["params"] }) {
  const { token } = await params;
  await connection();
  const s = load(token);
  if (!s) notFound();
  const h = await headers();
  if (countsAsView("GET", h)) countShareView(token);
  return <ChatSharePage token={token} snap={s.snapshot} portrait={!!s.portrait} />;
}

/** A shared chat's public page. The proxy lets /c/<token> through without a session; this page checks the token. */
export default function Page({ params }: PageProps<"/c/[token]">) {
  return (
    <Suspense fallback={<div className="min-h-svh bg-background" />}>
      <Content params={params} />
    </Suspense>
  );
}
