import { redirect } from "next/navigation";

/**
 * The GPU pre-flight board's "Image on a 16 GB GPU" row (/connect) opens the Image studio on Qwen-Image 2.1: on a card under
 * 20 GB with the small route ready, its Options → GPU picks the small encoder by itself (src/server/qwen21-gpu.ts).
 */
export default function Page() {
  redirect("/image?model=oss-qwen-image-21");
}
