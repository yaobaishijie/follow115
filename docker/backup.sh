#!/bin/sh
set -eu
stamp="$(date +%Y-%m-%d_%H-%M-%S)"
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "/backups/follow115_${stamp}.dump"
find /backups -type f -name 'follow115_*.dump' -mtime +6 -delete

