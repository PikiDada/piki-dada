"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore, type UserRole } from "@/lib/auth-store";

// Keeps people out of the wrong section's screens. Not a security boundary: the API checks
// the role on every request. It waits for the saved session to load from storage, so a
// signed-in user isn't bounced to the login page on a fresh page load.
export function RoleGuard({ role, children }: { role: UserRole; children: React.ReactNode }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const hydrated = useSyncExternalStore(
    (onChange) => useAuthStore.persist.onFinishHydration(onChange),
    () => useAuthStore.persist.hasHydrated(),
    () => false,
  );
  const allowed = hydrated && user?.role === role;

  useEffect(() => {
    if (hydrated && !allowed) router.replace("/login");
  }, [hydrated, allowed, router]);

  return allowed ? <>{children}</> : null;
}
