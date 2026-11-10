# Model routing

The main session is the orchestrator. It normally runs on Fable, the most expensive model, so it spends its effort on judgment: understanding the request, deciding, designing and checking. Cheaper subagents do the legwork.

> **If you are a subagent** (another agent started you with a task brief): skip this file. Do your brief and report back.

## New repository

If the repository has no `CLAUDE.md` at its root, offer once to create one from `.claude/templates/project-CLAUDE.md`. Fill in what you can find in the code, and ask the user only for what you can't.

## Agents

| Agent | Model · effort | Use for | Not for |
|---|---|---|---|
| `Explore` | Haiku · medium | Finding files, definitions, usages and call paths; summarizing long files | Judging whether code is correct; edits; commands |
| `test-runner` | Haiku · medium | Running tests, builds, lint and type-checks; reporting failures | Fixing anything |
| `docs-researcher` | Sonnet · medium | Library, framework, API and tool docs from the web | Questions about this codebase |
| `repeater` | Haiku · low | One defined change repeated across many files or items: renames, the same edit everywhere, UI string translations | Anything needing judgment; money or stock values |
| `worker` | Sonnet · medium | Edits with a clear spec: features, fixes with a known cause, tests, refactors | Anything on the keep list |
| `reviewer` | Sonnet · high | Fresh-eyes check of a finished change against its brief | Writing or fixing code |
| `db-agent` (only if installed) | Opus · high | All Supabase work: read-only checks, schema and migration design, RLS policies, applying approved changes | App code |
| Main session | Fable | Planning, design, unclear bugs, the keep list, final sign-off | Bulk reading, log reading, routine edits |

Use `general-purpose` (Sonnet) only when none of the agents above fits. Never spawn `claude`, `Plan` or `fork`: they run on the main session's model. Plan on the main session, with `Explore` for lookups.

## Do it yourself, or delegate?

1. **Do it yourself** when the job is one or two lookups or one small edit. Starting a subagent costs more than that.
2. **Delegate** when the work is bulky (many files, long logs, web pages) or clearly specified.
3. **Keep it on the main session** when it's on the keep list, needs back-and-forth with the user, or depends on so much of this conversation that briefing it would take longer than doing it.

## Keep list: the main session does these itself

- Login, permissions, secrets, `.env` files
- Long-lived choices: new libraries, app structure, folder layout
- Final sign-off on every task

**Database work.** If `db-agent` is in your agent list, all database work goes to it: it shows the exact SQL before any change, and the user's permission prompt is the approval. Take the job back only when db-agent reports it is blocked, has failed twice, or the job needs a business decision. If `db-agent` is not installed, the main session does database work itself and asks the user before any change to a schema, a security policy or live data.

**Money and stock logic** (prices, discounts, totals, HPP and costs, stock quantities, stock opname): `worker` may write it, at effort `high`. Before sign-off, the main session reads every changed line and checks one worked example by hand.

## Writing a brief

A subagent sees nothing of this conversation. Every brief states:

- **Goal:** one sentence.
- **Where:** which files or folders to look at or change.
- **Don't touch:** files, behavior or interfaces to leave alone.
- **Done when:** a condition that can be checked, such as "tests pass" or "returns X for input Y".
- **Known facts:** paths, error text and anything already ruled out, so the agent doesn't rediscover them.

Each agent already has a report format, so ask only for extras. For `Explore`, say how deep to search: quick, medium or very thorough. For `repeater`, give the exact pattern, one finished example, and the full list or search scope. Make the first change yourself if needed and use it as the example.

If an agent stops with a question, answer it from what you know. If the answer changes the result and you don't know it, ask the user. Don't guess for the agent.

## Efficiency

- Bundle related questions into one `Explore` brief instead of starting several small ones.
- Run agents in parallel only when their work is independent, up to 3 at a time. Never put two workers on the same files.
- For a follow-up, message the same worker (SendMessage) instead of starting a new one. It keeps its context.
- When a report cites `file:line`, read just those lines, not the whole file.
- Never pass `fable` as a subagent's model unless the user asks. Besides `db-agent`, which always runs on Opus, pass `opus` only in two cases: the escalation step below, and reviewing money or stock logic. For purely mechanical, repetitive edits, use `repeater` instead of `worker`.
- Pass effort `high` to `worker` for bug fixes in existing code and for money or stock logic.

## Trust, then verify

- **Explore:** findings are leads. Before acting on one that matters, open the cited lines yourself.
- **test-runner:** trust the pass/fail result and the quoted error lines. Treat its guesses about causes as leads.
- **docs-researcher:** check that the version it answered for matches the project's version.
- **worker:** read the diff, and have the tests run before sign-off.
- **repeater:** check that the count matches the scope, open 2–3 changed spots at random, and give skipped items to `worker` or handle them yourself.
- **db-agent:** for anything it changed, check its report against what you asked. If advisor warnings come back, decide whether to fix them before sign-off.
- **reviewer:** its findings are claims to check, not verdicts. Confirm each one before acting on it.

## When to use reviewer

Use it when a change touches 4 or more files or is longer than about 150 lines, when it touches money or stock logic, or when something already went wrong earlier in the task. For money or stock logic, pass model `opus` to the reviewer; this is in addition to your own line-by-line read. Skip it for small, low-risk changes, where reading the diff yourself is enough.

## Escalation

The ladder is Haiku, then Sonnet, then `worker` with model `opus` and effort `high`, then the main session. If an agent fails or reports low confidence, retry once with a better brief. After a second failure, move the job up one level. Never try a third time at the same level.

The Opus step is for work that is clearly specified but hard to get right. Skip it and go straight to the main session when the failure shows the plan itself is wrong, or the job is on the keep list.

## If the main session is not Fable

When the main session runs on Sonnet with Fable as the advisor, consult the advisor before keep-list work and before sign-off. All other rules stay the same.

## Routing note

End each task with one line in this format:

`Routing: Explore ×2 (haiku) · worker (sonnet, 1 retry) · reviewer: 1 real issue · redone on main: none`
