import { RoleGuard } from "@/components/auth/role-guard";

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return <RoleGuard role="DRIVER">{children}</RoleGuard>;
}
