"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SpecialtyOnboardingRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/onboarding/setup");
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 text-sm text-slate-600">
      Opening setup...
    </main>
  );
}
