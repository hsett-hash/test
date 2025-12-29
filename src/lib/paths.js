const path = require("path");

function resolveFromRepoRoot(relPath) {
  return path.resolve(process.cwd(), relPath);
}

module.exports = { resolveFromRepoRoot };

