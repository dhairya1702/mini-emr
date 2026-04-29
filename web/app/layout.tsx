import type { Metadata } from "next";
import { ClinicShellProvider } from "@/components/clinic-shell-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clinic EMR",
  description: "Queue management and AI note generation for small clinics.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <ClinicShellProvider>{children}</ClinicShellProvider>
      </body>
    </html>
  );
}
