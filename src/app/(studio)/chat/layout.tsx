import { AssistShell } from "@/components/assist/shell";

/** Chat's workspace: its sidebar (chats, projects, skills, memory, scheduled tasks) beside every Chat page. */
export default function ChatLayout({ children }: LayoutProps<"/chat">) {
  return <AssistShell>{children}</AssistShell>;
}
