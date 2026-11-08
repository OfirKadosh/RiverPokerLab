const { createCipheriv, createDecipheriv, createHmac, randomBytes } = require("node:crypto");

function key(secret) {
  return createHmac("sha256", secret).update("river-manual-activation-v1").digest();
}

function sealCode(secret, userId, nonce, code) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(Buffer.from(`${userId}:${nonce}`));
  const value = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), value]).toString("base64url");
}

function readCode(secret, user, now) {
  if (!user.verificationCiphertext || user.verificationDelivery !== "manual" ||
      !user.verificationHash || !(user.verificationExpiresAt > now) ||
      user.verificationAttempts >= 5) return null;

  try {
    const value = Buffer.from(user.verificationCiphertext, "base64url");
    const cipher = createDecipheriv("aes-256-gcm", key(secret), value.subarray(0, 12));
    cipher.setAAD(Buffer.from(`${user._id}:${user.verificationNonce}`));
    cipher.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

module.exports = { sealCode, readCode };
