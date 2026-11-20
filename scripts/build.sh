#!/bin/bash
# Builds the image into .release/ with everything upload.sh needs to deploy it, so the
# upload can run without the project (e.g. in a CI job that has the secrets but no node_modules).
set -e

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/env.sh"

NAME=$PROJECT_NAME
TAG="$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
git diff --quiet HEAD || TAG="$TAG-dirty"
IMAGE_NAME="$NAME:$TAG"
OUT=.release

echo $TAG

# The project's own Dockerfile and compose.yaml, else the package's. The package's Dockerfile
# brings its own Dockerfile.dockerignore, a project Dockerfile uses the project's .dockerignore.
DOCKERFILE=Dockerfile
[ -f "$DOCKERFILE" ] || DOCKERFILE="$SCRIPT_DIR/../docker/Dockerfile"
COMPOSE=compose.yaml
[ -f "$COMPOSE" ] || COMPOSE="$SCRIPT_DIR/../docker/compose.yaml"

rm -rf "$OUT"
docker build --platform linux/amd64 -f "$DOCKERFILE" -t $IMAGE_NAME .

mkdir -p "$OUT/remote"
docker save $IMAGE_NAME > "$OUT/$NAME.tar"
docker rmi $IMAGE_NAME > /dev/null
cp "$COMPOSE" "$OUT/compose.yaml"
cp "$SCRIPT_DIR/upload.sh" "$SCRIPT_DIR/env.sh" "$OUT/"
cp "$SCRIPT_DIR/remote/switch.sh" "$OUT/remote/"
echo "$NAME" > "$OUT/NAME"
echo "$TAG" > "$OUT/TAG"
