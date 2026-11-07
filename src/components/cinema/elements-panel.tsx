"use client";

import { AtSign, ExternalLink, MapPin, Plus, UserRoundPlus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ELEMENT_ICONS } from "@/components/studio/prompt-input";
import { useElements } from "@/lib/api";
import { ELEMENT_KINDS, type StudioElement } from "@/lib/catalog/elements";
import { ElementThumb } from "@/components/element-thumb";

/** "My Elements": the characters, locations and props every shot can @mention. */
export function ElementsPanel({ onMention, onCast, onLocation }: { onMention: (el: StudioElement) => void; onCast: () => void; onLocation: () => void }) {
  const { data, isLoading } = useElements();
  const visual = (data ?? []).filter((e) => e.kind !== "voice");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 font-heading text-[24px] leading-none whitespace-nowrap">My Elements</h2>
        <Button variant="secondary" size="sm" onClick={onCast}>
          <UserRoundPlus /> New character
        </Button>
        <Button variant="secondary" size="sm" onClick={onLocation}>
          <MapPin /> New location
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href="/elements?new=1">
            <Plus /> Upload an element
          </Link>
        </Button>
      </div>
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="aspect-[3/4] rounded-xl" />
          ))}
        </div>
      ) : !visual.length ? (
        <div className="mx-auto max-w-md py-12 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-brand-faint text-brand-text">
            <AtSign className="size-5" />
          </div>
          <p className="mt-4 font-heading text-[22px]">No elements yet</p>
          <p className="mt-1 text-[13.5px] text-muted-foreground">Build a cast member with Soul Cast or a set with Soul Location, then type @ in any prompt to put them in the shot.</p>
        </div>
      ) : (
        ELEMENT_KINDS.filter((k) => k.kind !== "voice" && visual.some((e) => e.kind === k.kind)).map((k) => (
          <section key={k.kind} className="space-y-2.5">
            <h3 className="text-[12px] font-medium text-muted-foreground">{k.plural}</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {visual
                .filter((e) => e.kind === k.kind)
                .map((el) => {
                  const Icon = ELEMENT_ICONS[el.kind];
                  return (
                    <div key={el.id} className="group/el relative overflow-hidden rounded-xl border bg-card">
                      <button type="button" onClick={() => onMention(el)} className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Add @${el.handle} to the prompt`}>
                        <div className="aspect-[4/3] bg-muted">
                          {el.references[0] ? (
                            <ElementThumb src={el.references[0]} loading="lazy" className="size-full object-cover" />
                          ) : (
                            <Icon className="m-auto mt-[22%] size-6 text-muted-foreground" />
                          )}
                        </div>
                        <div className="p-2">
                          <p className="truncate text-[13px] font-medium">{el.name}</p>
                          <p className="truncate text-[11.5px] text-brand-text">@{el.handle}</p>
                        </div>
                      </button>
                      <Link
                        href={`/elements/${el.id}`}
                        className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-black/45 text-white opacity-100 backdrop-blur sm:opacity-0 sm:group-hover/el:opacity-100 focus-visible:opacity-100"
                        aria-label={`Open ${el.name}`}
                      >
                        <ExternalLink className="size-3.5" />
                      </Link>
                    </div>
                  );
                })}
            </div>
          </section>
        ))
      )}
      {visual.length > 0 && <p className="text-[12px] text-muted-foreground">Click an element to add it to the prompt.</p>}
    </div>
  );
}
