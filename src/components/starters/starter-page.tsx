"use client";

import { ArrowLeft, ArrowRight, Clapperboard, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";
import { SelfHostNote } from "@/components/self-host-note";
import { CoverArt, CoverImg, useCoverPlayback } from "@/components/template-cover";
import { useIsOwner, useIsVisitor } from "@/lib/api";
import { STARTER_SURFACES, VISITOR_MAKES, lookLine, starterShown, type StarterCardData, type StarterInput, type StarterLookItem } from "@/lib/starters/types";
import { StarterIcon } from "./starter-icon";
import { shotKey, useStarterUse } from "./starter-section";
import { StepsGlyph } from "./steps-glyph";

/**
 * The look it is made in, in the studio's own words ("Epic · Anamorphic · Silhouette · Oil & Ochre · 16:9"): with the
 * shots' words, the whole recipe.
 */
export function StarterLook({ look, className }: { look: StarterLookItem[]; className?: string }) {
  return (
    <div className={className}>
      <p className="sr-only">Look: {lookLine(look)}</p>
      <ul aria-hidden className="flex flex-wrap items-center gap-1.5">
        <li className="mr-0.5 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">Look</li>
        {look.map((i) => (
          <li key={i.name} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-secondary px-2.5 text-[12.5px] font-medium text-secondary-foreground">
            {i.swatch && (
              <span className="flex -space-x-1">
                {i.swatch.map((c, n) => (
                  <span key={n} className="size-3 rounded-full ring-2 ring-secondary" style={{ background: c }} />
                ))}
              </span>
            )}
            {i.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One thing that goes in. A ready film's shot offers "Make this shot": the film opens with that shot in its prompt bar,
 * in the film's look and shape (`onMake`).
 */
function Input({ input, onMake, busy }: { input: StarterInput; onMake?: () => void; busy?: boolean }) {
  return (
    <li className="rounded-xl border bg-card p-3.5">
      <div className="flex items-start gap-3">
        {input.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={input.image.thumb} alt="" loading="lazy" decoding="async" className="size-14 shrink-0 rounded-lg border object-cover" />
        )}
        <div className="min-w-0">
          <p className="text-[14px] font-medium">{input.label}</p>
          {input.image && <p className="text-[13px] text-muted-foreground">{input.image.name}</p>}
        </div>
      </div>
      {input.audio && (
        // A voice sample: its words are what it shows.
        <audio controls preload="none" src={input.audio.src} aria-label={input.audio.name} className="mt-2 h-9 w-full" />
      )}
      {input.text && <p className="mt-2 rounded-lg bg-muted/60 px-3 py-2 text-[13px] text-pretty whitespace-pre-line">{input.text}</p>}
      {onMake && (
        <Button variant="outline" size="sm" className="mt-2.5 rounded-full px-3" onClick={onMake} disabled={busy} aria-label={`Make ${input.label.toLowerCase()} in this look`}>
          {busy ? <Loader2 className="animate-spin" /> : <Clapperboard />} Make this shot
        </Button>
      )}
    </li>
  );
}

/**
 * A ready-made starter's page (`<studio>/start/<id>`): what it makes, what goes in, the steps and what comes out, for
 * everyone. The owner makes it (or fills the studio's composer with it) from here; a guest or an account, who can't
 * save it here, reads how it works. One with no real cover yet is the owner's only.
 */
export function StarterPage({ s }: { s: StarterCardData }) {
  const owner = useIsOwner();
  const visitor = useIsVisitor();
  const { use, busy } = useStarterUse();
  const { ref, playing, asked, handlers } = useCoverPlayback<HTMLDivElement>(`starter-page/${s.id}`, s.cover);
  const surface = STARTER_SURFACES[s.surface];

  if (!starterShown(s, true) && !owner) {
    return (
      <PageShell>
        {visitor && (
          <div className="py-16 text-center">
            <p className="text-[15px] text-muted-foreground">This starter isn&apos;t here.</p>
            <Link href={surface.base} className="mt-3 inline-flex text-[14px] font-medium underline underline-offset-4">
              Back to {surface.name}
            </Link>
          </div>
        )}
      </PageShell>
    );
  }

  const heading = "text-[13px] font-semibold tracking-wide text-muted-foreground uppercase";
  // The owner, or a visitor where a ready one is theirs to make (a guest is asked to sign up first, then comes back here).
  const makes = owner || VISITOR_MAKES.has(s.surface);
  // A ready film: each shot can be made alone, in the film's look.
  const shots = makes && s.use.kind === "create" && s.inputs.some((i) => i.shot);
  const cover = s.cover;

  return (
    <PageShell wide>
      <Link href={surface.base} className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> {surface.name}
      </Link>
      <div className="mt-3 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-10">
        <div className="min-w-0">
          <div ref={ref} {...handlers} className="relative aspect-[16/9] overflow-hidden rounded-2xl border bg-muted">
            {cover ? (
              cover.frames.length > 1 || (s.coverTop && !cover.video) ? (
                <div className="absolute inset-0 grid auto-cols-fr grid-flow-col gap-0.5">
                  {cover.frames.map((f) => (
                    <CoverImg
                      key={f.src}
                      frame={f}
                      sizes={cover.frames.length > 1 ? "(max-width: 1024px) 34vw, 280px" : "(max-width: 1024px) 100vw, 820px"}
                      // A portrait: from its top, so the head stays whole in the wide frame.
                      className={s.coverTop ? "object-top" : undefined}
                    />
                  ))}
                </div>
              ) : (
                <CoverArt cover={cover} sizes="(max-width: 1024px) 100vw, 820px" playing={playing} asked={asked} />
              )
            ) : (
              <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, oklch(0.62 0.12 ${s.hue} / 0.14), transparent 70%)` }}>
                <StepsGlyph steps={s.steps.length} className="p-8" />
              </div>
            )}
            {owner && !cover && <span className="absolute top-3 right-3 rounded-full bg-background/90 px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-soft">No cover yet</span>}
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border bg-card">
              <StarterIcon name={s.icon} className="size-4" />
            </span>
            <h1 className="font-heading text-[30px] leading-tight text-balance">{s.name}</h1>
          </div>
          <p className="mt-2 text-[15px] text-pretty text-muted-foreground">{s.description}</p>
          {s.look?.length ? <StarterLook look={s.look} className="mt-3" /> : null}

          {makes ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {s.use.kind === "fill" ? (
                <Button asChild size="lg" className="rounded-full px-4">
                  <Link href={s.use.href}>
                    <Plus /> Use template
                  </Link>
                </Button>
              ) : (
                <Button size="lg" className="rounded-full px-4" onClick={() => void use(s)} disabled={busy === s.id}>
                  {busy === s.id ? <Loader2 className="animate-spin" /> : <Plus />} Use template
                </Button>
              )}
              {shots && <p className="basis-full text-[13px] text-muted-foreground">The whole film opens in {surface.name}: its look, its brief and every shot, ready to make.</p>}
            </div>
          ) : s.tryIn ? (
            // A guest or an account makes the same from the same photo in its app, the example loaded there.
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="rounded-full px-4">
                <Link href={s.tryIn.href}>
                  {s.tryIn.text ?? `Try it in ${s.tryIn.label}`} <ArrowRight />
                </Link>
              </Button>
            </div>
          ) : (
            <SelfHostNote className="mt-3">{surface.unavailable}</SelfHostNote>
          )}

          <section aria-labelledby="goes-in" className="mt-8">
            <h2 id="goes-in" className={heading}>
              What goes in
            </h2>
            <ul className="mt-2 space-y-2">
              {s.inputs.map((i) => (
                <Input key={i.label} input={i} onMake={shots && i.shot ? () => void use(s, i.shot) : undefined} busy={!!i.shot && busy === shotKey(s.id, i.shot)} />
              ))}
            </ul>
          </section>

          <section aria-labelledby="the-steps" className="mt-8">
            <h2 id="the-steps" className={heading}>
              The steps
            </h2>
            <ol className="mt-2 space-y-2">
              {s.steps.map((step, i) => (
                <li key={i} className="flex gap-3 text-[14px]">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[12px] font-medium">{i + 1}</span>
                  <span className="min-w-0 pt-0.5 text-pretty">{step}</span>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="comes-out" className="mt-8">
            <h2 id="comes-out" className={heading}>
              What comes out
            </h2>
            <p className="mt-2 text-[14px] text-pretty">{s.makes}</p>
            <Link href={surface.base} className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground">
              More in {surface.name} <ArrowRight className="size-3.5" />
            </Link>
          </section>
        </div>
      </div>
    </PageShell>
  );
}
