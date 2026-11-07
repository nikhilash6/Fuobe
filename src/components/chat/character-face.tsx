import { cn } from "@/lib/utils";

/**
 * A character's face: their portrait, or their initial on their own two colours. `src` overrides where the portrait
 * comes from (a shared chat serves it from its own link).
 */
export function CharacterFace({
  name,
  accent,
  portrait,
  src,
  className,
  rounded = "full",
}: {
  name: string;
  accent: [string, string];
  portrait?: string | null;
  src?: string | null;
  className?: string;
  rounded?: "full" | "card";
}) {
  const url = src ?? portrait ?? null;
  return (
    <span
      className={cn("relative grid shrink-0 place-items-center overflow-hidden text-white select-none", rounded === "full" ? "rounded-full" : "rounded-[18px]", className)}
      style={{ background: `linear-gradient(145deg, ${accent[0]} 0%, ${accent[1]} 100%)`, containerType: "inline-size" }}
      aria-hidden
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
      ) : (
        <span className="font-heading leading-none" style={{ fontSize: "min(44cqw, 6rem)" }}>
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}
