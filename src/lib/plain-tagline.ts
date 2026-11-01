/**
 * A model's tagline as a model menu shows it: what the model makes, without the GPU size, licence, host or step
 * count the catalog keeps after it ("Photoreal images in seconds · 12–16 GB GPU" → "Photoreal images in seconds").
 * The full tagline stays in the catalog for Settings → Models & licences and the readiness board.
 */
const DETAIL = [
  /\b\d+(?:[.,]\d+)?(?:[–-]\d+)?\+?\s*GB\b/,
  /\bGPU\b|\bCPU\b|\bRAM\b|offloading/,
  /licen[cs]e|License|Apache|\bMIT\b|OpenRAIL|CC[- ]BY|commercial|US\$|DINOv3|Built with/i,
  /\bfal\b|hosted|Replicate|ComfyUI/,
  /LoRA|\bweights\b|add-on|node pack|\b\d+[- ]steps?\b|frames a run|model files|ControlNet/,
  /^free$/i,
];

const isDetail = (part: string) => DETAIL.some((re) => re.test(part));

export function plainTagline(tagline: string): string {
  if (!tagline) return tagline;
  const [head, ...rest] = tagline.split(" · ");
  const lead = head
    .split(" — ")
    .filter((p, i, all) => all.length === 1 || i === 0 || !isDetail(p))
    .join(" — ")
    .replace(/\s*\([^()]*\)/g, (m) => (isDetail(m) ? "" : m))
    .trim();
  const kept = [lead || head, ...rest.filter((p) => !isDetail(p))];
  const out = kept.join(" · ").trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
}
