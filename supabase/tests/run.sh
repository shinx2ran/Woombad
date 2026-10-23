#!/usr/bin/env bash
# Database tests. Applies supabase/schema.sql to throwaway PostgreSQL databases that stand in for a
# Supabase project (roles, auth, storage and Supabase's default privileges: 00-mock-supabase.sql) and
# runs every suite in three scenarios:
#   fresh    empty database
#   twice    schema.sql applied twice, then once more over the attack-test data (30-reapply.sql)
#   upgrade  v0.2 schema with v0.2 data, then schema.sql (11-upgrade.sql)
# Needs psql as a superuser on PostgreSQL >= 15 with the dblink extension (postgresql-contrib), e.g.
#   PSQL="psql -h localhost -U postgres" supabase/tests/run.sh
# Databases are named ${DB_PREFIX}_<scenario> (default wb_db_test_*), dropped and recreated on each run.
# Prints a summary and exits non-zero if any check fails or any file errors. Logs: $LOG_DIR.
set -uo pipefail
cd "$(dirname "$0")/../.."
PSQL=${PSQL:-psql}
PREFIX=${DB_PREFIX:-wb_db_test}
LOG_DIR=${LOG_DIR:-$(mktemp -d)}
mkdir -p "$LOG_DIR"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"

T=supabase/tests
ATTACKS="$T/20-attack-fixture.sql $T/21-attacks.sql"
LATER="$T/22-skeptic.sql $T/23-redteam.sql $T/24-refund.sql $T/25-backup.sql $T/26-redate.sql"
SUITES="$T/01-harness.sql $T/10-schema-tests.sql $ATTACKS $LATER"
FRESH="$T/00-mock-supabase.sql supabase/schema.sql $SUITES"
TWICE="$T/00-mock-supabase.sql supabase/schema.sql supabase/schema.sql $T/01-harness.sql $T/10-schema-tests.sql $ATTACKS $T/30-reapply.sql $LATER"
UPGRADE="$T/00-mock-supabase.sql $T/fixtures/schema-v0.2.sql $T/01-harness.sql $T/fixtures/seed-v0.2.sql supabase/schema.sql $T/11-upgrade.sql $SUITES"

failed=0
summary=""
run_scenario() {
  local name=$1 files=$2
  local db="${PREFIX}_${name}" log="$LOG_DIR/$name.log" errors="" f counts passed failed_checks
  : > "$log"
  if ! $PSQL -X -q -d postgres -c "drop database if exists $db with (force)" -c "create database $db" >> "$log" 2>&1; then
    summary+=$(printf '%-8s  could not create database %s (see %s)' "$name" "$db" "$log")$'\n'
    failed=1
    return
  fi
  for f in $files; do
    echo "== $f" >> "$log"
    if ! $PSQL -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$f" >> "$log" 2>&1; then
      errors+=" $(basename "$f")"
    fi
  done
  counts=$($PSQL -X -q -At -F ' ' -d "$db" -c "select count(*) filter (where pass), count(*) filter (where not pass) from zz.results" 2>> "$log")
  read -r passed failed_checks <<< "${counts:-0 0}"
  if [ -n "$errors" ] || [ "${failed_checks:-0}" != 0 ] || [ "${passed:-0}" = 0 ]; then
    failed=1
    echo "---- $name: failed checks"
    $PSQL -X -q -d "$db" -f "$T/99-report.sql" 2>&1 | sed 's/^/  /'
    [ -n "$errors" ] && { echo "---- $name: errors (from $log)"; grep -E 'ERROR|FATAL' "$log" | sed 's/^/  /'; }
  fi
  summary+=$(printf '%-8s  %5s passed  %3s failed  %s' "$name" "${passed:-0}" "${failed_checks:-0}" "${errors:+errors in:$errors}")$'\n'
}

run_scenario fresh "$FRESH"
run_scenario twice "$TWICE"
run_scenario upgrade "$UPGRADE"

echo "==== database tests (logs: $LOG_DIR)"
printf '%s' "$summary"
if [ "$failed" != 0 ]; then
  echo "FAILED"
  exit 1
fi
echo "ALL PASSED"
