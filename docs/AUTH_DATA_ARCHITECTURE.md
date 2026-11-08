# Authentication and lending data: current-state audit

> Historical architecture audit. Its Node-RED routes and frontend paths describe the previous integration and are not used by the current frontend. For the present implementation and remaining blockers, see [FRONTEND_INTEGRATION_STATUS.md](./FRONTEND_INTEGRATION_STATUS.md).

**Audited:** 2026-10-29  
**Scope:** repository, local Node-RED flow files and running Node-RED process, supplied Supabase schema CSVs, and non-mutating HTTP/schema checks. No SQL was executed against either database, no Node-RED mutation route was called, and no credentials were printed.

## Verified current state

### Intended system boundaries

- The Borrower Angular app and Admin Angular app have separate entry points and development ports: 4200 and 4201.
- Supabase is configured for Auth. The running Node-RED process uses the same Supabase project URL and the repository's publishable key for its `SUPABASE_API_KEY`.
- Node-RED runs from `/home/nickel/.node-red-loans`; the active flow file is `/home/nickel/.node-red-loans/flows.json`. Its PostgreSQL config node names the `loanops` database at `127.0.0.1:5432`. The Node-RED credential store exists; its contents were not read.
- Node-RED has the PostgreSQL, AWS S3-compatible client, and S3 presigner packages needed by its flow.
- Supplied Supabase schema-audit CSVs report `public.user_roles` with:
  - `user_id uuid NOT NULL`, primary key and foreign key to `auth.users(id) ON DELETE CASCADE`
  - `app_role text NOT NULL DEFAULT 'BORROWER'`
  - `account_status text NOT NULL DEFAULT 'ACTIVE'`
  - `created_at` and `updated_at` timestamps, both defaulting to `now()`
  - Check constraints named `user_roles_app_role_check` and `user_roles_account_status_check`; the CSV does not include their expressions, so the complete allowed values are not verified.
- The owner has clarified that new public signups should receive the `BORROWER` role, while Admin accounts are invitation-only and created on the Supabase side. The live signup trigger/configuration enforcing this was not inspected.
- The owner confirms their intended identity link: the Supabase Auth UUID is also used as the local `customers.id`, and Supabase-side account creation is intended to populate both. The provided local schema confirms `customers.id` is a UUID primary key and `customers.phone` is unique. The schema alone does not confirm the Supabase trigger/hook or guarantee that `customers.id` is populated from `auth.users.id`.
- A read-only Supabase Data API request against `public.user_roles` returned permission denied for the publishable key. This confirms it is not directly readable under that request's role; it does not reveal the check expressions or row values. A read-only public-schema probe did not find `public.borrower_auth_links`.

### Existing Node-RED HTTP routes

The active flow file contains these six enabled HTTP In nodes. These are distinct from Inject nodes and internal orchestration actions.

| Method | Path | Current observation |
|---|---|---|
| `GET` | `/api/health` | Responded HTTP 200. |
| `GET` | `/borrower/requirements` | Responded HTTP 401 without a bearer token. Flow calls the auth/role subflow with required role `BORROWER`. |
| `GET` | `/api/test/auth` | Responded HTTP 401 without a bearer token. Flow calls the auth/role subflow. |
| `POST` | `/api/borrower/profile` | Flow calls the auth/role subflow with required role `BORROWER`, then has a local PostgreSQL profile upsert. The endpoint was not invoked. |
| `POST` | `/api/documents/upload-url` | Flow validates an upload request, looks up an application, then generates an R2 presigned upload URL. It does **not** enter the auth/role subflow. |
| `POST` | `/api/documents/confirm-upload` | Flow validates the confirmation, looks up an application, checks the R2 object, then registers document metadata. It does **not** enter the auth/role subflow. |

No HTTP In nodes were found for creating/listing/updating/submitting applications or for Admin approval, disbursement, or document review. Those operations appear in Inject-driven orchestration flows, but Inject nodes are not browser API endpoints.

### Authentication, authorization, and ownership

- The shared Node-RED auth subflow extracts the incoming bearer token and forwards it to the Supabase PostgREST RPC `pjloans_session_is_active`; its downstream function checks the RPC result for the expected role and active status.
- Node-RED does not locally verify JWT signatures or fetch JWKS in the inspected flow. Token/session validation and the meaning of the RPC result depend on the live Supabase RPC definition, which was not available in the repository or supplied exports.
- The flow does not reference `borrower_auth_links`. No verified Supabase-user-to-local-customer mapping was found.
- Node-RED's HTTP-node Basic Auth setting is commented out in `settings.js`. The editor and HTTP nodes therefore must not be assumed protected by that setting.
- The two R2 HTTP routes do not invoke the bearer-token/role subflow. Their validation and application lookups do not establish that the caller owns the referenced application. Do not expose these routes for real borrower documents until identity and ownership checks are connected server-side.
- The Admin Angular route is currently not guarded by Supabase Auth and remains a separate demo. A protected Admin HTTP API was not found.

### R2 and environment loading

- The flow references `R2_ENDPOINT`, `R2_REGION`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`; all five variable names are present in the running Node-RED process environment. Their values and whether an upload succeeds were not inspected.
- The Node-RED process also has `SUPABASE_URL` and `SUPABASE_API_KEY`; the latter matches the repository publishable key, not its secret key.
- The repository `.env` has no PostgreSQL or R2 variables. Angular's `scripts/prepare-public-config.mjs` copies only an explicit browser-safe allowlist and does not copy R2 or PostgreSQL credentials.
- The repository `.env` now contains blank R2 settings: `R2_ENDPOINT`, `R2_REGION`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`. Angular's `scripts/prepare-public-config.mjs` does not copy them into the browser config.
- Node-RED's `settings.js` does not load the repository `.env`. Adding credentials to that file alone will not change the environment of the separately launched `node-red -p 1881 -u ~/.node-red-loans` process.
- The R2 upload route definitions were inspected, but the POST routes were deliberately not called because they can create signed upload URLs and register file metadata.

