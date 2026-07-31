import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rate Beacon",
  description:
    "Free hotel rate intelligence: competitor rate grid, pricing advice, demand signals.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
