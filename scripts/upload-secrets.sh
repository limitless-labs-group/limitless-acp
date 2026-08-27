#!/usr/bin/env bash
# Uploads ACP secret values from .env into GCP Secret Manager.
#
# Values are passed via temp files (mode 600), never as command arguments,
# so nothing sensitive lands in shell history or the process table.
#
# Requires an active PAM grant for `prod-secrets-manager`
# (roles/secretmanager.secretVersionManager on prod-* secrets).
#
# Usage:  ./scripts/upload-secrets.sh [--dry-run]

set -euo pipefail

PROJECT="brave-nucleus-424014-n9"
ENV_FILE="${ENV_FILE:-.env}"
DRY_RUN="${1:-}"

# <env var in .env>:<secret name in Secret Manager>
MAPPING=(
  "SELLER_AGENT_WALLET_ADDRESS:prod-ACP_SELLER_AGENT_WALLET_ADDRESS"
  "ACP_WALLET_ID:prod-ACP_WALLET_ID"
  "ACP_SIGNER_PRIVATE_KEY:prod-ACP_SIGNER_PRIVATE_KEY"
  "PRIVATE_KEY:prod-ACP_PRIVATE_KEY"
  "LIMITLESS_HMAC_TOKEN_ID:prod-ACP_LIMITLESS_HMAC_TOKEN_ID"
  "LIMITLESS_HMAC_SECRET:prod-ACP_LIMITLESS_HMAC_SECRET"
  "BASE_RPC_URL:prod-ACP_BASE_RPC_URL"
)

[ -f "$ENV_FILE" ] || { echo "No $ENV_FILE found" >&2; exit 1; }

tmp=$(mktemp -d)
chmod 700 "$tmp"
trap 'rm -rf "$tmp"' EXIT

for pair in "${MAPPING[@]}"; do
  env_key="${pair%%:*}"
  secret="${pair##*:}"

  # dotenv-compatible read: strips quotes and inline # comments.
  value=$(ENV_FILE="$ENV_FILE" KEY="$env_key" node -e '
    require("dotenv").config({ path: process.env.ENV_FILE });
    process.stdout.write((process.env[process.env.KEY] || "").trim());
  ')

  if [ -z "$value" ]; then
    echo "SKIP  $secret (no value in $ENV_FILE)"
    continue
  fi

  if [ "$DRY_RUN" = "--dry-run" ]; then
    echo "WOULD UPLOAD  $secret (${#value} bytes)"
    continue
  fi

  f="$tmp/$secret"
  (umask 077; printf '%s' "$value" > "$f")

  if gcloud secrets versions add "$secret" --data-file="$f" --project="$PROJECT" >/dev/null 2>&1; then
    echo "OK    $secret (${#value} bytes)"
  else
    echo "FAIL  $secret — check the PAM grant is active and the secret exists" >&2
  fi
  rm -f "$f"
done
