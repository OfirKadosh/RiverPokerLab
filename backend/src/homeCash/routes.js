const { Router } = require("express");
const { GameError, uuid, createGame, applyCommand, publicGame } = require("./game");
const { mongoHomeCashStore } = require("./store");

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
