# Frontend architecture

## Intended system boundaries

```text
Borrower Angular app (4200)                 Admin Angular app (4201)
  Supabase Auth + borrower portal             Supabase Auth + active ADMIN role
               \                                      /
                \____ shared AuthService + models ___/
                                  |
                      loanops PostgreSQL RPCs
                                  |
               authoritative applications, loans, payments

Private application-document flow: Angular -> authenticated Supabase Edge Functions -> private Cloudflare R2
```

The workspace has independent standalone Angular applications with separate entry points, route tables, builds, and ports. Shared UI and services live under `src/core`. The browser must use the existing Supabase client and approved `loanops` RPCs for lending operations. It must not query operational tables directly or call a new proxy backend.

Supabase Auth owns identity and sessions. The existing `public.user_roles` infrastructure owns system role and account status. Borrower identity and ownership must be derived from the authenticated request; a UI guard is only a usability layer. Every privileged operation must still enforce authorization in its database function.

## Frontend/backend responsibilities

Angular owns presentation, wizard navigation, accessible form interaction, and explanatory UI. The backend owns identity-to-customer linkage, eligibility, application state transitions, requirements, document verification, loan values, balances, payment verification, and persistence.

After an authenticated session exists, registration calls `loanops.initialize_customer_profile` once and then `loanops.get_my_profile`, verifying that the returned customer UUID matches the signed-in user. The frontend connects the supplied RPC contracts for borrower application listing/draft create/update and loan reads, separate Admin application queues and decisions, document listing/review, and payment submission/verification. Requirements/readiness/submission, payment history/Admin queue, and customer management remain pending. Application-document upload, private retrieval, and metadata registration are implemented locally but remain pending deployment and live verification. See [the implementation status and backend verification checklist](./FRONTEND_INTEGRATION_STATUS.md).

## State and data protection

`LoanOpsApiService` keeps fictional demo data in memory and tracks availability/request/error state per feature. An unavailable operation cannot globally disable independent operations. Borrower-specific in-memory data is cleared when an authenticated account changes. No borrower record, financial balance, or identity document is written to browser persistent storage.

`AuthService` owns the single Supabase client. The Borrower Portal supports registration, email confirmation, sign-in, password recovery/reset, and sign-out. The registration flow initializes and re-reads the operational profile after authentication. The Admin Portal keeps demo mode isolated and, outside demo mode, requires Supabase Auth plus a row in `public.user_roles` with role `ADMIN` and status `ACTIVE`.

The runtime-config generator exposes only the Supabase URL, publishable key, and mode values. It rejects secret and service-role keys. R2 and database credentials must remain server-side.

## Operations still pending

Requirements, application readiness/final submission, Admin loan listing, payment history/Admin queue, and Admin customer management are pending. Application-document upload/listing/review/download code exists but must not be treated as live until its migration and functions are deployed and verified. These operations remain isolated rather than deriving request shapes from UI models or the former Node-RED API proposal. Payment submission records a pending payment; only backend verification determines paid and outstanding balances.

The deprecated migration [`20261029153000_borrower_accounts.sql`](../supabase/migrations/20261029153000_borrower_accounts.sql) must not be applied. It creates a direct Supabase-table lending design and does not match the RPC boundary.

## Theme and motion

`src/styles.css` defines the current palette and responsive layout. `ThemeService` persists only the theme preference. GSAP motion is scoped to portal components and respects reduced-motion preferences. Financial values shown in demo mode are illustrative only; authoritative values must come from the server.
