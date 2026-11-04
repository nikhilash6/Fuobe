import { ArrowRight, ArrowUpRight, ChevronsLeftRight, Play, Sparkles, Video } from "lucide-react";
import { BentoClip, BentoMotion, BentoReel, LiveTyping, NumbersLink } from "@/components/home/bento-islands";
import { PausePreviews } from "@/components/home/home-islands";
import { IntentLink } from "@/components/intent-link";
import { CountUp } from "@/components/ui/count-up";
import type { BentoPicture, BentoTile, HomeBento as Bento } from "@/lib/home-bento";
import { cn } from "@/lib/utils";
import { s } from "./home-bento-classes";
import "./home-bento.css";

/**
 * How wide each tile's picture shows, per width (the grid's columns: home-bento.css): under object-fit: cover, the
 * tile's width or, where the tile is the squarer shape, its height times 4/3, so the browser picks a copy that sharp.
 */
const SIZES = {
  video: "(min-width: 1024px) 572px, (min-width: 768px) 576px, calc(100vw - 32px)",
  /** A 4:3 picture in a square tile on a phone (half the row): cropped at its sides, so 4/3 of the tile's width. */
  square: "(min-width: 1024px) 290px, (min-width: 768px) 280px, calc((100vw - 44px) * 0.667)",
  /** The before/after tile: wide (its 4:3 pair) below lg; from lg it is tall and takes the pair's 3:5 crop (`tall`). */
  wide: "(min-width: 768px) 476px, calc(100vw - 32px)",
  tall: "290px",
};
/** From lg the before/after tile is tall (home-bento.css). */
const TALL_MEDIA = "(min-width: 1024px)";

/**
 * A picture in AVIF where the browser takes it, its published JPEG or WebP where not; a picture with a `tall` crop
 * takes it from lg. `position`: its object-position, where it differs from its tile's. Decorative: the tile's link
 * names it.
 */
function Pic({
  pic,
  sizes,
  className,
  loading = "eager",
  fetchPriority,
  position,
}: {
  pic: BentoPicture;
  sizes: string;
  className?: string;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low";
  position?: string;
}) {
  return (
    <picture className={s.pic}>
      {pic.tall && <source media={TALL_MEDIA} type="image/avif" srcSet={pic.tall.map((a) => `${a.src} ${a.w}w`).join(", ")} sizes={SIZES.tall} />}
      <source type="image/avif" srcSet={pic.avif.map((a) => `${a.src} ${a.w}w`).join(", ")} sizes={sizes} />
      <img
        src={pic.fallback}
        alt=""
        width={pic.avif.at(-1)!.w}
        height={Math.round((pic.avif.at(-1)!.w * 3) / 4)}
        loading={loading}
        fetchPriority={fetchPriority}
        decoding="async"
        draggable={false}
        className={cn(s.fill, className)}
        style={position ? { objectPosition: position } : undefined}
      />
    </picture>
  );
}

/** A tile's words: its kind and how much of it, its title, and where it opens (or, on a small tile, an arrow). */
function Copy({ tile, bigMeta }: { tile: BentoTile; bigMeta?: boolean }) {
  return (
    <>
      <span aria-hidden className={s.shade} />
      <span aria-hidden className={s.copy}>
        {tile.meta && <span className={cn(s.meta, bigMeta && s.big)}>{tile.meta}</span>}
        <span className={s.title}>{tile.title}</span>
        <span className={s.cta}>
          {tile.cta} <ArrowRight className="size-3.5" />
        </span>
      </span>
      <span aria-hidden className={s.corner}>
        <ArrowUpRight className="size-3.5" />
      </span>
    </>
  );
}

/** One tile: the whole of it is one link, named by its kind, title and where it goes. */
function Tile({ tile, area, children, bigMeta }: { tile: BentoTile; area: string; children?: React.ReactNode; bigMeta?: boolean }) {
  return (
    <IntentLink href={tile.href} aria-label={tile.label} data-tile={tile.key} className={cn(s.tile, area)}>
      {children}
      <Copy tile={tile} bigMeta={bigMeta} />
    </IntentLink>
  );
}