### Borrower app and migration mismatch

- At the time of the initial audit, `.env` selected `PJLOANS_BORROWER_MODE=supabase`. It has since been changed to `api` so borrower lending data no longer queries Supabase. Admin data mode remains `demo`.
- The owner-provided local `public` schema output lists `applications`, `customers`, `documents`, `loans`, `payments`, `audit_events`, `communications`, `conversation_sessions`, `document_extractions`, and `reminders`. A `borrowers` table is absent. `customers.id` is `uuid NOT NULL PRIMARY KEY`; `customers.phone` is `UNIQUE`. The output shows lending relations such as `applications.customer_id`, document parent references to applications/loans/payments, loans referencing applications with one loan per application, and payments referencing loans. These schema facts do not on their own establish the Supabase Auth-to-customer provisioning mechanism.
- In Supabase borrower mode, Angular directly queries `borrower_profiles`, `borrower_applications`, `borrower_verification_documents`, and `borrower_loans`, and directly uploads to Supabase Storage. This is contrary to the intended architecture in which Supabase owns identity only and Node-RED/local PostgreSQL own lending operations.
- `supabase/migrations/20261029153000_borrower_accounts.sql` still contains the earlier Supabase lending-table design and must not be run. The setup documentation has been corrected to describe the intended identity/data boundary.
- Both sample CSV attachments are Supabase schema audits. They report the requested borrower/application/document/loan/payment objects as not found in the searched Supabase schemas; they are not a local PostgreSQL schema dump.
- The owner-provided local schema output supplies table names, columns, and primary/foreign-key/unique/check constraint metadata for the listed `public` tables. This is a pasted schema snapshot, not an independently queried live database; verify it against the current database before writing migrations or production queries. It does not include the Supabase provisioning trigger/hook or the `user_roles` check expressions.

## Previously proposed but unverified

- A local `borrower_auth_links` table mapping Supabase Auth UUIDs to `customers.id`.
- A complete borrower/Admin HTTP API mapping every listed orchestration action.
- The exact `user_roles` role and account-status values allowed by its check constraints, its live RLS policies, and the implementation/security properties of `pjloans_session_is_active`.
- The local `borrowers`/`customers`, `applications`, `documents`, `loans`, and `payments` columns and their primary, foreign-key, unique, and check constraints.
- A verified ownership path from Supabase user UUID to local customer/application IDs.
- End-to-end R2 upload, private retrieval, and reviewer-authorized access.
- Whether every R2 configuration value currently available to Node-RED is valid or can successfully access the intended bucket.

## Recommended next step

1. Keep Supabase Auth as the identity provider; do not apply the Supabase borrower-account migration and do not move lending tables to Supabase.
2. Obtain a schema-only local PostgreSQL export for the relevant lending tables and the exact `user_roles` DDL/check expressions. Do not send database passwords or borrower rows.
3. Decide the explicit, validated process that links an Auth UUID to an existing customer. Do not match by email or phone automatically.
4. Complete and secure the existing Node-RED API: verify bearer tokens and `user_roles` server-side, derive the local customer from a trusted mapping, enforce ownership on every borrower operation, and require the Admin role for Admin operations.
5. Add the R2 routes to that same authenticated/authorized boundary, then validate upload completion and private access before enabling them in Angular.
6. Only after the route contract and local schema are verified, switch Angular's borrower data mode from direct Supabase table access to the Node-RED API. Keep the two Angular applications separate and add Supabase Auth/role guards for the Admin app before connecting real admin data.
7. Decide how Node-RED should receive local `.env` values. The current Node-RED process already has R2 and Supabase variable names; the repository `.env` is not automatically loaded by Node-RED. Never pass R2 secrets or PostgreSQL credentials to Angular.

## Registration implementation follow-up (2026-11-01)

The project owner supplied the contract for the existing Supabase RPC `loanops.initialize_customer_profile(p_phone text, p_full_name text, p_national_id text, p_borrower_type text)`, returning one table row with `customer_id`, `phone`, `full_name`, `national_id`, and `borrower_type`. Per that contract, the function derives its customer UUID from `auth.uid()` and requires an active `BORROWER` role. This is separate from the Node-RED flow audit above; this frontend change does not modify or independently verify the deployed function.

This RPC contract supersedes recommended next step 3 for new borrower-profile provisioning. It does not establish that the independently audited Node-RED API enforces customer ownership from the Auth UUID.

The borrower frontend now invokes this RPC only with an authenticated Supabase session. Immediate-session signup calls it before navigating to the dashboard. Email-confirmation signup waits until subsequent sign-in. A failed RPC keeps the user on the registration/sign-in screen with a retry path; the borrower route guard also requires successful profile initialization. The client sends no user/customer UUID and validates the expected single-row response.

The supplied local PostgreSQL export contained no routines and therefore did not independently verify this RPC. A public Data API metadata request during implementation returned HTTP 401, and no authorized Supabase session or management connection was available. Confirm that `loanops` is exposed in Supabase's Data API, the authenticated role can execute this function, and the function itself correctly handles existing customers idempotently. The frontend tests mock Supabase Auth/PostgREST and verify request schema, payload, response parsing, confirmation timing, and permission errors; they are not a live database integration test.
