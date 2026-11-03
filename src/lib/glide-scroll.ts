import { REVEAL_EVENT } from "@/lib/ui-motion";

/*
 * A refined scroll to a section: ease-out over 450 to 650 ms (longer for a longer way, never crawling), landing exactly
 * where a jump to its #id would (under the sticky bars: the page's scroll-padding-top and the section's
 * scroll-margin-top). A long way starts nearer, so the page never races past screens of pictures. The target is
 * measured again every frame, so content that settles above it on the way can't make the end jump. Any wheel, touch,
 * key or press stops it where it is. Reduced motion: an instant jump.
 */

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/** How long a glide over `distance` px takes in a viewport `vh` px tall. */
export function glideDuration(distance: number, vh: number): number {
  const screens = Math.abs(distance) / Math.max(1, vh);
  return Math.round(Math.min(650, 450 + 100 * Math.sqrt(Math.min(screens, 4))));
}

/** Where a jump to `el` would put the page's scroll (its top under the sticky bars), clamped to the page. */
export function landingY(el: Element): number {
  const html = document.documentElement;
  const pad = parseFloat(getComputedStyle(html).scrollPaddingTop) || 0;
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  const y = el.getBoundingClientRect().top + window.scrollY - pad - margin;
  const max = html.scrollHeight - window.innerHeight;
  return Math.max(0, Math.min(max, Math.round(y)));
}

let stopCurrent: (() => void) | null = null;

/** Glides the page to `el`. Resolves true when it landed, false when the visitor took over (or another glide began). */
export function glideTo(el: Element): Promise<boolean> {
  stopCurrent?.();
  // Sections on the way (and the target) show before the glide starts, so it never lands on one still waiting.
  document.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: { target: el } }));
  const instant = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (instant) {
    window.scrollTo({ top: landingY(el), behavior: "instant" });
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const vh = window.innerHeight;
    let from = window.scrollY;
    const to = landingY(el);
    // A long way starts a screen and a half off, so the glide itself stays short and smooth.
    const near = vh * 1.5;
    if (Math.abs(to - from) > vh * 3) {
      from = to - Math.sign(to - from) * near;
      window.scrollTo({ top: from, behavior: "instant" });
    }
    const duration = glideDuration(to - from, vh);
    let raf = 0;
    let t0 = 0;
    const end = (landed: boolean) => {
      cancelAnimationFrame(raf);
      for (const t of STOPS) window.removeEventListener(t, interrupt, true);
      if (stopCurrent === stop) stopCurrent = null;
      resolve(landed);
    };
    const interrupt = () => end(false);
    const stop = () => end(false);
    const STOPS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const t of STOPS) window.addEventListener(t, interrupt, { capture: true, passive: true });
    stopCurrent = stop;
    let pos = from;
    let done = 0;
    const frame = (now: number) => {
      if (!t0) t0 = now;
      const t = Math.min(1, (now - t0) / duration);
      // The target is measured each frame (a picture above it may have settled). Each frame covers its share of the way
      // still left, so a target that moves is spread over the rest of the glide instead of jumping.
      const target = landingY(el);
      const e = ease(t);
      pos += (target - pos) * (t >= 1 ? 1 : (e - done) / (1 - done));
      done = e;
      window.scrollTo({ top: Math.round(pos), behavior: "instant" });
      if (t < 1) raf = requestAnimationFrame(frame);
      else end(true);
    };
    raf = requestAnimationFrame(frame);
  });
}
