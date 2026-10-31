// Regenerate the browser's pure hand-setup helper from the backend source.
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(
  path.join(__dirname, "../src/engine/handSetup.js"),
  "utf8",
);
const browser = source
  .replace(
    /const \{ ValidationError \} = require\(["']\.\/errors["']\);/,
    "const ValidationError = Error;",
  )
  .replace(
    /module\.exports = \{ buildHandSetup \};/,
    "export { buildHandSetup };",
  );
if (browser === source || !browser.includes("export { buildHandSetup }"))
  throw new Error("Could not generate browser helper.");
fs.writeFileSync(
  path.join(__dirname, "../../frontend/src/lib/handSetup.js"),
  browser,
);
