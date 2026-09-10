"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { PassengerNav } from "@/components/passenger/passenger-nav";

interface Profile {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
}

interface Session {
  id: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: string;
}

export default function PassengerProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saved, setSaved] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    apiFetch<Profile>("/users/me").then((p) => {
      setProfile(p);
      setName(p.name);
      setPhone(p.phone ?? "");
    });
    apiFetch<Session[]>("/auth/sessions").then(setSessions);
  }, []);

  async function revokeSession(id: string) {
    await apiFetch(`/auth/sessions/${id}`, { method: "DELETE" });
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }

  async function revokeAllSessions() {
    await apiFetch("/auth/sessions/revoke-all", { method: "POST" });
    window.location.href = "/login";
  }

  async function handleSave() {
    const updated = await apiFetch<Profile>("/users/me", {
      method: "PATCH",
      body: JSON.stringify({ name, phone }),
    });
    setProfile(updated);
    setSaved(true);
  }

  if (!profile) return <div className="p-6 text-center text-neutral-600">Loading...</div>;

  return (
    <div className="min-h-screen p-4 pb-20">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={profile.email} disabled />
          </div>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          {saved && <p className="text-sm text-green-600">Saved</p>}
          <Button className="w-full" onClick={handleSave}>
            Save changes
          </Button>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Active sessions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sessions.length === 0 && (
            <p className="text-sm text-neutral-600">No active sessions.</p>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-xl bg-neutral-50 p-3 text-sm"
            >
              <div>
                <p className="font-medium">{s.userAgent ?? "Unknown device"}</p>
                <p className="text-neutral-600">
                  {s.ipAddress ?? "Unknown IP"} ·{" "}
                  {new Date(s.createdAt).toLocaleString()}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => revokeSession(s.id)}>
                Revoke
              </Button>
            </div>
          ))}
          <Button variant="destructive" className="w-full" onClick={revokeAllSessions}>
            Log out of all devices
          </Button>
        </CardContent>
      </Card>
      <PassengerNav />
    </div>
  );
}
