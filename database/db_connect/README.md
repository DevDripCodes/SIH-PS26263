# @sih/database-sdk

Internal PostgreSQL and Redis data access package for the SIH backend. TypeScript source is in `src/`; built JavaScript and declarations are generated in `dist/`.

The package exposes domain repositories and services from `src/index.ts`. It does not export the PostgreSQL pool, transaction runner, raw SQL helper, Redis client, or generic cache primitives.

Build with `npm run build`; create a local archive with `npm run pack:local` (output: `artifacts/`). It targets Node.js 20+ and PostgreSQL 14+.

For setup examples, database prerequisites, and schema compatibility notes, see `../SDK_USAGE.md` in the parent `database` folder.
