const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(
  path.join(__dirname, "../src/engine/betting.js"),
  "utf8",
);
const browser = source
  .replace(
    /const \{ ValidationError \} = require\(["']\.\/errors["']\);/,
    "const ValidationError = Error;",
  )
  .replace(
    /const \{ buildHandSetup \} = require\(["']\.\/handSetup["']\);/,
    'import { buildHandSetup } from "./handSetup.js";',
  )
  .replace(
    /module\.exports = \{ replayBetting \};/,
    "export { replayBetting };",
  );
if (!browser.includes("export { replayBetting }"))
  throw new Error("Could not generate browser betting helper.");
fs.writeFileSync(
  path.join(__dirname, "../../frontend/src/lib/betting.js"),
  browser,
);
