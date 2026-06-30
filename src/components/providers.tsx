"use client";

/**
 * Client provider tree. ToastProvider must wrap AdminProvider because the admin
 * context fires toasts on login/logout.
 */
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/toast";
import { AdminProvider } from "@/components/admin-context";
import { TerminalCaret } from "@/components/terminal-caret";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AdminProvider>
        {children}
        <TerminalCaret />
      </AdminProvider>
    </ToastProvider>
  );
}
