import { redirect } from "next/navigation";

/**
 * The GPU pre-flight board's "Image on a 16 GB GPU" row (/connect) opens the Image studio: on a card under 24 GB, Qwen-Image
 * 2.1's Options → GPU picks the small encoder by itself (src/lib/qwen21-speed.ts).
 */
export default function Page() {
  redirect("/image");
}
