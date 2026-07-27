#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SYNC_CMD="cd $ROOT_DIR && ./scripts/update-platform-doc.sh"
CRON_EXPR="0 */8 * * *"
MANAGED_TAG="# profilepush-doc-sync"
NEW_ENTRY="$CRON_EXPR $SYNC_CMD $MANAGED_TAG"

EXISTING="$(crontab -l 2>/dev/null || true)"
FILTERED="$(printf '%s\n' "$EXISTING" | grep -v "$MANAGED_TAG" || true)"

{
  printf '%s\n' "$FILTERED"
  printf '%s\n' "$NEW_ENTRY"
} | awk 'NF' | crontab -

echo "Installed cron entry: $NEW_ENTRY"
echo "This will sync docs every 8 hours."
