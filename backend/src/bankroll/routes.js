const express = require("express");
const { createBankrollStore } = require("./store");
const { BankrollError, entry, entryId, settings, summarize } = require("./ledger");

function bankrollRoutes(store = createBankrollStore()) {
  const router = express.Router();

  function route(method, path, operation) {
    router[method](path, async (req, res) => {
      try {
        const bankroll = await operation(req.user.id, req);
        res.json({ success: true, bankroll: summarize(bankroll) });
      } catch (error) {
        if (!(error instanceof BankrollError)) {
          return res.status(503).json({ success: false, error: "Bankroll is temporarily unavailable." });
        }
        res.status(error.status).json({ success: false, error: error.message });
      }
    });
  }

  route("get", "/", (ownerId) => store.get(ownerId));
  route("put", "/", (ownerId, req) => store.configure(ownerId, settings(req.body)));
  route("post", "/entries", (ownerId, req) => store.add(ownerId, entry(req.body, req.body?.id)));
  route("put", "/entries/:id", (ownerId, req) => store.edit(ownerId, entry(req.body, req.params.id)));
  route("delete", "/entries/:id", (ownerId, req) => store.remove(ownerId, entryId(req.params.id)));
  return router;
}

module.exports = { bankrollRoutes };
