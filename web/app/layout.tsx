import type { Metadata } from "next";
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
      <body>{children}</body>
    </html>
  );
}
