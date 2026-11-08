# Borrower registration and LoanOps integration status

## Summary

The existing registration flow was continued rather than replaced. Supabase Auth remains the identity provider. The frontend now calls the supplied `loanops` RPC contracts for borrower application drafts, application/loan reads, Admin application queues and decisions, document review, and payment submission/verification. Each feature has its own availability, request, and error state; a missing operation does not globally disable unrelated operations.

The frontend is **not yet a complete live borrower or Admin lending application**. Requirements, readiness/submission, payment history/Admin queue, and customer management remain pending. The supplied deployed R2 function sources are now integrated locally, but the end-to-end flow has not been live-verified. The former Node-RED API path and direct Supabase lending-table operations have been removed from the frontend. API mode does not fall back to fictional demo data.

## Implementation status

| Area | Status | Evidence and remaining work |
|---|---|---|
| Borrower registration and sign-in | Implemented in frontend | Uses the existing Supabase Auth client, persists the chosen session type, supports email confirmation, password recovery/reset, and sign-out. |
| Customer initialization and profile retrieval | Wired, backend contract not live-tested | After an authenticated session exists, calls `loanops.initialize_customer_profile` once, then `loanops.get_my_profile`; validates a single returned profile row and verifies its customer UUID matches the authenticated user. A retry after successful initialization retries only profile retrieval. Confirmation-required signup waits until sign-in. |
| Admin authentication | Implemented as a fail-closed frontend check | Non-demo Admin sign-in checks the authenticated user's `public.user_roles` row and requires `app_role = ADMIN` and `account_status = ACTIVE`. This check protects navigation only; each privileged backend RPC must enforce its own authorization. Live table policy/access has not been verified. |
| Borrower application list/draft create/update | Connected to supplied RPC contracts; not live-tested | Calls `get_my_applications`, `start_application`, and `update_application` in the `loanops` schema. Creates the application draft when leaving the first wizard step, saves supported application fields when leaving the details/review steps, and resumes from a per-tab step marker or the saved draft fields. The marker contains only customer/application IDs and the step number; it does not store form values or PII. Update continues to use an explicit field whitelist and does not send borrower identity/contact values or protected state fields. |
| Borrower loan read | Connected to supplied RPC contract; not live-tested | Calls `get_my_loans` independently from application loading. A failure in either feature does not hide the other. |
| Requirements, readiness, and final submission | Pending backend/policy | No requirements/readiness contract is assumed. The UI distinguishes unavailable/pending states; it does not mark drafts complete or submit without backend readiness validation. |
| Admin application queues, approval, disbursement | Connected to supplied RPC contracts; not live-tested | Loads `IN_PROGRESS`, `SUBMITTED`, and `APPROVED` queues independently; connects `approve_application` and `record_manual_disbursement`. Manual disbursement records a transfer already performed outside the app; it does not transfer funds. |
| Application document upload/list/review/download | Connected to the supplied deployed-function source; live verification pending | Borrowers request an authenticated upload intent, PUT directly to private R2, finalize against the stored object's size/type/ETag, then refresh through `get_my_application_documents`. Admin requests a short-lived authorized download using the document ID and keeps review decisions on `review_document`. Upload and download are independently available when configured; a real account transfer has not been tested here. |
| Payment submission and verification | Actions connected; history/queue pending | `submit_payment` records a payment as `PENDING`; the borrower UI explicitly says balances do not change until verified. Admin can invoke `verify_payment` using a known payment ID. The backend remains authoritative for balances. |
| Borrower profile and settings | Partial | Auth email/password actions remain available through Supabase Auth. Lending profile reads/updates, borrower-category changes, account-document retrieval, and authoritative eligibility are not connected. |
| Admin loan list, payment history/Admin queue, customer management, reminders, audit history | Pending | No Admin loan-list, payment-list, or Admin customer-list contract is connected. Missing read/list operations do not block independently available writes/actions. |
| Demo workflows | Available for UI exploration only | Fictional data and mutations remain in-memory and must not be interpreted as real customer or financial state. |

## Reported connection error

`net::ERR_CONNECTION_REFUSED` to the former local API means no process accepted that connection at the time; it is not evidence that an API returned an application error. The current frontend does not use that API. If DevTools still shows its requests, verify that the browser is loading the current Borrower Portal build rather than an older process or another app.

