"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/empty-state";

/** Catches render errors in any studio page; the top bar (layout) stays usable. */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <ErrorState error={error} retry={retry} />;
}
