const User = require("../models/User"),
  Session = require("../models/AuthSession"),
  Rate = require("../models/AuthRateLimit");
const { grantedAccess } = require("./access");
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
  async consumeSession(hash, now) {
    return !!(await Session.findOneAndDelete({ _id: hash, expiresAt: { $gt: now } }));
  }
  listAccounts(after, limit) {
    return User.find(after ? { _id: { $lt: after } } : {})
      .select("username usernameKey role email accountApprovedAt emailVerifiedAt phoneVerifiedAt restrictedAt trialStartedAt accessUntil accessSource verificationDelivery verificationSentAt verificationExpiresAt verificationAttempts verificationHash verificationNonce +verificationCiphertext")
      .sort({ _id: -1 }).limit(limit).lean();
  }
  async manageAccount(id, action, now, timeLimitedAccess) {
    if (action === "grant-access") {
      const { accessUntil, accessSource } = grantedAccess(now);
      return !!(await User.updateOne({
        _id: id, role: { $ne: "admin" },
        $or: [
          { trialStartedAt: { $type: "date" } }, { accountApprovedAt: { $type: "date" } },
          { emailVerifiedAt: { $type: "date" } }, { phoneVerifiedAt: { $type: "date" } },
        ],
      }, { $max: { accessUntil }, $set: { accessSource } })).matchedCount;
    }
    const target = { _id: id, role: { $ne: "admin" }, usernameKey: { $ne: "ofir" } };
    if (action === "delete") return !!(await User.deleteOne(target)).deletedCount;
    if (action === "restrict" || action === "unrestrict") {
      const update = action === "restrict" ? { $set: { restrictedAt: now } } : { $unset: { restrictedAt: 1 } };
      return !!(await User.updateOne(target, update)).matchedCount;
    }
    return !!(await User.updateOne({
      ...target,
      accountApprovedAt: null, emailVerifiedAt: null, phoneVerifiedAt: null,
      verificationDelivery: "manual",
      verificationSentAt: { $lte: new Date(+now - 600000) },
      $or: [{ verificationExpiresAt: null }, { verificationExpiresAt: { $lte: now } }],
    }, {
      $set: { accountApprovedAt: now, ...(timeLimitedAccess && grantedAccess(now)) },
      $unset: { verificationHash: 1, verificationNonce: 1, verificationExpiresAt: 1, verificationCiphertext: 1 },
    })).modifiedCount;
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
        accountApprovedAt: null, emailVerifiedAt: null, phoneVerifiedAt: null,
        $or: [
          { verificationSentAt: { $exists: false } },
          { verificationSentAt: { $lte: before } },
        ],
      },
      { $set: data, ...(!data.verificationCiphertext && { $unset: { verificationCiphertext: 1 } }) },
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
          verificationCiphertext: 1,
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
          verificationCiphertext: 1,
        },
      },
    );
  }
}
module.exports = { MongoAuthStore };
