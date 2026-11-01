const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const dotenv = require("dotenv");
const root = path.resolve(__dirname, "..");
const file = path.join(root, ".env.development");
if (!fs.existsSync(file)) {
  console.error("Create backend/.env.development from .env.development.example first. Development never falls back to the live .env.");
  process.exitCode = 1;
} else {
  const values = dotenv.parse(fs.readFileSync(file));
  const env = { ...process.env, ...values, NODE_ENV: "development",
    APP_ENV_FILE: file, APP_DATABASE_NAME: "river_poker_lab_dev" };
  console.info("Development database: river_poker_lab_dev. Production database selection is overridden.");
  const child = spawn(process.execPath, ["src/server.js"], { cwd: root, env, stdio: "inherit" });
  child.on("exit", code => { process.exitCode = code ?? 1; });
  child.on("error", () => { console.error("Cannot start the development server."); process.exitCode = 1; });
  process.once("SIGTERM", () => child.kill("SIGTERM"));
}
