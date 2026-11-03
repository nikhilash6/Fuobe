import "server-only";
import type { Engine } from "@/lib/catalog/types";
import type { NarratorVoice } from "@/lib/catalog/faceless";
import { getStarter, starterCards, starterFills, starterVoice, type Starter, type StarterProduct } from "@/lib/starters/catalog";
import type { OwnerStarters, StarterFill, StarterSurface } from "@/lib/starters/types";
import { createManualBrand, createProduct, listBrands, listProducts, updateProduct } from "./brand";
import { adoptSample } from "./canvas-samples";
import { createChannel, listChannels, updateChannel } from "./faceless";

/**
 * The owner's "Use template" on a starter that is made here (POST /api/starters/<id>): a Faceless channel set up for
 * its first episode, or a brand kit with its product and photo (Ads Studio, Click to Ad, Marketing Studio). It answers
 * where to go next. A starter that fills a composer (Content Factory, Explainer) is opened, not made.
 *
 * Guests get 401 and accounts 403 "library" before this runs (LIBRARY_CHANGES in src/lib/guest-access.ts): a starter
 * is saved to the owner's library.
 */

export class StarterError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * The starter's brand kit and product: the ones made before (by name) while they are there, else new ones. Its photo
 * is a stored copy of the published sample, made once.
 */
async function brandAndProduct(kit: StarterProduct): Promise<{ brandId: string; productId: string }> {
  const photo = adoptSample(kit.product.image.src);
  if (!photo) throw new StarterError("That starter's photo is missing", 500);
  const known = listBrands().find((b) => b.name === kit.brand.name);
  const brand = known ?? (await createManualBrand({ name: kit.brand.name, description: kit.brand.description, colors: kit.brand.colors, images: [photo] }));
  // The same product made before is reused; one whose photo was taken off gets it back (not a second copy).
  const had = listProducts(brand.id).find((p) => p.name === kit.product.name);
  const product =
    (had && (had.images.length ? had : updateProduct(had.id, { images: [photo] }))) ??
    createProduct(
      { name: kit.product.name, brandId: brand.id, description: kit.product.description, sellingPoints: kit.product.sellingPoints, price: kit.product.price, currency: kit.product.currency, images: [photo] },
      { force: true },
    );
  return { brandId: brand.id, productId: product.id };
}

/** The narrator a starter speaks with until its own sample is published: Fuobe's clean voice sample, a calm 8 s read. */
const NARRATOR_FALLBACK = "/samples/clean-voice/clean.m4a";

/**
 * The starter's narrator sample as a stored file (made once): its own once published, else Fuobe's clean voice sample,
 * so a narrated starter runs on the open engine as it is. Undefined for a starter with no narrator.
 */
function narrator(s: Pick<Starter, "id" | "surface">): (NarratorVoice & { kind: "sample" }) | undefined {
  const v = starterVoice(s);
  if (!v) return undefined;
  const url = adoptSample(v.src) ?? adoptSample(NARRATOR_FALLBACK);
  return url ? { kind: "sample", url, name: v.name } : undefined;
}

/** Every starter of a surface for the owner (GET /api/starters?surface=), the fills with their narrator sample. */
export function startersForOwner(surface: StarterSurface): OwnerStarters {
  const starters = starterCards(surface, { all: true });
  const fills: Record<string, StarterFill> = {};
  if (surface === "content-factory" || surface === "explainer") {
    for (const [id, f] of Object.entries(starterFills(surface, { all: true }))) {
      const voice = narrator({ id, surface });
      fills[id] = voice ? { ...f, voiceSample: voice.url } : f;
    }
  }
  return { starters, fills };
}

/** Make the starter and say where it opens. */
export async function createFromStarter(id: string, engine: Engine): Promise<{ href: string }> {
  const s = getStarter(id);
  if (!s) throw new StarterError("That starter doesn't exist", 404);
  const seed = s.seed;
  if (seed.kind === "fill") throw new StarterError("That starter opens in its studio: nothing to make here");
  if (seed.kind === "faceless") {
    // On the open engine the narrator clones a voice: the starter's own sample, while it is published.
    const voice = engine === "open" ? narrator(s) : undefined;
    // The channel made before from this starter (same name and idea) opens again, rather than a second one.
    const known = listChannels().find((c) => c.name === seed.channel.name && c.idea === seed.channel.idea);
    const channel = known
      ? voice && known.settings.voice?.kind !== "sample"
        ? await updateChannel(known.id, { settings: { voice } })
        : known
      : await createChannel({
          idea: seed.channel.idea,
          genre: seed.channel.genre,
          engine,
          name: seed.channel.name,
          settings: { styleId: seed.episode.styleId, length: seed.episode.length, ...(voice && { voice }) },
        });
    return { href: `/faceless/${channel.id}/new?starter=${encodeURIComponent(s.id)}` };
  }
  const { brandId, productId } = await brandAndProduct(seed.kit);
  const open = seed.open;
  // The brand opens on "New ads", its product in place: pick how many and make them.
  if (open.to === "brand") return { href: `/ads/${brandId}?step=new` };
  if (open.to === "click-to-ad") return { href: `/marketing/click-to-ad?product=${productId}` };
  return { href: `/marketing?template=${encodeURIComponent(open.template)}&product=${productId}` };
}
