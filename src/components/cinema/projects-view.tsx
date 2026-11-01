"use client";

import { Clapperboard, Copy, ExternalLink, MoreHorizontal, Pin, PinOff, Plus, Settings2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageShell } from "@/components/page-shell";
import { PageHeader } from "@/components/page-shell";
import { HadItemsScript, useHadItems } from "@/components/use-had-items";
import { SelfHostNote } from "@/components/self-host-note";
import { useIsVisitor } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import type { CinemaProject } from "@/lib/catalog/cinema";
import { formatUsd } from "./money";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { copyWithToast } from "@/lib/clipboard";
import { useCinemaProjects, useUpdateProject } from "./hooks";
import { ProjectDialog } from "./project-settings";

/** A calm gradient for projects without a cover, stable per project. */
export function projectHue(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function Cover({ project, className }: { project: CinemaProject; className?: string }) {
  const src = project.cover ?? project.stats?.cover;
  const hue = projectHue(project.id);
  if (src && /\.(mp4|webm|mov)(\?|$)/i.test(src))
    return <video src={`${src}#t=0.1`} muted playsInline preload="metadata" className={cn("size-full object-cover", className)} />;
  if (src)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" loading="lazy" className={cn("size-full object-cover", className)} />;
  return (
    <div className={cn("grid size-full place-items-center", className)} style={{ background: `linear-gradient(135deg, oklch(0.42 0.06 ${hue}), oklch(0.26 0.04 ${(hue + 40) % 360}))` }}>
      <Clapperboard className="size-7 text-white/70" />
    </div>
  );
}

function ProjectCard({ project, onSettings }: { project: CinemaProject; onSettings: () => void }) {
  const update = useUpdateProject(project.id);
  const href = `/cinema/${project.id}`;
  return (
    <div className="group/card relative animate-fade-up">
      <Link href={href} className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="relative aspect-video overflow-hidden rounded-xl bg-muted">
          <Cover project={project} className="transition-transform duration-300 ease-move group-hover/card:scale-[1.02]" />
          {project.pinned && (
            <span className="absolute top-2 left-2 grid size-7 place-items-center rounded-full bg-black/45 text-white backdrop-blur">
              <Pin className="size-3.5" />
            </span>
          )}
        </div>
        <div className="mt-2.5 min-w-0 px-0.5">
          <h2 className="truncate text-[15px] font-medium">{project.name}</h2>
          {project.description && <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{project.description}</p>}
          <p className="mt-1 text-[12px] text-muted-foreground">
            Updated {timeAgo(project.updatedAt)}
            {project.stats ? ` · ${project.stats.items} take${project.stats.items === 1 ? "" : "s"}` : ""}
            {project.stats?.spentUsd || project.costCapUsd != null ? (
              <span className="font-mono">
                {" "}
                · ≈ {formatUsd(project.stats?.spentUsd)}
                {project.costCapUsd != null ? ` of ${formatUsd(project.costCapUsd)}` : ""}
              </span>
            ) : null}
          </p>
        </div>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="absolute top-2 right-2 grid size-8 place-items-center rounded-full bg-black/45 text-white opacity-100 backdrop-blur transition-opacity hover:bg-black/65 focus-visible:opacity-100 sm:opacity-0 sm:group-hover/card:opacity-100 data-[state=open]:opacity-100"
            aria-label={`${project.name} actions`}
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => update.mutate({ pinned: !project.pinned })}>
            {project.pinned ? <PinOff /> : <Pin />} {project.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => window.open(href, "_blank")}>
            <ExternalLink /> Open in new tab
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => void copyWithToast(new URL(href, window.location.origin).toString(), "Link copied")}
          >
            <Copy /> Copy link
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onSettings}>
            <Settings2 /> Settings
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const GRID = "grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

/**
 * The first-production block, or (`loading`) a placeholder of exactly its size: a grid skeleton
 * swapped for this block moved the page (CLS 0.048 in the round-4 audit).
 */
