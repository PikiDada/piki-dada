import { RoleGuard } from "@/components/auth/role-guard";

export default function PassengerLayout({ children }: { children: React.ReactNode }) {
  return <RoleGuard role="PASSENGER">{children}</RoleGuard>;
}
