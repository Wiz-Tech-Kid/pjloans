# Proposed frontend application API contract

> Historical proposal only. The current frontend does not call these Node-RED routes; its former HTTP adapter was removed. Treat the route inventory as an audit snapshot, not as evidence of currently deployed or supported behavior. See [the current integration status](./FRONTEND_INTEGRATION_STATUS.md).

**Status:** proposed contract for the complete frontend API. The active Node-RED flow also has the limited HTTP routes listed below, but these do not implement this full contract. The Angular API adapter does not claim the proposed routes are deployed. The Node-RED editor URL is not an API.

## Existing Node-RED HTTP routes

These six routes were found in the inspected active flow. Inject-node actions are not HTTP endpoints.

| Method | Path | Verified boundary |
|---|---|---|
| `GET` | `/api/health` | Responds without authentication; health check only. |
| `GET` | `/borrower/requirements` | Enters the auth/role subflow and returned 401 without a bearer token. |
| `GET` | `/api/test/auth` | Enters the auth/role subflow and returned 401 without a bearer token. |
| `POST` | `/api/borrower/profile` | Enters the auth/role subflow, then a local PostgreSQL profile upsert; not invoked during the audit. |
| `POST` | `/api/documents/upload-url` | Generates an R2 presigned upload URL but bypasses the auth/role subflow. |
| `POST` | `/api/documents/confirm-upload` | Checks an R2 object and registers metadata but bypasses the auth/role subflow. |

The R2 routes do not establish caller identity or application ownership; do not use them with real borrower documents until they are secured server-side. The auth subflow's `pjloans_session_is_active` RPC implementation remains unverified. No application CRUD/submission or Admin-operation HTTP routes were found.

The previous frontend used a Node-RED API origin, with explicit route paths because that server mixed prefixes. Those route checks are historical observations from 2026-10-30, not current frontend behavior: the Borrower Portal no longer calls these routes. The historical checks confirmed `/api/health` returned 200, unauthenticated `/borrower/requirements` returned 401, and `/api/borrower/applications` plus `/api/borrower/requirements` returned 404. A valid authenticated borrower response was not tested.

`POST /api/borrower/profile` is the only currently found profile route. Its flow enters the auth/role subflow and upserts a local profile, but its request contract was not invoked or verified. There is no confirmed profile read/update/category-change route, no account-document route, and no account eligibility response. The Settings UI therefore reports those sections as unavailable rather than calling proposed routes.

## Shared response types

Success: `{ "success": true, "data": <operation result> }`

Failure: `{ "success": false, "error": { "code": "VALIDATION_ERROR | NOT_FOUND | CONFLICT | UNAUTHORIZED | FORBIDDEN | INTERNAL", "message": "safe user-facing description", "details": {} } }`

Use HTTP 200/201 for success, 400 for invalid input, 401/403 for access failure, 404 for missing resource, 409 for eligibility/state/idempotency conflicts, and 5xx for service failure. Never return SQL errors, secrets or internal stack traces to browsers.

## Borrower routes (proposed)

| Route | Request | Node-RED action | Notes |
|---|---|---|---|
| `GET /api/borrower/requirements?borrowerType=...` | `STUDENT`, `EMPLOYED`, or `UNEMPLOYED` | `GET_BORROWER_REQUIREMENTS` | Preferred normalized route; the existing authenticated route is `/borrower/requirements` and the client currently targets it. Preserve unemployed confirmation flags. |
| `POST /api/borrower/applications` | validated borrower fields, category, amount, receiving fields | `START_APPLICATION` | Derive sender/customer server-side; do not trust a supplied customer ID. Return active-app/outstanding-loan conflict instead of creating a duplicate. |
| `GET /api/borrower/applications` | authenticated session/sender context only | `GET_APPLICATION_STATE` | Return only the current borrower's application(s). No arbitrary customer selector. |
| `PUT /api/borrower/applications/{id}` | whitelisted details and current step | `UPDATE_APPLICATION_DETAILS` | Check borrower ownership; update only permitted fields. |
| `POST /api/borrower/applications/{id}/readiness` | no caller-trusted owner ID | `CHECK_SUBMISSION_READINESS` | Return missing fields/documents, account verification and requirements confirmation. |
| `POST /api/borrower/applications/{id}/submit` | no caller-trusted owner ID | `SUBMIT_APPLICATION` | Backend readiness validation is authoritative. Preserve first submitted timestamp on repeats. |
| `POST /api/borrower/applications/{id}/documents` | document metadata only, when supported | `REGISTER_APPLICATION_DOCUMENT` | Application documents are separate from account-verification documents. Return 501/disabled until storage exists. |

### Proposed account and verification endpoints

These are not deployed routes:

