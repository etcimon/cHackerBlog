"use client";

/**
 * Client provider tree. ToastProvider must wrap AdminProvider because the admin
 * context fires toasts on login/logout.
 */
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/toast";
import { AdminProvider } from "@/components/admin-context";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AdminProvider>{children}</AdminProvider>
    </ToastProvider>
  );
}
