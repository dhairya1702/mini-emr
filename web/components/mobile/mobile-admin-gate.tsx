"use client";

import { useRouter } from "next/navigation";
import { ReactNode, useEffect } from "react";

import { useClinicShell } from "@/components/clinic-shell-provider";
import { MobileShell } from "@/components/mobile/mobile-shell";
import type { UserRole } from "@/lib/types";

export function MobileAdminGate({
  title,
  canAccess = (role) => role === "admin",
  children,
}: {
  title: string;
  canAccess?: (role: UserRole | null | undefined) => boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const { currentUser, isAuthReady, isRedirectingToLogin } = useClinicShell();

  useEffect(() => {
    if (isAuthReady && currentUser && !canAccess(currentUser.role)) {
      router.replace("/m");
    }
  }, [canAccess, currentUser, isAuthReady, router]);

  if (!isAuthReady || isRedirectingToLogin) {
    return (
      <MobileShell title={title}>
        <p className="clinic-empty-state">Loading...</p>
      </MobileShell>
    );
  }

  if (!canAccess(currentUser?.role)) {
    return (
      <MobileShell title={title}>
        <p className="clinic-empty-state">Redirecting to queue...</p>
      </MobileShell>
    );
  }

  return <>{children}</>;
}
