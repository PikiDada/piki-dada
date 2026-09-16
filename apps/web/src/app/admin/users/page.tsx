"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  emailVerifiedAt: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  PASSENGER: "Passenger",
  DRIVER: "Rider",
  ADMIN: "Admin",
};

function Spinner() {
  return (
    <div className="flex items-center gap-2 py-8 text-neutral-600">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600" />
      <span className="text-sm">Loading...</span>
    </div>
  );
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    apiFetch<AdminUser[]>("/admin/users")
      .then(setUsers)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleActive(user: AdminUser) {
    await apiFetch(`/admin/users/${user.id}/${user.isActive ? "suspend" : "activate"}`, {
      method: "PATCH",
    });
    load();
  }

  async function promote(user: AdminUser) {
    if (!confirm(`Make ${user.name} (${user.email}) an admin? This grants full admin access.`)) {
      return;
    }
    try {
      await apiFetch(`/admin/users/${user.id}/promote`, { method: "PATCH" });
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to promote user");
    }
  }

  async function deleteUser(user: AdminUser) {
    if (
      !confirm(
        `Permanently delete ${user.name} (${user.email})? This cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      await apiFetch(`/admin/users/${user.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete user");
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Users</h1>
      <div className="space-y-2">
        {loading ? (
          <Spinner />
        ) : users.length === 0 ? (
          <p className="text-neutral-600">No users found.</p>
        ) : users.map((u) => (
          <Card key={u.id}>
            <CardContent className="flex items-center justify-between pt-4">
              <div>
                <p className="font-medium">
                  {u.name} <span className="text-xs text-neutral-600">({ROLE_LABELS[u.role] ?? u.role})</span>
                </p>
                <p className="text-sm text-neutral-600">{u.email}</p>
              </div>
              <div className="flex gap-2">
                {u.role !== "ADMIN" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!u.emailVerifiedAt}
                    title={!u.emailVerifiedAt ? "User must verify their email first" : undefined}
                    onClick={() => promote(u)}
                  >
                    Promote to Admin
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={u.isActive ? "destructive" : "default"}
                  onClick={() => toggleActive(u)}
                >
                  {u.isActive ? "Suspend" : "Activate"}
                </Button>
                {u.role !== "ADMIN" && (
                  <Button size="sm" variant="destructive" onClick={() => deleteUser(u)}>
                    Delete
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

