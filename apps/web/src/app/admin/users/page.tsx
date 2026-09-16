"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

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

type Category = "ALL" | "PASSENGER" | "DRIVER" | "ADMIN" | "SUSPENDED";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "PASSENGER", label: "Passengers" },
  { value: "DRIVER", label: "Riders" },
  { value: "ADMIN", label: "Admins" },
  { value: "SUSPENDED", label: "Suspended" },
];

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
  const [category, setCategory] = useState<Category>("ALL");

  function load() {
    setLoading(true);
    apiFetch<AdminUser[]>("/admin/users")
      .then(setUsers)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const counts = useMemo(() => {
    const c: Record<Category, number> = { ALL: users.length, PASSENGER: 0, DRIVER: 0, ADMIN: 0, SUSPENDED: 0 };
    for (const u of users) {
      if (u.role === "PASSENGER" || u.role === "DRIVER" || u.role === "ADMIN") c[u.role] += 1;
      if (!u.isActive) c.SUSPENDED += 1;
    }
    return c;
  }, [users]);

  const filtered = useMemo(() => {
    if (category === "ALL") return users;
    if (category === "SUSPENDED") return users.filter((u) => !u.isActive);
    return users.filter((u) => u.role === category);
  }, [users, category]);

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

      <div className="mb-4 flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setCategory(c.value)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors duration-150",
              category === c.value
                ? "border-black bg-black text-white"
                : "border-neutral-300 text-neutral-600 hover:border-neutral-400 hover:text-black",
            )}
          >
            {c.label}
            {!loading && <span className="ml-1.5 opacity-70">{counts[c.value]}</span>}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {loading ? (
          <Spinner />
        ) : filtered.length === 0 ? (
          <p className="text-neutral-600">No users in this category.</p>
        ) : filtered.map((u) => (
          <Card key={u.id}>
            <CardContent className="flex items-center justify-between pt-4">
              <div>
                <p className="flex items-center gap-2 font-medium">
                  {u.name}
                  <span className="text-xs font-normal text-neutral-600">({ROLE_LABELS[u.role] ?? u.role})</span>
                  {!u.isActive && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                      Suspended
                    </span>
                  )}
                  {!u.emailVerifiedAt && (
                    <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                      Unverified
                    </span>
                  )}
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
