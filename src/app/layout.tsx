import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lil Leaguer",
  description: "Little League lineup, rotation, and pitch-count helper for coaches.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
