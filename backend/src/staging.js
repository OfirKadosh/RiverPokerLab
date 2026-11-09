const { createHash, timingSafeEqual } = require("node:crypto");
const { hashPassword, passwordInput } = require("./auth/security");

const database = "river_poker_lab_staging";
const digest = (value) => createHash("sha256").update(value).digest();

function stagingConfig(env = process.env) {
  if (env.RPL_STAGING !== "true") return null;
  const gate = env.RPL_STAGING_GATE_PASSWORD;
  const passwords = [env.RPL_STAGING_TESTER_A_PASSWORD, env.RPL_STAGING_TESTER_B_PASSWORD];
  if ([gate, ...passwords].some((password) => !/^[A-Za-z0-9_-]{24,128}$/.test(password || "")) ||
      new Set([gate, ...passwords]).size !== 3) {
    throw Error("Staging requires three distinct strong passwords.");
  }

  const uri = new URL(env.MONGO_URI);
  if (env.NODE_ENV !== "production" ||
      env.APP_DATABASE_NAME !== database ||
      !env.RPL_STAGING_DB_HOST ||
      uri.protocol !== "mongodb+srv:" ||
      uri.hostname !== env.RPL_STAGING_DB_HOST ||
      uri.pathname !== `/${database}`) {
    throw Error("Staging requires its designated Atlas host and database.");
  }
  return { gate, passwords };
}

function stagingGate(password) {
  const expected = digest(`staging:${password}`);
  return (req, res, next) => {
    const token = /^Basic ([A-Za-z0-9+/=]+)$/i.exec(req.get("authorization") || "")?.[1];
    if (token && timingSafeEqual(expected, digest(Buffer.from(token, "base64")))) return next();
    res.set("WWW-Authenticate", 'Basic realm="RiverPokerLab Staging", charset="UTF-8"');
    return res.status(401).json({ success: false, error: "Staging access is required." });
  };
}

async function seedStagingUsers(passwords, model = require("./models/User")) {
  for (const [index, suffix] of ["a", "b"].entries()) {
    const username = `tester-${suffix}`;
    const password = passwords[index];
    passwordInput(password);
    await model.updateOne({ usernameKey: username, role: "user" }, {
      $setOnInsert: {
        username,
        usernameKey: username,
        email: `${username}@example.invalid`,
        phone: `+1202555010${index}`,
        role: "user",
        accountApprovedAt: new Date(),
      },
      $set: { passwordHash: await hashPassword(password) },
    }, { upsert: true });
  }
}

module.exports = { stagingConfig, stagingGate, seedStagingUsers };
