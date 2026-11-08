const { grantedAccess } = require("../../../auth/access");
const { randomBytes } = require("node:crypto");
const clone = (value) =>
  value === undefined ? undefined : structuredClone(value);
class MemoryAuthStore {
  constructor() {
    this.users = new Map();
    this.sessions = new Map();
    this.rates = new Map();
  }
  async createUser(data) {
    if (
      [...this.users.values()].some(
        (user) =>
          user.email === data.email ||
          user.usernameKey === data.usernameKey ||
          user.phone === data.phone,
      )
    ) {
      const error = Error("duplicate");
      error.code = 11000;
      throw error;
    }
    const user = {
      _id: randomBytes(12).toString("hex"),
      verificationAttempts: 0,
      ...clone(data),
    };
    this.users.set(user._id, user);
    return clone(user);
  }
  async findUser(identifier) {
    return clone(
      [...this.users.values()].find(
        (user) => user.email === identifier || user.usernameKey === identifier,
      ),
    );
  }
  async getUser(id) {
    return clone(this.users.get(String(id)));
  }
  async createSession(data) {
    this.sessions.set(data._id, clone(data));
  }
  async getSession(hash, now) {
    const row = this.sessions.get(hash);
    return row && row.expiresAt > now ? clone(row) : null;
  }
  async deleteSession(hash) {
    this.sessions.delete(hash);
  }
  async consumeSession(hash, now) {
    const row = this.sessions.get(hash);
    return !!row && row.expiresAt > now && this.sessions.delete(hash);
  }
  async listAccounts(after, limit) {
    return [...this.users.values()].filter(user => !after || user._id < after)
      .sort((a, b) => b._id.localeCompare(a._id)).slice(0, limit).map(clone);
  }
  async manageAccount(id, action, now, timeLimitedAccess) {
    const user = this.users.get(id);
    if (!user || user.role === "admin") return false;
    if (action === "grant-access") {
      if (!user.trialStartedAt && !user.accountApprovedAt && !user.emailVerifiedAt && !user.phoneVerifiedAt)
        return false;
      const grant = grantedAccess(now);
      if (!(user.accessUntil > grant.accessUntil)) user.accessUntil = grant.accessUntil;
      user.accessSource = grant.accessSource;
      return true;
    }
    if (user.usernameKey === "ofir") return false;
    if (action === "delete") return this.users.delete(id);
    if (action === "restrict") user.restrictedAt = now;
    if (action === "unrestrict") delete user.restrictedAt;
    if (action === "approve") {
      if (user.accountApprovedAt || user.emailVerifiedAt || user.phoneVerifiedAt ||
          user.verificationDelivery !== "manual" ||
          !(+user.verificationSentAt + 600000 <= +now) || user.verificationExpiresAt > now) return false;
      user.accountApprovedAt = now;
      if (timeLimitedAccess) Object.assign(user, grantedAccess(now));
      await this.cancelVerification(id, user.verificationHash);
    }
    return true;
  }
  async rate(key) {
    const count = (this.rates.get(key) || 0) + 1;
    this.rates.set(key, count);
    return count;
  }
  async reserveVerification(id, data, before) {
    const user = this.users.get(String(id));
    if (!user || user.accountApprovedAt || user.emailVerifiedAt || user.phoneVerifiedAt || (user.verificationSentAt && user.verificationSentAt > before))
      return null;
    Object.assign(user, clone(data));
    if (!data.verificationCiphertext) delete user.verificationCiphertext;
    return clone(user);
  }
  async attemptVerification(id, now) {
    const user = this.users.get(String(id));
    if (
      !user?.verificationHash ||
      user.verificationExpiresAt <= now ||
      user.verificationAttempts >= 5
    )
      return null;
    user.verificationAttempts++;
    return clone(user);
  }
  async completeVerification(id, hash, nonce, channel, now, manual = false) {
    const user = this.users.get(String(id));
    if (
      !user ||
      user.verificationHash !== hash ||
      user.verificationNonce !== nonce ||
      user.verificationChannel !== channel ||
      (user.verificationDelivery === "manual") !== manual ||
      user.verificationExpiresAt <= now ||
      user.verificationAttempts > 5
    )
      return null;
    user[manual ? "accountApprovedAt" : channel === "email" ? "emailVerifiedAt" : "phoneVerifiedAt"] =
      clone(now);
    delete user.verificationHash;
    delete user.verificationNonce;
    delete user.verificationExpiresAt;
    delete user.verificationCiphertext;
    return clone(user);
  }
  async cancelVerification(id, hash) {
    const user = this.users.get(String(id));
    if (user?.verificationHash === hash) {
      delete user.verificationHash;
      delete user.verificationNonce;
      delete user.verificationExpiresAt;
    delete user.verificationCiphertext;
    }
  }
}
module.exports = { MemoryAuthStore };
