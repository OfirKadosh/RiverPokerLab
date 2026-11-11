const { Router } = require("express");
const { GameError, uuid, createGame, applyCommand, publicGame } = require("./game");
const { mongoHomeCashStore } = require("./store");

const HISTORY_PAGE_SIZE = 20;

function historyCursor(raw) {
  if (raw === undefined) return null;
  const [date, _id, extra] = typeof raw === "string" ? raw.split("|") : [];
  const updatedAt = new Date(date);
  if (extra !== undefined || !uuid.test(_id) || !Number.isFinite(updatedAt.getTime()) ||
      updatedAt.toISOString() !== date) {
    throw new GameError(400, "Invalid history cursor.");
  }
  return { _id, updatedAt };
}

function homeCashRoutes(store = mongoHomeCashStore()) {
  const router = Router();
  const route = (handler) => async (req, res) => {
    try {
      await handler(req, res, req.user.id);
    } catch (error) {
      if (error instanceof GameError) {
        res.status(error.status).json({ success: false, error: error.message });
      } else {
        console.error("Home cash game request failed", error.name);
        res.status(503).json({ success: false, error: "The game could not be saved or loaded. Please retry." });
      }
    }
  };
  router.get("/", route(async (req, res, ownerId) => {
    const [active, recent] = await Promise.all([
      store.latest(ownerId, "active"), store.latest(ownerId, "closed"),
    ]);
    res.json({ success: true, active: publicGame(active), recent: publicGame(recent) });
  }));
  router.get("/history", route(async (req, res, ownerId) => {
    const rows = await store.history(ownerId, historyCursor(req.query.before), HISTORY_PAGE_SIZE + 1);
    const page = rows.slice(0, HISTORY_PAGE_SIZE);
    const last = page.at(-1);
    const next = rows.length > HISTORY_PAGE_SIZE ? `${last.updatedAt.toISOString()}|${last._id}` : null;
    res.json({
      success: true,
      games: page.map((game) => ({
        id: game._id, name: game.name, closedAt: game.updatedAt, collected: game.settlement.collected,
      })),
      next,
    });
  }));
  router.get("/history/:id", route(async (req, res, ownerId) => {
    if (!uuid.test(req.params.id)) throw new GameError(404, "Game not found.");
    const game = await store.find(ownerId, req.params.id);
    if (game?.status !== "closed") throw new GameError(404, "Game not found.");
    res.json({ success: true, game: {
      id: game._id, name: game.name, closedAt: game.updatedAt, settlement: game.settlement,
    } });
  }));
  router.post("/", route(async (req, res, ownerId) => {
    const game = createGame(ownerId, req.body, new Date());
    if (await store.insert(game)) {
      res.status(201).json({ success: true, game: publicGame(game) });
      return;
    }
    const existing = await store.find(ownerId, game._id);
    if (!existing || existing.openingFingerprint !== game.openingFingerprint) {
      throw new GameError(409, "A game is already open, or this game ID has been used. Reload your game.");
    }
    res.json({ success: true, game: publicGame(existing) });
  }));
  router.post("/:id/actions", route(async (req, res, ownerId) => {
    if (!uuid.test(req.params.id)) throw new GameError(404, "Game not found.");
    const game = await store.find(ownerId, req.params.id);
    if (!game) throw new GameError(404, "Game not found.");
    const next = applyCommand(game, req.body, new Date());
    if (next === game || await store.replace(game, next)) {
      res.json({ success: true, game: publicGame(next) });
      return;
    }
    const current = await store.find(ownerId, req.params.id);
    if (!current) throw new GameError(404, "Game not found.");
    if (applyCommand(current, req.body, new Date()) !== current) {
      throw new GameError(409, "The game changed. Reload and review the latest entries.");
    }
    res.json({ success: true, game: publicGame(current) });
  }));
  return router;
}

module.exports = { homeCashRoutes };
