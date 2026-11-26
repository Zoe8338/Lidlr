import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { currentUser, getTheme } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { logout } from "@/app/actions";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CookieBanner } from "@/components/CookieBanner";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || "http://localhost:3000"),
  title: {
    default: "Lidlr — Lidl EU price tracker (Parkside, Crivit, SilverCrest, Livarno…)",
    template: "%s",
  },
  description:
    "Track prices, new items and weekly in-store deals for Parkside, Esmara, Crivit, Cien, SilverCrest (Personal Care & Kitchen Tools), Livarno, Livery and Dentalux across every EU Lidl online shop — with EUR-converted prices, leaflet archive and product manuals.",
  keywords: [
    "lidl price tracker",
    "parkside price tracker",
    "lidl deals",
    "lidl leaflet archive",
    "crivit catalog",
    "silvercrest price history",
    "livarno",
    "lidl eu price comparison",
  ],
  openGraph: { siteName: "Lidlr", type: "website" },
  appleWebApp: { capable: true, title: "Lidlr", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f0f4f9" },
    { media: "(prefers-color-scheme: dark)", color: "#101318" },
  ],
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
              <Link href="/archive">Archive</Link>
              <Link href="/alerts">Tracking</Link>
              {user && isAdminEmail(user.email) ? <Link href="/admin">Admin</Link> : null}
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
        <main className="container">
          {children}
        </main>
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
