const mongoose = require("mongoose");
module.exports = mongoose.model(
  "AuthRateLimit",
  new mongoose.Schema({
    _id: String,
    count: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  }),
);
