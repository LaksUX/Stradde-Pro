const { getDefaultConfig } = require("expo/metro-config")
const { withNativeWind } = require("nativewind/metro")
const path = require("path")

// [decision, docs/MOBILE_MIGRATION_PLAN.md -> repo structure] Phase 3 needs
// src/core's money-math/settlement logic (dependency-free, tested, meant to
// be reused unchanged by this rebuild — see src/core/money.js's own header
// comment) without a separate publish step. Metro only watches/resolves
// files inside its own project root by default, so this widens that to the
// whole poker-night repo, letting mobile/ import `@core/money` etc.
// (see tsconfig.json's `@core/*` path) straight from the real source.
const projectRoot = __dirname
const repoRoot = path.resolve(projectRoot, "..")

const config = getDefaultConfig(projectRoot)

config.watchFolders = [repoRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(repoRoot, "node_modules"),
]

module.exports = withNativeWind(config, { input: "./src/global.css" })
