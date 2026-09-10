"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";

function SentInner() {
  const params = useSearchParams();
  const email = params.get("email") ?? "";
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");

  async function resend() {
    setStatus("sending");
    try {
      await apiFetch("/auth/resend-verification-email", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setStatus("sent");
    } catch {
      setStatus("idle");
    }
  }

  return (
    <div className="space-y-4 text-center">
      <p className="text-4xl">📬</p>
      <p className="text-sm text-neutral-600">
        We sent a verification link to{" "}
        <span className="font-medium text-black">{email || "your email"}</span>.
        Click the link in that email to activate your account.
      </p>
      <p className="text-xs text-neutral-600">
        Check your spam folder if you don&apos;t see it within a minute.
      </p>

      {status === "sent" ? (
        <p className="text-sm text-green-700">Email resent — check your inbox.</p>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={status === "sending"}
          onClick={resend}
        >
          {status === "sending" ? "Sending..." : "Resend verification email"}
        </Button>
      )}

      <p className="text-sm text-neutral-600">
        Already verified?{" "}
        <Link href="/login" className="font-medium text-black underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

export default function VerifyEmailSentPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-neutral-50 px-4">
      <Image src="/brand/pikidada_logo4.png" alt="Piki Dada" width={180} height={58} />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<p className="text-sm text-neutral-600">Loading...</p>}>
            <SentInner />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
