#!/bin/bash
# Runs on the server, from the project folder. Recreates the app container from an image
# still on the server; deploy.sh and rollback.sh both go through it.
#
#   switch.sh <name> <tag>       run <name>:<tag>
#   switch.sh <name> previous    run the image deployed before the live one
#   switch.sh <name> --list      list the images that can be run
set -euo pipefail

NAME="$1"
TAG="$2"
KEEP=5

CURRENT=$(cat .active-tag 2>/dev/null || true)
# Tags start with a UTC timestamp, so newest first is a plain reverse sort.
TAGS=$(sudo docker images "$NAME" --format '{{.Tag}}' | grep -v '^latest$' | sort -r || true)

if [ "$TAG" = "--list" ]; then
  echo "$TAGS" | sed "${CURRENT:+s/^$CURRENT\$/& (live)/}"
  exit 0
fi

if [ "$TAG" = "previous" ]; then
  if [ -z "$CURRENT" ]; then
    echo "No live version recorded yet, pass a tag (--list shows them)" >&2
    exit 1
  fi
  TAG=$(echo "$TAGS" | grep -A1 -x "$CURRENT" | sed -n 2p)
  if [ -z "$TAG" ]; then
    echo "No image older than $CURRENT is left on the server" >&2
    exit 1
  fi
fi

if ! sudo docker image inspect "$NAME:$TAG" > /dev/null 2>&1; then
  echo "Image $NAME:$TAG is not on the server (--list shows the ones that are)" >&2
  exit 1
fi

echo "Running $NAME:$TAG (was: ${CURRENT:-unknown})"
sudo docker tag "$NAME:$TAG" "$NAME:latest"
sudo docker compose up -d --force-recreate
echo "$TAG" > .active-tag

# Images in use are refused by rmi, so the live one always survives.
echo "$TAGS" | tail -n +$((KEEP + 1)) | xargs -r -I {} sudo docker rmi "$NAME:{}" > /dev/null 2>&1 || true

echo "Live: $NAME:$TAG"
