const dayMs = 86_400_000;
const receiptLimit = 256;

class ProgressError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function practiceZone(value) {
  if (typeof value !== "string" || value.length > 80) return "UTC";
  try {
    return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

function practiceDay(now, zone) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: zone, year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(now);
  const part = (type) => Number(parts.find((item) => item.type === type).value);
  return Math.floor(Date.UTC(part("year"), part("month") - 1, part("day")) / dayMs);
}

function progressView(state, now) {
  const {
    answered = 0, correct = 0, correctStreak = 0, bestCorrectStreak = 0,
    dayStreak = 0, bestDayStreak = 0, lastDay, zone,
  } = state || {};
  const activeDays = zone && practiceDay(now, zone) - lastDay <= 1 ? dayStreak : 0;
  const milestones = [
    [answered >= 10, "10 answers"],
    [bestCorrectStreak >= 5, "5 correct in a row"],
    [bestDayStreak >= 3, "3 practice days in a row"],
  ];
  return {
    answered, correct, correctStreak, bestCorrectStreak,
    dayStreak: activeDays, bestDayStreak, zone: zone || null,
    milestones: milestones.filter(([earned]) => earned).map(([, label]) => label),
  };
}

function createPracticeProgress({ read, write }, clock = () => new Date()) {
  return {
    async get(owner) {
      return progressView(await read(owner), clock());
    },

    async record(owner, { id, action, correct, expiresAt, timeZone }) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const state = await read(owner) || {};
        const now = clock();
        const receipts = (state.receipts || []).filter((entry) => entry.expiresAt > +now);
        const replay = receipts.find((entry) => entry.id === id);
        if (replay) return {
          selected: replay.action, progress: progressView(state, now),
          unlockedMilestones: replay.unlockedMilestones ?? [],
        };
        if (expiresAt <= +now) throw new ProgressError(404, "Practice spot expired. Start a new spot.");
        if (receipts.length >= receiptLimit) {
          throw new ProgressError(429, "Practice limit reached for this half hour. Try again later.");
        }

        const zone = state.zone || practiceZone(timeZone);
        const day = practiceDay(now, zone);
        const correctStreak = correct ? (state.correctStreak || 0) + 1 : 0;
        const dayStreak = day <= state.lastDay ? state.dayStreak
          : day === state.lastDay + 1 ? state.dayStreak + 1 : 1;
        const next = {
          version: (state.version || 0) + 1, zone,
          answered: (state.answered || 0) + 1,
          correct: (state.correct || 0) + Number(correct),
          correctStreak, bestCorrectStreak: Math.max(correctStreak, state.bestCorrectStreak || 0),
          lastDay: Math.max(day, state.lastDay ?? day),
          dayStreak, bestDayStreak: Math.max(dayStreak, state.bestDayStreak || 0),
        };
        const previousMilestones = progressView(state, now).milestones;
        const progress = progressView(next, now);
        const unlockedMilestones = progress.milestones.filter((label) => !previousMilestones.includes(label));
        next.receipts = [...receipts, { id, action, expiresAt, unlockedMilestones }];
        if (await write(owner, state.version, next)) {
          return { selected: action, progress, unlockedMilestones };
        }
      }
      throw new ProgressError(503, "Could not save practice progress. Retry your answer.");
    },
  };
}

function mongoPracticeProgress(model = require("../models/User")) {
  return createPracticeProgress({
    async read(owner) {
      const user = await model.findById(owner).select({ practiceProgress: 1, _id: 0 }).lean();
      return user?.practiceProgress;
    },
    async write(owner, version, practiceProgress) {
      const saved = await model.updateOne({
        _id: owner, "practiceProgress.version": version === undefined ? { $exists: false } : version,
      }, { $set: { practiceProgress } }, { timestamps: false });
      return saved.modifiedCount === 1;
    },
  });
}

function memoryPracticeProgress(clock) {
  const states = new Map();
  return createPracticeProgress({
    read: (owner) => states.get(owner),
    write(owner, version, next) {
      if (states.get(owner)?.version !== version) return false;
      states.set(owner, next);
      return true;
    },
  }, clock);
}

module.exports = { mongoPracticeProgress, memoryPracticeProgress, ProgressError };
