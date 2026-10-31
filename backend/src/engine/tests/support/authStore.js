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
  async rate(key) {
    const count = (this.rates.get(key) || 0) + 1;
    this.rates.set(key, count);
    return count;
  }
  async reserveVerification(id, data, before) {
    const user = this.users.get(String(id));
    if (!user || (user.verificationSentAt && user.verificationSentAt > before))
      return null;
    Object.assign(user, clone(data));
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
  async completeVerification(id, hash, nonce, channel, now) {
    const user = this.users.get(String(id));
    if (
      !user ||
      user.verificationHash !== hash ||
      user.verificationNonce !== nonce ||
      user.verificationChannel !== channel ||
      user.verificationExpiresAt <= now ||
      user.verificationAttempts > 5
    )
      return null;
    user[channel === "email" ? "emailVerifiedAt" : "phoneVerifiedAt"] =
      clone(now);
    delete user.verificationHash;
    delete user.verificationNonce;
    delete user.verificationExpiresAt;
    return clone(user);
  }
  async cancelVerification(id, hash) {
    const user = this.users.get(String(id));
    if (user?.verificationHash === hash) {
      delete user.verificationHash;
      delete user.verificationNonce;
      delete user.verificationExpiresAt;
    }
  }
}
module.exports = { MemoryAuthStore };
