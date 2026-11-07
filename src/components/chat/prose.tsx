import { Clapperboard, ImageIcon, Music4 } from "lucide-react";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { makeItHref, splitMakeIts, type MakeIt } from "@/lib/chat/prompt";
import { cn } from "@/lib/utils";

const STUDIO = {
  image: { label: "Make it in Image", icon: ImageIcon },
  video: { label: "Make it in Video", icon: Clapperboard },
  music: { label: "Make it in Music", icon: Music4 },
} as const;

/** Markdown as chat replies use it: no raw HTML, links open in a new tab, *actions* read as stage directions. */
const COMPONENTS: Components = {
  p: ({ children }) => <p className="break-words">{children}</p>,
  em: ({ children }) => <em className="text-muted-foreground italic">{children}</em>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5 marker:text-muted-foreground">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5 marker:text-muted-foreground">{children}</ol>,
  h1: ({ children }) => <h3 className="font-heading pt-1 text-[22px] leading-snug">{children}</h3>,
  h2: ({ children }) => <h3 className="font-heading pt-1 text-[22px] leading-snug">{children}</h3>,
  h3: ({ children }) => <h3 className="font-heading pt-1 text-[21px] leading-snug">{children}</h3>,
  h4: ({ children }) => <h4 className="pt-1 font-semibold">{children}</h4>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-text underline underline-offset-2">
      {children}
    </a>
  ),
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{children}</code>,
  pre: ({ children }) => <pre className="overflow-x-auto rounded-xl bg-muted p-3 text-[13px]">{children}</pre>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-border-strong pl-3 text-muted-foreground">{children}</blockquote>,
  hr: () => <hr className="border-border" />,
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-[14px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b px-2 py-1 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b px-2 py-1 align-top">{children}</td>,
};

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("space-y-3 text-[15.5px] leading-relaxed", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** A prompt the reply suggested, with the button that opens its studio filled in. */
export function MakeItCard({ make, compact }: { make: MakeIt; compact?: boolean }) {
  const s = STUDIO[make.studio];
  const Icon = s.icon;
  return (
    <div className={cn("group rounded-2xl border bg-background/80 p-3", compact && "p-2.5")}>
      <p className="line-clamp-3 text-[13.5px] leading-snug text-muted-foreground">{make.prompt}</p>
      <Link
        href={makeItHref(make)}
        className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-full bg-foreground px-3.5 text-[13px] font-medium text-background transition-opacity hover:opacity-90 focus-visible:ring-4 focus-visible:ring-brand-faint focus-visible:outline-none"
      >
        <Icon className="size-3.5" />
        {s.label}
      </Link>
    </div>
  );
}

/** A reply: its words, with each suggested prompt as a Make it card where it appears. */
export function ReplyBody({ text, compact }: { text: string; compact?: boolean }) {
  const parts = splitMakeIts(text);
  return (
    <div className="space-y-3">
      {parts.map((p, i) => (p.kind === "text" ? <Markdown key={i} text={p.text} /> : <MakeItCard key={i} make={p.make} compact={compact} />))}
    </div>
  );
}
