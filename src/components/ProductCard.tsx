import Link from "next/link";
import { convert, fmtEur, fmtLocal, getFxRates, type FxRates } from "@/lib/fx";

export type CardProduct = {
  erpNumber: string;
  title: string;
  titleEn?: string | null;
  imageUrl?: string | null;
  brandName?: string | null;
};

export type CardListing = {
  countryCode: string;
  currentPrice: number | null;
  oldPrice?: number | null;
  currency?: string | null;
  stockOk: boolean;
  promo?: string | null;
};

export async function ProductCard({ product, listing }: { product: CardProduct; listing?: CardListing }) {
  const fx: FxRates | null = listing?.currentPrice != null ? await getFxRates() : null;
  const local = listing?.currentPrice ?? null;
  const eur =
    listing?.currentPrice != null && fx && listing.currency
      ? convert(listing.currentPrice, listing.currency, "EUR", fx)
      : null;
  const eurWas =
    listing?.oldPrice != null && fx && listing?.currency ? convert(listing.oldPrice, listing.currency, "EUR", fx) : null;

  return (
    <Link href={`/products/${product.erpNumber}`} className="card">
      {product.imageUrl ? <img src={product.imageUrl} alt={product.titleEn ?? product.title} loading="lazy" /> : null}
      <div className="title">
        {product.titleEn && product.titleEn !== product.title ? (
          <span className="title-en">{product.titleEn}</span>
        ) : (
          product.title
        )}
        {product.titleEn && product.titleEn !== product.title ? (
          <span className="title-orig">{product.title}</span>
        ) : null}
      </div>
      {listing && local != null ? (
        <div className="price-line">
          <span className="price">{eur != null ? fmtEur(eur) : `${local.toFixed(2)} ${listing.currency ?? ""}`}</span>
          {eurWas ? <span className="old">{fmtEur(eurWas)}</span> : listing.oldPrice ? <span className="old">{listing.oldPrice.toFixed(2)}</span> : null}
        </div>
      ) : listing ? (
        <div className="meta">price n/a</div>
      ) : null}
      {listing && listing.currency && listing.currency !== "EUR" && local != null ? (
        <div className="meta local-price">
          in {listing.countryCode}: {fmtLocal(local, listing.currency)}
          {listing.oldPrice ? ` · was ${listing.oldPrice.toFixed(2)}` : ""}
        </div>
      ) : null}
      <div className="meta">
        <span className={`badge ${listing && !listing.stockOk ? "out" : listing?.promo ? "deal" : ""}`}>
          {listing ? (listing.stockOk ? listing.countryCode : "out of stock") : product.brandName || ""}
        </span>
        {listing?.promo ? <span className="meta"> {listing.promo}</span> : null}
      </div>
    </Link>
  );
}