/**
 * The canvas tile's board, drawn as the board itself runs: the photo goes in, the scene is set, the effect makes the
 * film, which comes out with a frame of the real film in it. Laid out on a 260 x 88 plan (BOARD), scaled to the tile:
 * the two steps stacked between the photo and the film, joined by curved links.
 */
const BOARD = { w: 260, h: 88, pic: { w: 52, y: 10 }, step: { x: 70, w: 120, h: 28, y: [4, 50] }, filmX: 208 } as const;
const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;

/** One of the board's two pictures (its photo, its film), with its label under it. */
function BoardPicture({ style, node, out }: { style: React.CSSProperties; node: Bento["canvas"]["photo"]; out?: boolean }) {
  return (
    <span className={s.node} style={style}>
      <span className={cn(s.box, out && s.out)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={node.thumb} alt="" width={168} height={168} decoding="async" fetchPriority="low" draggable={false} />
        {out && (
          <span className={s.filmMark}>
            <Play className="size-2.5" fill="currentColor" />
          </span>
        )}
      </span>
      <span className={s.nodeLabel}>{node.label}</span>
    </span>
  );
}

function CanvasBoard({ board }: { board: Bento["canvas"] }) {
  const { w, h, pic, step, filmX } = BOARD;
  const picBox = (x: number): React.CSSProperties => ({ left: pct(x, w), top: pct(pic.y, h), width: pct(pic.w, w) });
  const picMid = pic.y + pic.w / 2;
  const stepMid = (i: number) => step.y[i] + step.h / 2;
  const stepX = step.x + step.w / 2;
  const links = [
    `M${pic.w} ${picMid} C${pic.w + 14} ${picMid} ${step.x - 14} ${stepMid(0)} ${step.x} ${stepMid(0)}`,
    `M${stepX} ${step.y[0] + step.h} V${step.y[1]}`,
    `M${step.x + step.w} ${stepMid(1)} C${step.x + step.w + 14} ${stepMid(1)} ${filmX - 14} ${picMid} ${filmX} ${picMid}`,
  ];
  return (
    <span aria-hidden className={s.board}>
      <svg className={s.edges} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {links.map((d) => (
          <path key={d} d={d} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <BoardPicture style={picBox(0)} node={board.photo} />
      {board.steps.map((n, i) => (
        <span key={n.id} className={s.step} style={{ left: pct(step.x, w), top: pct(step.y[i], h), width: pct(step.w, w), height: pct(step.h, h) }}>
          {i === 0 ? <Sparkles className="size-3" /> : <Video className="size-3" />}
          <span>{n.label}</span>
        </span>
      ))}
      <BoardPicture style={picBox(filmX)} node={board.film} out />
    </span>
  );
}

/**
 * Home's first screen: the page's headline over a grid of tiles, one per kind of media Fuobe makes, each a real
 * picture, clip or sound from the studio it opens. A server component: the words, numbers, links and stills are all
 * in the HTML; the clips, the typing, the motion switch and the numbers tile's launcher are small islands
 * (bento-islands.tsx). Nothing in it depends on who is looking.
 */
export function HomeBento({ bento }: { bento: Bento }) {
  const { tiles } = bento;
  return (
    <section id="home-bento" aria-labelledby="home-bento-title" className={s.bento}>
      <div className={s.head}>
        {/*
          No-break spaces keep "finished film," and "one place." whole when the line wraps. The empty end mark tells the
          stylesheet the second line's words have all arrived (home-bento.css).
        */}
        <h1 id="home-bento-title" className={s.h1}>
          <span className={s.line1}>Make anything:</span>{" "}
          <span className={s.line2}>
            From an idea to a{" "}
            <span className={s.l2b}>
              <span className={s.accent} data-glow={"finished film,"}>
                finished&nbsp;film,
              </span>{" "}
              in one&nbsp;place.
            </span>
            <span aria-hidden className={s.end} />
          </span>
        </h1>
        <p className={s.aside}>Film, stills, sound, 3D, live edits and whole pipelines. Each tile opens the studio that makes it.</p>
      </div>

      <div className={s.grid}>
        <Tile tile={tiles.video} area={s.video} bigMeta>
          <Pic pic={bento.video.poster} sizes={SIZES.video} fetchPriority="high" position={bento.video.reel[0].position} />
          <BentoReel id={bento.video.id} reel={bento.video.reel} progress />
          <span aria-hidden className={s.badge}>
            <Video className="size-3.5" /> Video
          </span>
        </Tile>

        <Tile tile={tiles.image} area={s.image}>
          <Pic pic={bento.image} sizes={SIZES.square} className={s.kenburns} fetchPriority="low" />
        </Tile>

        <Tile tile={tiles.audio} area={s.audio}>
          <span aria-hidden className={s.wave} style={{ "--wave-s": `${bento.wave.seconds}s` } as React.CSSProperties}>
            {bento.wave.bars.map((h, i) => (
              <i key={i} style={{ "--h": h, "--d": `${((i / bento.wave.bars.length) * bento.wave.seconds).toFixed(3)}s` } as React.CSSProperties} />
            ))}
            <span className={s.playhead} />
          </span>
        </Tile>

        <Tile tile={tiles.threeD} area={s.three}>
          <Pic pic={bento.threeD.poster} sizes={SIZES.square} fetchPriority="low" />
          <BentoClip id={bento.threeD.id} clips={bento.threeD.clips} />
        </Tile>

        <Tile tile={tiles.restore} area={s.restore}>
          <Pic pic={bento.restore.after} sizes={SIZES.wide} fetchPriority="low" />
          <Pic pic={bento.restore.before} sizes={SIZES.wide} className={s.before} fetchPriority="low" />
          <span aria-hidden className={s.split}>
            <span>
              <ChevronsLeftRight className="size-4" />
            </span>
          </span>
          <span aria-hidden className={cn(s.side, s.left)}>
            Before
          </span>
          <span aria-hidden className={cn(s.side, s.right)}>
            After
          </span>
        </Tile>

        <NumbersLink href={tiles.numbers.href} aria-label={tiles.numbers.label} aria-haspopup="dialog" data-tile="numbers" className={cn(s.tile, s.numbers)}>
          <dl aria-hidden className={s.figures}>
            {bento.numbers.map((n) => (
              <div key={n.label}>
                <dt>{n.label}</dt>
                <dd>
                  <CountUp value={n.value} id={`bento-${n.label}`} />
                </dd>
              </div>
            ))}
          </dl>
          <span aria-hidden className={s.numbersFoot}>
            <span className={s.numbersLine}>{bento.numbersLine}</span>{" "}
            <span className={s.cta}>
              {tiles.numbers.cta} <ArrowRight className="size-3.5" />
            </span>
          </span>
        </NumbersLink>

        <Tile tile={tiles.live} area={s.live}>
          <LiveTyping frames={bento.live.frames} phrases={bento.live.phrases} sizes={SIZES.square} />
        </Tile>

        <Tile tile={tiles.canvas} area={s.canvas}>
          <CanvasBoard board={bento.canvas} />
        </Tile>
      </div>

      <div className={s.foot}>
        <p className="min-w-0">
          <span className="sm:hidden">Rendered locally on ComfyUI, on one RTX 5090.</span>
          <span className="max-sm:hidden">Every preview on this page was rendered locally on ComfyUI, on one RTX 5090.</span>
        </p>
        <PausePreviews className="[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11" />
      </div>
      <BentoMotion target="home-bento" />
    </section>
  );
}
