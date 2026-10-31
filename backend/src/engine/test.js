// --- 4. Testing Range Parser & EV Calculator ---
const { parseRange } = require('./rangeParser');
const { calculateCallEV } = require('./evCalculator');

console.log("4. Testing Range Parser (Parsing 'AA'):");
const parsedPairs = parseRange('AA');
console.log(`Parsed ${parsedPairs.length} hand combos for 'AA'. (Expected: 6)`);

console.log("\n5. Testing EV Calculator:");
// נניח קופה של 100, צריך להשוות 50, ויש לנו 45% Equity
const evResult = calculateCallEV(45, 100, 50);
console.log("EV Calculation Result:", evResult);