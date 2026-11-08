const total = 10000;
const minimum = 100;

// Keep the existing proportions where possible, with whole basis points and bounded shares.
function distribute(weights, sum, lower, upper) {
  let low = 0;
  let high = total;
  for (let step = 0; step < 48; step++) {
    const factor = (low + high) / 2;
    const allocated = weights.reduce((acc, weight, i) => acc + Math.min(upper[i], Math.max(lower[i], weight * factor)), 0);
    if (allocated <= sum) low = factor;
    else high = factor;
  }
  const fractions = weights.map((weight, i) => Math.min(upper[i], Math.max(lower[i], weight * low)));
  const values = fractions.map(Math.floor);
  let remainder = sum - values.reduce((acc, value) => acc + value, 0);
  const order = fractions.map((value, index) => ({ index, fraction: value - values[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (!remainder) break;
    if (values[index] < upper[index]) { values[index]++; remainder--; }
  }
  return values;
}

export function resizeShares(shares, count) {
  const weights = Array.from({ length: count }, (_, i) => shares[i] ?? Math.max(minimum, Math.floor((shares.at(-1) ?? total) / 2)));
  return distribute(weights, total, weights.map(() => minimum), weights.map(() => total)).sort((a, b) => b - a);
}

export function editShare(shares, index, value) {
  if (!Number.isInteger(value) || value < minimum || value > total) throw new Error('יש להזין אחוז בין 1 ל־100.');
  if (value === total || shares.length === 1) return [total];
  if (value * (index + 1) > total) throw new Error('האחוז גבוה מדי למקום הזה. מקומות קודמים צריכים לקבל לפחות אותו אחוז.');
  const count = Math.min(shares.length, index + 1 + Math.floor((total - value * (index + 1)) / minimum));
  if (count === 1) return [total];
  const earlier = shares.slice(0, index);
  const later = shares.slice(index + 1, count);
  const weights = [...earlier, ...later];
  const lower = weights.map((_, i) => i < index ? value : minimum);
  const upper = weights.map((_, i) => i < index ? total : value);
  if (upper.reduce((sum, amount) => sum + amount, 0) < total - value) {
    throw new Error('האחוז נמוך מדי למספר המקומות הנוכחי.');
  }
  const adjusted = distribute(weights, total - value, lower, upper);
  return [...adjusted.slice(0, index).sort((a, b) => b - a), value, ...adjusted.slice(index).sort((a, b) => b - a)];
}
