export function signedValueClass(value: number) {
  if (value > 0) return "value-positive";
  if (value < 0) return "value-negative";
  return undefined;
}
