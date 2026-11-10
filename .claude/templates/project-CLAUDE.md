# <Project name>

<!-- Copy this file to the project's root folder as CLAUDE.md and fill in every <...>.
     Agents read it, so the more precise it is, the less they have to search.
     Delete these comment lines and any section that doesn't apply. -->

<One line: what the app does and who uses it.>
<!-- Example: Store system for Toko Indo HPL: sales, inventory, purchasing, stock opname and reports. The cashier uses it all day. -->

## Stack

- Language / framework: <e.g. Flutter 3, Next.js, Python 3.12>
- Database: <e.g. Supabase (Postgres)>
- Runs on: <e.g. Android phone at the store, web browser>

## Commands

- Install: `<command>`
- Run locally: `<command>`
- Test: `<command>`  <!-- test-runner uses this -->
- Build: `<command>`
- Lint / type-check: `<command>`

## Where things are

| Folder | What's in it |
|---|---|
| `<path>` | <...> |
| `<path>` | <...> |

## Sensitive areas

- **Money and stock logic** (the main session reads every changed line): `<paths>`
- **Database schema and migrations** (main session only): `<e.g. supabase/migrations/>`
- **Login, permissions, security policies** (main session only): `<paths>`
- **Never read or print:** `.env`, `<other secret files>`

## Project rules

- Money: <e.g. amounts are whole rupiah stored as integers; round only at the final total>
- Stock: <e.g. stock changes only through a transaction record, never by editing the quantity directly>
- UI text: <e.g. Bahasa Indonesia>
- Dates: <e.g. DD/MM/YYYY on screen, ISO in the database>

## Done means

- <e.g. tests pass, the app builds, and one manual check of the screen that changed>
