export const currencies = ["ILS", "USD", "EUR", "GBP"] as const;

export const entryLabels = {
  cash: "Cash session",
  tournament: "Tournament",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
};

export const venueLabels = { online: "Online", live: "Live", unspecified: "Unspecified" };
export type Venue = Exclude<keyof typeof venueLabels, "unspecified">;

export type Currency = (typeof currencies)[number];
export type Kind = keyof typeof entryLabels;
export type Entry = { id: string; date: string; note: string } & (
  | { kind: "cash" | "tournament"; buyIn: number; cashOut: number; venue?: Venue }
  | { kind: "deposit" | "withdrawal"; amount: number }
);
export type Ledger = {
  currency: Currency;
  openingBalance: number;
  balance: number;
  pokerProfit: number;
  netTransfers: number;
  entries: Entry[];
};

export type BankrollFilters = {
  from: string;
  to: string;
  game: "all" | "cash" | "tournament";
  venue: "all" | keyof typeof venueLabels;
};

export const allEntries: BankrollFilters = { from: "", to: "", game: "all", venue: "all" };

export function entryChange(entry: Entry) {
  if ("buyIn" in entry) return entry.cashOut - entry.buyIn;
  return entry.kind === "deposit" ? entry.amount : -entry.amount;
}

export type BalancePoint = { day: number; balance: number };
const dayMs = 86_400_000;
const dayIndex = (date: string) => Date.parse(date) / dayMs;

export function bankrollPeriod(ledger: Ledger, filters: BankrollFilters) {
  const { from, to, game, venue = "all" } = filters;
  if ([from, to].some((date) => date && !/^(?:19|20)\d\d-\d\d-\d\d$/.test(date))) return null;
  if (from && to && from > to) return null;

  const dailyChanges = new Map<string, number>();
  const entries: Entry[] = [];
  let opening = ledger.openingBalance;
  let pokerProfit = 0;
  let netTransfers = 0;
  let sessions = 0;
  const byVenue = {
    online: { profit: 0, sessions: 0 },
    live: { profit: 0, sessions: 0 },
    unspecified: { profit: 0, sessions: 0 },
  };

  for (const entry of ledger.entries) {
    const change = entryChange(entry);
    if (from && entry.date < from) {
      opening += change;
      continue;
    }
    if (to && entry.date > to) continue;

    dailyChanges.set(entry.date, (dailyChanges.get(entry.date) ?? 0) + change);
    if ("buyIn" in entry) {
      if (game !== "all" && game !== entry.kind) continue;
      const entryVenue = entry.venue ?? "unspecified";
      byVenue[entryVenue].profit += change;
      byVenue[entryVenue].sessions += 1;
      if (venue !== "all" && venue !== entryVenue) continue;
      pokerProfit += change;
      sessions += 1;
    } else {
      netTransfers += change;
    }
    entries.push(entry);
  }

  const days = [...dailyChanges.keys()].sort();
  const firstDate = from || days[0] || to;
  const lastDate = to || days[days.length - 1] || from;
  const points: BalancePoint[] = [];
  let closing = opening;
  if (firstDate) {
    points.push({ day: dayIndex(firstDate), balance: opening });
    for (const date of days) {
      closing += dailyChanges.get(date)!;
      points.push({ day: dayIndex(date) + 1, balance: closing });
    }
    const end = dayIndex(lastDate) + 1;
    if (points[points.length - 1].day < end) points.push({ day: end, balance: closing });
  }
  return { entries, pokerProfit, netTransfers, sessions, byVenue, opening, closing, firstDate, lastDate, points };
}
