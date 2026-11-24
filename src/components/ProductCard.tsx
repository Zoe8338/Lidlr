import Link from "next/link";
import { convert, getFxRates } from "@/lib/fx";

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
  const fx = listing?.currentPrice != null && listing.currency != null ? await getFxRates() : null;
  const eur = fx && listing?.currentPrice != null && listing.currency ? convert(listing.currentPrice, listing.currency, "EUR", fx) : null;

  return (
    <Link href={`/products/${product.erpNumber}`} className="card">
      {product.imageUrl ? <img src={product.imageUrl} alt={product.title} loading="lazy" /> : null}
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
      {listing ? (
        <div>
          {listing.currentPrice != null ? (
            <>
              <span className="price">
                {listing.currentPrice.toFixed(2)} {listing.currency}
              </span>
              {listing.oldPrice ? <span className="old">{listing.oldPrice.toFixed(2)}</span> : null}
            </>
          ) : (
            <span className="meta">price n/a</span>
          )}
        </div>
      ) : null}
      <div className="meta">
        <span className={`badge ${listing && !listing.stockOk ? "out" : listing?.promo ? "deal" : ""}`}>
          {listing ? (listing.stockOk ? listing.countryCode : "out of stock") : product.brandName || ""}
        </span>
        {eur != null ? <span className="meta"> · ≈ {eur.toFixed(2)} EUR</span> : null}
        {listing?.promo ? <span className="meta"> {listing.promo}</span> : null}
      </div>
    </Link>
  );
}
