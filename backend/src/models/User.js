const mongoose = require("mongoose");
const { CURRENCIES, KINDS } = require("../bankroll/ledger");

const bankrollEntry = new mongoose.Schema({
  id: String,
  kind: { type: String, enum: KINDS },
  date: String,
  note: String,
  amount: Number,
  buyIn: Number,
  cashOut: Number,
}, { _id: false });

const bankroll = new mongoose.Schema({
  currency: { type: String, enum: CURRENCIES },
  openingBalance: Number,
  entries: { type: [bankrollEntry], default: undefined },
}, { _id: false });

const schema = new mongoose.Schema(
  {
    email: { type: String, required: function () { return this.role !== "admin"; }, unique: true },
    username: { type: String, required: true },
    usernameKey: { type: String, required: true, unique: true },
    phone: { type: String, required: function () { return this.role !== "admin"; }, unique: true },
    role: { type: String, enum: ["user", "admin"], default: "user", immutable: true },
    passwordHash: { type: String, required: true },
    bankroll: { type: bankroll, select: false },
    accountApprovedAt: Date,
    restrictedAt: Date,
    trialStartedAt: Date,
    accessUntil: Date,
    accessSource: { type: String, enum: ["trial", "admin"] },
    verificationCiphertext: { type: String, select: false },
    verificationDelivery: { type: String, enum: ["manual", "contact"] },
    emailVerifiedAt: Date,
    phoneVerifiedAt: Date,
    verificationChannel: { type: String, enum: ["email", "sms"] },
    verificationHash: String,
    verificationNonce: String,
    verificationExpiresAt: Date,
    verificationAttempts: { type: Number, default: 0 },
    verificationSentAt: Date,
  },
  { timestamps: true },
);
module.exports = mongoose.model("User", schema);
