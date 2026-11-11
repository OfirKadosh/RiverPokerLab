import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { apiClient } from "../lib/api";
import { LoadingIndicator } from "./LoadingIndicator";
import { allEntries, bankrollPeriod, currencies, entryChange, entryLabels, venueLabels } from "../lib/bankroll";
import type { BankrollFilters, Currency, Entry, Kind, Ledger, Venue } from "../lib/bankroll";
import { BankrollDashboard } from "./BankrollDashboard";
import "./BankrollPanel.css";

const PAGE_SIZE = 20;
type FeedbackArea = "settings" | "entry" | "ledger";
type Draft = { kind: Kind; venue: Venue | ""; date: string; note: string; buyIn: string; cashOut: string; amount: string };

function newEntry(): Draft {
  const now = new Date();
  const date = new Date(+now - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return { kind: "cash", venue: "", date, note: "", buyIn: "", cashOut: "", amount: "" };
}

function minorUnits(value: string) {
  if (!/^\d{1,10}(?:[.,]\d{1,2})?$/.test(value.trim())) {
    throw new Error("Enter an amount with up to two decimal places.");
  }
  const [whole, fraction = ""] = value.trim().split(/[.,]/);
  const units = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (units > 100_000_000_000) throw new Error("Amount exceeds the supported limit.");
  return units;
}

const decimal = (minor: number) => (minor / 100).toFixed(2);
const message = (error: unknown) => error instanceof Error ? error.message : "Bankroll is temporarily unavailable.";

function MoneyInput({ label, value, setValue }: {
  label: string;
  value: string;
  setValue: (value: string) => void;
}) {
  return (
    <label className="field-label">
      {label}
      <input inputMode="decimal" placeholder="0.00" required maxLength={13}
        value={value} onChange={(event) => setValue(event.target.value)} />
    </label>
  );
}

export function BankrollPanel({ preview }: { preview: boolean }) {
  const [ledger, setLedger] = useState<Ledger | null>();
  const [filters, setFilters] = useState(allEntries);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const period = useMemo(() => ledger ? bankrollPeriod(ledger, filters) : null, [ledger, filters]);
  const currencyCode = ledger?.currency;
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [feedbackArea, setFeedbackArea] = useState<FeedbackArea>("settings");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [currency, setCurrency] = useState<Currency>("ILS");
  const [openingBalance, setOpeningBalance] = useState("0.00");
  const [editingOpening, setEditingOpening] = useState(false);
  const [draft, setDraft] = useState(newEntry);
  const [editing, setEditing] = useState<string>();
  const [pendingDelete, setPendingDelete] = useState<string>();
  const requestId = useRef<string | undefined>(undefined);
  const operation = useRef<AbortController | undefined>(undefined);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiClient.request("/bankroll", { signal: controller.signal }).then(
      (data) => setLedger(data.bankroll as Ledger | null),
      (failure: unknown) => { if (!controller.signal.aborted) setError(message(failure)); },
    );
    return () => {
      controller.abort();
      operation.current?.abort();
    };
  }, [revision]);

  async function write(path: string, method: string, body: object, area: FeedbackArea, onSuccess: () => void, notice: string) {
    if (operation.current || preview) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setFeedbackArea(area);
    setError("");
    setStatus("");
    try {
      const data = await apiClient.request(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setLedger(data.bankroll as Ledger);
        onSuccess();
        setStatus(notice);
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(message(failure));
    } finally {
      operation.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function saveOpening(event: FormEvent) {
    event.preventDefault();
    setFeedbackArea("settings");
    setStatus("");
    try {
      void write("/bankroll", "PUT", {
        currency: ledger?.currency ?? currency, openingBalance: minorUnits(openingBalance),
      }, "settings", () => setEditingOpening(false), "Opening balance saved.");
    } catch (failure) { setError(message(failure)); }
  }

  function resetEntry() {
    setEditing(undefined);
    setDraft(newEntry());
    requestId.current = undefined;
  }

  function editEntry(entry: Entry) {
    setEditing(entry.id);
    setDraft({
      ...newEntry(), kind: entry.kind, date: entry.date, note: entry.note,
      ...("buyIn" in entry ? { buyIn: decimal(entry.buyIn), cashOut: decimal(entry.cashOut), venue: entry.venue ?? "" }
        : { amount: decimal(entry.amount) }),
    });
    setPendingDelete(undefined);
    setError("");
    setStatus("");
    form.current?.focus();
  }

  function saveEntry(event: FormEvent) {
    event.preventDefault();
    setFeedbackArea("entry");
    setStatus("");
    try {
      const money = draft.kind === "cash" || draft.kind === "tournament"
        ? {
          buyIn: minorUnits(draft.buyIn), cashOut: minorUnits(draft.cashOut),
          ...(draft.venue ? { venue: draft.venue } : {}),
        }
        : { amount: minorUnits(draft.amount) };
      const id = editing ?? (requestId.current ??= crypto.randomUUID());
      const path = editing ? `/bankroll/entries/${id}` : "/bankroll/entries";
      void write(path, editing ? "PUT" : "POST", {
        id, kind: draft.kind, date: draft.date, note: draft.note, ...money,
      }, "entry", resetEntry, editing ? "Entry updated." : "Entry added.");
    } catch (failure) { setError(message(failure)); }
  }

  function setField<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  const formatter = useMemo(() => new Intl.NumberFormat(undefined, {
    style: "currency", currency: currencyCode ?? currency,
  }), [currencyCode, currency]);
  const money = (value: number) => formatter.format(value / 100);

  function updateFilters(next: BankrollFilters) {
    setFilters(next);
    setVisibleCount(PAGE_SIZE);
  }

  const feedback = (area: FeedbackArea) => feedbackArea === area && <>
    {error && <p role="alert" className="validation-note">{error}</p>}
    {status && <p role="status" className="field-help">{status}</p>}
  </>;

  const openingForm = (
    <form onSubmit={saveOpening}>
      <fieldset disabled={busy}>
        <div className="bankroll-fields">
          <label className="field-label">
            Currency
            <select value={ledger?.currency ?? currency} disabled={!!ledger} onChange={(event) => setCurrency(event.target.value as Currency)}>
              {currencies.map((code) => <option key={code}>{code}</option>)}
            </select>
          </label>
          <MoneyInput label="Opening balance" value={openingBalance} setValue={setOpeningBalance} />
        </div>
        {!ledger && <p className="field-help">Choose one currency for this ledger. You can edit the opening balance later.</p>}
        <div className="bankroll-actions">
          <button className="primary-button">{ledger ? "Save opening balance" : "Create bankroll"}</button>
          {ledger && <button type="button" className="text-button" onClick={() => setEditingOpening(false)}>Cancel</button>}
        </div>
      </fieldset>
    </form>
  );

  if (ledger === undefined) return (
    <section className="sidebar-section">
      {error ? <>
        <p role="alert" className="validation-note">{error}</p>
        <button className="secondary-button" onClick={() => { setError(""); setRevision((n) => n + 1); }}>Retry</button>
      </> : <LoadingIndicator label="Loading bankroll…" />}
    </section>
  );

  return (
    <div className="bankroll">
      <section className="sidebar-section">
        <div className="section-heading"><h2>{ledger ? "Bankroll summary" : "Set up your bankroll"}</h2></div>
        {feedback("settings")}
        {preview && <p className="inline-note">Preview uses read-only sample entries.</p>}
        {!ledger ? openingForm : <>
          <dl className="bankroll-summary" aria-label="All-time totals">
            <div><dt>Current balance</dt><dd>{money(ledger.balance)}</dd></div>
            <div><dt>All-time poker profit</dt><dd className={ledger.pokerProfit > 0 ? "bankroll-gain" : ledger.pokerProfit < 0 ? "bankroll-loss" : undefined}>{money(ledger.pokerProfit)}</dd></div>
            <div><dt>All-time net transfers</dt><dd>{money(ledger.netTransfers)}</dd></div>
            <div><dt>Opening balance</dt><dd>{money(ledger.openingBalance)}</dd></div>
          </dl>
          {editingOpening ? openingForm : !preview && (
            <button className="text-button" disabled={busy} onClick={() => {
              setOpeningBalance(decimal(ledger.openingBalance));
              setEditingOpening(true);
            }}>Edit opening balance</button>
          )}
        </>}
      </section>

      {ledger && <BankrollDashboard filters={filters} onFilters={updateFilters} period={period} money={money} />}

      {ledger && !preview && <section className="sidebar-section">
        <h2>{editing ? "Edit entry" : "Add an entry"}</h2>
        <form onSubmit={saveEntry} ref={form} tabIndex={-1} className="bankroll-form" aria-label="Bankroll entry">
          <fieldset disabled={busy}>
            <div className="bankroll-fields">
              <label className="field-label">
                Entry type
                <select value={draft.kind} onChange={(event) => setField("kind", event.target.value as Kind)}>
                  {Object.entries(entryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
              <label className="field-label">Date
                <input required type="date" min="1900-01-01" max="2099-12-31"
                  value={draft.date} onChange={(event) => setField("date", event.target.value)} />
              </label>
              {draft.kind === "cash" || draft.kind === "tournament" ? <>
                <label className="field-label">Played
                  <select value={draft.venue} onChange={(event) => setField("venue", event.target.value as Draft["venue"])}>
                    <option value="">Unspecified</option>
                    <option value="online">{venueLabels.online}</option>
                    <option value="live">{venueLabels.live}</option>
                  </select>
                </label>
                <MoneyInput label={draft.kind === "cash" ? "Total buy-ins" : "Total entries and re-entries"}
                  value={draft.buyIn} setValue={(value) => setField("buyIn", value)} />
                <MoneyInput label={draft.kind === "cash" ? "Cash-out" : "Prizes"}
                  value={draft.cashOut} setValue={(value) => setField("cashOut", value)} />
              </> : <MoneyInput label="Transfer amount" value={draft.amount} setValue={(value) => setField("amount", value)} />}
            </div>
            <label className="field-label">Note (optional)
              <input value={draft.note} maxLength={240} onChange={(event) => setField("note", event.target.value)} />
            </label>
            {feedback("entry")}
            <div className="bankroll-actions">
              <button className="primary-button">{busy ? "Saving…" : editing ? "Save entry" : "Add entry"}</button>
              {editing && <button type="button" className="text-button" onClick={resetEntry}>Cancel edit</button>}
            </div>
          </fieldset>
        </form>
      </section>}

      {ledger && <section className="sidebar-section">
        <h2>Ledger</h2>
        {feedback("ledger")}
        {!ledger.entries.length ? <p className="field-help">No entries yet.</p>
          : period && !period.entries.length ? <p className="field-help">No entries match the filters.</p>
            : period && <p className="field-help">Showing {Math.min(visibleCount, period.entries.length)} of {period.entries.length} entries, newest first.</p>}
        <ul className="bankroll-entries">
          {period?.entries.slice(0, visibleCount).map((entry) => {
            const result = entryChange(entry);
            return <li key={entry.id}>
              <div className="bankroll-entry">
                <div><strong>{entryLabels[entry.kind]}</strong>{"buyIn" in entry && <span className="field-help"> · {venueLabels[entry.venue ?? "unspecified"]}</span>}<time dateTime={entry.date}>{entry.date}</time></div>
                <strong className={result < 0 ? "bankroll-loss" : "bankroll-gain"}>{result > 0 ? "+" : ""}{money(result)}</strong>
              </div>
              {"buyIn" in entry && <p className="field-help">Paid {money(entry.buyIn)} · Returned {money(entry.cashOut)}</p>}
              {entry.note && <p className="bankroll-note">{entry.note}</p>}
              {!preview && <div className="bankroll-actions">
                {pendingDelete === entry.id ? <>
                  <span>Delete this entry?</span>
                  <button disabled={busy} className="secondary-button" onClick={() => void write(
                    `/bankroll/entries/${entry.id}`, "DELETE", {}, "ledger", () => {
                      setPendingDelete(undefined);
                      if (editing === entry.id) resetEntry();
                    }, "Entry deleted.",
                  )}>Confirm delete</button>
                  <button disabled={busy} className="text-button" onClick={() => setPendingDelete(undefined)}>Cancel</button>
                </> : <>
                  <button disabled={busy} className="text-button" onClick={() => editEntry(entry)}>Edit</button>
                  <button disabled={busy} className="text-button" onClick={() => setPendingDelete(entry.id)}>Delete</button>
                </>}
              </div>}
            </li>;
          })}
        </ul>
        {period && visibleCount < period.entries.length && (
          <button className="secondary-button" type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
            Show more entries
          </button>
        )}
      </section>}
    </div>
  );
}
