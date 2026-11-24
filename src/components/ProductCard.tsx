import Link from "next/link";

export type CardProduct = {
  erpNumber: string;
  title: string;
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

export function ProductCard({ product, listing }: { product: CardProduct; listing?: CardListing }) {
  return (
    <Link href={`/products/${product.erpNumber}`} className="card">
      {product.imageUrl ? <img src={product.imageUrl} alt={product.title} loading="lazy" /> : null}
      <div className="title">{product.title}</div>
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
        {listing?.promo ? <span className="meta"> {listing.promo}</span> : null}
      </div>
    </Link>
  );
}
