# Autoflex Backend (Phase 0)

NestJS **resource server** for Autoflex. Staff authenticate via **Frevels IAM**; this API verifies RS256 JWTs via JWKS, maps `domainId` → `ServiceCenter` and `sub` → `StaffProfile`, and exposes tenant-scoped business APIs.

Autoflex does **not** issue identity JWTs, handle OTP login, or define RBAC — see [ADR — Frevels IAM Auth](../development-documents/architecture/adr-2026-07-11-frevels-iam-auth.md).

## Prerequisites

- Node.js 18+
- Docker (for local PostgreSQL)
- Frevels IAM running locally (for real JWTs) **or** `LOCAL_JWKS_JSON` for offline/tests

## Durable test workshop

This is the path for the three apps. Postgres keeps the center, the roster, the customers, and every booking across API restarts. `POST /v1/dev/session` still stands in for Frevels IAM.

```bash
docker compose up -d
cp .env.example .env
npm install
npm run migration:run
npm run catalog:import
npm run start:workshop
```

`npm run catalog:import` loads the India car catalogue and nothing else. A new car cannot be saved until that import has run. `npm start` does not import it. `npm run start:workshop` still imports the catalogue while it upserts the demo center, staff, and customers.

API: `http://localhost:3001`  
Swagger: `http://localhost:3001/docs`  
Health: `http://localhost:3001/health`

`start:workshop` upserts the roster on boot. `npm run workshop:bootstrap` does the same upsert without starting the API. Rerunning restores the center card, menu, staff, and customer garages. It does not delete bookings, jobs, or documents. A vehicle's odometer is kept once it has been set.

The first start writes `.workshop/dev-signing-key.json` (gitignored). Dev tokens keep working after a restart until that file is deleted.

Sign in with `POST /v1/dev/session`:

| Who | How |
|-----|-----|
| Apex Auto Garage | The only workshop center (Bengaluru, UPI `apexauto@okhdfcbank`) |
| Meera Iyer, manager | `{"persona":"manager"}` · 9845000001 |
| Arjun Rao, advisor | `{"persona":"advisor"}` · 9845000002 |
| Ravi Kumar, technician | `{"persona":"technician"}` · 9845000003 |
| Sana Sheikh, technician | `{"persona":"technician2"}` · 9845000004 |
| Priya Sharma | `{"phone":"9876543210"}` · Activa `KA01AB1234`, i20 `KA03MN4567` |
| Nikhil Menon | `{"phone":"9845123450"}` · Classic 350 `KA05RE2201` |
| Aisha Khan | `{"phone":"9900887766"}` · Swift `KA02SW4410` |

`npm run start:dev` is the API without the dev-session stand-in, for when Frevels IAM is issuing real tokens. `npm run seed:dev` only maps one IAM domain id and user id; it is not the workshop roster.

### Local memory runtime (no Docker)

```bash
PORT=3001 npm run start:memory
```

Uses pg-mem. It loads the same Apex roster, then adds Speedline, Koramangala, and a scripted morning of jobs. Every restart wipes that database. Boot takes about a minute. Prefer `start:workshop` when bookings should survive.

## Auth flow (verify-only)

```mermaid
sequenceDiagram
  participant SCApp as service-center-app
  participant IAM as Frevels IAM
  participant API as autoflex-backend

  SCApp->>IAM: OTP login
  IAM-->>SCApp: RS256 access JWT
  SCApp->>API: Authorization: Bearer JWT
  API->>IAM: GET /.well-known/jwks.json (cached)
  API->>API: Verify JWT + map domainId/sub
  API-->>SCApp: Tenant-scoped response
```

### JWT claims used

| IAM claim | Autoflex mapping |
|-----------|------------------|
| `domainId` | `ServiceCenter.iamDomainId` (1:1 Phase 0) |
| `sub` | `StaffProfile.iamUserId` |
| `domainApplicationId` | Client app registration in IAM |
| `roles` / `permissions` | Enforced by guards on routes |

