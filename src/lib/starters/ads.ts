/**
 * The ad studios' ready brands and products (Ads Studio, Click to Ad, Marketing Studio): one brand kit and product per
 * photo, shared by name, so a second "Use template" on the same product reuses it. Server only, listed in catalog.ts.
 */
import "server-only";
import type { Starter, StarterProduct } from "./catalog";

const MAISON_VERRE: StarterProduct = {
  brand: {
    name: "Maison Verre",
    description:
      "Maison Verre is a small Paris perfume house. Its first scent, Eau de Verre, is a fresh green fragrance of fig leaf, vetiver and sea salt, poured into hand-blown sea-glass bottles with solid oak caps, for people who wear one scent and make it their own.",
    colors: ["#7FB5A5", "#C9A46A", "#F4EFE6"],
  },
  product: {
    name: "Eau de Verre",
    description: "A fresh green eau de parfum of fig leaf, vetiver and sea salt, in a hand-blown sea-glass bottle with a solid oak cap. 50 ml.",
    sellingPoints: ["Hand-blown sea-glass bottle", "Fig leaf, vetiver and sea salt", "Made in Paris in small batches"],
    price: 145,
    currency: "EUR",
    image: { src: "/examples/app-product-shot/1/in-image.jpg", name: "Eau de Verre.jpg" },
  },
};

const STUDIO_MARLOW: StarterProduct = {
  brand: {
    name: "Studio Marlow",
    description:
      "Studio Marlow makes leather goods and tailoring in limited runs, hand-stitched in Florence, for women who want one great bag instead of five okay ones.",
    colors: ["#8A4B2A", "#EFE6DA", "#1F1B18"],
  },
  product: {
    name: "The Marlow top-handle bag",
    description: "A structured top-handle bag in cognac calf leather, hand-stitched in Florence, with brushed-gold hardware and a suede-lined interior.",
    sellingPoints: ["Cognac calf leather", "Hand-stitched in Florence", "Brushed-gold hardware"],
    price: 690,
    currency: "EUR",
    image: { src: "/examples/app-packshot/1/in-image.jpg", name: "Marlow bag.jpg" },
  },
};

const productWords = (k: StarterProduct) => [
  { label: "Brand", text: k.brand.description },
  { label: "Product", text: `${k.product.name}: ${k.product.description}` },
];

