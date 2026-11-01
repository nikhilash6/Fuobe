"use client";

import { ArrowLeft, Check, ImagePlus, Link2, Loader2, MoreHorizontal, Pencil, Plus, Settings2, Trash2, Tv } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { NotFoundState } from "@/components/empty-state";
import { FACELESS_STYLE_IDS, genreInfo, getStyle, type ChannelSettings, type FacelessChannel, type PickerData } from "@/lib/catalog/faceless";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { ChannelAvatar, EpisodeTile } from "./cards";
import { Section, Segmented, ToggleRow } from "./controls";
import { makeAvatar, useChannel, useDeleteChannel, useLikeEpisode, useUpdateChannel } from "./hooks";
import { NarratorList, voiceLabel } from "./narrator";
import { StyleArt, StyleGrid } from "./style-art";

/** The look and sound saved on a channel (every new episode starts from it). */
function ChannelSettingsSheet({ channel, picker, open, onOpenChange }: { channel: FacelessChannel; picker: PickerData; open: boolean; onOpenChange: (v: boolean) => void }) {
  const update = useUpdateChannel(channel.id);
  const [s, setS] = useState<ChannelSettings>(channel.settings);
  const set = (p: Partial<ChannelSettings>) => setS((x) => ({ ...x, ...p }));
  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (v) setS(channel.settings);
        onOpenChange(v);
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-[560px]">
        <SheetHeader>
          <SheetTitle>Channel look and sound</SheetTitle>
          <SheetDescription>Saved on the channel so every episode looks and sounds the same.</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-4 pb-24">
          <Section title="Style">
            <StyleGrid ids={FACELESS_STYLE_IDS} value={s.styleId} onChange={(styleId) => set({ styleId, styleRefs: [] })} compact className="sm:grid-cols-3 lg:grid-cols-3" />
          </Section>
          <Section title="Format">
            <Segmented
              label="Aspect ratio"
              value={s.aspect}
              options={[
                { value: "16:9", label: "Horizontal 16:9" },
                { value: "9:16", label: "Vertical 9:16" },
              ]}
              onChange={(aspect) => set({ aspect })}
            />
            <div className="space-y-3 rounded-xl border p-3">
              <ToggleRow label="Subtitles" checked={s.subtitles} onChange={(subtitles) => set({ subtitles })} />
              <ToggleRow label="Background music" checked={s.music} onChange={(music) => set({ music })} />
            </div>
          </Section>
          <Section title="Narrator">
            <div className="rounded-xl border p-2">
              <NarratorList engine={s.engine} voices={picker.voices} value={s.voice} onChange={(voice) => set({ voice })} />
            </div>
          </Section>
        </div>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background p-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={update.isPending}
            onClick={() =>
              update.mutate(
                { settings: s },
                {
                  onSuccess: () => {
                    toast.success("Saved");
                    onOpenChange(false);
                  },
                  onError: (e) => toastError(e),
                },
              )
            }
          >
            {update.isPending ? <Loader2 className="animate-spin" /> : <Check />} Save
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-secondary px-2.5 text-[12px] font-medium text-secondary-foreground", className)}>{children}</span>;
}

