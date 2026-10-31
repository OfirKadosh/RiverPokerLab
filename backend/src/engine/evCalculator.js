// backend/src/engine/evCalculator.js

/**
 * חישוב Expected Value (EV) לפעולת השוואה (Call)
 * @param {Number} equity - אחוזי זכייה באחוזים או בשברים (למשל 45 או 0.45)
 * @param {Number} potSize - גודל הקופה הנוכחי לפני ההימור
 * @param {Number} callAmount - הסכום הנדרש להשקעה כדי להשוות
 */
function calculateCallEV(equity, potSize, callAmount) {
  // המרה לאחוזים אם הועבר כמספר שלם (למשל 45 אחוז -> 0.45)
  const eq = equity > 1 ? equity / 100 : equity;
  
  const totalPotAfterCall = potSize + callAmount;
  const ev = (eq * totalPotAfterCall) - callAmount;

  return {
    ev: Number(ev.toFixed(2)),
    isProfitable: ev > 0
  };
}

module.exports = {
  calculateCallEV
};