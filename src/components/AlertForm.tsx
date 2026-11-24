import { createAlert, toggleAlert, deleteAlert } from "@/app/actions";

export function AlertForm({ presetErp, brands, countryCodes }: { presetErp?: string; brands: string[]; countryCodes: string[] }) {
  return (
    <form action={createAlert} className="inline" style={{ display: "grid", gap: 10, maxWidth: 520 }}>
      {presetErp ? <input type="hidden" name="erp" value={presetErp} /> : null}
      <input name="email" type="email" required placeholder="you@example.com" />
      <select name="kind" defaultValue="price_below">
        <option value="price_below">Price drops to or below…</option>
        <option value="in_stock">In stock / available</option>
        <option value="new_item">Any new item (brand match)</option>
      </select>
      <input name="maxPrice" inputMode="decimal" placeholder="Max price (for price alerts), e.g. 19.99" />
      {!presetErp ? (
        <>
          <input name="query" placeholder="Title contains (optional)" />
          <select name="brandSlug" defaultValue="">
            <option value="">Brand family (optional)</option>
            {brands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </>
      ) : null}
      <select name="countryCode" defaultValue="">
        <option value="">Any country (optional)</option>
        {countryCodes.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <button type="submit">Create alert</button>
    </form>
  );
}

export function AlertRowActions({ id, active }: { id: number; active: boolean }) {
  return (
    <span style={{ display: "inline-flex", gap: 8 }}>
      <form action={toggleAlert}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="active" value={active ? "0" : "1"} />
        <button className="button ghost" type="submit">
          {active ? "Pause" : "Resume"}
        </button>
      </form>
      <form action={deleteAlert}>
        <input type="hidden" name="id" value={id} />
        <button className="button danger" type="submit">
          Delete
        </button>
      </form>
    </span>
  );
}
