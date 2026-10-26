import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { NavLinks } from "@/components/NavLinks";
import { patch } from "@/data";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Dao TFT — early-game decision engine",
  description:
    "Tell Dao TFT which item components you hold and it ranks the Teamfight Tactics compositions you can play toward, and when to pivot.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="border-b border-line bg-panel/80">
          <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-3">
              <Link href="/" className="whitespace-nowrap text-lg font-semibold tracking-wide text-gold">
                道 Dao TFT
              </Link>
              <span
                className="whitespace-nowrap rounded-full border border-line px-2 py-0.5 text-xs text-muted"
                title={`Recommendations use TFT Academy's comps for patch ${patch}`}
              >
                <span className="hidden sm:inline">Patch </span>
                {patch}
              </span>
            </div>
            <NavLinks />
          </nav>
        </header>
        <div className="flex-1">{children}</div>
        <footer className="border-t border-line px-4 py-6 text-center text-xs text-muted">
          Dao TFT is an independent portfolio project and is not endorsed by Riot Games. Teamfight Tactics and Riot
          Games are trademarks of Riot Games, Inc. Game data and icons from Community Dragon.
        </footer>
      </body>
    </html>
  );
}
