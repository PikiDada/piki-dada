import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UserRole = "PASSENGER" | "DRIVER" | "ADMIN";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  setSession: (accessToken: string, user: AuthUser) => void;
  clearSession: () => void;
}

// The refresh token lives only in an httpOnly cookie set by the API — it's never
// stored here, so it isn't readable by JS even if an XSS bug is ever introduced.
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      setSession: (accessToken, user) => set({ accessToken, user }),
      clearSession: () => set({ accessToken: null, user: null }),
    }),
    { name: "piki-dada-auth" },
  ),
);
