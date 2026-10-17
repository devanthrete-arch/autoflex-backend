# Autoflex Backend (Phase 0)

NestJS **resource server** for Autoflex. Staff authenticate via **Frevels IAM**; this API verifies RS256 JWTs via JWKS, maps `domainId` → `ServiceCenter` and `sub` → `StaffProfile`, and exposes tenant-scoped business APIs.

Autoflex does **not** issue identity JWTs, handle OTP login, or define RBAC — see [ADR — Frevels IAM Auth](../development-documents/architecture/adr-2026-07-11-frevels-iam-auth.md).

## Prerequisites

- Node.js 18+
- Docker (for local PostgreSQL)
- Frevels IAM running locally (for real JWTs) **or** `LOCAL_JWKS_JSON` for offline/tests

## Durable test workshop

This is the path for the four client apps. Postgres keeps the center, the roster, the customers, and every booking across API restarts. `POST /v1/dev/session` still stands in for Frevels IAM.

```bash
docker compose up -d
cp .env.example .env
npm install
npm run migration:run
npm run catalog:import
npm run services:import
npm run start:workshop
```

`npm run catalog:import` loads the India car catalogue and nothing else. A new car cannot be saved until that import has run. `npm start` does not import it. `npm run start:workshop` still imports the catalogue while it upserts the demo center, staff, and customers.

API: `http://localhost:3001`  
Swagger: `http://localhost:3001/docs`  
Health: `http://localhost:3001/health`

`start:workshop` upserts the roster on boot. `npm run workshop:bootstrap` does the same upsert without starting the API. Rerunning restores the center card, staff, and customer garages. The demo menu is seeded only when the center has no offerings (including soft-deleted rows), so manager edits and pauses survive restart. It does not delete bookings, jobs, or documents. A vehicle's odometer is kept once it has been set.

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
| `POST` | `/v1/jobs` | Bearer + `jobs:create` | Create job (token generated internally; omitted from response) |
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
| `npm run test:e2e` | HTTP/policy E2E tests using pg-mem |
| `npm run test:support:postgres` | Opt-in AF-010 migration/transaction tests on disposable PostgreSQL |
| `npm run migration:run` | Apply migrations |
| `npm run migration:revert` | Revert last migration |
| `npm run seed:dev` | Map one IAM domain and user (not the workshop roster) |
| `npm run support:preflight` | Read support status counts and incompatible links before migration |
| `npm run intake:preflight` | Read returning-intake conflict counts without personal identifiers; works before migration 0011 |
| `npm run visit-access:preflight` | Read legacy/access/snapshot counts before or after migration 0013 |
| `npm run test:visit-access:postgres` | AF-006 visit-access migration, race and rollback tests on isolated port 55416 |
| `npm run support:provision` | Provision a support profile for an existing IAM identity |

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


## AF-010 central support

Migration `1730000000008` adds the central support queue after the vehicle catalogue. Operators are distinct from customers and center staff; a signed support role/permission and active `support_agent_profiles` mapping are required. Configure `IAM_SUPPORT_DOMAIN_APPLICATION_ID` and `IAM_SUPPORT_DOMAIN_ID` separately from the customer application. Empty configuration disables operator access.

`GET /v1/support/me`, queue/summary/detail/events/roster and explicit command routes power `support-app` (port 5176). Customer conversations are `/v1/me/support-requests/:id/events` and `POST :id/replies`. New commands require `If-Match` and `Idempotency-Key`. Request state, immutable event, receipt and public-action notifications commit together. Customer reads never serialize private notes or operator identities. No SLA/external delivery is promised.

- `npm run support:preflight`: aggregate status and incompatible link report; run and back up the intended target before migrating.
- `npm run support:provision -- --user <IAM-user-id> --name "Display name"`: create a local active mapping in the configured support domain. Existing profiles stay unchanged; provision IAM roles separately.
- Local `workshop:bootstrap` / memory runtime seed named support accounts: `{"actor":"support","phone":"9845000011"}` (Neha), `9845000012` (Kabir), `9845000013` (manager Ananya). Reruns never reactivate disabled support profiles.
- `npm run test:support:postgres`: opt-in transaction/migration suite, fixed disposable `af010_test` database on localhost:55410. It drops that dedicated schema; it never targets the workshop. See the runbook for the disposable Docker command.

