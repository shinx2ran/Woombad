# Woombad: rules for Claude sessions

## Data safety (the owner's rule, 28 Okt 2026)
Never delete anything without asking the owner in the conversation and getting a yes there first. That covers: SQL
`DELETE`, `TRUNCATE` and `DROP` on the live Supabase project (`dttwvzsetibwwxbkecmy`), deleting rows through the app's
repo in Mode Online, `rm` / `git rm` of tracked files, force-pushes, branch deletion, and the delete methods of GitHub
Actions tools. `.claude/settings.json` lets the routine tools (SQL, tests, git, PRs) run without a permission prompt;
this rule is the guard those rules cannot express, because a permission rule cannot read the SQL text.

## Live database changes
One transaction with `set local lock_timeout = '5s'`; no `DROP` statements (the approval prompt never reaches the
owner and the call times out after 60 s); rehearse on a throwaway local PostgreSQL 16 copy of `supabase/schema.sql`
first (`supabase/tests/run.sh`), then `notify pgrst, 'reload schema';` and verify the objects and row counts. Only
owner/admin members may change prices, deposits or start dates (database guards).

## Checks before any push
`npm run typecheck`, `npm run lint` (30 inherited warnings in `master`; no new ones), `npx vitest run`,
`VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npm run build`, `npx playwright test` (Chromium at
`/opt/pw-browsers/chromium`). Compare the live site with `origin/gh-pages` after a merge.

## Branch and release
Develop on `claude/kos-management-app-kxcb77`, open a PR to `master`, merge once CI is green, then reset the branch to
`master`. Commits carry the attribution trailers given in the session. Never commit keys, tokens or the owner's email.
