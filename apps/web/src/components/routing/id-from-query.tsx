"use client";

import { Fragment, Suspense } from "react";
import { useSearchParams } from "next/navigation";

// Detail pages take their id as ?id=... rather than a path segment: the site is static files,
// so there's no page per trip/delivery/user to serve.
export function IdFromQuery({ children }: { children: (id: string) => React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <ReadId>{children}</ReadId>
    </Suspense>
  );
}

function ReadId({ children }: { children: (id: string) => React.ReactNode }) {
  const id = useSearchParams().get("id");
  if (!id) return <div className="p-6 text-center text-neutral-600">Not found.</div>;
  // Keyed by id so moving between two records starts from fresh state.
  return <Fragment key={id}>{children(id)}</Fragment>;
}
