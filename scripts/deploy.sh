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

docker build --platform linux/amd64 -t $IMAGE_NAME .
docker save $IMAGE_NAME > $NAME.tar

scp -i $SSH_KEY $NAME.tar compose.yaml $SERVER_URL:$REMOTE_PATH
scp -i $SSH_KEY "$SCRIPT_DIR/remote/switch.sh" $SERVER_URL:$REMOTE_PATH/switch.sh
ssh -i $SSH_KEY $SERVER_URL "
  cd $REMOTE_PATH && \
  sudo docker load < $NAME.tar && \
  rm -f $NAME.tar && \
  bash switch.sh $NAME $TAG
"
rm -f $NAME.tar
docker rmi $IMAGE_NAME
