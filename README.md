# PJloans

Mobile-first lending frontend for Botswana, organized as two separate Angular applications:

- **Borrower Portal**: public-facing application journey, starts on port `4200`.
- **Admin Portal**: separate administration runtime, starts on port `4201`.

Supabase Auth provides identity for both portals. LoanOps PostgreSQL is the operational source of truth and is accessed through approved `loanops` RPCs. The frontend connects the supplied profile, application draft/list, loan-read, Admin queue/decision, document-review, and payment submission/verification RPCs. Each feature has an independent availability and request state.

## Prerequisites

- Node.js compatible with Angular 22
- pnpm (the repository package manager)

Install dependencies:

```bash
pnpm install
```

## Run the portals

Start the borrower runtime:

```bash
pnpm run start:borrower
```

Start the admin runtime in a second terminal:

```bash
pnpm run start:admin
```

The equivalent npm commands also work:

```bash
npm run start:borrower
npm run start:admin
```

URLs:

- Borrower: `http://localhost:4200`
- Admin: `http://localhost:4201`

Both dev servers bind to `0.0.0.0` for Replit or trusted LAN development. The portals have different Angular application entry points, builds, and ports; neither contains a role switch or link to the other. Do not expose the unauthenticated admin demo on an untrusted network.

The Borrower Portal opens on a welcome screen with **Create account** and **Sign in** actions. Registration supports email confirmation and borrower-profile fields. When Supabase returns an authenticated session, the client calls `loanops.initialize_customer_profile` once and then `loanops.get_my_profile`; when email confirmation is required, it waits until sign-in. The returned customer UUID must match the authenticated user. The Admin Portal retains fictional demo mode; outside demo mode it requires Supabase Auth and an active `ADMIN` role from `public.user_roles`.

The student application form offers the supplied Botswana institutions in one alphabetically sorted list. BCET applicants choose a location, and an **Other institution** option allows manual entry.

## Visual system and motion

The dark theme retains the existing PJloans palette. The light theme uses `#c0bcdf`, `#a6a3a1`, `#544f69`, `#252526`, `#9bb3be` and `#68513f` through shared CSS custom properties. GSAP coordinates component-scoped entrance and ambient motion; Angular's native `animate.enter` and `animate.leave` handle conditional UI transitions. GSAP contexts are reverted when a portal component is destroyed, and `prefers-reduced-motion` removes ambient movement and reduces transitions. No animation changes loan amounts or application state.

## Borrower and Admin data modes

`PJLOANS_MODE` selects the Admin data mode. `PJLOANS_BORROWER_MODE` independently selects the Borrower data mode (`demo` or `api`). Fictional demo records are in-memory only. In `api` mode, each available LoanOps RPC can operate independently; unavailable operations remain explicitly pending and do not disable unrelated features. There is no fallback to demo data. Use demo mode for local UI exploration; do not treat it as a live lending workflow.

### Borrower Settings and verification

Password changes use the signed-in Supabase Auth session. Profile retrieval/update, borrower-category changes, account-verification documents, and authoritative eligibility are not connected to verified RPC contracts. Application documents have a separate private Cloudflare R2 flow integrated with the supplied deployed Edge Function source; authenticated upload/review/download still needs live verification against the project.

### Supabase authentication and lending-data boundary

Supabase Auth provides identity; `loanops` RPCs are the only approved browser interface to operational data. Do not apply [`supabase/migrations/20261029153000_borrower_accounts.sql`](./supabase/migrations/20261029153000_borrower_accounts.sql), which implements an obsolete direct-table design. The browser config contains only the Supabase URL and publishable key. Never expose a secret/service-role key, database credentials, or private-storage credentials.

The current environment cannot introspect protected RPC definitions: the Supabase OpenAPI endpoint requires a secret key, which must not be used in the browser, and local PostgreSQL catalog access requires credentials that are not available. See [the implementation status and backend migration proposal](./docs/FRONTEND_INTEGRATION_STATUS.md) for exact completed work and blockers. Older Node-RED route notes in [the API contract](./docs/API_CONTRACT.md) are historical and are not used by the frontend.

## Build and test

Build each application independently:

```bash
pnpm run build:borrower
pnpm run build:admin
```

Build both:

```bash
pnpm run build
```

Run each test target or both:

```bash
pnpm run test:borrower
pnpm run test:admin
pnpm test
```

## Replit

The default Replit Run command starts only the Borrower Portal on port 4200. Start the Admin Portal separately with `pnpm run start:admin` in another Shell. Depending on the Replit workspace, port 4201 may need to be made public in the Ports tool; Replit does not guarantee every forwarded port is automatically exposed. Details: [replit.md](./replit.md) and [docs/REPLIT.md](./docs/REPLIT.md).

## Current limits

- The borrower auth screens require a configured Supabase project for real account operations; placeholders are not valid credentials.
- Admin demo mode is fictional and unauthenticated. Non-demo Admin routes require Supabase Auth and an active role check, but backend RPC authorization remains essential.
- The frontend calls `initialize_customer_profile`, `get_my_profile`, `get_my_applications`, `start_application`, `update_application`, `get_my_loans`, `list_applications_for_admin`, `approve_application`, `record_manual_disbursement`, `review_document`, `submit_payment`, and `verify_payment`. Their deployed signatures and authorization behavior were not independently verified in this environment.
- Requirements, application readiness/submission, Admin loan listing, payment history/Admin queue, and customer management remain pending. The application-document listing, upload, download, and review paths are independently wired to LoanOps and the supplied deployed-function contracts; the end-to-end live flow remains unverified. A missing operation does not block unrelated connected features.
- The frontend does not call Node-RED application routes or directly query operational Supabase tables. Unsupported operations are blocked rather than silently falling back.
- Do not apply the old Supabase borrower-account migration. Configure Supabase email confirmation and redirect URLs according to the Auth settings before production use.
- Application submission cannot be enabled until the backend exposes readiness/completeness checks and confirmed document policy. Payment operations must enforce balances and overpayment constraints transactionally; only verified server responses change balance state.
- Before production use, verify that the existing function configuration/secrets, LoanOps RPC authorization, and R2 CORS match the supplied source, then run an authorized upload/review/download verification. Do not apply the stale local upload-intent migration without reconciling its incompatible RPC signatures. Never expose R2 credentials to the browser.

To run both portals with fictional data, start separate terminals with `PJLOANS_MODE=demo PJLOANS_BORROWER_MODE=demo pnpm run start:borrower` and `PJLOANS_MODE=demo pnpm run start:admin`.
