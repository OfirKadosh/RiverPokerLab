const User = require("../models/User"),
  Session = require("../models/AuthSession"),
  Rate = require("../models/AuthRateLimit");
class MongoAuthStore {
  async createUser(data) {
    return (await User.create(data)).toObject();
  }
  findUser(identifier) {
    return User.findOne({
      $or: [{ email: identifier }, { usernameKey: identifier }],
    }).lean();
  }
  getUser(id) {
    return User.findById(id).lean();
  }
  async createSession(data) {
    await Session.create(data);
  }
  getSession(hash, now) {
    return Session.findOne({ _id: hash, expiresAt: { $gt: now } }).lean();
  }
  async deleteSession(hash) {
    await Session.deleteOne({ _id: hash });
  }
  async rate(key, expiresAt) {
    let row;
    try {
      row = await Rate.findOneAndUpdate(
        { _id: key },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
        { upsert: true, returnDocument: "after" },
      ).lean();
    } catch (error) {
      if (error.code !== 11000) throw error;
      row = await Rate.findOneAndUpdate(
        { _id: key },
        { $inc: { count: 1 } },
        { returnDocument: "after" },
      ).lean();
    }
    return row.count;
  }
  reserveVerification(id, data, before) {
    return User.findOneAndUpdate(
      {
        _id: id,
        $or: [
          { verificationSentAt: { $exists: false } },
          { verificationSentAt: { $lte: before } },
        ],
      },
      { $set: data },
      { returnDocument: "after" },
    ).lean();
  }
  attemptVerification(id, now) {
    return User.findOneAndUpdate(
      {
        _id: id,
        verificationExpiresAt: { $gt: now },
        verificationHash: { $exists: true },
        verificationAttempts: { $lt: 5 },
      },
      { $inc: { verificationAttempts: 1 } },
      { returnDocument: "after" },
    ).lean();
  }
  completeVerification(id, hash, nonce, channel, now, manual = false) {
    return User.findOneAndUpdate(
      {
        _id: id,
        verificationHash: hash,
        verificationNonce: nonce,
        verificationChannel: channel,
        verificationDelivery: manual ? "manual" : { $ne: "manual" },
        verificationExpiresAt: { $gt: now },
        verificationAttempts: { $lte: 5 },
      },
      {
        $set: {
          [manual ? "accountApprovedAt" : channel === "email" ? "emailVerifiedAt" : "phoneVerifiedAt"]: now,
        },
        $unset: {
          verificationHash: 1,
          verificationNonce: 1,
          verificationExpiresAt: 1,
        },
      },
      { returnDocument: "after" },
    ).lean();
  }
  async cancelVerification(id, hash) {
    await User.updateOne(
      { _id: id, verificationHash: hash },
      {
        $unset: {
          verificationHash: 1,
          verificationNonce: 1,
          verificationExpiresAt: 1,
        },
      },
    );
  }
}
module.exports = { MongoAuthStore };
