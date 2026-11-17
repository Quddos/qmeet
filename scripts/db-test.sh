#!/usr/bin/env bash
# Applies the migrations to a DISPOSABLE database and runs the RLS tests.
# Usage: DATABASE_URL=postgresql://... scripts/db-test.sh
# Never point this at production: it drops and recreates the public schema.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL to a disposable database}"
if [[ "${ALLOW_RESET:-}" != "yes" ]]; then
  echo "Refusing to reset the public schema. Set ALLOW_RESET=yes for a disposable database." >&2
  exit 1
fi
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -c 'drop schema public cascade; create schema public;'
for f in supabase/migrations/*.sql; do psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$f"; done
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql
