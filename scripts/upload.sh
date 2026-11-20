#!/bin/bash
# Uploads a release made by build.sh and switches the server to it. Runs from the release
# folder's copy, so it needs neither the project nor node_modules.
#
#   bash .release/upload.sh [-e .env.name]
set -e

RELEASE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$RELEASE_DIR/env.sh"

NAME=$(cat "$RELEASE_DIR/NAME")
TAG=$(cat "$RELEASE_DIR/TAG")

scp "${SSH_OPTS[@]}" "$RELEASE_DIR/$NAME.tar" "$RELEASE_DIR/compose.yaml" "$RELEASE_DIR/remote/switch.sh" $SERVER_URL:$REMOTE_PATH
ssh "${SSH_OPTS[@]}" $SERVER_URL "
  cd $REMOTE_PATH && \
  sudo docker load < $NAME.tar && \
  rm -f $NAME.tar && \
  bash switch.sh $NAME $TAG
"
