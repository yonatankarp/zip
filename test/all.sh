#!/bin/sh
set -e
cd "$(dirname "$0")/.."
# The engine suites import the TypeScript source directly (Node strips types),
# so they need no build. The browser suite drives the built bundle.
node test/verify.js "${1:-200}"
node test/play.js 40
npm run build
node test/render.js
