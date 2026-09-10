"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

function VerifyEmailInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [status, setStatus] = useState<"pending" | "success" | "error">("pending");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      return;
    }
    apiFetch("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) })
      .then(() => setStatus("success"))
      .catch(() => setStatus("error"));
  }, [token]);

  if (status === "pending") return <p className="text-sm text-neutral-600">Verifying...</p>;
  if (status === "success") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-neutral-600">Your email is verified.</p>
        <Link href="/login" className="font-medium text-black underline">
          Continue to sign in
        </Link>
      </div>
    );
  }
  return <p className="text-sm text-red-600">This verification link is invalid or has expired.</p>;
}

export default function VerifyEmailPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Email verification</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<p className="text-sm text-neutral-600">Loading...</p>}>
            <VerifyEmailInner />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
