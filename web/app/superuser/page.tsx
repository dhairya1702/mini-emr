import { redirect } from "next/navigation";

export default function SuperuserRedirectPage() {
  redirect("/superdashboard");
}
