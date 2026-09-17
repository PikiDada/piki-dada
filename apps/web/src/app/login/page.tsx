"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch, apiUrl } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { redirectForRole } from "@/lib/auth-helpers";
import Link from "next/link";
import Image from "next/image";

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "sent">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNeedsVerification(false);
    setLoading(true);
    try {
      const data = await apiFetch<{
        accessToken: string;
        user: { id: string; email: string; role: "PASSENGER" | "DRIVER" | "ADMIN" };
      }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      setSession(data.accessToken, data.user);
      redirectForRole(data.user.role, router);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      setError(message);
      setNeedsVerification(message.toLowerCase().includes("verify your email"));
    } finally {
      setLoading(false);
    }
  }

  async function resendVerification() {
    setResendStatus("sending");
    try {
      await apiFetch("/auth/resend-verification-email", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setResendStatus("sent");
    } catch {
      setResendStatus("idle");
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-7 overflow-hidden bg-neutral-50 px-4 py-10">
      {/* Soft brand wash behind the card so the page reads as branded space rather
          than a form floating on flat grey. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-64 w-72 -translate-x-1/2 rounded-full bg-brand/15 blur-3xl"
      />
      <Image
        src="/brand/pikidada_logo4.png"
        alt="Piki Dada"
        width={180}
        height={58}
        className="relative"
        priority
      />
      <Card className="relative w-full max-w-sm shadow-lift">
        <CardHeader className="pb-4">
          <CardTitle className="text-2xl">Welcome back</CardTitle>
          <p className="mt-1 text-sm text-neutral-600">Sign in to book your next ride.</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <PasswordInput
                id="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {needsVerification && (
              <div className="text-sm">
                {resendStatus === "sent" ? (
                  <p className="text-green-700">Verification email sent — check your inbox.</p>
                ) : (
                  <button
                    type="button"
                    onClick={resendVerification}
                    disabled={resendStatus === "sending"}
                    className="font-medium text-black underline"
                  >
                    {resendStatus === "sending" ? "Sending..." : "Resend verification email"}
                  </button>
                )}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-neutral-200" />
            <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">or</span>
            <div className="h-px flex-1 bg-neutral-200" />
          </div>
          <a href={apiUrl("/auth/google")} className="block">
            <Button variant="outline" className="w-full" type="button">
              Continue with Google
            </Button>
          </a>
          <div className="mt-6 space-y-1.5 border-t border-neutral-200 pt-5 text-center text-sm text-neutral-600">
            <p>
              Can&apos;t sign in?{" "}
              <Link
                href="/forgot-password"
                className="font-medium text-neutral-900 underline underline-offset-2 hover:text-neutral-700"
              >
                Reset your password
              </Link>
            </p>
            <p>
              No account?{" "}
              <Link
                href="/register"
                className="font-medium text-neutral-900 underline underline-offset-2 hover:text-neutral-700"
              >
                Sign up
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
