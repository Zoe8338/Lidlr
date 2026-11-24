"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { dismissCookies } from "@/app/actions";

export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const match = document.cookie.match(/(?:^|; )lidlr_consent=([^;]*)/);
    if (!match) setVisible(true);
  }, []);

  if (!visible) return null;

  const choose = async (choice: string) => {
    const fd = new FormData();
    fd.set("choice", choice);
    await dismissCookies(fd);
    setVisible(false);
  };

  return (
    <div className="cookie-banner" role="dialog" aria-label="Cookie preferences">
      <p>
        Lidlr stores only <strong>strictly necessary</strong> cookies: a login session (if you sign in) and your
        theme choice. Nothing tracks you across sites — no analytics or ad cookies, ever. Details in our{" "}
        <Link href="/cookies">cookie policy</Link>.
      </p>
      <div className="cookie-actions">
        <button type="button" className="button" onClick={() => choose("all")}>
          Accept
        </button>
        <button type="button" className="button ghost" onClick={() => choose("essential")}>
          Essential only
        </button>
      </div>
    </div>
  );
}
