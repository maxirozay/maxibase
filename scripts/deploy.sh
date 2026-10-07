#!/bin/bash
set -e

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/env.sh"

NAME=$PROJECT_NAME
SSH_KEY="$HOME/.ssh/$SSH_KEY_NAME"
TAG="$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
git diff --quiet HEAD || TAG="$TAG-dirty"
IMAGE_NAME="$NAME:$TAG"

echo $TAG

# The project's own Dockerfile and compose.yaml, else the package's. The package's Dockerfile
# brings its own Dockerfile.dockerignore, a project Dockerfile uses the project's .dockerignore.
DOCKERFILE=Dockerfile
[ -f "$DOCKERFILE" ] || DOCKERFILE="$SCRIPT_DIR/../docker/Dockerfile"
COMPOSE=compose.yaml
[ -f "$COMPOSE" ] || COMPOSE="$SCRIPT_DIR/../docker/compose.yaml"

docker build --platform linux/amd64 -f "$DOCKERFILE" -t $IMAGE_NAME .
docker save $IMAGE_NAME > $NAME.tar

scp -i $SSH_KEY $NAME.tar "$COMPOSE" $SERVER_URL:$REMOTE_PATH
scp -i $SSH_KEY "$SCRIPT_DIR/remote/switch.sh" $SERVER_URL:$REMOTE_PATH/switch.sh
ssh -i $SSH_KEY $SERVER_URL "
  cd $REMOTE_PATH && \
  sudo docker load < $NAME.tar && \
  rm -f $NAME.tar && \
  bash switch.sh $NAME $TAG
"
rm -f $NAME.tar
docker rmi $IMAGE_NAME