export const AD_STARTERS: Starter[] = [
  {
    id: "ads.maison-verre",
    surface: "ads",
    rank: 1,
    name: "Maison Verre perfume",
    description: "A Paris perfume house with its first scent, ready for on-brand ads in every size",
    icon: "FlaskConical",
    hue: 165,
    flow: ["Brand", "Product", "Ads"],
    steps: ["The brand kit is set up: its story, colours and tone.", "Its perfume is added with a product photo, its words and its price.", "Pick how many ads: each gets a headline, a picture and a call to action, in 1:1, 4:5 and 9:16."],
    makes: "On-brand static ads for the perfume, in three sizes.",
    words: productWords(MAISON_VERRE),
    // Its own cover (an ad in its sizes) is on its way: until then it's the owner's only.
    tryIn: { app: "app-product-shot", example: "app-product-shot.1" },
    seed: { kind: "product", kit: MAISON_VERRE, open: { to: "brand" } },
  },
  {
    id: "ads.studio-marlow",
    surface: "ads",
    rank: 2,
    name: "Studio Marlow leather",
    description: "A Florence leather-goods label with its top-handle bag, ready for on-brand ads",
    icon: "ShoppingBag",
    hue: 25,
    flow: ["Brand", "Product", "Ads"],
    steps: ["The brand kit is set up: its story, colours and tone.", "Its bag is added with a product photo, its words and its price.", "Pick how many ads: each gets a headline, a picture and a call to action, in 1:1, 4:5 and 9:16."],
    makes: "On-brand static ads for the bag, in three sizes.",
    words: productWords(STUDIO_MARLOW),
    // Its own cover (an ad in its sizes) is on its way: until then it's the owner's only.
    tryIn: { app: "app-packshot", example: "app-packshot.1" },
    seed: { kind: "product", kit: STUDIO_MARLOW, open: { to: "brand" } },
  },

  // Click to Ad: a product with its photo, ready for a 9:16 video ad.
  {
    id: "c2a.eau-de-verre",
    surface: "click-to-ad",
    rank: 1,
    name: "Perfume video ad",
    description: "A sea-glass perfume bottle becomes a 9:16 ad with voiceover and captions",
    icon: "FlaskConical",
    hue: 165,
    flow: ["Product", "Style", "Ad"],
    steps: ["The perfume is added with its photo, its words and its brand's colours.", "Pick a style: calm studio shots, an unboxing or a creator.", "A script is written, voiced and laid over moving shots of the bottle, with captions and an end card."],
    makes: "A 9:16 video ad of up to 12 seconds, with voiceover and captions.",
    words: productWords(MAISON_VERRE).slice(1),
    // Its own cover (an ad in its sizes) is on its way: until then it's the owner's only.
    tryIn: { app: "app-product-shot", example: "app-product-shot.1" },
    seed: { kind: "product", kit: MAISON_VERRE, open: { to: "click-to-ad" } },
  },
  {
    id: "c2a.marlow-bag",
    surface: "click-to-ad",
    rank: 2,
    name: "Handbag video ad",
    description: "A cognac leather bag becomes a 9:16 ad with voiceover and captions",
    icon: "ShoppingBag",
    hue: 25,
    flow: ["Product", "Style", "Ad"],
    steps: ["The bag is added with its photo, its words and its brand's colours.", "Pick a style: calm studio shots, an unboxing or a creator.", "A script is written, voiced and laid over moving shots of the bag, with captions and an end card."],
    makes: "A 9:16 video ad of up to 12 seconds, with voiceover and captions.",
    words: productWords(STUDIO_MARLOW).slice(1),
    // Its own cover (an ad in its sizes) is on its way: until then it's the owner's only.
    tryIn: { app: "app-packshot", example: "app-packshot.1" },
    seed: { kind: "product", kit: STUDIO_MARLOW, open: { to: "click-to-ad" } },
  },

  // Marketing Studio: a product photo and the template that sets its scene.
  {
    id: "mk.perfume-moss",
    surface: "marketing",
    rank: 1,
    name: "Perfume on moss and stone",
    description: "The perfume photo, set on moss and river stones in soft forest light",
    icon: "Leaf",
    hue: 135,
    flow: ["Product", "Scene", "Shot"],
    steps: ["The perfume and its photo go in.", "The Moss & Stone scene is picked: moss, smooth river stones and soft forest light.", "Press Generate: the bottle is shot in that scene, true to its shape and label."],
    makes: "A product shot of the perfume in a natural forest scene.",
    words: [...productWords(MAISON_VERRE).slice(1), { label: "Scene", text: "The product nestled on moss and smooth river stones, soft forest light filtering through mist." }],
    coverFrom: "app-product-shot",
    tryIn: { app: "app-product-shot", example: "app-product-shot.1" },
    seed: { kind: "product", kit: MAISON_VERRE, open: { to: "marketing", template: "ps-moss-stone" } },
  },
  {
    id: "mk.bag-packshot",
    surface: "marketing",
    rank: 2,
    name: "Handbag packshot",
    description: "The bag photo, as a clean packshot on a seamless white background",
    icon: "ShoppingBag",
    hue: 25,
    flow: ["Product", "Scene", "Shot"],
    steps: ["The bag and its photo go in.", "The Studio White scene is picked: a clean packshot on a seamless white background.", "Press Generate: the bag is shot in that scene, true to its shape and colour."],
    makes: "A clean e-commerce packshot of the bag.",
    words: [...productWords(STUDIO_MARLOW).slice(1), { label: "Scene", text: "A clean e-commerce packshot on a seamless white background." }],
    coverFrom: "app-packshot",
    tryIn: { app: "app-packshot", example: "app-packshot.1" },
    seed: { kind: "product", kit: STUDIO_MARLOW, open: { to: "marketing", template: "ps-studio-white" } },
  },
];