Missing or inactive tenant mapping returns **404** (no cross-tenant leakage).

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | HTTP port (default `3001`) |
| `DATABASE_HOST` | Yes | Postgres host |
| `DATABASE_PORT` | Yes | Postgres port |
| `DATABASE_USER` | Yes | Postgres user |
| `DATABASE_PASSWORD` | Yes | Postgres password |
| `DATABASE_NAME` | Yes | Postgres database |
| `IAM_JWKS_URL` | Yes* | IAM JWKS endpoint |
| `JWKS_CACHE_TTL_MS` | No | JWKS cache TTL (default 5m) |
| `IAM_JWT_ISSUER` | No | Optional issuer validation |
| `IAM_JWT_AUDIENCE` | No | Optional audience validation |
| `LOCAL_JWKS_JSON` | No | Inline JWKS for tests/offline only |
| `DATABASE_NAME_TEST` | No | DB name for e2e (default `autoflex_test`) |

\* Not required when `LOCAL_JWKS_JSON` is set (tests/offline).

## Project structure

```
src/
  common/           # Shared enums, DTOs
  database/         # TypeORM data source, migrations, seed
  modules/
    auth/           # JWKS verify, JWT guard, roles/permissions guards
    tenancy/        # ServiceCenter, StaffProfile, domain resolution
    customers/      # Customer, Vehicle entities
    jobs/           # ServiceJob CRUD + status transitions
    events/         # ServiceJobEvent, AuditLog
  test-utils/       # JWT test helpers
test/               # E2E specs + DB helpers
```

## API (Phase 0)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | Public | Health check |
| `POST` | `/v1/jobs` | Bearer + `jobs:create` | Create job (generates `publicToken`) |
| `GET` | `/v1/jobs` | Bearer + `jobs:read` | List/filter/paginate jobs |
| `GET` | `/v1/jobs/:id` | Bearer + `jobs:read` | Job detail |
| `PATCH` | `/v1/jobs/:id` | Bearer + `jobs:update` | Update job fields |
| `PATCH` | `/v1/jobs/:id/status` | Bearer + `jobs:update` | Workflow status transition |
| `DELETE` | `/v1/jobs/:id` | Bearer + `jobs:delete` | Soft-delete job |

Job statuses: `CHECKED_IN`, `INSPECTION`, `AWAITING_APPROVAL`, `IN_PROGRESS`, `QUALITY_CHECK`, `READY_FOR_PICKUP`, `COMPLETED`, `ON_HOLD`, `CANCELLED`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run start:dev` | Dev server with watch (real IAM; no dev session) |
| `npm run start:workshop` | Durable Postgres workshop and `POST /v1/dev/session` |
| `npm run workshop:bootstrap` | Upsert the workshop roster without starting the API |
| `npm run start:memory` | Throwaway pg-mem runtime (resets on exit) |
| `npm run build` | Compile TypeScript |
| `npm run lint` | ESLint |
| `npm test` | Unit tests |
| `npm run test:e2e` | E2E tests (requires Postgres) |
| `npm run migration:run` | Apply migrations |
| `npm run migration:revert` | Revert last migration |
| `npm run seed:dev` | Map one IAM domain and user (not the workshop roster) |

## Testing

E2E tests use **pg-mem** (in-memory Postgres) — no Docker required for `npm run test:e2e`. For local dev and migration verification, use Docker Postgres:

```bash
docker compose up -d
createdb -h localhost -U autoflex autoflex_test   # optional, only if using a separate test DB against real Postgres
npm test
npm run test:e2e
```

E2E tests use a local RSA keypair (`LOCAL_JWKS_JSON`) — no IAM instance required.

## Related docs

- [Technical Architecture](../development-documents/architecture/technical-architecture.md)
- [Phase 0 Repository Plan](../development-documents/architecture/phase-0-repository-plan.md)
- [ADR — Frevels IAM](../development-documents/architecture/adr-2026-07-11-frevels-iam-auth.md)
