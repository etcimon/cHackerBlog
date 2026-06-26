"use client";

/**
 * Admin session context. Exposes `isAdmin`, a `login(password)` action used by
 * the admin modal, and `logout`. State is hydrated from GET /api/auth on mount.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/toast";

interface AdminApi {
  isAdmin: boolean;
  ready: boolean;
  login: (password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

const AdminContext = createContext<AdminApi | null>(null);

export function useAdmin(): AdminApi {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used within <AdminProvider>");
  return ctx;
}

export function AdminProvider({ children }: { children: ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [ready, setReady] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api
      .get<{ admin: boolean }>("/api/auth")
      .then((d) => setIsAdmin(d.admin))
      .catch(() => setIsAdmin(false))
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(
    async (password: string) => {
      try {
        const d = await api.post<{ admin: boolean }>("/api/auth", { password });
        setIsAdmin(d.admin);
        toast.success("Authenticated as admin");
        return true;
      } catch (err) {
        toast.error(err instanceof ApiClientError ? err.message : "Login failed");
        return false;
      }
    },
    [toast],
  );

  const logout = useCallback(async () => {
    try {
      await api.del("/api/auth");
    } finally {
      setIsAdmin(false);
      toast.info("Signed out");
    }
  }, [toast]);

  return (
    <AdminContext.Provider value={{ isAdmin, ready, login, logout }}>
      {children}
    </AdminContext.Provider>
  );
}