[Support runbook](../development-documents/architecture/support-work-queue-runbook.md) · [Current contracts](../development-documents/architecture/api-contracts-v1.md#central-support-work-queue). Real IAM sign-in and production rollout remain separate tracked work.

## AF-001 public tracking

`GET /v1/track/:publicToken` anonymously returns limited status/history, masked registration, ETA and nullable public business `centerPhone`. It excludes note bodies, personal contact details, prices and approval/payment capabilities. Success and controller-error responses use no-store/noindex headers; malformed or unavailable tokens return 404. Completed/cancelled jobs remain readable. No new migration is needed.

The matching customer route is `/t/:token`. Deploy the API privacy/masking changes before or with that website. [Setup, verification and production launch requirements](../development-documents/architecture/public-job-timeline-runbook.md). Focused coverage lives in `test/public-tracking.e2e-spec.ts` and `src/modules/jobs/public-tracking-view.spec.ts`.

### Tracking token replacement (AF-004)

Same-center admin/manager/advisor staff can read `GET /v1/jobs/:id/public-token` with `jobs:read` and replace via `POST /v1/jobs/:id/public-token/rotate` with read/update permission. POST requires strict `If-Match`, `Idempotency-Key` and `{reason}`. Token/version/private audit/non-secret receipt commit together; retries replay the receipt. No notification or public event is written. All non-deleted statuses are allowed. No migration is added.

Run `npm run test:e2e -- --runInBand --testPathPatterns=tracking-token-rotation.e2e` for API coverage. Real transaction tests require the disposable PostgreSQL database named `af004_test` with matching user/password on `127.0.0.1:55404`; then run `AF004_POSTGRES_TEST=true npm run test:e2e -- --runInBand --testPathPatterns=tracking-token-rotation-postgres`. The opt-in suite resets this fixed test database; do not use durable workshop data. [Setup, recovery and rollout runbook](../development-documents/architecture/public-job-timeline-runbook.md#staff-tracking-link-replacement-af-004).

## AF-029 service catalog and packages

Migration `1730000000009` adds the shared activity catalog, versioned menu options, packages, and immutable booking/job scope. Run `npm run services:import` after migrations to import the initial 12 activities. This is separate from the vehicle `catalog:import`; it creates no centers, staff, customers or prices. Neither catalog is loaded by `npm start`. Workshop startup then links two exact, reviewed Apex demo services to their catalog activities without changing their prices; other existing offerings remain unmapped until a manager reviews them.

Admins/managers with `center:manage` configure the menu in the desk's **Services & packages** screen. Menu writes require an explicit `Idempotency-Key`; edits/removal also require `If-Match`. Shared catalog identity, exact service filtering, typed booking selections and package contents are documented in the [contracts](../development-documents/architecture/api-contracts-v1.md) and [runbook](../development-documents/architecture/service-marketplace-runbook.md).

PostgreSQL integration verification uses the isolated fixed target on port 55429, never the normal workshop environment. See the runbook before running `AF029_POSTGRES_TEST=true npm run test:e2e -- --runInBand --testPathPatterns=service-marketplace`.

### Customer discovery location

`GET /v1/marketplace/discovery-config` returns the user-approved Bengaluru fallback and the 15 km GPS radius. Optional `DISCOVERY_DEFAULT_CITY`/`DISCOVERY_DEFAULT_LABEL` override it. Missing/blank city uses Bengaluru; invalid nonblank configuration returns `defaultLocation:null`.

`GET /v1/marketplace/available-services` requires city, exact `postalCode`, or paired coordinates and returns paginated services actually offered in the whole eligible area. PIN may combine with coordinates/radius; city+PIN is rejected. Center search shares the predicates and accepts coordinate-only `nearest`/`farthest` sorts. Distances are straight-line, not travel estimates. The manager's master catalog stays global. Profile location writes require bounded numeric pairs or paired null clearing and can clear postal/state metadata.

`GET /v1/marketplace/postal-locations/:postalCode` resolves a six-digit PIN through the third-party PostalPinCode directory into localities/district/state. The adapter has a five-second timeout, bounded success/not-found cache and request sharing. No coordinates or customer identity are sent/inferred. The customer picker offers PIN lookup or explicit browser location; failures preserve the current area and allow PIN retry, GPS or Skip recovery. City mode remains for configured defaults and saved history.

Migration **1730000000010** adds center gallery `photo_urls` and `google_maps_url`; run migrations before restarting. The desk **More → Location and photos** editor is admin/manager + `center:manage`. It loads the full center profile and PATCHes explicit fields, accepting paired coordinate clears and up to eight gallery URLs. Maps links are validated and displayed, never scraped for coordinates. Existing menus/bookings are preserved. [PIN, distance and gallery delivery](../development-documents/architecture/af-029-pin-distance-gallery-delivery.md).

## Returning-customer intake (AF-006)

Run `npm run intake:preflight`, then migrations before restarting the API. Migration **1730000000011** adds center customer/vehicle canonical keys, revisions and nullable vehicle type, preserving legacy conflicts and unknown types. Preflight reports counts read-only; it never merges, transfers or deletes records.

Desk intake now uses protected exact customer lookup, explicit confirmation and saved vehicle selection. `POST /v1/jobs` requires selected IDs/revisions and one stable `Idempotency-Key`; it returns only `{id,jobNumber,status}`. Vehicle/job/event/audit/receipt commit together. Booking check-in attaches its job atomically and recovers a lost response through that attached job. Backend association, archive/type and active-job checks apply independently of the UI.

New/unlinked reception registration, VAHAN RC verification and global ownership claims/transfers remain pending. A stored association is not verified legal ownership. [Runbook and recovery](../development-documents/architecture/returning-walk-in-runbook.md) · [Live blockers](../development-documents/architecture/af-006-returning-customer-walk-in-scope.md#13-live-execution-status-and-blockers--12-october-2026) · [Isolated regression instructions](./test/AF006.md).

## AF-019 invoicing core — staged development

Migrations `1730000000014` and `1730000000015` add versioned finance configuration, seller/year number counters, immutable invoice/tax snapshots and payment deduplication. They are prepared, not applied to the workshop by this development pass. Before a deployment, run `npm run billing:preflight`; it reads a repeatable snapshot, emits aggregate counts and never repairs or retaxes history. Back up and drain old writers before applying migrations. Legacy bills retain their amounts/numbers and are labelled `LEGACY_BILL`.

`BILLING_V2_ENABLED` defaults to false. Enabling it switches the existing invoice/close commands to explicit preview/issue/exact-invoice payment; unconfigured centers fail closed. A center with any V2 configuration cannot fall back to creating a legacy bill while rollout is disabled. Finance uses the restricted internal configuration API, with a dedicated `IAM_FINANCE_DOMAIN_APPLICATION_ID` and `IAM_FINANCE_DOMAIN_ID`, `finance_operator` / `finance_reviewer`, and separate `billing:configure` / `billing:approve` powers. Draft author cannot approve their own revision. No finance test account or sample GST registration is provisioned into a real center.

The desk's **Invoice and payment** action supports individual/business buyer confirmation, per-line approved classifications, pure preview, immutable numbered issue and full counter payment. V2 issue requires `billing:issue`; payment requires `billing:record-payment` plus `jobs:update`. Both need exactly one `If-Match` and `Idempotency-Key`; writes/audit/receipt commit together. Tax values come only from approved policy, with no universal rate. Policies also require explicit place-of-supply cases (buyer type/state, staff-confirmed service context, approved supply state and evidence basis); unmatched cases are refused. Saved line amount must equal quantity × unit price rounded to a paisa before preview/issue. Legacy charge-kind inference is frozen at issue and never repeated during collection. Payment and PDF readiness are separate: **PDF generation/private delivery, corrections/discounts and IRP integration remain pending**; IRP-required business issue is blocked. Keep real-center activation disabled until these release gates and accountant fixtures pass.

Run `npm test -- --runInBand --testPathPatterns='billing|jwt-finance'` for core tests. Run `AF019_POSTGRES_TEST=true npm run test:e2e -- --runInBand --testPathPatterns=billing-v2` for real transaction tests; it creates/drops only a random `af019_test_*` database using the local PostgreSQL admin connection (override with `AF019_TEST_ADMIN_URL`). It does not migrate or truncate the workshop database. [Delivered behavior, API and remaining work](../development-documents/architecture/af-019-invoicing-core-delivery.md).

### Stable visit access before registration (AF-006)

Migration **1730000000013** adds explicit per-visit view/decision grants and intake/original-billing-recipient snapshots. New walk-in/check-in transactions write them atomically. Customer jobs, decisions and support use active grants; changing a center contact cannot transfer history or invoice responsibility. Customer approval retries reauthorize within their receipt transaction; the response is projected before releasing grant locks, and the customer app sends a stable key. New bills require the saved recipient and intake phone/plate. Notifications follow the original authorized recipient; IAM signup and external delivery are separate work.

Run `npm run visit-access:preflight` before migration and again after cutover. Stop/drain old API writers and back up before applying migrations; mixed old/new writers can create grantless jobs. Do not bulk-link history to repair a missing grant. Migration 0013 was applied to the local workshop on 15 October after a backup; the post-migration preflight found two active grants and no grantless jobs or missing snapshots/recipients. Other environments still need their own backup, preflight and coordinated cutover. [Delivery and remaining blockers](../development-documents/architecture/af-006-visit-access-delivery.md) · [Tests](./test/AF006.md#stable-visit-access-and-reception-prerequisites).

### Working hours and booking slots (AF-009)

After migrations, run `npm run schedule:preflight` before enabling booking traffic in a new environment. This reads existing center schedules and future commitments without changing them. Migration `1730000000012` preserves legacy hours/bookings and defaults to zero advance notice and seven India calendar dates including today. Managers edit **More → Working hours & booking slots** in the desk app.

Backend and customer enforce exact hourly arrival windows, holidays/breaks, notice, horizon and capacity. Schedule commands require a revision and idempotency key; customer booking keys are committed in the same transaction as the reservation. Existing visits are retained when hours/capacity change. Use PostgreSQL for transaction/rollback verification. See [AF-009 test guide](test/AF009.md); `npm run test:scheduling:postgres` targets the isolated test database documented there.

## AF-006 registration and AF-019 invoice completion

Apply migrations through `1730000000018` after backup/preflight and draining old writers.
`npm run billing:preflight` is read-only and reconciles invoice and financial-note payments separately.
`npm run test:completion:postgres` creates and drops a disposable database on the local PostgreSQL server; it never uses the workshop database for test fixtures.

Reception requires `jobs:create` **and** `customers:register`. Customer sign-in/registration stays with IAM; a separate signed, session-bound verified-phone assertion and the customer's explicit consent are required before linking. Set the reception environment variables from `.env.example`. The HTTPS broker contract is proposed, not a shipped Frevels integration. Missing identity configuration blocks linking. A contact/plate match never confers historical visit access or verified vehicle ownership.

V2 invoicing stays off by default. Use a real finance-approved center configuration before live issue. Optional `discounts`, `cancellation` and `corrections` policy sections explicitly enable their respective flows; absence blocks the action. Paid originals stay immutable. Staff propose linked credit/debit notes; additional charges require the original recipient's acceptance, then a separate finance reviewer issues a new numbered note. Full debit-note counter payment is a separate ledger entry. A credit note does not record a refund. IRP-required business documents remain blocked pending a verified provider integration.

For internal finance review, with an authenticated `AUTOFLEX_FINANCE_TOKEN` and `AUTOFLEX_API_URL` supplied securely:

```sh
npm run billing:note -- review <invoice-uuid>
npm run billing:note -- issue <note-uuid> <reviewed-version> <persistent-command-key> <private-evidence-reference>
```

Reuse the exact version, key and evidence for an unknown issue result. Review output contains private billing details; do not redirect it into the repository. The finance principal must have `finance_reviewer` and `billing:approve` in the dedicated configured finance domain/application. This CLI does not approve policy or impersonate an accountant.

Issued invoice/note PDFs use a transactional document intent, a two-minute worker lease and bounded retry. Configure private S3 plus `AWS_REGION` and an IAM role for production. Enable the document worker in at least one API process; concurrent workers are safe. Authorized download requests can also trigger rendering. The filesystem driver is development-only and gitignored. Downloads reauthorize and verify SHA-256; there is no public object URL. Staff with `billing:correct` can restart exhausted failed processing; READY documents are never regenerated.

A protected synthetic demonstration (no operating garage or accountant approval claimed):

```sh
DATABASE_HOST=127.0.0.1 DATABASE_NAME=autoflex_af019_demo npm run migration:run
DATABASE_HOST=127.0.0.1 DATABASE_NAME=autoflex_af019_demo npm run start:invoice-demo
```

This entry refuses production/non-loopback/other database names. It uses development IAM proof and private local PDFs, preserves existing demo jobs/payments, and never enables V2 in the normal workshop process. See `development-documents/architecture/af006-af019-completion.md` in the parent workspace for contracts, examples, browser evidence and remaining live acceptance gates.
