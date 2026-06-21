import { redirect } from "next/navigation";

export default function MobileLoginAliasPage() {
  redirect("/login?surface=mobile");
}
