import { redirect } from "next/navigation";

import { hasValidSuperdashboardSession } from "@/lib/superdashboard-auth";

export const dynamic = "force-dynamic";

export default async function ProtectedSuperdashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (!(await hasValidSuperdashboardSession())) {
    redirect("/superdashboard/login");
  }

  return children;
}
