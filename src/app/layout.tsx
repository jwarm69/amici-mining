import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import "leaflet/dist/leaflet.css";

export const metadata: Metadata = {
  title: "Amici Mining — Catering Prospects, Palm Beach",
  description: "Geo-targeted business pipeline for Amici Market catering & yacht provisions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-background text-foreground antialiased">
        <header className="border-b border-[var(--color-border)] bg-[var(--color-card)]">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <Link href="/" className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-full grid place-items-center text-white text-sm font-bold"
                  style={{ background: "var(--color-primary)", fontFamily: "var(--font-serif)" }}
                >
                  A
                </div>
                <div>
                  <div className="text-sm font-semibold tracking-tight">Amici Mining</div>
                  <div className="text-xs text-[var(--color-muted)]">Catering prospects · Palm Beach</div>
                </div>
              </Link>
            </div>
            <nav className="flex items-center gap-1 text-sm">
              <Link
                href="/"
                className="px-3 py-1.5 rounded-md hover:bg-[var(--color-border-light)] transition"
              >
                Pipeline
              </Link>
              <Link
                href="/map"
                className="px-3 py-1.5 rounded-md hover:bg-[var(--color-border-light)] transition"
              >
                Map
              </Link>
            </nav>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
