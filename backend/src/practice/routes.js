const express = require("express");
const { randomUUID } = require("node:crypto");
const { makeRiverSpot, riverDecision } = require("./river");
const { ProgressError, mongoPracticeProgress } = require("./progress");

const lifetime = 30 * 60 * 1000;
const maxSpots = 2000;

function practiceRoutes(compute, progress = mongoPracticeProgress()) {
  const router = express.Router();
  const spots = new Map();
  const fail = (res, status, error) => res.status(status).json({ success: false, error });

  router.get("/progress", async (req, res) => {
    try {
      res.json({ success: true, progress: await progress.get(req.user.id) });
    } catch {
      fail(res, 503, "Practice progress is temporarily unavailable.");
    }
  });

  router.post("/spots", async (req, res) => {
    const { mode } = req.body || {};
    if (mode !== "cash" && mode !== "tournament") return fail(res, 400, "Choose Cash or Tournament.");
    try {
      const { kind, input, question } = makeRiverSpot(mode);
      const decision = riverDecision(mode, await compute(req, res, kind, input));
      if (res.destroyed) return;
      const id = randomUUID();
      const expiresAt = Date.now() + lifetime;
      while (spots.size) {
        const [oldId, oldest] = spots.entries().next().value;
        if (spots.size < maxSpots && oldest.expiresAt > Date.now()) break;
        spots.delete(oldId);
      }
      spots.set(id, { owner: req.user.id, expiresAt, decision });
      res.status(201).json({ success: true, spot: { id, ...question, actions: decision.actions.map(({ type }) => type) } });
    } catch {
      if (!res.destroyed) fail(res, 503, "Practice spot unavailable. Try again.");
    }
  });

  router.post("/spots/:id/answer", async (req, res) => {
    const { action, timeZone } = req.body || {};
    if (action !== "fold" && action !== "call") return fail(res, 400, "Choose Fold or Call.");
    const spot = spots.get(req.params.id);
    if (!spot || spot.owner !== req.user.id || spot.expiresAt <= Date.now()) {
      return fail(res, 404, "Practice spot unavailable. Start a new spot.");
    }
    try {
      const { selected, progress: stats, unlockedMilestones } = await progress.record(req.user.id, {
        id: req.params.id, action, correct: spot.decision.accepted.includes(action), expiresAt: spot.expiresAt, timeZone,
      });
      const result = { ...spot.decision, selected, correct: spot.decision.accepted.includes(selected) };
      return res.json({ success: true, result, progress: stats, unlockedMilestones });
    } catch (error) {
      return error instanceof ProgressError ? fail(res, error.status, error.message)
        : fail(res, 503, "Could not save practice progress. Retry your answer.");
    }
  });

  return router;
}

module.exports = { practiceRoutes };