| Route | Purpose | Required behavior |
|---|---|---|
| `GET /api/borrower/profile` | Load the authenticated borrower's saved profile/category | Derive customer UUID from validated Supabase identity; no browser-supplied owner ID. |
| `PATCH /api/borrower/profile` | Update supported profile values/category | Validate, preserve prior category until confirmation, return authoritative persisted data. |
| `GET /api/borrower/documents` | Load account-level verification history | Return only the authenticated borrower's records, with review status/feedback and dates. |
| `POST /api/borrower/documents` | Upload/register account-level evidence | Secure private object storage, register a borrower-owned record, retain history, and only acknowledge after registration succeeds. |
| `GET /api/borrower/eligibility` | Determine whether the borrower can start an application | Return authoritative requirements confirmation, document state and eligibility decision. Recheck on application creation and submission. |

The verified `POST /api/borrower/profile` route is not a substitute for these read/update contracts until its payload, response, and persistence behavior are confirmed.

## Admin routes (proposed)

| Route | Request | Node-RED action | Notes |
|---|---|---|---|
| `GET /api/admin/applications` | filters/page | aggregate read | Requires authenticated admin and server-side pagination/filtering. |
| `GET /api/admin/applications/{id}` | path id | read state/data | Restricted admin detail. |
| `POST /api/admin/applications/{id}/approve` | `{ applicationId, adminId, approvedAmount }` | `ADMIN_APPROVE_APPLICATION` | `adminId` must come from authenticated server identity, not trusted from body. Only submitted state; idempotency key recommended. |
| `POST /api/admin/applications/{id}/disburse` | `{ applicationId, adminId, dueDate, disbursementReference }` | `ADMIN_DISBURSE_LOAN` | Use saved approved amount. Unique loan/application and idempotency required. Require human confirmation and retain audit event. |
| `GET /api/admin/documents` | filters/page | document read | No public permanent object URLs. |
| `POST /api/admin/documents/{id}/review` | `{ documentId, adminId, decision, reviewNote }` | `ADMIN_REVIEW_DOCUMENT` | `decision` is verification/rejection; derive actor server-side. |

## Account-document data model and lifecycle

The currently supplied PostgreSQL model ties document metadata to application/loan/payment parents; it has not been shown to support safe account-level verification ownership. Do not attach account verification uploads to each new application or treat the existing application upload routes as reusable account documents.

Before enabling this workflow, add or confirm a borrower-owned verification record keyed to the existing `customers.id` UUID (which is intended to match `auth.users.id`). It should retain document type, category at submission, private object key, file metadata, status, submitted/reviewed timestamps, reviewer, and feedback. Keep historical submissions append-only; define how the active accepted version is selected and how applicability/expiry is determined. Keep application-specific review documents separate. The Node-RED API must derive the owner from a verified token, enforce ownership and role checks, and validate the category/document relationship. Migration details must be based on a fresh PostgreSQL schema review rather than inferred from the old Supabase migration.

The current `POST /api/documents/upload-url` and `/api/documents/confirm-upload` routes are application-linked and were previously found to bypass bearer authentication and ownership checks. Disable or secure them before real borrower uploads. Do not return permanent public object URLs.

## Operation types and errors

- Application creation returns `{ applicationId, applicationNumber, customerId, status, currentStep, decision }`. Active application or outstanding loan returns 409 with the applicable decision; invalid borrower type/phone/required fields returns 400.
- Readiness returns `{ ready, decision, missingFields, missingDocuments, requirementsConfirmed }`. An incomplete application remains `IN_PROGRESS`.
- Submission returns confirmed `SUBMITTED` state and `submittedAt`; otherwise 409/400 with missing requirements.
- Approval returns confirmed application status and approved amount. A non-submitted application is a conflict.
- Disbursement returns confirmed loan fields: principal, fixed interest rate/amount, total due, paid, outstanding, due date, status and reference. The approved principal is read from the saved application, not accepted independently from the browser.
- Document review returns the persisted document state. Missing ID is 404; invalid decision/state is 400/409.

For every mutating endpoint use transactionality, duplicate-safe idempotency for financial operations, server-side audit events, validation, and authorization against authenticated context. Borrower routes require ownership checks; admin routes require admin RBAC. Phone matching alone is not identity verification.

## Not implemented in the current backend

`ADMIN_REJECT_APPLICATION`, request-more-information, real media transfer/private R2 upload/view, disbursement-proof review, repayment/payment verification and balance mutation, scheduled 27th reminders, and Google Sheets synchronization are not confirmed current actions. Do not create successful frontend flows for them until a backend contract and implementation exist.

## Demo vs API mode

The current default is `mode: 'demo'` in `src/core/environment.ts`: fictional fixtures and in-memory UI actions only. `mode: 'api'` sends requests through `LoanOpsApiService` to the configured base URL and surfaces failures; it never uses demo fallback. Before setting API mode, deploy and verify these routes, CORS/session/CSRF policy, authorization and response envelopes. Frontend environment variables are public and must never contain credentials or permanent tokens.
