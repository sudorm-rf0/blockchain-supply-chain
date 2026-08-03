"use client";

import { create } from "zustand";
import type { AuthUser } from "@/lib/api";

interface UserState {
  user: AuthUser | null;
  hydrated: boolean;
  setAuth: (user: AuthUser | null) => void;
  setUser: (user: AuthUser | null) => void;
  setHydrated: (hydrated: boolean) => void;
  logout: () => void;
}

export const useUserStore = create<UserState>()((set) => ({
  user: null,
  hydrated: false,
  setAuth: (user) => set({ user, hydrated: true }),
  setUser: (user) => set({ user }),
  setHydrated: (hydrated) => set({ hydrated }),
  logout: () => set({ user: null, hydrated: true }),
}));
