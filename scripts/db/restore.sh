#!/bin/bash
set -eo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/../env.sh"

BACKUP_PATH="$1"
if [ -z "$BACKUP_PATH" ]; then
  echo "Usage: $0 <backup-file> [age-identity-file]"
  echo "  .age backups need the private key, either as the 2nd argument or in AGE_IDENTITY_FILE."
  exit 1
fi

if [[ "$BACKUP_PATH" == *.age ]]; then
  AGE_IDENTITY_FILE="${2:-$AGE_IDENTITY_FILE}"
  if [ -z "$AGE_IDENTITY_FILE" ]; then
    echo "$BACKUP_PATH is encrypted: pass the age identity file (the key.txt holding age-secret-key-...)" >&2
    exit 1
  fi
  # Decrypt straight into pg_restore so the plaintext dump is never written to disk.
  age -d -i "$AGE_IDENTITY_FILE" "$BACKUP_PATH" | pg_restore --disable-triggers -d "$NUXT_DB"
else
  pg_restore --disable-triggers -d "$NUXT_DB" "$BACKUP_PATH"
fi

echo "Restore complete!"
