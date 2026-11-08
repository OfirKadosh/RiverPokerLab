const express = require("express");
const { randomInt } = require("node:crypto");
const { MongoAuthStore } = require("./store");
const { managementRoutes, OWNER } = require("./management");
const { sealCode } = require("./manualCode");
const { TRIAL_DAYS, trialAccess, accessStatus } = require("./access");
const { createDelivery } = require("./delivery");
const {
  AuthError,
  registration,
  hashPassword,
  checkPassword,
  token,
  tokenHash,
  codeHash,
  sameHash,
  publicUser,
} = require("./security");
function authConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const secret = env.AUTH_SECRET || "";
  if (secret.length < 32)
    throw Error("AUTH_SECRET must contain at least 32 characters.");
  const origins = (
    env.APP_ORIGINS ||
    (env.RENDER === "true" ? env.RENDER_EXTERNAL_URL : "") ||
    (production ? "" : "http://localhost:5173,http://127.0.0.1:5173")
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    production &&
    (!origins.length ||
      origins.some((origin) => !origin.startsWith("https://")))
  )
    throw Error("Production APP_ORIGINS must use explicit HTTPS origins.");
  for (const origin of origins)
    if (new URL(origin).origin !== origin)
      throw Error("APP_ORIGINS must contain exact origins without paths.");
  return {
    secret,
    origins,
    secure: production,
    timeLimitedAccess: env.AUTH_TIME_LIMITED_ACCESS === "true",
    cookieName: production ? "__Host-river_session" : "river_session",
  };
}
function createAuth({
  store = new MongoAuthStore(),
  config,
  delivery,
  now = () => new Date(),
} = {}) {
  let problem;
  try {
    config = config || authConfig();
    delivery = delivery || createDelivery();
  } catch (error) {
    problem = error;
  }
  const router = express.Router();
  const originAllowed = (origin, req) =>
    !origin || config?.origins.includes(origin);
  function csrf(req, res, next) {
    if (config?.secure && !req.secure)
      return res.status(400).json({
        success: false,
        error: "HTTPS is required for account access.",
      });
    if (
      !originAllowed(req.get("origin"), req) ||
      req.get("sec-fetch-site") === "cross-site"
    )
      return res
        .status(403)
        .json({ success: false, error: "Request origin is not allowed." });
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (req.get("X-Requested-With") !== "RiverPokerLab" ||
        !req.is("application/json"))
    )
      return res.status(403).json({
        success: false,
        error: "Use the JSON application client for this action.",
      });
    next();
  }
  function ready() {
    if (problem)
      throw new AuthError(
        503,
        "Account services are not configured. Contact the administrator.",
      );
  }
  function rawCookie(req) {
    const item = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${config?.cookieName}=`));
    if (!item) return null;
    const value = item.slice(item.indexOf("=") + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  }
  async function session(req) {
    const raw = rawCookie(req);
    if (!raw) return null;
    ready();
    return store.getSession(tokenHash(raw), now());
  }
  function cookie(res, value, remember, maxAge) {
    res.cookie(config.cookieName, value, {
      httpOnly: true,
      secure: config.secure,
      sameSite: "lax",
      path: "/",
      ...(remember ? { maxAge } : {}),
    });
  }
  function clear(res) {
    res.clearCookie(config.cookieName, {
      httpOnly: true,
      secure: config.secure,
      sameSite: "lax",
      path: "/",
    });
  }
  async function issue(req, res, user, purpose, remember = false) {
    const old = rawCookie(req);
    if (old) await store.deleteSession(tokenHash(old));
    const raw = token(),
      duration =
        purpose === "pending"
          ? 20 * 60 * 1000
          : remember
            ? 30 * 24 * 60 * 60 * 1000
            : 12 * 60 * 60 * 1000;
    const expiresAt = new Date(+now() + duration);
    await store.createSession({
      _id: tokenHash(raw),
      userId: String(user._id),
      purpose,
      remember,
      expiresAt,
    });
    cookie(res, raw, purpose === "authenticated" && remember, duration);
    return { expiresAt, remember, expiresInMs: duration };
  }
  const verified = (user) => !!(user?.accountApprovedAt || user?.emailVerifiedAt || user?.phoneVerifiedAt);
  const canSignIn = user => verified(user) || !!user?.trialStartedAt;
  function identity(user, record) {
    const linked = !!record.switchOwnerId;
    return {
      success: true,
      user: publicUser(user),
      access: accessStatus(user, now(), config.timeLimitedAccess),
      accountSwitch: user.restrictedAt ? undefined : linked
        ? { mode: user.role === "admin" ? "return" : "switch" }
        : user.role !== "admin" && user.usernameKey === OWNER ? { mode: "link" } : undefined,
      session: {
        expiresAt: record.expiresAt,
        remember: record.remember,
        expiresInMs: Math.max(0, +record.expiresAt - +now()),
      },
    };
  }
  function checkAccountHeader(req, record) {
    const expected = req.get("X-River-Account");
    if ((expected || record.switchOwnerId) && expected !== String(record.userId))
      throw new AuthError(409, "The active account changed. Refresh the page.", "ACCOUNT_CHANGED");
  }
  async function requireAccount(req, checkHeader = true) {
    const record = await session(req);
    if (!record || record.purpose !== "authenticated")
      throw new AuthError(401, "Sign in to continue.");
    const user = await store.getUser(record.userId);
    if (!canSignIn(user)) throw new AuthError(401, "Sign in with a verified account.");
    if (checkHeader) checkAccountHeader(req, record);
    return { user, record };
  }
  async function issueSwitch(req, res, record, target, owner, admin) {
    const raw = token();
    const instant = now();
    const expiresAt = new Date(Math.min(+record.expiresAt, +instant + 12 * 60 * 60000));
    if (!await store.consumeSession(tokenHash(rawCookie(req)), instant))
      throw new AuthError(409, "The session changed. Refresh the page.");
    const next = {
      _id: tokenHash(raw),
      userId: String(target._id),
      purpose: "authenticated",
      remember: record.remember,
      expiresAt,
      switchOwnerId: String(owner._id),
      switchAdminId: String(admin._id),
    };
    await store.createSession(next);
    cookie(res, raw, next.remember, +expiresAt - +instant);
    return next;
  }
  function verificationInfo(user) {
    return {
      username: user.username,
      manual: user.verificationDelivery === "manual",
      channel: user.verificationChannel || "email",
      emailHint: user.email ? `${user.email[0]}***@${user.email.split("@")[1]}` : null,
      phoneHint: user.phone ? `***${user.phone.slice(-4)}` : null,
    };
  }
  async function requirePending(req) {
    const record = await session(req);
    if (!record || record.purpose !== "pending")
      throw new AuthError(401, "Sign in again before verifying your account.");
    const user = await store.getUser(record.userId);
    if (!user || canSignIn(user))
      throw new AuthError(401, "Sign in again to continue.");
    return user;
  }
  async function limit(scope, key, maximum, windowMs) {
    const instant = +now(),
      bucket = Math.floor(instant / windowMs),
      id = tokenHash(`${scope}:${key}:${bucket}`);
    const count = await store.rate(id, new Date((bucket + 2) * windowMs));
    if (count > maximum)
      throw new AuthError(
        429,
        "Too many attempts. Please try again later.",
        "RATE_LIMITED",
      );
  }
  async function send(user, channel, req) {
    if (!delivery.config.channels.includes(channel))
      throw new AuthError(400, "This verification channel is unavailable.");
    await limit("verification-send-user", String(user._id), 5, 3600000);
    await limit("verification-send-ip", req.ip, 10, 3600000);
    const code = String(randomInt(0, 100000000)).padStart(8, "0"),
      nonce = token(),
      hash = codeHash(config.secret, String(user._id), nonce, code),
      instant = now();
    const manual = delivery.config.manualChannels?.includes(channel);
    const updated = await store.reserveVerification(
      user._id,
      {
        verificationChannel: channel,
        verificationDelivery: manual ? "manual" : "contact",
        ...(manual && { verificationCiphertext: sealCode(config.secret, user._id, nonce, code) }),
        verificationHash: hash,
        verificationNonce: nonce,
        verificationExpiresAt: new Date(+instant + 10 * 60 * 1000),
        verificationAttempts: 0,
        verificationSentAt: instant,
      },
      new Date(+instant - 60000),
    );
    if (!updated)
      throw new AuthError(
        429,
        "Wait 60 seconds before requesting another code.",
        "RESEND_COOLDOWN",
      );
    try {
      await delivery.send({
        channel,
        to: channel === "email" ? user.email : user.phone,
        userId: String(user._id),
        username: user.username,
        code,
      });
    } catch (error) {
      await store.cancelVerification(user._id, hash);
      const failure = new AuthError(
        503,
        "Verification delivery failed. You can request another code after 60 seconds.",
        "DELIVERY_FAILED",
      );
      failure.verification = verificationInfo(updated);
      throw failure;
    }
    return verificationInfo(updated);
  }
  function route(path, fn) {
    router.post(path, async (req, res) => {
      try {
        ready();
        await fn(req, res);
      } catch (error) {
        const status =
          error instanceof AuthError
            ? error.status
            : error.code === 11000
              ? 409
              : 503;
        res.status(status).json({
          success: false,
          error:
            error instanceof AuthError
              ? error.message
              : error.code === 11000
                ? "Registration details are unavailable. Use different details or sign in."
                : "Account service is temporarily unavailable.",
          ...(error.code && error instanceof AuthError
            ? { code: error.code }
            : {}),
          ...(error.verification ? { verification: error.verification } : {}),
        });
      }
    });
  }
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.use(csrf);
  router.get("/config", (req, res) =>
    res.json({
      success: true,
      channels: problem ? [] : delivery.config.channels,
      development: !problem && delivery.config.development,
      manualChannels: problem ? [] : delivery.config.manualChannels || [],
      configured: !problem,
      trialDays: !problem && config.timeLimitedAccess ? TRIAL_DAYS : undefined,
    }),
  );
  router.get("/me", async (req, res) => {
    try {
      ready();
      const record = await session(req);
      if (!record) return res.json({ success: true, user: null });
      const user = await store.getUser(record.userId);
      if (!user) {
        clear(res);
        return res.json({ success: true, user: null });
      }
      if (record.purpose === "pending")
        return res.json({
          success: true,
          user: null,
          verification: verificationInfo(user),
        });
      if (!canSignIn(user)) {
        clear(res);
        return res.json({ success: true, user: null });
      }
      res.json(identity(user, record));
    } catch (error) {
      res.status(error.status || 503).json({
        success: false,
        error: error.status
          ? error.message
          : "Cannot check your session right now.",
      });
    }
  });
  route("/register", async (req, res) => {
    await limit("register-ip", req.ip, 5, 3600000);
    const selfServe = config.timeLimitedAccess === true;
    const input = registration(req.body, { skipVerificationChannel: selfServe });
    if (!selfServe && !delivery.config.channels.includes(input.channel))
      throw new AuthError(400, "This verification channel is unavailable.");
    const passwordHash = await hashPassword(input.password);
    const user = await store.createUser({
      email: input.email,
      username: input.username,
      usernameKey: input.usernameKey,
      phone: input.phone,
      passwordHash,
      ...(selfServe && trialAccess(now())),
    });
    if (selfServe) {
      const record = await issue(req, res, user, "authenticated");
      return res.status(201).json(identity(user, record));
    }
    await issue(req, res, user, "pending");
    const verification = await send(user, input.channel, req);
    res.status(201).json({ success: true, verification });
  });
  route("/login", async (req, res) => {
    const identifier =
      typeof req.body?.identifier === "string"
        ? req.body.identifier.trim().toLowerCase()
        : "";
    if (
      !identifier ||
      identifier.length > 254 ||
      typeof req.body?.password !== "string" ||
      (req.body.remember !== undefined &&
        typeof req.body.remember !== "boolean")
    )
      throw new AuthError(
        400,
        "Enter a username or email, password and a valid remember-me option.",
      );
    await limit("login-ip", req.ip, 30, 15 * 60000);
    await limit("login-identity", identifier, 10, 15 * 60000);
    const user = await store.findUser(identifier);
    const matched = await checkPassword(req.body.password, user?.passwordHash);
    if (!user || !matched)
      throw new AuthError(401, "Invalid username/email or password.");
    if (!canSignIn(user)) {
      await issue(req, res, user, "pending");
      return res.status(403).json({
        success: false,
        code: "VERIFICATION_REQUIRED",
        error: "Verify your account before signing in.",
        verification: verificationInfo(user),
      });
    }
    const record = await issue(
      req,
      res,
      user,
      "authenticated",
      req.body.remember === true,
    );
    res.json(identity(user, record));
  });
  route("/verification/send", async (req, res) => {
    const user = await requirePending(req);
    if (!["email", "sms"].includes(req.body?.channel))
      throw new AuthError(400, "Choose email or SMS verification.");
    const verification = await send(user, req.body.channel, req);
    res.json({ success: true, verification });
  });
  route("/verification/confirm", async (req, res) => {
    await limit("verify-ip", req.ip, 30, 15 * 60000);
    const user = await requirePending(req);
    if (typeof req.body?.code !== "string" || !/^\d{8}$/.test(req.body.code))
      throw new AuthError(400, "Enter the eight-digit verification code.");
    const attempt = await store.attemptVerification(user._id, now());
    if (!attempt)
      throw new AuthError(
        400,
        "Code expired, already used, or attempt limit reached. Request a new code.",
      );
    const hash = codeHash(
      config.secret,
      String(user._id),
      attempt.verificationNonce,
      req.body.code,
    );
    if (!sameHash(hash, attempt.verificationHash))
      throw new AuthError(400, "Invalid verification code.");
    const completed = await store.completeVerification(
      user._id,
      hash,
      attempt.verificationNonce,
      attempt.verificationChannel,
      now(),
      attempt.verificationDelivery === "manual",
    );
    if (!completed) throw new AuthError(400, "Code expired or already used.");
    const raw = rawCookie(req);
    await store.deleteSession(tokenHash(raw));
    clear(res);
    res.json({
      success: true,
      message: "Account verified. Sign in to continue.",
    });
  });
  route("/logout", async (req, res) => {
    const raw = rawCookie(req);
    if (raw) await store.deleteSession(tokenHash(raw));
    clear(res);
    res.json({ success: true });
  });
  async function middleware(req, res, next) {
    csrf(req, res, async () => {
      try {
        ready();
        const { user } = await requireAccount(req);
        if (user.restrictedAt) throw new AuthError(403, "This account is restricted.", "ACCOUNT_RESTRICTED");
        if (accessStatus(user, now(), config.timeLimitedAccess)?.expired)
          throw new AuthError(403, "Your access has expired. Contact the administrator to renew.", "ACCESS_EXPIRED");
        req.user = publicUser(user);
        next();
      } catch (error) {
        res.status(error instanceof AuthError ? error.status : 503).json({
          success: false,
          error: error instanceof AuthError ? error.message : "Account service is temporarily unavailable.",
          ...(error instanceof AuthError && error.code ? { code: error.code } : {}),
        });
      }
    });
  }
  if (!problem) managementRoutes({ route, requireAccount, issueSwitch, identity, store, config, now, limit });
  return { router, middleware, config, originAllowed };
}
module.exports = { createAuth, authConfig };
