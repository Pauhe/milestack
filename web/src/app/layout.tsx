import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";

import { AppProviders } from "@/components/providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Milestack",
  description: "Non-custodial milestone escrow for digital work on Base.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <AppProviders>
          <div className="app-shell">
            <header className="site-header">
              <Link href="/" className="brand-mark">
                <span className="brand-mark__dot" />
                <span>Milestack</span>
              </Link>

              <nav className="site-nav" aria-label="Primary">
                <Link href="/create">Create Deal</Link>
                <Link href="/discover">Discover</Link>
                <Link href="/deals/demo-deal">Deal Overview</Link>
                <Link href="/deals/demo-deal/milestones/0">Milestone</Link>
                <Link href="/deals/demo-deal/disputes/0">Dispute</Link>
                <Link href="/profiles/0xA11CE">Profile</Link>
              </nav>
            </header>

            <main className="page-shell">{children}</main>
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