export function ChannelView({ id, picker }: { id: string; picker: PickerData }) {
  const router = useRouter();
  const { data, isLoading, error } = useChannel(id);
  const update = useUpdateChannel(id);
  const del = useDeleteChannel();
  const like = useLikeEpisode();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [asking, setAsking] = useState(false);
  const qc = useQueryClient();

  if (error && /not found/i.test((error as Error).message)) return <NotFoundState title="This channel doesn't exist">It may have been deleted. Your episodes&apos; videos are still in your library.</NotFoundState>;
  const channel = data?.channel;
  // The server attaches the avatar when it's drawn, whether or not this page is still open.
  const avatarBusy = asking || !!channel?.avatarJob;

  const drawAvatar = async () => {
    setAsking(true);
    try {
      await makeAvatar(id);
      await qc.invalidateQueries({ queryKey: ["faceless", "channel", id] });
      toast("Drawing a new avatar", { description: "It appears here when it's done — you can leave this page." });
    } catch (e) {
      toastError(e);
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="flex min-h-svh min-w-0 flex-col">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 bg-background/85 px-3 backdrop-blur sm:px-6">
        <SidebarTrigger className="md:hidden" />
        <Link href="/faceless" className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4 shrink-0" /> <span className="truncate">Faceless Studio</span>
        </Link>
      </header>
      <div className="mx-auto w-full max-w-[1240px] min-w-0 flex-1 space-y-8 px-3 pb-16 sm:px-6">
        {isLoading || !channel ? (
          <div className="space-y-4 pt-6">
            <div className="flex items-center gap-4">
              <Skeleton className="size-16 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-7 w-64" />
                <Skeleton className="h-4 w-80 max-w-full" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-5 pt-6 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="aspect-video rounded-xl" />
              ))}
            </div>
          </div>
        ) : (
          <>
            <section className="flex flex-wrap items-start gap-4 pt-6">
              <div className="relative">
                <ChannelAvatar channel={channel} className="size-16 text-[24px]" />
                {avatarBusy && (
                  <span className="absolute inset-0 grid place-items-center rounded-full bg-background/60" role="status" aria-label="Drawing the avatar">
                    <Loader2 className="size-5 animate-spin" />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1 basis-64">
                {editing ? (
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      update.mutate({ name }, { onError: (err) => toastError(err) });
                      setEditing(false);
                    }}
                  >
                    <input
                      autoFocus
                      value={name}
                      maxLength={60}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
                      aria-label="Channel name"
                      className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 font-heading text-[26px] outline-none focus:border-primary"
                    />
                    <Button type="submit" size="icon" aria-label="Save the name">
                      <Check />
                    </Button>
                  </form>
                ) : (
                  <div className="flex min-w-0 items-center gap-1.5">
                    <h1 className="truncate font-heading text-[32px] leading-tight">{channel.name}</h1>
                    <button
                      type="button"
                      onClick={() => {
                        setName(channel.name);
                        setEditing(true);
                      }}
                      className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label="Rename channel"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  </div>
                )}
                <p className="mt-0.5 line-clamp-2 text-[14px] text-muted-foreground">
                  {genreInfo(channel.genre).label} · {channel.idea}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Chip>
                    <span className="h-4 w-6 overflow-hidden rounded-sm">
                      {channel.settings.styleRefs.length ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={channel.settings.styleRefs[0]} alt="" className="size-full object-cover" />
                      ) : (
                        <StyleArt styleId={channel.settings.styleId} />
                      )}
                    </span>
                    {channel.settings.styleRefs.length ? "Your own style" : getStyle(channel.settings.styleId).name}
                  </Chip>
                  <Chip>{voiceLabel(channel.settings.voice, picker.voices, channel.settings.engine)}</Chip>
                  <Chip>{channel.settings.aspect === "9:16" ? "Vertical 9:16" : "Horizontal 16:9"}</Chip>
                  <Chip>{channel.settings.subtitles ? "Subtitles on" : "No subtitles"}</Chip>
                  {channel.settings.music && <Chip>Music</Chip>}
                  {channel.reference && (
                    <a href={channel.reference.url} target="_blank" rel="noreferrer" className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-secondary px-2.5 text-[12px] font-medium hover:bg-accent">
                      <Link2 className="size-3.5 shrink-0" /> <span className="truncate">{channel.reference.title ?? "Reference"}</span>
                    </a>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button asChild>
                  <Link href={`/faceless/${channel.id}/new`}>
                    <Plus /> New episode
                  </Link>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" aria-label="Channel actions">
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setTimeout(() => setSettingsOpen(true))}>
                      <Settings2 /> Look and sound
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={avatarBusy} onClick={() => void drawAvatar()}>
                      <ImagePlus /> Draw an avatar
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => setTimeout(() => setConfirm(true))}>
                      <Trash2 /> Delete channel
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </section>

            <section aria-labelledby="episodes-title" className="space-y-4">
              <h2 id="episodes-title" className="font-heading text-[24px]">
                Episodes
              </h2>
              {data.episodes.length ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 lg:grid-cols-4">
                  {data.episodes.map((ep) => (
                    <EpisodeTile key={ep.id} ep={ep} href={`/faceless/${channel.id}/${ep.id}`} onLike={() => like.mutate({ id: ep.id, favorite: !ep.favorite })} />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center rounded-2xl border border-dashed px-6 py-12 text-center">
                  <div className="grid size-12 place-items-center rounded-2xl bg-brand-faint text-brand-text">
                    <Tv className="size-5" />
                  </div>
                  <p className="mt-3 font-heading text-[22px]">No episodes yet</p>
                  <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">Pick a topic, review the script, and the first episode renders in the channel&apos;s look.</p>
                  <Button asChild className="mt-5">
                    <Link href={`/faceless/${channel.id}/new`}>
                      <Plus /> Create the first episode
                    </Link>
                  </Button>
                </div>
              )}
            </section>

            <ChannelSettingsSheet channel={channel} picker={picker} open={settingsOpen} onOpenChange={setSettingsOpen} />
            <AlertDialog open={confirm} onOpenChange={setConfirm}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete “{channel.name}”?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The channel and its {data.episodes.length} episode{data.episodes.length === 1 ? "" : "s"} are removed from Faceless Studio, and anything still rendering stops. Finished videos stay in your Library.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() =>
                      del.mutate(channel.id, {
                        onSuccess: () => {
                          toast("Channel deleted");
                          router.push("/faceless");
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
