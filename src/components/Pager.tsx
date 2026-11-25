import Link from "next/link";

// Sliding window of page numbers: up to 10 buttons, current centred with 5
// before and 5 after (clamped at the edges).
export function PageNumbers({
  page,
  totalPages,
  href,
}: {
  page: number;
  totalPages: number;
  href: (n: number) => string;
}) {
  if (totalPages <= 1) return null;
  const WINDOW = 10;
  let start = Math.max(1, page - 5);
  const end = Math.min(totalPages, start + WINDOW - 1);
  start = Math.max(1, Math.min(start, end - WINDOW + 1));
  const nums = [];
  for (let i = start; i <= end; i++) nums.push(i);
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>
      {nums.map((n) =>
        n === page ? (
          <span key={n} className="button ghost current" aria-current="page">
            {n}
          </span>
        ) : (
          <Link key={n} className="button ghost" href={href(n)}>
            {n}
          </Link>
        ),
      )}
    </span>
  );
}
