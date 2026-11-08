# Backend integration status and next steps

> Historical handover for the former Node-RED integration. The current frontend no longer calls those routes; use [FRONTEND_INTEGRATION_STATUS.md](./FRONTEND_INTEGRATION_STATUS.md) for the current LoanOps RPC boundary and outstanding work.

## Verified vs unverified

The LoanOps handover confirms Stage 2 reusable database/business subflows and Stage 3 orchestration happy-path tests in Node-RED. It explicitly says orchestration was exercised from Inject nodes, not a public HTTP endpoint. No Angular operation is currently connected to a verified HTTP API.

The frontend adapter represents the ten known orchestration action names:

1. `START_APPLICATION`
2. `GET_APPLICATION_STATE`
3. `GET_BORROWER_REQUIREMENTS`
4. `UPDATE_APPLICATION_DETAILS`
5. `CHECK_SUBMISSION_READINESS`
6. `SUBMIT_APPLICATION`
7. `ADMIN_APPROVE_APPLICATION`
8. `ADMIN_DISBURSE_LOAN`
9. `REGISTER_APPLICATION_DOCUMENT`
10. `ADMIN_REVIEW_DOCUMENT`

The service uses proposed separated paths in API mode only. Those paths require new Node-RED HTTP In/Response routes (or an equivalent authenticated API service), validation, auth/ownership enforcement, idempotency and verified integration tests first. It does not call the Node-RED editor or PostgreSQL directly.

## Integration steps

1. Use [the current architecture audit](./AUTH_DATA_ARCHITECTURE.md) as the initial inventory of existing HTTP routes, then inspect the live flow and a schema-only PostgreSQL export to confirm request/response contracts. Do not infer the full contract from the limited routes.
2. Implement HTTP endpoints matching [API_CONTRACT.md](./API_CONTRACT.md), with distinct borrower/admin route groups and safe response envelopes. Derive user/admin identity from server-side authenticated session, never request-provided IDs.
3. Verify every action against the existing subflows and transactional DB state; preserve eligibility, completeness, submitted timestamps, approved principal, fixed one-time 30% interest and one-loan-per-application constraint.
4. Add secured CORS, HTTPS, CSRF/session controls, audit logging, rate limiting, webhook authenticity where applicable, error mapping and idempotency. Never publicly expose the Node-RED editor.
5. Keep borrower profiles, applications, and loan/document metadata in local PostgreSQL. Supabase is identity only; Cloudflare R2 is the private file store. Do not apply the old Supabase borrower migration.
6. Add API contract/integration tests and test conflict, retry, duplicate and failure paths. Only then set `mode: 'api'` in the appropriate frontend environment and configure its public API base URL.
7. Reconcile unresolved borrower requirements: student registration evidence, employed-document policy, unemployed confirmation, and passport vs `national_id` completeness.

## Borrower account data

The borrower portal uses Supabase for email/password authentication, but its current `supabase` data mode reads/writes borrower tables and files directly in Supabase. That mode is not appropriate for the intended architecture. Replace it with authenticated Node-RED API calls after the schema, ownership mapping, and route contract are verified.

The Admin Portal remains a separate demo and its Angular routes currently lack a Supabase Auth guard. Admin review, approvals, disbursements, and media require Admin-role protected Node-RED endpoints before the portal can use real data.

## Existing capability gaps

The active flow has a few HTTP routes, but no HTTP application CRUD/submission or Admin-operation route was found. R2 upload-url and confirmation routes exist but bypass authentication/ownership checks and are not safe for real borrower documents. Rejection, request-information, disbursement evidence, repayments/payment verification, reminders and Google Sheets sync remain unimplemented. Existing Sheets reminders must not be shut down until a replacement passes end-to-end tests.

## Borrower Settings and account verification

The Settings frontend now keeps the Supabase Auth email/password section available independently from profile and document loading. It uses the existing `AuthService.updatePassword()` operation; profile and account-document sections report their own unavailable state. There is no confirmed profile GET/PATCH or category-change route, account-document list/upload route, or account-level eligibility response. `POST /api/borrower/profile` exists in Node-RED but its request/response contract and behavior have not been verified, so the browser does not treat it as a profile API.

The current profile and documents storage model was not demonstrated to support reusable account-verification documents: supplied schema information associates documents with application/loan/payment parents. Add a separate, append-only borrower-owned verification record keyed to the existing `customers.id` UUID, then build authenticated APIs that derive ownership from the verified Supabase session. Keep application review documents separate. Do not copy the same account document into each application, delete prior submissions after a category change, or claim eligibility from a file upload alone.

Before enabling uploads, fix or disable `/api/documents/upload-url` and `/api/documents/confirm-upload`: the inspected routes did not perform bearer authorization and ownership checks. Keep object keys private. Add server-side category requirements and eligibility checks before both application creation and submission; client-side blocking is only a usability guard. The Settings UI intentionally blocks new live applications and submission while authoritative account eligibility is unavailable, but this does not replace backend enforcement.

The current requirements route is `GET /borrower/requirements?borrowerType=...`; the client now uses that exact path. Normalize it to `/api/borrower/requirements` only when Node-RED is changed and the new route is tested. The API origin is configured separately from route paths because existing routes do not share one prefix. A valid authenticated requirements response, invalid-category validation response, and borrower profile/document lifecycle still require backend integration tests with an authorized test account.

## Validation performed

On 2026-10-30, `pnpm test` passed (borrower: 14 tests; admin: 1 test), and `pnpm run build` completed for both Angular applications. Live read-only checks returned HTTP 200 from `/api/health`, HTTP 401 without a bearer token from `/borrower/requirements`, and HTTP 404 from `/api/borrower/requirements` and `/api/borrower/applications`. An invalid category was also rejected with 401 before category validation because no authenticated test session was available. No valid authenticated requirements response was tested; do not treat that API path as fully integrated based on the client unit test alone.
