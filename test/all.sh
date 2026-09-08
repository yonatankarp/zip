#!/bin/sh
set -e
cd "$(dirname "$0")/.."
# The engine suites import the TypeScript source directly (Node strips types),
# so they need no build. The browser suite drives a real bundle: dist-test,
# which differs from the deployed dist only by the ?test hook flag. dist itself
# is built too, and asserted to carry no hook and no reachable solution.
node test/verify.js "${1:-200}"
node test/play.js 40
npm run build
npm run build:test
node test/render.js
