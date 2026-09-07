#!/bin/sh
set -e
cd "$(dirname "$0")/.."
node test/verify.js "${1:-200}"
node test/play.js 40
node test/ui.js 4
node test/render.js
