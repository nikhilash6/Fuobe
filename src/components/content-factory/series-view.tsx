"use client";

import { ArrowLeft, Loader2, Minus, Plus, Trash2, Tv } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { EpisodeTile } from "@/components/faceless/cards";
import { voiceLabel } from "@/components/faceless/narrator";
import { animationStyle, CF_LENGTHS, MAX_EPISODES } from "@/lib/catalog/content-factory";
import { genreInfo, type PickerData } from "@/lib/catalog/faceless";
import { toastError } from "@/lib/refusals";
import { BriefCard, ReferenceCard, SeriesPriceLine } from "./parts";
import { useAddEpisodes, useDeleteSeries, useSeries, useSeriesEstimate, useUpdateSeries } from "./hooks";

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex h-7 max-w-full items-center truncate rounded-full bg-secondary px-2.5 text-[12px] font-medium text-secondary-foreground">{children}</span>;
}

export function SeriesView({ id, voices }: { id: string; voices: PickerData["voices"] }) {
  const router = useRouter();
  const { data: s, isLoading, error } = useSeries(id);
  const more = useAddEpisodes(id);
  const del = useDeleteSeries();
  const update = useUpdateSeries();
  const [next, setNext] = useState("");
  const [count, setCount] = useState(1);
  const [review, setReview] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const nextId = useId();

  const channel = s?.channel ?? null;
  const settings = s?.settings ?? null;
  const estimate = useSeriesEstimate(
    s && settings && channel
      ? { prompt: s.prompt, settings: { ...settings, engine: channel.settings.engine, episodes: count }, voice: channel.settings.voice, seriesId: s.id, subtitles: channel.settings.subtitles, music: channel.settings.music }
      : null,
    s ? String(s.updatedAt) : undefined,
  );

  const header = (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 bg-background/85 px-3 backdrop-blur sm:px-6">
      <SidebarTrigger className="md:hidden" />
      <Link href="/content-factory" className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 shrink-0" /> <span className="truncate">Content Factory</span>
      </Link>
    </header>
  );

  if (error || (s && !channel)) {
    // Made, but its channel was deleted in Faceless Studio (its episodes went with it): only deleting is left.
    const orphan = !error && !!s?.made;
    const removeOrphan = () =>
      s &&
      del.mutate(s.id, {
        onSuccess: () => {
          toast("Series deleted");
          router.push("/content-factory");
        },
        onError: (e) => toastError(e),
      });
    return (
      <div className="flex min-h-svh min-w-0 flex-col">
        {header}
        <div className="mx-auto w-full max-w-[640px] px-3 pt-16 text-center sm:px-6">
          <h1 className="font-heading text-[28px]">{error ? "Series not found" : orphan ? "This series' channel was deleted" : "This series hasn't been made yet"}</h1>
          <p className="mt-2 text-[14px] text-muted-foreground">
            {error
              ? "It may have been deleted."
              : orphan
                ? "Its channel and episodes were deleted in Faceless Studio, so nothing more can be made here. Start a new series from the same reference in Content Factory."
                : "Its reference is in the Content Factory composer: say what it's about and generate it there."}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {orphan && (
              <Button variant="secondary" className="rounded-full" onClick={removeOrphan} disabled={del.isPending}>
                {del.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete series
              </Button>
            )}
            <Button asChild className="rounded-full">
              <Link href="/content-factory">Open Content Factory</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const style = settings ? animationStyle(settings.animation) : null;
  const engine = channel?.settings.engine ?? "cloud";

  return (
    <div className="flex min-h-svh min-w-0 flex-col">
      {header}
      <div className="mx-auto w-full max-w-[1240px] min-w-0 flex-1 space-y-8 px-3 pb-16 sm:px-6">
        {isLoading || !s || !channel || !settings ? (
          <div className="space-y-4 pt-6">
            <Skeleton className="h-9 w-72 max-w-full" />
            <Skeleton className="h-4 w-96 max-w-full" />
            <div className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="aspect-[4/5] rounded-xl" />
              ))}
            </div>
          </div>
        ) : (
          <>
            <section className="flex flex-wrap items-start gap-4 pt-6">
              <div className="min-w-0 flex-1 basis-72">
                <h1 className="font-heading text-[32px] leading-tight text-balance">{s.name ?? channel.name}</h1>
                {s.prompt.trim().toLowerCase() !== (s.name ?? channel.name).trim().toLowerCase() && <p className="mt-1 line-clamp-3 text-[14px] text-muted-foreground">{s.prompt}</p>}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Chip>{genreInfo(settings.genre).label}</Chip>
                  <Chip>{style?.label}</Chip>
                  <Chip>{CF_LENGTHS.find((l) => l.value === settings.length)?.label ?? `${settings.length} s`} each</Chip>
                  <Chip>{settings.aspect === "9:16" ? "Vertical 9:16" : "Horizontal 16:9"}</Chip>
                  <Chip>{voiceLabel(channel.settings.voice, voices, engine)}</Chip>
                  <Chip>{engine === "open" ? "Open source" : "Cloud"}</Chip>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button asChild variant="secondary" className="rounded-full">
                  <Link href={`/faceless/${channel.id}`}>
                    <Tv /> Open in Faceless Studio
                  </Link>
                </Button>
                <Button variant="ghost" size="icon" className="rounded-full text-muted-foreground hover:text-destructive" onClick={() => setConfirm(true)} aria-label="Delete series">
                  <Trash2 />
                </Button>
              </div>
            </section>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              {s.reference && <ReferenceCard reference={s.reference} analysis={s.analysis} styleId={channel.settings.styleId} className="h-fit" />}
              {s.brief && (
                <BriefCard
                  brief={s.brief}
                  note={s.analysis?.note}
                  saving={update.isPending}
                  onSave={(b) => update.mutate({ id: s.id, brief: b }, { onSuccess: () => toast("Saved — episodes you add from now on follow it"), onError: (e) => toastError(e) })}
                />
              )}
            </div>

            <section aria-labelledby="episodes-title" className="space-y-4">
              <h2 id="episodes-title" className="font-heading text-[24px]">
                Episodes
              </h2>
              <ol className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
                {s.episodes.map((ep, i) => (
                  <li key={ep.id} className="min-w-0">
                    <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Episode {i + 1}</p>
                    <EpisodeTile ep={ep} href={`/faceless/${channel.id}/${ep.id}`} />
                  </li>
                ))}
              </ol>
            </section>

            <section aria-labelledby="next-title" className="max-w-[760px] rounded-2xl border bg-background p-4 shadow-soft">
              <h2 id="next-title" className="text-[15px] font-medium">
                Next episode
              </h2>
              <label htmlFor={nextId} className="mt-1 block text-[12px] text-muted-foreground">
                What happens in the next episode? Leave it empty and the story simply carries on.
              </label>
              <textarea
                id={nextId}
                value={next}
                maxLength={1000}
                rows={2}
                onChange={(e) => setNext(e.target.value)}
                placeholder={s.plan.length ? `After “${s.plan[s.plan.length - 1].title}”…` : "What happens next…"}
                className="mt-2 w-full resize-none rounded-xl border bg-background px-3 py-2 text-[14px] leading-relaxed outline-none [field-sizing:content] focus:border-primary"
              />
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <div role="group" aria-label="Episodes to add" className="inline-flex h-8 items-center rounded-full bg-secondary">
                  <button type="button" onClick={() => setCount((n) => Math.max(1, n - 1))} disabled={count <= 1} className="grid size-8 place-items-center rounded-full hover:bg-accent disabled:opacity-40" aria-label="Fewer episodes">
                    <Minus className="size-3.5" />
                  </button>
                  <span className="min-w-[5.5rem] text-center text-[13px] font-medium tabular-nums" aria-live="polite">
                    {count} episode{count === 1 ? "" : "s"}
                  </span>
                  <button type="button" onClick={() => setCount((n) => Math.min(MAX_EPISODES, n + 1))} disabled={count >= MAX_EPISODES} className="grid size-8 place-items-center rounded-full hover:bg-accent disabled:opacity-40" aria-label="More episodes">
                    <Plus className="size-3.5" />
                  </button>
                </div>
                <SeriesPriceLine data={estimate.data} loading={estimate.isFetching} engine={engine} className="min-w-0 flex-1 basis-48" />
                <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-muted-foreground">
                  <Switch checked={review} onCheckedChange={setReview} aria-label="Review each script before it renders" />
                  Review scripts first
                </label>
                <Button
                  className="ml-auto h-9 rounded-full px-4"
                  disabled={more.isPending}
                  onClick={() =>
                    more.mutate(
                      { count, next: next.trim() || undefined, review },
                      {
                        onSuccess: () => {
                          setNext("");
                          toast(count === 1 ? "Next episode started" : `${count} episodes started`);
                        },
                        onError: (e) => toastError(e),
                      },
                    )
                  }
                >
                  {more.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                  {more.isPending ? "Planning…" : count === 1 ? "Add episode" : `Add ${count} episodes`}
                </Button>
              </div>
              {estimate.data?.error && (
                <p role="alert" className="mt-2 text-[12px] text-destructive">
                  {estimate.data.error}
                </p>
              )}
            </section>

            <AlertDialog open={confirm} onOpenChange={setConfirm}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete “{s.name ?? channel.name}”?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The series, its channel and its {s.episodes.length} episode{s.episodes.length === 1 ? "" : "s"} are removed, and anything still rendering stops. Finished videos stay in your Library.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() =>
                      del.mutate(s.id, {
                        onSuccess: () => {
                          toast("Series deleted");
                          router.push("/content-factory");
                        },
                        onError: (e) => toastError(e),
                      })
                    }
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>
    </div>
  );
}
