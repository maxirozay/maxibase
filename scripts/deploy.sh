#!/bin/bash
set -e

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

bash "$SCRIPT_DIR/build.sh" "$@"
bash .release/upload.sh "$@"
rm -rf .release
