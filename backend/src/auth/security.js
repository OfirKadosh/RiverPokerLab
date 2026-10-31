const {
  scrypt,
  randomBytes,
  timingSafeEqual,
  createHmac,
  createHash,
} = require("node:crypto");
const { promisify } = require("node:util");
const deriveScrypt = promisify(scrypt);
let hashing = false;
const hashQueue = [];
async function derive(...args) {
  if (hashing) {
    if (hashQueue.length >= 8)
      throw new AuthError(503, "Sign-in service is busy. Try again shortly.", "HASH_BUSY");
    await new Promise((resolve) => hashQueue.push(resolve));
  } else hashing = true;
  try {
    return await deriveScrypt(...args);
  } finally {
    const next = hashQueue.shift();
    if (next) next();
    else hashing = false;
  }
}
const PARAMETERS = { N: 1 << 17, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
class AuthError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
function registration(body) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new AuthError(400, "Registration input must be an object.");
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const username =
    typeof body.username === "string" ? body.username.trim() : "";
  const phone =
    typeof body.phone === "string"
      ? body.phone.trim().replace(/[ ()-]/g, "")
      : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new AuthError(400, "Enter a valid email address.");
  if (!/^[A-Za-z0-9_]{3,30}$/.test(username))
    throw new AuthError(
      400,
      "Username must use 3–30 letters, numbers or underscores.",
    );
  if (!/^\+[1-9]\d{7,14}$/.test(phone))
    throw new AuthError(
      400,
      "Use an international phone number, for example +972501234567.",
    );
  passwordInput(body.password);
  if (!["email", "sms"].includes(body.channel))
    throw new AuthError(400, "Choose email or SMS verification.");
  return {
    email,
    username,
    usernameKey: username.toLowerCase(),
    phone,
    password: body.password,
    channel: body.channel,
  };
}
function passwordInput(value) {
  if (
    typeof value !== "string" ||
    [...value].length < 15 ||
    [...value].length > 128 ||
    Buffer.byteLength(value) > 512
  )
    throw new AuthError(
      400,
      "Password must contain 15–128 characters. Spaces and Unicode are allowed.",
    );
}
async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex"),
    key = await derive(password, salt, 64, PARAMETERS);
  return `scrypt$131072$8$1$${salt}$${key.toString("hex")}`;
}
async function checkPassword(password, stored) {
  if (typeof password !== "string" || Buffer.byteLength(password) > 512)
    return false;
  const parts = typeof stored === "string" ? stored.split("$") : [];
  const salt =
    parts.length === 6 ? parts[4] : "00000000000000000000000000000000";
  const key = await derive(password, salt, 64, PARAMETERS);
  const expected =
    parts.length === 6 && /^[a-f0-9]{128}$/.test(parts[5])
      ? Buffer.from(parts[5], "hex")
      : Buffer.alloc(64);
  return timingSafeEqual(key, expected) && parts.length === 6;
}
const token = () => randomBytes(32).toString("base64url");
const tokenHash = (value) => createHash("sha256").update(value).digest("hex");
const codeHash = (secret, userId, nonce, code) =>
  createHmac("sha256", secret)
    .update(`${userId}:${nonce}:${code}`)
    .digest("hex");
function sameHash(a, b) {
  return (
    typeof a === "string" &&
    typeof b === "string" &&
    a.length === b.length &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
function publicUser(user) {
  return {
    id: String(user._id),
    username: user.username,
    email: user.email,
    phone: user.phone,
    manuallyApproved: !!user.accountApprovedAt,
    emailVerified: !!user.emailVerifiedAt,
    phoneVerified: !!user.phoneVerifiedAt,
  };
}
module.exports = {
  AuthError,
  registration,
  passwordInput,
  hashPassword,
  checkPassword,
  token,
  tokenHash,
  codeHash,
  sameHash,
  publicUser,
};
