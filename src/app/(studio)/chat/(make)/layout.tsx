import { AssistShell } from "@/components/assist/shell";

/** The making side of Chat: its sidebar (making chats, projects, skills, memory) beside each of its pages. */
export default function AssistLayout({ children }: LayoutProps<"/chat">) {
  return <AssistShell>{children}</AssistShell>;
}