/** onCreate: none for a guest or an account (a project is saved to the owner's library), who is told so instead. */
function EmptyProjects({ loading, onCreate, className }: { loading?: boolean; onCreate?: () => void; className?: string }) {
  return (
    <div className={cn("mx-auto flex max-w-md flex-col items-center pt-[8vh] text-center", className)} aria-busy={loading || undefined} aria-label={loading ? "Loading projects" : undefined}>
      {loading ? (
        <>
          <Skeleton className="size-14 rounded-2xl" />
          <span className="mt-5 flex h-[1lh] w-full items-center justify-center font-heading text-[26px] leading-tight">
            <Skeleton className="h-6 w-2/3" />
          </span>
          {/* Two lines of 15 px text, then the button's 36 px. */}
          <span className="mt-2 flex h-[2lh] w-full flex-col items-center justify-center gap-2 text-[15px]">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-1/2" />
          </span>
          <Skeleton className="mt-6 h-9 w-36 rounded-full" />
        </>
      ) : (
        <>
          <div className="grid size-14 place-items-center rounded-2xl bg-brand-faint text-brand-text">
            <Clapperboard className="size-6" />
          </div>
          {onCreate ? (
            <>
              <h2 className="mt-5 font-heading text-[26px] leading-tight">Start your first production</h2>
              <p className="mt-2 text-[15px] text-muted-foreground">Projects keep your generations, elements, and chats together – create one to start.</p>
              <Button className="mt-6" onClick={onCreate}>
                <Plus /> New project
              </Button>
            </>
          ) : (
            <>
              <h2 className="mt-5 font-heading text-[26px] leading-tight">Projects aren&apos;t on free accounts yet</h2>
              <SelfHostNote className="mt-2 text-[15px]">Free accounts can use the Image, Video and Audio studios, camera motions, effects and apps.</SelfHostNote>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function CinemaProjects() {
  const { data, isLoading } = useCinemaProjects();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CinemaProject | null>(null);
  // A project is saved to the studio's library, which is its owner's: a guest or an account can't start one.
  const visitor = useIsVisitor();
  const onCreate = visitor ? undefined : () => setCreating(true);
  useHadItems("cinema-projects", data?.length);
  return (
    <PageShell wide>
      <PageHeader title="Cinema Studio" description="Direct films shot by shot: genre, camera, lens, palette and light, with characters and locations that stay the same.">
        {!visitor && (
          <Button onClick={() => setCreating(true)}>
            <Plus /> New project
          </Button>
        )}
      </PageHeader>
      {isLoading ? (
        // Both shapes are in the server's shell; the one this browser saw last time shows from the first paint.
        <div key="loading">
          <HadItemsScript name="cinema-projects" />
          <div className={cn(GRID, "hidden [html[data-had-cinema-projects='1']_&]:grid")} aria-busy="true" aria-label="Loading projects">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i}>
                <Skeleton className="aspect-video rounded-xl" />
                <Skeleton className="mt-3 h-4 w-2/3" />
                <Skeleton className="mt-2 h-3 w-1/3" />
              </div>
            ))}
          </div>
          <EmptyProjects loading className="[html[data-had-cinema-projects='1']_&]:hidden" onCreate={onCreate} />
        </div>
      ) : !data?.length ? (
        <EmptyProjects key="empty" onCreate={onCreate} />
      ) : (
        <div key="cards" className={GRID}>
          {data.map((p) => (
            <ProjectCard key={p.id} project={p} onSettings={() => setEditing(p)} />
          ))}
          <button
            onClick={() => setCreating(true)}
            className="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong text-[13px] font-medium text-muted-foreground transition-colors hover:border-primary hover:bg-brand-faint hover:text-brand-text"
          >
            <Plus className="size-5" /> New project
          </button>
        </div>
      )}
      <ProjectDialog
        open={creating}
        onOpenChange={setCreating}
        onDone={(p) => {
          setCreating(false);
          if (p) router.push(`/cinema/${p.id}`);
        }}
      />
      <ProjectDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        project={editing ?? undefined}
        spentUsd={editing?.stats?.spentUsd}
        onDone={() => setEditing(null)}
        onDeleted={() => setEditing(null)}
      />
    </PageShell>
  );
}
