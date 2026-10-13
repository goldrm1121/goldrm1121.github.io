#!/usr/bin/env bash
# Stamp a fresh ?v= on every asset URL so browsers never run stale JS/CSS after a deploy
# (GitHub Pages caches assets for 10 minutes).
set -e
cd "$(dirname "$0")/.."
v=$(date +%Y%m%d%H%M%S)
sed -i '' -E "s#(assets/(style\.css|main\.js))(\?v=[0-9]+)?\"#\1?v=$v\"#g" index.html
sed -i '' -E "s#(\./(i18n|scene)\.js)(\?v=[0-9]+)?\"#\1?v=$v\"#g" assets/main.js
echo "asset version $v"
