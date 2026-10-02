#!/bin/bash
# ./scripts/rollback.sh           back to the version deployed before the live one
# ./scripts/rollback.sh <tag>     to a specific version
# ./scripts/rollback.sh --list    versions still on the server
set -e

source ./scripts/env.sh

SSH_KEY="$HOME/.ssh/$SSH_KEY_NAME"

ssh -i $SSH_KEY $SERVER_URL "cd $REMOTE_PATH && bash switch.sh $PROJECT_NAME ${1:-previous}"
