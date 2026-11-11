interface Balance {
  id: string;
  name: string;
  profit: number;
}

interface Transfer {
  from: Balance;
  to: Balance;
  amount: number;
}

export function suggestedTransfers(players: readonly Balance[]): Transfer[] | null {
  if (players.some(({ profit }) => !Number.isSafeInteger(profit))) return null;

  const debtors = players.filter(({ profit }) => profit < 0)
    .map((player) => ({ player, remaining: -player.profit }))
    .sort((a, b) => b.remaining - a.remaining);
  const creditors = players.filter(({ profit }) => profit > 0)
    .map((player) => ({ player, remaining: player.profit }))
    .sort((a, b) => b.remaining - a.remaining);
  const owed = debtors.reduce((sum, balance) => sum + balance.remaining, 0);
  const due = creditors.reduce((sum, balance) => sum + balance.remaining, 0);
  if (!Number.isSafeInteger(owed) || owed !== due) return null;

  const transfers: Transfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.min(debtor.remaining, creditor.remaining);
    transfers.push({ from: debtor.player, to: creditor.player, amount });
    debtor.remaining -= amount;
    creditor.remaining -= amount;
    if (debtor.remaining === 0) debtorIndex += 1;
    if (creditor.remaining === 0) creditorIndex += 1;
  }
  return transfers;
}
