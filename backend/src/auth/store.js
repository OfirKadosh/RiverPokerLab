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
        { upsert: true, new: true },
      ).lean();
    } catch (error) {
      if (error.code !== 11000) throw error;
      row = await Rate.findOneAndUpdate(
        { _id: key },
        { $inc: { count: 1 } },
        { new: true },
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
      { new: true },
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
      { new: true },
    ).lean();
  }
  completeVerification(id, hash, nonce, channel, now) {
    return User.findOneAndUpdate(
      {
        _id: id,
        verificationHash: hash,
        verificationNonce: nonce,
        verificationChannel: channel,
        verificationExpiresAt: { $gt: now },
        verificationAttempts: { $lte: 5 },
      },
      {
        $set: {
          [channel === "email" ? "emailVerifiedAt" : "phoneVerifiedAt"]: now,
        },
        $unset: {
          verificationHash: 1,
          verificationNonce: 1,
          verificationExpiresAt: 1,
        },
      },
      { new: true },
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