Settings password changes are Supabase Auth operations and do not require the removed local lending API. Profile updates and account-verification documents remain explicitly unavailable; they are separate from the implemented application-document R2 flow.

## Deployed R2 function contract and live verification

The three ZIP archives supplied for the deployed functions each contained only `source/index.ts`; the original archives remain in their function directories. The extracted `finalize-document-upload` and `get-document-download-url` sources explicitly use Smithy's Fetch HTTP handler for outbound R2 calls, avoiding Deno's Node HTTP stream adapter implicated by the reported `IncomingMessageForClient._read` EOF error. The finalizer also normalizes the database RPC's `verification_status` response into the Edge Function's documented `status` field, and supplies the intent ID and idempotency state from the already-verified upload intent when those fields are not returned by the RPC. The function code invokes these `loanops` RPCs using the caller's Auth JWT for user-scoped operations: `create_document_upload_intent`, `get_document_upload_intent`, and `get_document_download_metadata`. Finalization verifies the R2 object and calls `finalize_document_upload` with a server-side Supabase secret key. The frontend does not receive storage credentials or query `loanops.documents` directly.

The inspected HTTP contracts are:

- `create-document-upload`: accepts `application_id`, `document_type`, `original_filename`, `mime_type`, and `expected_size`; returns `intent_id`, `expires_at`, `upload_url`, `upload_method` (`PUT`), `required_headers`, and `url_expires_in_seconds` (300). Accepted file types are PDF/JPEG/PNG, up to 20 MiB.
- Direct R2 upload: uses the returned URL, method, and required headers. The browser reports upload progress but does not report completion until finalization succeeds.
- `finalize-document-upload`: accepts `intent_id`; returns `document_id`, `intent_id`, `status`, and `idempotent`. It verifies object size/type/ETag and only then registers the metadata.
- `get-document-download-url`: accepts `document_id`; returns that ID, a short-lived `download_url`, and `expires_in_seconds` (120). The Admin portal asks the function for a URL per download; it does not construct public object links. The signed response uses an attachment disposition, so the Admin action is labeled as a secure download.

**Do not apply** the existing local migration [`20261102194915_document_upload_intents.sql`](../supabase/migrations/20261102194915_document_upload_intents.sql) as-is. It describes a different implementation: a 10 MiB limit, a `p_upload_intent_id`/`p_user_id`/`p_file_size`/`p_sha256` finalization signature, and SHA-256 metadata, while the supplied deployed finalizer calls `p_intent_id`/`p_actor_id`/`p_actual_size`/`p_content_type`/`p_object_etag`. Applying it could conflict with the deployed function contract. No database migration or function change was made.

The local Supabase config enables JWT verification for all three functions. Live availability still depends on deploying the updated finalizer/download handler, deployed function configuration, server-side secrets, RPC authorization, and R2 CORS allowing the application origins and signed `PUT` with `Content-Type`. No authenticated live Supabase invocation, R2 transfer, borrower cross-account denial, or Admin download was performed in this workspace. Do not treat builds or mocked tests as end-to-end verification.

The old [`20261029153000_borrower_accounts.sql`](../supabase/migrations/20261029153000_borrower_accounts.sql) is explicitly out of scope: it creates a direct-table design in Supabase and conflicts with the existing `loanops` RPC boundary.

## Inspection limits

- The Supabase Data API OpenAPI request returned `401` with “Secret API key required”. No secret or service-role key was used to work around that access boundary.
- No migration was applied, no Edge Function was deployed or changed remotely, and no authenticated live RPC or R2 upload/download was performed.
- Therefore, this report makes no claim that the document operation has been successfully verified against a live authenticated account.

## Validation performed

- `pnpm run build` — passed for both Borrower and Admin applications.
- `pnpm test:borrower` — passed: 33 tests, including the deployed R2 contracts and post-finalization document refresh.
- `pnpm test:admin` — passed: 5 tests.
- `git diff --check` and byte-for-byte comparisons between each extracted `index.ts` and its ZIP source — passed.
- The prior Deno lint/type-check applied to an earlier local function revision, not the supplied ZIP source; the extracted deployed source has not been independently Deno-checked here.
- No authenticated live Supabase account operations were exercised; deployment and authorization still require backend-owner verification.
