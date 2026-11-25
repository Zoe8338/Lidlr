"use client";

import { useState } from "react";

// ParkPrice-style description box: clamped to a few lines with a fade,
// expanding to the full text via a Read more / Show less toggle.
export function DescriptionBox({ primary, alt }: { primary?: string | null; alt?: string | null }) {
  const [open, setOpen] = useState(false);
  const text = primary || alt;
  if (!text) return null;
  return (
    <div className="descbox">
      <p className={open ? "descbox-text open" : "descbox-text"}>{text}</p>
      {alt && primary && alt !== primary ? <p className="descbox-alt">{alt}</p> : null}
      <button type="button" className="descbox-more" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? "Show less ▴" : "Read more ▾"}
      </button>
    </div>
  );
}
