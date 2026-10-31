const express = require("express");
const path = require("node:path");
const fs = require("node:fs");
function frontendDirectory(env = process.env) {
  if (env.SERVE_FRONTEND !== "true") return null;
  const directory = path.resolve(__dirname, "../../frontend/dist");
  if (!fs.existsSync(path.join(directory, "index.html")))
    throw Error("Frontend build missing. Run npm run build from the repository root.");
  return directory;
}
function serveFrontend(app, directory) {
  app.use("/api", (req, res) =>
    res.status(404).json({ success: false, error: "API endpoint not found." }),
  );
  if (directory) {
    app.use(express.static(directory, { dotfiles: "deny", index: "index.html" }));
  }
}
module.exports = { frontendDirectory, serveFrontend };
