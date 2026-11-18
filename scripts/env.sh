ROOT_DIR=$(pwd)
ENV_FILE="$ROOT_DIR/.env"

while [ $# -gt 0 ]; do
  case "$1" in
    -e|--env)
      ENV_FILE="$ROOT_DIR/$2"
      shift 2
      ;;
    *)
      break
      ;;
  esac
done

set -a
if [ -f "$ENV_FILE" ]; then
  . "$ENV_FILE"
fi
set +a
# SSH_KEY is optional: leave it empty to rely on ssh-agent, ~/.ssh/config or
# Tailscale SSH (e.g. in CI), where no key file is used.
SSH_OPTS=()
case "$SSH_KEY" in
  "") ;;
  "~/"*) SSH_OPTS=(-i "$HOME/${SSH_KEY#\~/}") ;;
  /*) SSH_OPTS=(-i "$SSH_KEY") ;;
  *) SSH_OPTS=(-i "$HOME/.ssh/$SSH_KEY") ;;
esac
