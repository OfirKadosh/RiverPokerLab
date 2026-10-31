// backend/src/models/Spot.js
const mongoose = require("mongoose");

// Optional metadata allows restoring the visual table without changing legacy spots.
const TableSeatSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true, min: 0, max: 8 },
    name: { type: String, required: true, maxlength: 40 },
    stack: { type: Number, required: true, min: 0 },
    startingStack: { type: Number, min: Number.MIN_VALUE },
    mode: { type: String, enum: ["hand", "range"] },
    range: String,
    actionRanges: { type: mongoose.Schema.Types.Mixed, default: undefined },
    rangeAction: {
      type: String,
      enum: ["base", "fold", "check", "call", "bet", "raise", "allin"],
    },
    cards: [String],
  },
  { _id: false },
);

const TableStateSchema = new mongoose.Schema(
  {
    seats: [TableSeatSchema],
    heroSeatId: { type: Number, required: true },
    bigBlind: { type: Number, required: true },
    betting: {
      type: new mongoose.Schema(
        { actions: { type: [mongoose.Schema.Types.Mixed], default: [] } },
        { _id: false },
      ),
      default: undefined,
    },
    handSetup: {
      type: new mongoose.Schema(
        {
          dealerSeatId: Number,
          smallBlind: Number,
          bigBlind: Number,
          smallBlindSeatId: Number,
          bigBlindSeatId: Number,
          positions: [
            new mongoose.Schema(
              {
                seatId: Number,
                position: String,
                startingStack: Number,
                posted: Number,
                remaining: Number,
                forcedAllIn: Boolean,
              },
              { _id: false },
            ),
          ],
          preflopOrder: [Number],
          postflopOrder: [Number],
          initialPot: Number,
        },
        { _id: false },
      ),
      default: undefined,
    },
  },
  { _id: false },
);

const SpotSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  title: { type: String, default: "Untitled Spot" },
  gameType: { type: String, enum: ["holdem", "omaha"], default: "holdem" },
  gameMode: { type: String, required: true, default: "cash" }, // הוספת סוג המשחק
  players: [[String]], // למשל: [["Ah", "Ac"], ["Kh", "Kc"]]
  playerInputs: {
    type: [
      new mongoose.Schema(
        {
          type: { type: String, enum: ["hand", "range"], required: true },
          cards: { type: [String], default: undefined },
          range: String,
          actionRanges: {
            type: mongoose.Schema.Types.Mixed,
            default: undefined,
          },
          rangeAction: {
            type: String,
            enum: ["base", "fold", "check", "call", "bet", "raise", "allin"],
          },
        },
        { _id: false },
      ),
    ],
    default: undefined,
  },
  board: [String], // למשל: ["2d", "7s", "Jc"]
  potSize: { type: Number, default: 0 },
  callAmount: { type: Number, default: 0 },
  tableState: { type: TableStateSchema, default: undefined },
  calculationMethod: { type: String, enum: ["auto", "exact", "monteCarlo"] },
  chipUnit: { type: Number },
  payoutSummary: mongoose.Schema.Types.Mixed,
  decisionAnalysis: mongoose.Schema.Types.Mixed,
  tournament: {
    type: new mongoose.Schema(
      {
        fieldConfirmed: Boolean,
        eliminationRule: { type: String, enum: ["starting-stack-split"] },
        tableSeats: [
          new mongoose.Schema(
            { seatId: Number, startingStack: Number },
            { _id: false },
          ),
        ],
        otherPlayers: [
          new mongoose.Schema({ name: String, stack: Number }, { _id: false }),
        ],
        payouts: [Number],
      },
      { _id: false },
    ),
    default: undefined,
  },
  results: Array,
  evResults: Array,
  createdAt: { type: Date, default: Date.now },
});

SpotSchema.index({ ownerId: 1, createdAt: -1 });
module.exports = mongoose.model("Spot", SpotSchema);
