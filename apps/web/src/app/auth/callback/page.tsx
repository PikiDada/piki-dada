"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/lib/auth-store";
import { redirectForRole } from "@/lib/auth-helpers";
import { apiFetch } from "@/lib/api";

function AuthCallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const setSession = useAuthStore((s) => s.setSession);

  useEffect(() => {
    const accessToken = params.get("accessToken");
    if (!accessToken) {
      router.push("/login");
      return;
    }
    // The refresh token was already set as an httpOnly cookie by the backend redirect —
    // it never appears in this URL.
    useAuthStore.setState({ accessToken });
    apiFetch<{
      id: string;
      email: string;
      role: "PASSENGER" | "DRIVER" | "ADMIN";
      phone?: string | null;
    }>("/users/me")
      .then((user) => {
        setSession(accessToken, user);
        if (!user.phone) {
          router.push("/complete-profile");
          return;
        }
        redirectForRole(user.role, router);
      })
      .catch(() => router.push("/login"));
  }, [params, router, setSession]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-neutral-600">Signing you in...</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-neutral-600">Signing you in...</p>
        </div>
      }
    >
      <AuthCallbackInner />
    </Suspense>
  );
}
