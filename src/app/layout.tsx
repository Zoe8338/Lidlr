import type { Metadata } from "next";
import Link from "next/link";
import { currentUser, getTheme } from "@/lib/auth";
import { logout } from "@/app/actions";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CookieBanner } from "@/components/CookieBanner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lidlr — Lidl EU price tracker",
  description:
    "Track prices, new items and deals for Parkside, Esmara, Crivit, Cien, SilverCrest, Livarno, Livery, Dentalux and more across every EU Lidl online shop.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [user, theme] = await Promise.all([currentUser(), getTheme()]);
  return (
    <html lang="en" data-theme={theme}>
      <body>
        <header className="site">
          <div className="container inner">
            <Link href="/" className="logo">
              LIDLR
            </Link>
            <nav className="main">
              <Link href="/products">Products</Link>
              <Link href="/deals">Deals</Link>
              <Link href="/new">New items</Link>
              <Link href="/alerts">Tracking</Link>
            </nav>
            <div className="spacer" />
            <ThemeToggle />
            {user ? (
              <div className="userbar">
                <span className="userchip" title={user.email}>
                  {user.email}
                </span>
                <form action={logout}>
                  <button className="button ghost" type="submit">
                    Sign out
                  </button>
                </form>
              </div>
            ) : (
              <Link className="button" href="/login">
                Sign in
              </Link>
            )}
          </div>
        </header>
        <main className="container">{children}</main>
        <footer className="site container">
          <div className="footer-links">
            <Link href="/privacy">Privacy</Link>
            <span>·</span>
            <Link href="/cookies">Cookies</Link>
            <span>·</span>
            <Link href="/terms">Terms</Link>
          </div>
          <p>
            Lidlr is an independent tracker and is not affiliated with Lidl. Data is crawled from Lidl&apos;s public
            online shops; in-store availability is based on the online shop indicators.
          </p>
        </footer>
        <CookieBanner />
      </body>
    </html>
  );
}
