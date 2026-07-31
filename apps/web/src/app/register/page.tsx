"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { useAuthStore, type UserRole } from "@/lib/auth-store";
import type { DocumentType } from "@/lib/types";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { Upload, CheckCircle2 } from "lucide-react";

const DOCUMENT_TYPES: { value: DocumentType; label: string }[] = [
  { value: "NATIONAL_ID", label: "National ID" },
  { value: "DRIVING_PERMIT", label: "Driving Permit" },
  { value: "VEHICLE_REGISTRATION", label: "Motorcycle Registration" },
  { value: "INSURANCE", label: "Insurance" },
];

export default function RegisterPage() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const clearSession = useAuthStore((s) => s.clearSession);
  const [role, setRole] = useState<UserRole>("PASSENGER");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [color, setColor] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [documents, setDocuments] = useState<Record<DocumentType, File | null>>({
    NATIONAL_ID: null,
    DRIVING_PERMIT: null,
    VEHICLE_REGISTRATION: null,
    INSURANCE: null,
  });

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (role === "DRIVER" && DOCUMENT_TYPES.some((d) => !documents[d.value])) {
      setError("All documents are required");
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch<{
        accessToken: string;
        user: { id: string; email: string; role: UserRole };
      }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, phone, password, role }),
      });
      setSession(data.accessToken, data.user);

      if (role === "DRIVER") {
        await apiFetch("/drivers/me/vehicle", {
          method: "POST",
          body: JSON.stringify({ make, model, color, plateNumber, rideType: "BODA" }),
        });
        for (const doc of DOCUMENT_TYPES) {
          const file = documents[doc.value];
          if (!file) continue;
          const formData = new FormData();
          formData.append("file", file);
          formData.append("type", doc.value);
          await apiFetch("/drivers/me/documents", { method: "POST", body: formData });
        }
      }

      // Registration done. Clear the session so the user must verify their
      // email and log in properly — prevents bypassing verification via the
      // token issued during registration.
      clearSession();
      router.push(`/verify-email/sent?email=${encodeURIComponent(email)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-neutral-50 px-4 py-10">
      <Image src="/brand/pikidada_logo4.png" alt="Piki Dada" width={180} height={58} />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid grid-cols-2 gap-2">
            {(["PASSENGER", "DRIVER"] as UserRole[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={cn(
                  "rounded-xl border px-3 py-2 text-sm font-medium transition-all duration-150 active:scale-[0.96]",
                  role === r
                    ? "border-[#F4C12C] bg-[#F4C12C] text-black shadow-md"
                    : "border-neutral-300 hover:border-[#F4C12C] hover:bg-yellow-100 hover:scale-[1.08]",
                )}
              >
                {r === "PASSENGER" ? "Ride" : "Drive"}
              </button>
            ))}
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
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
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                type="tel"
                required
                pattern="^\+?[0-9\s\(\)\-]{7,20}$"
                title="Enter a valid phone number"
                placeholder="07XXXXXXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <PasswordInput
                id="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <PasswordInput
                id="confirmPassword"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            {role === "DRIVER" && (
              <>
                <div className="border-t border-neutral-200 pt-4">
                  <p className="mb-3 text-sm font-semibold">Motorcycle details</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="make">Make</Label>
                      <Input id="make" required value={make} onChange={(e) => setMake(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="model">Model</Label>
                      <Input
                        id="model"
                        required
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="color">Color</Label>
                      <Input
                        id="color"
                        required
                        value={color}
                        onChange={(e) => setColor(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="plateNumber">Plate number</Label>
                      <Input
                        id="plateNumber"
                        required
                        value={plateNumber}
                        onChange={(e) => setPlateNumber(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="border-t border-neutral-200 pt-4">
                  <p className="mb-3 text-sm font-semibold">Documents</p>
                  <div className="space-y-3">
                    {DOCUMENT_TYPES.map((doc) => {
                      const file = documents[doc.value];
                      return (
                        <div key={doc.value} className="space-y-1.5">
                          <Label htmlFor={doc.value}>{doc.label}</Label>
                          <label
                            htmlFor={doc.value}
                            className={cn(
                              "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-4 text-center transition-colors duration-150",
                              file
                                ? "border-green-500 bg-green-50 text-green-700"
                                : "border-neutral-300 bg-neutral-50 text-neutral-500 hover:border-[#F4C12C] hover:bg-yellow-50 hover:text-neutral-700",
                            )}
                          >
                            {file ? (
                              <>
                                <CheckCircle2 size={20} className="text-green-600" />
                                <span className="max-w-full truncate text-xs font-medium">{file.name}</span>
                                <span className="text-[11px] text-green-600">Tap to change</span>
                              </>
                            ) : (
                              <>
                                <Upload size={20} />
                                <span className="text-xs font-medium">Upload {doc.label}</span>
                                <span className="text-[11px]">JPG, PNG, PDF</span>
                              </>
                            )}
                          </label>
                          <input
                            id={doc.value}
                            type="file"
                            required
                            accept="image/jpeg,image/png,image/webp,application/pdf"
                            className="sr-only"
                            onChange={(e) =>
                              setDocuments((prev) => ({
                                ...prev,
                                [doc.value]: e.target.files?.[0] ?? null,
                              }))
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Creating account..." : "Create account"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-neutral-500">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-black underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
