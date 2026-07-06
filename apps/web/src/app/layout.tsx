import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wangchao Intelligence",
  description: "Theme-first AI intelligence workspace for topic monitoring.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
