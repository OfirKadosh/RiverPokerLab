const express = require("express");
module.exports = require("../../../server").createApp({
  compute: async (req, res, kind, input) => require("../../../compute/tasks").executeTask(kind, input),
  auth: {
    router: express.Router(),
    config: { origins: [] },
    middleware(req, res, next) {
      req.user = { id: "000000000000000000000001", username: "EngineFixture" };
      next();
    },
  },
});
