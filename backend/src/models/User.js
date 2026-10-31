const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    usernameKey: { type: String, required: true, unique: true },
    phone: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    accountApprovedAt: Date,
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
