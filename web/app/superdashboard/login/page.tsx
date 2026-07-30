import { redirect } from "next/navigation";

import { SuperdashboardLoginForm } from "@/components/superdashboard-login-form";
import { hasValidSuperdashboardSession } from "@/lib/superdashboard-auth";

export const dynamic = "force-dynamic";

export default async function SuperdashboardLoginPage() {
  if (await hasValidSuperdashboardSession()) {
    redirect("/superdashboard");
  }

  return <SuperdashboardLoginForm />;
}
