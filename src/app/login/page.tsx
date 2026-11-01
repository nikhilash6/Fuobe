import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function Page() {
  return (
    <main className="grid min-h-svh place-items-center bg-sidebar px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
