import { AdminNav } from "@/components/admin/admin-nav";
import { RoleGuard } from "@/components/auth/role-guard";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard role="ADMIN">
      <div className="min-h-screen">
        <AdminNav />
        <main className="ml-56 p-6">{children}</main>
      </div>
    </RoleGuard>
  );
}
