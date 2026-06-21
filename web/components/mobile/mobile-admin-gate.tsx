"use client";

import { useRouter } from "next/navigation";
import { ReactNode, useEffect } from "react";

import { useClinicShell } from "@/components/clinic-shell-provider";
import { MobileShell } from "@/components/mobile/mobile-shell";

export function MobileAdminGate({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const { currentUser, isAuthReady, isRedirectingToLogin } = useClinicShell();

  useEffect(() => {
    if (isAuthReady && currentUser?.role === "staff") {
      router.replace("/m");
    }
  }, [currentUser, isAuthReady, router]);

  if (!isAuthReady || isRedirectingToLogin) {
    return (
      <MobileShell title={title}>
        <p className="clinic-empty-state">Loading...</p>
      </MobileShell>
    );
  }

  if (currentUser?.role === "staff") {
    return (
      <MobileShell title={title}>
        <p className="clinic-empty-state">Redirecting to queue...</p>
      </MobileShell>
    );
  }

  return <>{children}</>;
}
