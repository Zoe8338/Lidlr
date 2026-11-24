"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestLogin, saveTracking, toggleTrack } from "@/app/actions";

export type ExistingTracking = {
  countryCode: string | null;
  maxPrice: number | null;
  offerOnly: boolean | null;
  onlineOnly: boolean | null;
  notifyEmail: boolean;
  notifyWhatsapp: boolean;
};

export function TrackDialog({
  erp,
  productTitle,
  countries,
  signedIn,
  whatsappReady,
  emailReady,
  existing,
}: {
  erp: string;
  productTitle: string;
  countries: { code: string; name: string }[];
  signedIn: boolean;
  whatsappReady: boolean;
  emailReady: boolean;
  existing: ExistingTracking | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const startForm = () => {
    setError("");
    setOpen(true);
  };

  async function onSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await saveTracking(new FormData(formEvent.currentTarget));
      if (res?.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError("Could not save — try again.");
      }
    } catch {
      setError("Could not save — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.set("erp", erp);
      await toggleTrack(fd);
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not remove — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!signedIn) {
    return (
      <form action={requestLogin}>
        <input type="hidden" name="erp" value={erp} />
        <input type="hidden" name="next" value={`/products/${erp}`} />
        <button className="button" type="submit">
          Track this product
        </button>
      </form>
    );
  }

  return (
    <>
      <button className={existing ? "button" : "button"} type="button" onClick={startForm}>
        {existing ? "Edit tracking" : "Track this product"}
      </button>
      {open ? (
        <div className="modal-overlay" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label={existing ? "Edit tracking" : "Add tracking"}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <strong>{existing ? "Edit tracking" : "Add tracking"}</strong>
              <button className="modal-close" type="button" aria-label="Close" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
            <p className="modal-sub">{productTitle}</p>

            {existing ? (
              <form onSubmit={onSubmit}>
                <label className="field">
                  <span>Country</span>
                  <select name="countryCode" defaultValue={existing.countryCode ?? ""}>
                    <option value="">Any country</option>
                    {countries.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="field-grid">
                  <label className="field">
                    <span>Price ≤ (in country currency)</span>
                    <input
                      name="maxPrice"
                      inputMode="decimal"
                      placeholder="e.g. 19.99"
                      defaultValue={existing.maxPrice != null ? String(existing.maxPrice) : ""}
                    />
                  </label>
                  <label className="field">
                    <span>Offer</span>
                    <select name="offer" defaultValue={existing.offerOnly == null ? "any" : existing.offerOnly ? "yes" : "no"}>
                      <option value="any">Unknown</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Online</span>
                    <select name="online" defaultValue={existing.onlineOnly == null ? "any" : existing.onlineOnly ? "yes" : "no"}>
                      <option value="any">Unknown</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </label>
                </div>
                <fieldset className="field">
                  <legend>Notify via</legend>
                  <label className="check">
                    <input type="checkbox" name="notifyEmail" defaultChecked={existing.notifyEmail} /> Email
                    {emailReady ? "" : " (no mail provider configured)"}
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      name="notifyWhatsapp"
                      defaultChecked={existing.notifyWhatsapp}
                      disabled={!whatsappReady}
                    />{" "}
                    WhatsApp
                    {whatsappReady ? "" : " (add number + key on the Alerts page first)"}
                  </label>
                </fieldset>
                {error ? <p className="form-error">{error}</p> : null}
                <div className="modal-actions">
                  <button className="button primary" type="submit" disabled={busy}>
                    {busy ? "Saving…" : "Save"}
                  </button>
                  <button className="button danger" type="button" disabled={busy} onClick={onRemove}>
                    Stop tracking
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={onSubmit}>
                <input type="hidden" name="erp" value={erp} />
                <div className="field-grid">
                  <label className="field">
                    <span>Country</span>
                    <select name="countryCode" defaultValue="">
                      <option value="">Any country</option>
                      {countries.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Price ≤ (in country currency)</span>
                    <input name="maxPrice" inputMode="decimal" placeholder="e.g. 19.99" />
                  </label>
                  <label className="field">
                    <span>Offer</span>
                    <select name="offer" defaultValue="any">
                      <option value="any">Unknown</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Online</span>
                    <select name="online" defaultValue="any">
                      <option value="any">Unknown</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </label>
                </div>
                <fieldset className="field">
                  <legend>Notify via</legend>
                  <label className="check">
                    <input type="checkbox" name="notifyEmail" defaultChecked /> Email
                    {emailReady ? "" : " (no mail provider configured)"}
                  </label>
                  <label className="check">
                    <input type="checkbox" name="notifyWhatsapp" disabled={!whatsappReady} /> WhatsApp
                    {whatsappReady ? "" : " (add number + key on the Alerts page first)"}
                  </label>
                </fieldset>
                <p className="modal-hint">
                  You&apos;ll get an alert on a price drop, when it goes on offer, comes back in stock, or appears in a
                  country&apos;s leaflet.
                </p>
                {error ? <p className="form-error">{error}</p> : null}
                <div className="modal-actions">
                  <button className="button primary" type="submit" disabled={busy}>
                    {busy ? "Saving…" : "Save"}
                  </button>
                  <button className="button ghost" type="button" onClick={() => setOpen(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
