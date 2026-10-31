const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    _id: String,
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    purpose: {
      type: String,
      enum: ["pending", "authenticated"],
      required: true,
    },
    remember: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
);
module.exports = mongoose.model("AuthSession", schema);
