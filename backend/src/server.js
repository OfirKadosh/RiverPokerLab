const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config(process.env.APP_ENV_FILE ? { path: process.env.APP_ENV_FILE } : {});

const Spot = require("./models/Spot");
const {
  ValidationError,
  validateCalculateInput,
} = require("./engine/validation");
const { replayBetting } = require("./engine/betting");
const { validateTableState } = require("./engine/tableState");
const {
  calculationSettings,
  ledgerConfig,
} = require("./engine/analysis");

const { validateTournament } = require("./engine/tournament");

const { createAuth, authConfig } = require("./auth");
const { frontendDirectory, serveFrontend } = require("./hosting");
const { computeForRequest, ComputeError, pool } = require("./compute/pool");
function createApp({ auth = createAuth(), frontendDir = null, databaseReady = () => mongoose.connection.readyState === 1, compute = computeForRequest } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "same-origin");
    next();
  });
  app.use(
    cors({
      origin: (origin, callback) =>
        callback(null, !origin || !!auth.config?.origins.includes(origin)),
      credentials: true,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "X-Requested-With"],
    }),
  );
  app.get("/healthz", (req, res) => {
    const ready = databaseReady();
    res.status(ready ? 200 : 503).json({ status: ready ? "ok" : "unavailable" });
  });
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/auth", auth.router);
  app.use("/api", auth.middleware);

  // Independent tournament valuation; no cards, betting history or database required.
  app.post("/api/icm", async (req, res) => {
    try {
      res.json({ success: true, ...await compute(req, res, "icm", req.body) });
    } catch (error) {
      if (res.destroyed) return;
      if (error instanceof ComputeError) res.set("Retry-After", "1");
      res
        .status(error instanceof ValidationError ? 400 : error instanceof ComputeError ? error.status : 500)
        .json({ success: false, error: error.message });
    }
  });

  // 1. Calculate Equity, EV, and optionally save spot (with validation & gameMode)
  app.post("/api/calculate", async (req, res) => {
    try {
      const {
        players,
        board,
        gameType,
        gameMode,
        iterations,
        potSize,
        callAmount,
        saveSpot,
      } = validateCalculateInput(req.body);
      const tableState = validateTableState(
        req.body.tableState,
        players,
        gameType,
        board,
      );

      const tournament = validateTournament(
        req.body.tournament,
        tableState,
        gameMode,
      );

      let bettingState;
      if (tableState?.betting) {
        bettingState = replayBetting(
          {
            seats: tableState.seats.map((seat) => ({
              id: seat.id,
              startingStack: seat.startingStack,
            })),
            dealerSeatId: tableState.handSetup.dealerSeatId,
            smallBlind: tableState.handSetup.smallBlind,
            bigBlind: tableState.bigBlind,
            gameType,
          },
          tableState.betting.actions,
          board.length,
        );
        if (
          potSize !== bettingState.pot ||
          callAmount !== (bettingState.legal?.toCall || 0)
        )
          throw new ValidationError(
            "Pot and call amount must agree with the replayed betting ledger.",
          );
      }
      const settings = calculationSettings(req.body);
      if (
        req.body.includeDecisionAnalysis !== undefined &&
        typeof req.body.includeDecisionAnalysis !== "boolean"
      )
        throw new ValidationError("includeDecisionAnalysis must be a boolean.");
      const { analysis, decisionAnalysis } = await compute(req, res, "calculate", {
        players, board, gameType, gameMode, iterations, tableState, settings,
        bettingState, tournament, includeDecisionAnalysis: req.body.includeDecisionAnalysis,
      });
      if (res.destroyed) return;
      const { results, rangeStats, sampling, proposals } = analysis;
      const hasRanges = players.some((player) => !Array.isArray(player));
      const playerInputs = players.map((player) =>
        Array.isArray(player) ? { type: "hand", cards: player } : player,
      );

      // חישוב EV בהתאם לסוג המשחק
      const evResults = results.map((resItem) => {
        const eq = resItem.equity / 100;
        let ev = 0;

        if (gameMode === "cash") {
          ev = eq * (potSize + callAmount) - callAmount;
        } else {
          ev = eq * (potSize + callAmount) - callAmount;
        }

        let decision = "Fold";
        if (ev > 0) decision = callAmount === 0 ? "Check / Bet" : "Call";

        return {
          playerIndex: resItem.playerIndex,
          ev: Number(ev.toFixed(2)),
          decision,
        };
      });

      let savedSpotId = null;
      if (saveSpot) {
        const newSpot = new Spot({
          ownerId: req.user.id,
          gameType,
          gameMode,
          players: players.map((player) =>
            Array.isArray(player) ? player : [],
          ),
          ...(hasRanges ? { playerInputs } : {}),
          board,
          potSize,
          callAmount,
          results,
          evResults,
          tableState,
          calculationMethod: settings.method,
          chipUnit: settings.chipUnit,
          payoutSummary: analysis.payoutSummary,
          decisionAnalysis,
          tournament,
        });
        const saved = await newSpot.save();
        savedSpotId = saved._id;
      }

      res.json({
        success: true,
        gameType,
        gameMode,
        iterations,
        ...analysis,
        ...(decisionAnalysis ? { decisionAnalysis } : {}),
        ...(tournament ? { tournament } : {}),
        results,
        rangeStats,
        ...(bettingState ? { bettingState } : {}),
        sampling,
        ...(proposals !== undefined ? { proposals } : {}),
        evResults,
        savedSpotId,
      });
    } catch (err) {
      if (res.destroyed) return;
      if (err instanceof ComputeError) res.set("Retry-After", "1");
      res
        .status(err instanceof ValidationError ? 400 : err instanceof ComputeError ? err.status : 500)
        .json({ success: false, error: err.message });
    }
  });

  // Explicit analysis endpoint: unsupported strategic spots return an explanatory scope result.
  app.post("/api/analyze-decision", async (req, res) => {
    try {
      const input = validateCalculateInput(req.body);
      const settings = calculationSettings(req.body);
      const tableState = validateTableState(
        req.body.tableState,
        input.players,
        input.gameType,
        input.board,
      );
      const tournament = validateTournament(
        req.body.tournament,
        tableState,
        input.gameMode,
      );
      const bettingState = tableState?.betting
        ? replayBetting(
            ledgerConfig(tableState, input.gameType),
            tableState.betting.actions,
            input.board.length,
          )
        : undefined;
      if (
        bettingState &&
        (input.potSize !== bettingState.pot ||
          input.callAmount !== (bettingState.legal?.toCall || 0))
      )
        throw new ValidationError(
          "Pot and call amount must agree with the replayed betting ledger.",
        );
      res.json({
        success: true,
        analysis: await compute(req, res, "decision", {
          ...input,
          tableState,
          settings,
          bettingState,
          tournament,
        }),
      });
    } catch (error) {
      if (res.destroyed) return;
      if (error instanceof ComputeError) res.set("Retry-After", "1");
      res
        .status(error instanceof ValidationError ? 400 : error instanceof ComputeError ? error.status : 500)
        .json({ success: false, error: error.message });
    }
  });

  // Parse with the same authoritative grammar used by the simulation.
  app.post("/api/ranges/preview", async (req, res) => {
    try {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
        throw new ValidationError("Request body must be an object.");
      res.json({
        success: true,
        ...await compute(req, res, "range", req.body),
      });
    } catch (err) {
      if (res.destroyed) return;
      if (err instanceof ComputeError) res.set("Retry-After", "1");
      res
        .status(err instanceof ValidationError ? 400 : err instanceof ComputeError ? err.status : 500)
        .json({ success: false, error: err.message });
    }
  });

  // 2. Get saved spots history
  app.get("/api/spots", async (req, res) => {
    try {
      const spots = await Spot.find({ ownerId: req.user.id })
        .sort({ createdAt: -1 })
        .limit(20);
      res.json({ success: true, spots });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  serveFrontend(app, frontendDir);

  // Return JSON for malformed request bodies, matching the existing API format.
  app.use((err, req, res, next) => {
    if (err.type === "entity.too.large")
      return res
        .status(413)
        .json({
          success: false,
          error: "Request exceeds the 2 MB input limit.",
        });
    if (err.type === "entity.parse.failed") {
      return res
        .status(400)
        .json({
          success: false,
          error: "Request body must contain valid JSON.",
        });
    }
    next(err);
  });

  return app;
}
const app = createApp({ frontendDir: require.main === module ? frontendDirectory() : null });
// Importing the app for tests must not connect to the production database.
if (require.main === module) {
  (async () => {
    try {
      authConfig();
      const delivery = require("./auth/delivery").createDelivery();
      if (
        process.env.NODE_ENV === "production" &&
        !delivery.config.channels.length
      )
        throw Error("Configure at least one production verification channel.");
      const hops = Number(process.env.TRUST_PROXY_HOPS || 0);
      if (!Number.isInteger(hops) || hops < 0 || hops > 2)
        throw Error("TRUST_PROXY_HOPS must be 0, 1 or 2.");
      app.set("trust proxy", hops);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    try {
      await mongoose.connect(process.env.MONGO_URI, process.env.APP_DATABASE_NAME ? { dbName: process.env.APP_DATABASE_NAME } : {});
      await Promise.all([
        Spot.init(),
        require("./models/User").init(),
        require("./models/AuthSession").init(),
        require("./models/AuthRateLimit").init(),
      ]);
      const PORT = process.env.PORT || 5000;
      const server = app.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));
      let stopping = false;
      const stop = () => {
        if (stopping) return;
        stopping = true;
        const deadline = setTimeout(() => process.exit(1), 10000);
        deadline.unref();
        server.close(async () => {
          await pool.close();
          await mongoose.disconnect();
          clearTimeout(deadline);
        });
      };
      process.once("SIGTERM", stop);
      process.once("SIGINT", stop);
    } catch (error) {
      console.error(
        "Startup failed. Check MongoDB connection and index configuration.",
      );
      await mongoose.disconnect();
      process.exitCode = 1;
    }
  })();
}

module.exports = app;
module.exports.createApp = createApp;
