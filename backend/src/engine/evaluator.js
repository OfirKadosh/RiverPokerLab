// backend/src/engine/evaluator.js

// קטגוריות הידיים בפוקר (מנמוך לגבוה)
const HandTypes = {
  HIGH_CARD: 1,
  PAIR: 2,
  TWO_PAIR: 3,
  THREE_OF_A_KIND: 4,
  STRAIGHT: 5,
  FLUSH: 6,
  FULL_HOUSE: 7,
  FOUR_OF_A_KIND: 8,
  STRAIGHT_FLUSH: 9,
};

/**
 * מקבל מערך של בדיוק 5 קלפים (מספרים מ-0 עד 51) ומחזיר ציון מספר (Score) להשוואה
 */
function evaluate5CardHand(cards) {
  // מיון הקלפים לפי ערך (Rank) בסדר יורד
  const sortedCards = [...cards].sort((a, b) => Math.floor(b / 4) - Math.floor(a / 4));
  
  const ranks = sortedCards.map(c => Math.floor(c / 4)); // ערכים 0-12
  const suits = sortedCards.map(c => c % 4);             // צבעים 0-3

  const isFlush = suits.every(s => s === suits[0]);
  
  // בדיקת סטרייט (כולל אופציה לסטרייט נמוך A-2-3-4-5)
  let isStraight = false;
  let straightHighRank = -1;

  if (
    ranks[0] - ranks[1] === 1 &&
    ranks[1] - ranks[2] === 1 &&
    ranks[2] - ranks[3] === 1 &&
    ranks[3] - ranks[4] === 1
  ) {
    isStraight = true;
    straightHighRank = ranks[0];
  } 
  // סטרייט נמוך (A-2-3-4-5) -> ערכים: 12, 3, 2, 1, 0
  else if (
    ranks[0] === 12 &&
    ranks[1] === 3 &&
    ranks[2] === 2 &&
    ranks[3] === 1 &&
    ranks[4] === 0
  ) {
    isStraight = true;
    straightHighRank = 3; // הקלף הגבוה בסטרייט הזה הוא 5 (אינדקס 3)
  }

  // ספירת מופעים של כל ערך (לזיהוי זוגות, שלישיות וכו')
  const rankCounts = {};
  for (const r of ranks) {
    rankCounts[r] = (rankCounts[r] || 0) + 1;
  }

  const counts = Object.entries(rankCounts).map(([rank, count]) => ({
    rank: parseInt(rank),
    count
  })).sort((a, b) => b.count - a.count || b.rank - a.rank);

  // זיהוי קטגוריית היד לפי החוקים
  if (isFlush && isStraight) return encodeScore(HandTypes.STRAIGHT_FLUSH, [straightHighRank]);
  if (counts[0].count === 4) return encodeScore(HandTypes.FOUR_OF_A_KIND, [counts[0].rank, counts[1].rank]);
  if (counts[0].count === 3 && counts[1].count === 2) return encodeScore(HandTypes.FULL_HOUSE, [counts[0].rank, counts[1].rank]);
  if (isFlush) return encodeScore(HandTypes.FLUSH, ranks);
  if (isStraight) return encodeScore(HandTypes.STRAIGHT, [straightHighRank]);
  if (counts[0].count === 3) return encodeScore(HandTypes.THREE_OF_A_KIND, [counts[0].rank, counts[1].rank, counts[2].rank]);
  if (counts[0].count === 2 && counts[1].count === 2) return encodeScore(HandTypes.TWO_PAIR, [counts[0].rank, counts[1].rank, counts[2].rank]);
  if (counts[0].count === 2) return encodeScore(HandTypes.PAIR, [counts[0].rank, counts[1].rank, counts[2].rank, counts[3].rank]);

  return encodeScore(HandTypes.HIGH_CARD, ranks);
}

/**
 * פונקציה שעוזרת לייצר ציון מספרי אחיד המשלב את סוג היד והקלפים הגבוהים (Kickers)
 */
function encodeScore(handType, kickers) {
  let score = handType * 10000000;
  let multiplier = 100000;
  for (const kicker of kickers) {
    score += kicker * multiplier;
    multiplier /= 100;
  }
  return score;
}

module.exports = {
  evaluate5CardHand,
  HandTypes
};