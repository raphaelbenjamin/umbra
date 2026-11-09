#!/bin/bash
set -e
cd "$(dirname "$0")"
source scripts/mac-env.sh
npm run app:build -- --bundles app
echo 'Build: src-tauri/target/release/bundle/macos/Umbra.app'
