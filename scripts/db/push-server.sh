#!/bin/bash
set -eo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/../env.sh"

LOCAL_PORT=5433
REMOTE_PORT=5432
SSH_KEY="$HOME/.ssh/$SSH_KEY_NAME"
CONTROL_SOCKET="/tmp/.${PROJECT_NAME}-db-tunnel.$$"

# Master connection, reused for both the tunnel and the credential read, so this
# authenticates once. -f backgrounds it, -N runs no remote command.
ssh -M -S "$CONTROL_SOCKET" -f -N -L "$LOCAL_PORT:localhost:$REMOTE_PORT" -i "$SSH_KEY" "$SERVER_URL"
trap 'ssh -S "$CONTROL_SOCKET" -O exit "$SERVER_URL" 2>/dev/null || true' EXIT

# The app's own connection string is the single source of truth, so there is no second
# copy of the credentials to keep in sync. Only that one line crosses the wire, and it
# is never written to disk locally.
# -n: read no stdin, so this cannot swallow keystrokes meant for drizzle-kit's prompts.
REMOTE_LINE=$(ssh -n -S "$CONTROL_SOCKET" "$SERVER_URL" "grep -m1 '^NUXT_DB=' $REMOTE_PATH/.env" | tr -d '\r')

if [ -z "$REMOTE_LINE" ]; then
  echo "No NUXT_DB found in $REMOTE_PATH/.env on $SERVER_URL" >&2
  exit 1
fi

# Repoint whatever host the server uses at the local end of the tunnel, leaving the
# credentials byte-for-byte as the server has them.
TUNNELED_DB=$(REMOTE_LINE="$REMOTE_LINE" LOCAL_PORT="$LOCAL_PORT" node -p '
  const raw = process.env.REMOTE_LINE.replace(/^NUXT_DB=/, "").trim().replace(/^["\x27]|["\x27]$/g, "")
  new URL(raw) // the validation pg-connection-string applies; throws on a malformed URL
  const m = raw.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)(.*)$/)
  const end = m[2].search(/[/?#]/)
  const authority = end === -1 ? m[2] : m[2].slice(0, end)
  const tail = end === -1 ? "" : m[2].slice(end)
  const at = authority.lastIndexOf("@")
  process.stderr.write(`Pushing schema to ${authority.slice(at + 1)}${tail.split("?")[0]} on ${process.env.SERVER_URL}\n`)
  if (/ssl/i.test(tail)) process.stderr.write("Note: the connection string sets SSL options, but through the tunnel the host is localhost, so certificate verification may fail. The tunnel is already encrypted.\n")
  m[1] + authority.slice(0, at + 1) + "localhost:" + process.env.LOCAL_PORT + tail
')

NUXT_DB="$TUNNELED_DB" pnpm drizzle-kit push

echo "Migration complete!"
