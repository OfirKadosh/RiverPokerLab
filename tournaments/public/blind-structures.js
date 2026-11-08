// Each group ends at a color-up boundary. Higher paces skip intermediate levels.
const early = [200, 300, 400, 500, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000];
const mid = [2500, 3000, 4000, 5000, 6000, 8000, 10000];
const late = [12000, 14000, 16000, 20000, 24000, 30000, 40000];
const high = [50000, 60000, 70000, 80000, 100000, 120000, 150000, 180000, 200000];
const final = [250000, 300000, 400000, 500000, 600000, 800000, 1000000, 1200000, 1500000, 2000000];

export const blindPresets = {
  slow: { label: 'עלייה איטית', minutes: 30, bigBlinds: [...early, ...mid, ...late, ...high, ...final] },
  regular: { label: 'עלייה רגילה', minutes: 20, bigBlinds: [
    200, 300, 400, 600, 800, 1000, 1200, 1600, 2000, 2500, 3000, 4000, 6000, 8000, 10000,
    12000, 16000, 20000, 30000, 40000, 50000, 60000, 80000, 100000, 150000, 200000, ...final,
  ] },
  turbo: { label: 'עלייה מהירה', minutes: 12, bigBlinds: [
    200, 300, 500, 800, 1200, 2000, 3000, 5000, 8000, 10000, 16000, 24000, 40000,
    60000, 80000, 120000, 200000, ...final,
  ] },
  fast: { label: 'עלייה מהירה מאוד', minutes: 8, bigBlinds: [
    200, 400, 800, 1200, 2000, 4000, 6000, 10000, 20000, 40000, 80000, 120000, 200000,
    300000, 500000, 800000, 1200000, 2000000, 3000000, 5000000, 8000000, 12000000, 20000000, 30000000, 50000000,
  ] },
};

export function smallestChip(big) {
  if (big <= 2000) return 100;
  if (big <= 10000) return 500;
  if (big <= 40000) return 1000;
  if (big <= 200000) return 5000;
  return 25000;
}

function level(big, minutes) {
  const chip = smallestChip(big);
  const small = Math.floor(big / 2 / chip) * chip;
  return { small, big, ante: big, minutes };
}

export function presetLevels(preset, minutes = preset.minutes) {
  return preset.bigBlinds.map((big) => level(big, minutes));
}

export function nextPresetLevel(preset, minutes, previousBig) {
  const next = preset.bigBlinds.find((big) => big > previousBig);
  const big = next ?? Math.ceil(previousBig * 1.5 / 25000) * 25000;
  return level(big, minutes);
}
