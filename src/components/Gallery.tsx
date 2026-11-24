"use client";

import { useState } from "react";

export function Gallery({ images, title }: { images: string[]; title: string }) {
  const [active, setActive] = useState(0);
  const main = images[active] ?? images[0];
  return (
    <div style={{ width: 280 }}>
      <img
        src={main}
        alt={title}
        style={{ width: 280, height: 280, objectFit: "contain", background: "#fff", borderRadius: 12, border: "1px solid var(--border)" }}
      />
      {images.length > 1 ? (
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setActive(i)}
              style={{
                padding: 0,
                cursor: "pointer",
                border: i === active ? "2px solid var(--accent)" : "1px solid var(--border)",
                borderRadius: 8,
                background: "#fff",
                width: 56,
                height: 56,
                overflow: "hidden",
              }}
              aria-label={`Image ${i + 1}`}
            >
              <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
