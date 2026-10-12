#!/usr/bin/env bash
# Applies supabase/schema.sql to a throwaway local PostgreSQL database with a minimal stand-in for
# Supabase's auth/storage objects, then runs the functional tests (signup trigger, invitations, RLS,
# staff restrictions, invoice triggers). Needs a local PostgreSQL where `psql` can connect as a superuser.
#   PSQL="psql -U postgres" ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
PSQL=${PSQL:-psql}
DB=${DB:-woombad_test}
$PSQL -qc "drop database if exists $DB"
$PSQL -qc "create database $DB"
$PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/00-mock-supabase.sql
$PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/schema.sql
$PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/10-schema-tests.sql | grep -E "PASSED|ERROR" || true
