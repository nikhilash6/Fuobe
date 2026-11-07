import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatHome } from "@/components/chat/chat-home";

export const metadata: Metadata = {
  title: "Chat",
  description: "Free AI chat on Fuobe: ask anything, brainstorm ideas you can make in one tap, write captions and scripts, or step into a story with a character.",
};

export default function Page() {
  return (
    <Suspense>
      <ChatHome />
    </Suspense>
  );
}
