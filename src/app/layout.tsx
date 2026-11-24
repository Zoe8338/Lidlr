import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { logout } from "@/app/actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lidlr — Lidl EU price tracker",
  description:
    "Track prices, new items and deals for Parkside, Esmara, Crivit, Cien, SilverCrest, Livarno, Livery, Dentalux and more across every EU Lidl online shop.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en">
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
          Lidlr is an independent tracker and is not affiliated with Lidl. Data is crawled from Lidl&apos;s public
          online shops; in-store availability is based on the online shop indicators.
        </footer>
      </body>
    </html>
  );
}
