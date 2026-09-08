#!/bin/sh
set -e
cd "$(dirname "$0")/.."
# The engine and daily suites import the TypeScript source directly (Node strips
# types), so they need no build and run in milliseconds. The browser suite drives
# a real bundle: dist-test, which differs from the deployed dist only by the
# ?test hook flag. dist is built too, and asserted to carry no hook.
node test/verify.js "${1:-200}"
node test/play.js 40
node test/daily.js
node test/changelog.js
npm run build
npm run build:test
node test/render.js
