const CURRENCIES = ["ILS", "USD", "EUR", "GBP"];
const VENUES = ["online", "live"];
const KINDS = ["cash", "tournament", "deposit", "withdrawal"];
const MAX_AMOUNT = 100_000_000_000;
const MAX_ENTRIES = 2_000;

class BankrollError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function amount(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value > MAX_AMOUNT) {
    throw new BankrollError(400, `${field} must be a valid amount in minor units.`);
  }
  return value;
}

function settings(input) {
  if (!CURRENCIES.includes(input?.currency)) {
    throw new BankrollError(400, "Choose a supported currency.");
  }
  return {
    currency: input.currency,
    openingBalance: amount(input.openingBalance, "Opening balance"),
  };
}

function entryId(id) {
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw new BankrollError(400, "Choose a valid entry ID.");
  }
  return id;
}

function entry(input, id) {
  const { kind, date, venue, note = "" } = input || {};
  if (!KINDS.includes(kind)) throw new BankrollError(400, "Choose an entry type.");
  if (typeof date !== "string" || !/^(?:19|20)\d\d-\d\d-\d\d$/.test(date)) {
    throw new BankrollError(400, "Enter a valid date.");
  }
  const parsed = new Date(date);
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== date) {
    throw new BankrollError(400, "Enter a valid date.");
  }
  if (typeof note !== "string" || note.length > 240) {
    throw new BankrollError(400, "Use at most 240 characters for the note.");
  }
  const data = { id: entryId(id), kind, date, note: note.trim() };
  if (kind === "cash" || kind === "tournament") {
    if (venue !== undefined && !VENUES.includes(venue)) {
      throw new BankrollError(400, "Choose Online or Live for the playing venue.");
    }
    return {
      ...data,
      ...(venue === undefined ? {} : { venue }),
      buyIn: amount(input.buyIn, "Total buy-ins", kind === "cash" ? 1 : 0),
      cashOut: amount(input.cashOut, "Total cash-out or prizes"),
    };
  }
  if (venue !== undefined) throw new BankrollError(400, "The playing venue applies to poker results only.");
  return { ...data, amount: amount(input.amount, "Transfer", 1) };
}

function summarize(bankroll) {
  if (!bankroll) return null;
  const { currency, openingBalance } = bankroll;
  const entries = [...(bankroll.entries || [])].sort((a, b) => b.date.localeCompare(a.date));
  let pokerProfit = 0;
  let netTransfers = 0;
  for (const item of entries) {
    if (item.kind === "deposit") netTransfers += item.amount;
    else if (item.kind === "withdrawal") netTransfers -= item.amount;
    else pokerProfit += item.cashOut - item.buyIn;
  }
  return {
    currency, openingBalance, entries, pokerProfit, netTransfers,
    balance: openingBalance + netTransfers + pokerProfit,
  };
}

module.exports = { CURRENCIES, KINDS, VENUES, MAX_AMOUNT, MAX_ENTRIES, BankrollError, settings, entryId, entry, summarize };
