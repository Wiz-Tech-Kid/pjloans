# PJloans Frontend Implementation and Architecture Audit

> Historical read-only audit, superseded by [FRONTEND_INTEGRATION_STATUS.md](./FRONTEND_INTEGRATION_STATUS.md). Its statements about active frontend paths predate subsequent implementation changes.

**Audit date:** 2026-11-01  
**Scope:** Current frontend source, configuration, local documentation/schema snapshot, and safe local build/test commands.  
**Mode:** Read-only audit. No application source, configuration, database, or dependency files were edited. This report is the only file created for the audit.  
**Important evidence boundary:** The backend RPC names and contract notes below come from the supplied project requirements and existing repository documentation. No authenticated live backend call was made during this audit. Findings about live Node-RED routes are identified as observations recorded in the existing audit documents, not freshly re-probed results.

## A. Executive technical summary

PJloans currently consists of two independently bootstrapped Angular applications that share feature code under `src/core` and a global stylesheet:

- At the time of this historical audit, the **Borrower Portal** used Supabase Auth and sent lending-data requests to a Node-RED API. That adapter was removed in a later implementation; this statement does not describe the current frontend.
- The **Admin Portal** is a separate, unauthenticated demo. It can be configured to use the API adapter, but its routes have no Auth guard and its mutation calls still supply the literal `DEMO_ADMIN` identity.
- The frontend has a working client integration for the supplied `loanops.initialize_customer_profile` RPC. It defers profile initialization when sign-up returns no session, uses the authenticated session after sign-in, validates the RPC response row, and keeps navigation behind successful initialization.
- Most borrower and admin lending operations are **not deployed/verified integrations**. The API adapter has methods for many proposed HTTP endpoints, but existing documentation records only a small Node-RED HTTP surface. In particular, borrower application list/create/update/submit and Admin list/approve/disburse/review routes were not found in the audited flow.
- The current API-mode borrower UI intentionally blocks new applications and submissions until account-level eligibility is available. Settings password changes use Supabase Auth; profile, category change, account-document retrieval/upload, and eligibility APIs are unavailable.
- A legacy Supabase lending-data mode remains in `LoanOpsApiService`, including direct reads and writes to `borrower_*` tables. The current public-config generator rejects `supabase` as a borrower data mode, and the repository documentation says not to use this legacy mode or apply the old migration.
- Financial calculations and admin actions in demo mode are in-memory demonstrations. No borrower payment submission, payment verification, or balance-update workflow exists.
- `pnpm run build` succeeded for both apps; `pnpm test` passed 18 borrower tests and 1 admin test. These are unit tests with mocked Auth/HTTP dependencies, not live backend tests.

The overall frontend is **structurally well underway but not production-ready for lending operations**. The auth and portal boundaries are clear on the borrower side; backend compatibility, Admin authorization, profile/document APIs, payments, and live integration evidence remain major gaps.

## B. Complete repository structure

This tree reflects the current working tree and omits generated directories (`node_modules`, `.angular`, `dist`, and coverage output).

```text
.
├── .gitignore
├── .agents/
│   └── skills/supabase-server/SKILL.md
├── .aider-desk/
│   └── skills/supabase-server -> ../../.agents/skills/supabase-server
├── .postcssrc.json
├── .replit
├── .vscode/
│   ├── extensions.json
│   ├── launch.json
│   ├── settings.json
│   └── tasks.json
├── angular.json
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── README.md
├── replit.md
├── skills-lock.json
├── apps/
│   ├── admin/
│   │   ├── src/
│   │   │   ├── admin.spec.ts
│   │   │   ├── index.html
│   │   │   └── main.ts
│   │   ├── tsconfig.app.json
│   │   └── tsconfig.spec.json
│   └── borrower/
│       ├── src/
│       │   ├── borrower.spec.ts
│       │   ├── index.html
│       │   └── main.ts
│       ├── tsconfig.app.json
│       └── tsconfig.spec.json
├── docs/
│   ├── API_CONTRACT.md
│   ├── ARCHITECTURE.md
│   ├── AUTH_DATA_ARCHITECTURE.md
│   ├── BACKEND_INTEGRATION.md
│   ├── REPLIT.md
│   └── SUPABASE_SETUP.md
├── public/
│   └── favicon.ico
├── scripts/
│   └── prepare-public-config.mjs
├── src/
│   ├── core/
│   │   ├── admin-portal.ts
│   │   ├── admin-root.ts
│   │   ├── api-routes.ts
│   │   ├── auth.service.ts
│   │   ├── borrower-account.service.ts
│   │   ├── borrower-auth.ts
│   │   ├── borrower-portal.ts
│   │   ├── borrower-root.ts
│   │   ├── borrower-settings.ts
│   │   ├── environment.api.ts
│   │   ├── environment.prod.ts
│   │   ├── environment.ts
│   │   ├── loanops-api.service.ts
│   │   ├── models.ts
│   │   ├── portal-motion.ts
│   │   ├── public-config.ts
│   │   ├── supabase-error.ts
│   │   └── theme.service.ts
│   └── styles.css
├── supabase/
│   ├── loanops.md
│   └── migrations/
│       └── 20261029153000_borrower_accounts.sql
├── tsconfig.json
└── skills-lock.json
```

### Important file responsibilities

| File | Responsibility and use |
|---|---|
| [`apps/borrower/src/main.ts`](../apps/borrower/src/main.ts#L1) | Borrower entry point, runtime-config loading, HTTP provider and borrower routes. |
| [`apps/admin/src/main.ts`](../apps/admin/src/main.ts#L1) | Independent Admin entry point and Admin routes. No Auth guard is registered. |
| [`src/core/borrower-root.ts`](../src/core/borrower-root.ts#L1), [`src/core/admin-root.ts`](../src/core/admin-root.ts#L1) | Minimal root components; each hosts a router outlet and initializes the shared theme service. |
| [`src/core/auth.service.ts`](../src/core/auth.service.ts#L1) | Supabase client, Auth/session state, registration, password operations, customer-profile RPC, and borrower guard. |
| [`src/core/borrower-auth.ts`](../src/core/borrower-auth.ts#L1) | Borrower welcome/sign-in/register/password-recovery/reset components. |
| [`src/core/borrower-portal.ts`](../src/core/borrower-portal.ts#L1) | Borrower dashboard, application wizard, local subviews, requirements display, and status/loan presentation. |
| [`src/core/borrower-settings.ts`](../src/core/borrower-settings.ts#L1) | Settings UI; Auth password change works, while profile/category/document actions depend on unavailable APIs. |
| [`src/core/borrower-account.service.ts`](../src/core/borrower-account.service.ts#L1) | Profile and account-document interfaces plus explicit unavailable-operation errors. |
| [`src/core/admin-portal.ts`](../src/core/admin-portal.ts#L1) | Admin welcome/demo and in-app overview, application, document, loan, and customer views. |
| [`src/core/loanops-api.service.ts`](../src/core/loanops-api.service.ts#L1) | Shared demo/API/legacy-Supabase adapter, fixtures, transformations, and request/error state. |
| [`src/core/models.ts`](../src/core/models.ts#L1) | Frontend business types, requirements constants, response envelope, and application draft. |
| [`src/core/api-routes.ts`](../src/core/api-routes.ts#L1) | Central constants for the API paths currently used by the adapter. |
| [`src/core/public-config.ts`](../src/core/public-config.ts#L1) | Runtime JSON config contract, loader, validation, and safe default config. |
| [`scripts/prepare-public-config.mjs`](../scripts/prepare-public-config.mjs#L1) | Reads `.env`, validates modes, rejects privileged browser keys, and generates ignored `public/runtime-config.json`. |
| [`src/core/theme.service.ts`](../src/core/theme.service.ts#L1) | Shared light/dark theme signal, localStorage preference, and document theme attribute. |
| [`src/core/portal-motion.ts`](../src/core/portal-motion.ts#L1) | Scoped GSAP entrance/ambient animations and reduced-motion handling. |
| [`src/styles.css`](../src/styles.css#L1) | Shared Tailwind/daisyUI setup, custom palette/tokens, all page styles, responsive rules, and CSS motion behavior. |
| [`docs/API_CONTRACT.md`](./API_CONTRACT.md) | Distinguishes recorded existing routes from proposed borrower/Admin APIs. |
| [`docs/AUTH_DATA_ARCHITECTURE.md`](./AUTH_DATA_ARCHITECTURE.md) | Earlier Node-RED/Auth/data audit and registration implementation follow-up. |
| [`docs/BACKEND_INTEGRATION.md`](./BACKEND_INTEGRATION.md) | Backend integration status, gaps, and recommendations. |
| [`supabase/loanops.md`](../supabase/loanops.md) | Local PostgreSQL schema snapshot, not generated TypeScript database types. |
| [`supabase/migrations/20261029153000_borrower_accounts.sql`](../supabase/migrations/20261029153000_borrower_accounts.sql) | Deprecated earlier Supabase lending-data design. Documentation explicitly says not to apply it. |

`src/app`, the old root Angular starter entry files, and the old root server entry files are absent from this working tree; Git status already showed tracked deletions for those files before this report was created. Current apps use `apps/borrower` and `apps/admin`, with shared feature code in `src/core`. The worktree was already substantially dirty (modified tracked files and many untracked files); none of those prior changes were reverted or edited by this audit.

At audit time, `node_modules`, `.angular`, and `dist` existed; `coverage` did not. The build regenerated ignored `dist/borrower`, `dist/admin`, and `public/runtime-config.json`.

## C. Technology and dependency inventory

Installed versions were inspected from the local package installation. Manifest ranges are declared in [`package.json`](../package.json#L1), and resolved versions are pinned by [`pnpm-lock.yaml`](../pnpm-lock.yaml).

| Technology/package | Installed version | Actual use |
|---|---:|---|
| Angular CLI, build, core, common, router, forms, compiler | 22.2.3 | Used by both Angular applications and their standalone components. |
| Angular platform-browser, platform-server, SSR | 22.2.3 | `platform-browser` bootstraps the client apps; no active SSR/server entry point was found. |
| `@supabase/supabase-js` | 2.118.0 | Used by `AuthService` for Auth and by legacy lending code for PostgREST table access. |
| `@supabase/server` | 1.9.2 | Installed but no source import/use was found. |
| RxJS | 7.8.2 | Used by `HttpClient` API methods and adapter observable flows. |
| GSAP | 3.15.0 | Used in `portal-motion.ts`; context is scoped by `gsap.matchMedia()` and reverted on component destruction. |
| Tailwind CSS | 4.3.3 | Imported from global CSS. |
| `@tailwindcss/postcss` | 4.3.3 | Active plugin in `.postcssrc.json`. |
| daisyUI | 5.7.50 | Active CSS plugin and custom dark/light theme definitions. |
| TypeScript | 6.0.3 | Angular application and test source. |
| Vitest | 5.0.5 | Angular unit-test runner. |
| Express | 5.3.0 | Installed, but no active Express/server source or import was found. |
| `@angular/ssr`, `@angular/platform-server` | 22.2.3 | Installed; no active server bootstrap or SSR route file exists in this working tree. |
| `tslib` | 2.8.1 | Angular/TypeScript runtime helper dependency. |
| jsdom | 30.1.3 | Test DOM environment dependency. |

No evidence was found for generated Supabase `Database` types. Table row shapes used by the legacy service are locally declared interfaces (`SupabaseProfileRow`, `SupabaseApplicationRow`, `SupabaseLoanRow`), so they are not generated or guaranteed to match a deployed schema.

Angular defines two independent application build targets in [`angular.json`](../angular.json#L8): borrower (`apps/borrower/src/main.ts`, port 4200, `dist/borrower`) and admin (`apps/admin/src/main.ts`, port 4201, `dist/admin`). Both use shared `src/styles.css`, and each has separate app/spec tsconfig files. `serve` defaults to development; build defaults to production. An `api` configuration replaces `environment.ts` with `environment.api.ts`; production replaces it with `environment.prod.ts`.

## D. Borrower Portal architecture

### Entry point and routes

[`apps/borrower/src/main.ts`](../apps/borrower/src/main.ts#L14) loads `/runtime-config.json`, bootstraps `BorrowerRoot`, provides `HttpClient`, and registers:

| Path | Component/behavior | Access |
|---|---|---|
| `/` | `BorrowerLogin` welcome screen | Public |
| `/welcome` | Redirect to `/` | Public |
| `/login`, `/sign-in` | `BorrowerSignIn` | Public |
| `/register` | `BorrowerRegister` | Public |
| `/forgot-password` | `BorrowerPasswordRecovery` | Public |
| `/reset-password` | `BorrowerPasswordReset` | Public |
| `/dashboard` | `BorrowerPortal` | `authGuard` |
| `/settings` | Lazy `BorrowerSettings` | `authGuard` |
| Other paths | Redirect to `/login` | — |

Dashboard sections (`home`, `application`, `documents`, `loan`) are switched inside `BorrowerPortal` by a component-local signal; they are not separate URL routes. There are no application-specific detail routes, deep links, or separate payment route. No link to Admin functionality was found in the borrower routes or borrower navigation.

### Pages and current capability

- **Welcome/auth:** account creation and sign-in navigation, theme switch, Supabase Auth forms; a development mock-auth link is shown only in mock mode.
- **Dashboard:** displays the active application, status/progress, requested amount and requirements; API-mode state comes from the configured backend. Demo records are clearly labeled.
- **Application wizard:** five steps—category, personal details, application/receiving details, documents, review. It can save or update drafts through demo memory or API adapter. The live API path is intentionally gated for starting a new application pending backend eligibility.
- **Documents:** shows requirement/status/checklist rows only. File input is disabled; application uploads and application-document metadata registration are not connected.
- **Loan details:** displays loan principal, interest, total due, paid, outstanding, due date, and status. There is no borrower payment submission interface.
- **Settings:** password update is Auth-backed. Profile read/write, category change, account-document load/upload, and eligibility remain unavailable; UI reports those gaps independently.

### Application form details

`BorrowerPortal` owns a reactive form with borrower type, name, phone, national ID, student/employer fields, amount, receiving method, recipient name, same-name checkbox, and recipient identifier ([form definition](../src/core/borrower-portal.ts#L126)). Supported categories are `STUDENT`, `EMPLOYED`, and `UNEMPLOYED`; supported payout methods are `CASH`, `FNB_PAY_TO_CELL`, `EFT`, `ORANGE_MONEY`, `MYZAKA`, and `SMEGA`.

Angular applies required name, a phone pattern, and amount minimum 1. The step handler additionally checks student institution/ID, employed employer/status, requested amount, and recipient information. These are client usability checks only. The backend must repeat validation and enforce category/eligibility rules authoritatively.

The “Recipient name is the same as my ID” checkbox synchronizes the recipient name to the borrower’s `fullName`; it does not compare the recipient name to the national-ID/passport number. When selected, the field is made read-only and the same full-name value is sent.

In API mode:

- Existing active applications may be continued/updated.
- Starting a new application is blocked pending a backend eligibility decision.
- Submitting is blocked pending account-level verification/eligibility.
- Application/document uploads are disabled.

In the unreachable-by-default legacy Supabase data mode, the component would call local readiness logic and update the application table directly. The config generator currently rejects this mode.

## E. Admin Portal architecture

### Entry point and routes

[`apps/admin/src/main.ts`](../apps/admin/src/main.ts#L11) is bootstrapped independently and registers `/`, `/login`, `/dashboard`, and wildcard redirect. `/dashboard` has **no authentication or authorization guard**. `AdminLogin` is a credential-free welcome screen with a link to the dashboard and explicit “DEMO MODE — Authentication disabled” copy ([component](../src/core/admin-portal.ts#L30)).

### Admin workflows

`AdminPortal` has internal Overview, Applications, Documents, Loans, and Customers sections ([component and section state](../src/core/admin-portal.ts#L132)). It loads `loadApplications('admin')` from the shared adapter. In demo mode, fixtures are in-memory and all writes update only that in-memory dataset.

- **Overview:** counts applications/documents/loans and sums outstanding balances.
- **Applications:** search/filter/sort/paginate client-side; detail drawer; approval form and 30% preview; manual-disbursement form.
- **Documents:** metadata-only list with verify/reject controls and review notes. No file preview or secure media viewer.
- **Loans:** table of principal, interest, total due, paid/outstanding, due date, status.
- **Customers:** client-side search and customer detail summary.
- **Not implemented:** rejection/request-more-information, repayment recording, payment verification, reminders, audit history, and settings are listed as planned.

When API mode is enabled, operations call the proposed API paths in `LoanOpsApiService`; repository backend docs say the full application/Admin HTTP API was not found. The component currently supplies the literal `DEMO_ADMIN` to approve/disburse/review calls. That value is demonstration data, not a verified authenticated Admin identity, and must never be treated as authorization by an API.

The two apps build independently, use separate route tables/entry points, and do not provide cross-portal navigation. Shared service classes are bundled separately in each app runtime; this is source reuse, not a shared running Angular injector across ports.

## F. Authentication and registration implementation

### Supabase client/session architecture

`AuthService` creates a Supabase client from `PUBLIC_RUNTIME_CONFIG` only when Auth mode is `supabase` and a URL/publishable key passes checks ([client/config](../src/core/auth.service.ts#L105)). Client options enable `persistSession`, `autoRefreshToken`, and `detectSessionInUrl`. A custom storage wrapper uses `localStorage` when “remember me” is true and `sessionStorage` otherwise, removing the key from the other store.

`restoreSession()` calls `auth.getSession()` and sets signals `session`, `user`, and `ready`. `onAuthStateChange` synchronizes session/user, clears the cached customer profile when the Auth user changes, and records password-recovery state. No explicit `HttpInterceptor` is registered; the API service manually adds the current access token when available.

Auth operations:

- Sign-up: `auth.signUp` writes `full_name`, `phone`, and `borrower_type` to Auth user metadata and redirects confirmation to the app `/login` route.
- Sign-in: `auth.signInWithPassword`, then customer-profile initialization.
- Confirmation resend: `auth.resend({ type: 'signup', email })`.
- Password reset: `auth.resetPasswordForEmail` to `/reset-password`.
- Password change: `auth.updateUser({ password })`.
- Sign-out: Supabase `auth.signOut`, then clears Auth/session/customer-profile state.

No frontend call reads `public.user_roles`, custom JWT role claims, or account status. The browser does not distinguish `BORROWER` from `ADMIN` through a role query. The borrower guard checks Auth state and then profile initialization; it is not backend authorization. No Admin guard exists.

### Registration sequence compared with the supplied six-step reference

| Step | Current implementation | Evidence/status |
|---|---|---|
| 1. Create Supabase Auth account | Implemented by `BorrowerRegister.register()` → `AuthService.signUp()`. Metadata carries full name, phone, and borrower type. | [`borrower-auth.ts`](../src/core/borrower-auth.ts#L204), [`auth.service.ts`](../src/core/auth.service.ts#L245) |
| 2. Auth infrastructure creates `public.user_roles` | Not performed or verified by the frontend. The project requires the pre-existing server-side Auth/role configuration to create an active `BORROWER`; no user-role table call is made in Angular. | No `.from('user_roles')` or role RPC found. |
| 3. Obtain authenticated session | Implemented conditionally. If `signUp` returns no `data.session`, registration displays confirmation instructions and does not call the RPC. Later successful password sign-in supplies a session. | [`auth.service.ts`](../src/core/auth.service.ts#L275), [sign-in implementation](../src/core/auth.service.ts#L207) |
| 4. Collect phone | Collected and validated at registration, then collected again as application contact information in the later wizard. The registration phone is saved in Auth metadata; there is no registration `national_id` field. | [`borrower-auth.ts`](../src/core/borrower-auth.ts#L186), [`borrower-portal.ts`](../src/core/borrower-portal.ts#L87) |
| 5. Call `loanops.initialize_customer_profile` | Implemented after immediate-session sign-up or after successful sign-in. Calls `.schema('loanops').rpc('initialize_customer_profile', args)` with `p_phone`, `p_full_name`, `p_national_id`, `p_borrower_type`; no Auth/customer UUID is sent. | [`auth.service.ts`](../src/core/auth.service.ts#L347) |
| 6. Call `loanops.get_my_profile`, verify profile, enter dashboard | **Not implemented as specified.** The client parses the one-row response from `initialize_customer_profile` and uses that response as its profile state. It does not call `get_my_profile`. The route guard waits for initialization before granting dashboard access. | [`auth.service.ts`](../src/core/auth.service.ts#L398), [guard](../src/core/auth.service.ts#L471) |

The initialization response is expected to be exactly one object with UUID `customer_id`, phone, nullable name/ID, and a borrower type accepted by the client. A malformed or zero/multiple-row response becomes an error. The RPC contract, including that the database derives identity from `auth.uid()` and requires active `BORROWER`, was supplied by the project owner. The client does not independently verify the returned customer UUID equals the current Auth UUID.

### Retry, duplication, and navigation behavior

`AuthService` caches an in-flight initialization promise and successful profile by current Auth user ID, preventing duplicate calls within that service instance when sign-in and the route guard both request setup. The cache is cleared on account change or RPC failure. This does not guarantee database idempotency across page reloads, retries, or multiple tabs; the RPC must be idempotent.

If signup has a session but RPC setup fails, registration shows a retry screen and does not navigate. If no session is returned, the RPC is deferred. Subsequent sign-in calls initialization before returning successfully. The guard also calls initialization and redirects to sign-in on failure. The borrower sign-in screen can then display the error and offer a retry. Error mapping explicitly mentions schema not exposed (`PGRST106`), missing function (`PGRST202`), and permission denied (`42501`).

There is no `get_my_profile` verification pass after initialization. This is the main gap against the requested sequence. The local schema inventory reports no routines; a prior repository note records an unauthenticated metadata probe returning HTTP 401. No authenticated live RPC/customer write was verified here.

## G. Supabase and API integration inventory

### Supabase client calls found in source

The Supabase client is initialized once in `AuthService`. Calls found under `src/`:

| Source/function | API | Schema/table/RPC | Inputs/result/error handling |
|---|---|---|---|
| `AuthService.restoreSession()` | `auth.getSession()` | Auth | Restores session; sets readiness and user/session signals; on returned error sets an Auth message. |
| `AuthService.signIn()` | `auth.signInWithPassword()` | Auth | Email/password; maps unconfirmed/invalid credentials to user-facing errors; then initializes customer. |
| `AuthService.signUp()` | `auth.signUp()` | Auth | Email/password and user metadata (`full_name`, `phone`, `borrower_type`); branches on presence of session. |
| `AuthService.resendConfirmation()` | `auth.resend()` | Auth | Signup confirmation email; explicit generic error on failure. |
| `AuthService.requestPasswordReset()` | `auth.resetPasswordForEmail()` | Auth | Email and redirect URL; explicit error on failure. |
| `AuthService.updatePassword()` | `auth.updateUser()` | Auth | New password; maps session, reauthentication, weak-password, and network errors. |
| `AuthService.signOut()` | `auth.signOut()` | Auth | Clears frontend Auth/profile signals after successful sign-out. |
| `AuthService.initializeOperationalCustomerProfile()` | `.schema('loanops').rpc('initialize_customer_profile', args)` | `loanops` RPC | Arguments are the four `p_*` fields listed above; validates and maps one returned row; maps schema/function/role/network errors. |
| Legacy `loadSupabaseBorrowerData()` | `.from(...).select()` | `public.borrower_profiles` | Filters profile `id` by `auth.getUser().user.id`; locally typed `SupabaseProfileRow`. |
| Legacy `loadSupabaseBorrowerData()` | `.from(...).select().eq().order()` | `public.borrower_applications` | Filters by `user_id`; orders `created_at` descending; locally typed application rows. |
| Legacy `loadSupabaseBorrowerData()` | `.from(...).select().in()` | `public.borrower_loans` | Filters to the returned application IDs; locally typed loan rows. |
| Legacy `createSupabaseApplication()` | `.from(...).insert().select().single()` | `public.borrower_applications` | Inserts application draft fields; no client-supplied user ID; relies on old table defaults/RLS. |
| Legacy `updateSupabaseApplication()` | `.from(...).update().eq().eq().select().single()` | `public.borrower_applications` | Updates application ID and current `user_id`; maps failure to user-facing message. |
| Legacy `checkSupabaseSubmissionReadiness()` | `.from(...).select()` | `public.borrower_applications` | Reads application by ID and current user ID; computes readiness in frontend. |
| Legacy `checkSupabaseSubmissionReadiness()` | `.from(...).select().eq().in()` | `public.borrower_verification_documents` | Reads document types/statuses for current user and current required types; readiness is client-computed. |
| Legacy `submitSupabaseApplication()` | `.from(...).update().eq().eq().select().single()` | `public.borrower_applications` | Updates status to `SUBMITTED` after local readiness calculation. |

All legacy table calls use the client’s default schema; only profile initialization uses `.schema('loanops')`. No other `.rpc()` call was found. No `.storage()` call or Supabase Storage upload/download code was found. The legacy data path is present in source but the public config generator rejects `PJLOANS_BORROWER_MODE=supabase`; do not infer that the old tables exist in the actual Supabase project.

### API adapter routes

At the time of this historical audit, `LoanOpsApiService` made JSON HTTP requests to the configured Node-RED origin. That adapter was subsequently removed; the current service does not make these HTTP requests.

| Method | HTTP request |
|---|---|
| `loadApplications('borrower')` | `GET /api/borrower/applications` |
| `loadApplications('admin')` | `GET /api/admin/applications` |
| `startApplication(draft)` | `POST /api/borrower/applications` |
| `updateApplication(id, draft)` | `PUT /api/borrower/applications/{id}` |
| `checkSubmissionReadiness(id)` | `POST /api/borrower/applications/{id}/readiness` |
| `submitApplication(id)` | `POST /api/borrower/applications/{id}/submit` |
| `approveApplication(...)` | `POST /api/admin/applications/{id}/approve`, body includes `applicationId`, `approvedAmount`, `adminId` |
| `disburseLoan(...)` | `POST /api/admin/applications/{id}/disburse`, body includes `applicationId`, `dueDate`, `disbursementReference`, `adminId` |
| `reviewDocument(...)` | `POST /api/admin/documents/{id}/review`, body includes `documentId`, `decision`, `adminId`, `reviewNote` |
| `loadBorrowerRequirements(type)` | `GET /borrower/requirements?borrowerType=...` |

The route constant and API implementation are in [`api-routes.ts`](../src/core/api-routes.ts#L1) and [`loanops-api.service.ts`](../src/core/loanops-api.service.ts#L176). Existing documentation records `/borrower/requirements` as the route found in Node-RED, while the application CRUD and Admin paths are proposed/unavailable. Historical live checks recorded 404 for `/api/borrower/applications` and `/api/borrower/requirements`; no authorized borrower response was verified. The frontend’s explicit requirements path differs from the proposed normalized `/api/borrower/requirements`, intentionally following the route documented as existing.

No old Node-RED action names are sent directly from Angular. Names such as `START_APPLICATION`, `GET_APPLICATION_STATE`, `CHECK_SUBMISSION_READINESS`, and Admin action names appear in backend-integration documentation as orchestration action mappings, not browser RPC calls.

## H. Backend RPC compatibility matrix

The following names are the supplied backend reference list. “Not called” means no corresponding Supabase `.rpc()` exists in frontend source; a matching HTTP adapter operation is not an RPC integration. Deployed behavior was not independently checked during this audit.

| Supplied RPC | Frontend integration | Actual UI/service path | Status |
|---|---|---|---|
| `initialize_customer_profile` | Yes, sole lending RPC call. | `AuthService.initializeOperationalCustomerProfile()`; signup/sign-in and borrower guard. Uses `loanops` schema, four `p_*` args, parses one row. Mocked RPC request tests exist. | **Partial:** contract-driven client code exists; no live invocation; no follow-up `get_my_profile`. |
| `get_my_profile` | No. | The initialization RPC response is cached and used; no profile-fetch RPC. | **Missing.** |
| `start_application` | No RPC. | API-mode `POST /api/borrower/applications`; legacy `public.borrower_applications` insert; demo in-memory create. | **Partial/unverified:** matching API path not found in recorded HTTP routes. |
| `get_my_applications` | No RPC. | API-mode `GET /api/borrower/applications`; legacy applications table select. | **Partial/unverified:** route not confirmed. |
| `update_application` | No RPC. | API-mode `PUT /api/borrower/applications/{id}`; legacy table update. | **Partial/unverified:** route not confirmed. |
| `submit_application` | No RPC. | API-mode submit route exists in adapter, but BorrowerPortal blocks live API submission; legacy mode updates table after local readiness. | **Missing as deployed operation / legacy-only direct table code.** |
| `list_applications_for_admin` | No RPC. | API-mode `GET /api/admin/applications`; Admin UI calls adapter. | **Missing/unverified:** no guarded Admin API confirmed. |
| `approve_application` | No RPC. | API-mode `POST /api/admin/applications/{id}/approve`; demo adapter mutates memory. | **Missing/unverified:** method sends caller-provided `adminId`, currently `DEMO_ADMIN`. |
| `record_manual_disbursement` | No RPC. | API-mode `POST /api/admin/applications/{id}/disburse`; demo calculation/mutation. | **Missing/unverified:** method does not call an RPC; backend must derive approved principal from saved state. |
| `review_document` | No RPC. | API-mode `POST /api/admin/documents/{id}/review`; demo metadata mutation. | **Missing/unverified:** route and authorization not confirmed. |
| `get_my_loans` | No RPC. | Loans are part of the `LoanOpsData` response; legacy mode reads `borrower_loans`. | **Partial/unverified:** no dedicated RPC/API read contract. |
| `submit_payment` | No call, method, or UI. | No payment submission form/service. | **Missing.** |
| `verify_payment` | No call, method, or UI. | No payment verification workflow. | **Missing.** |

Other requested integration distinctions:

- Borrower requirements retrieval is an HTTP GET to the verified-route path documented as `/borrower/requirements`; a response for an authenticated borrower has not been validated.
- Submission readiness is a proposed HTTP POST route in API mode; its implementation is not recorded as deployed. The legacy Supabase mode computes readiness by reading table rows in the browser, which is not an authoritative server-side readiness check.
- Application document metadata registration has no frontend service call. The wizard’s file input is disabled. The backend contract describes a proposed application-document endpoint; do not infer that it is deployed.
- There is no API call to `get_my_profile`, no payment RPC, and no document-storage RPC.

## I. Data models and service architecture

### Models

[`models.ts`](../src/core/models.ts#L1) defines:

- `BorrowerType`: `STUDENT | EMPLOYED | UNEMPLOYED`.
- `BorrowerDocumentType`: `STUDENT_ID | ADMISSION_LETTER | IDENTITY_DOCUMENT | EMPLOYMENT_LETTER`.
- `ApplicationStatus`: `IN_PROGRESS | SUBMITTED | APPROVED | DISBURSED`.
- `DocumentStatus`: `MISSING | PENDING | VERIFIED | REJECTED`.
- `ReceivingMethod`: `CASH | FNB_PAY_TO_CELL | EFT | ORANGE_MONEY | MYZAKA | SMEGA`.
- `Customer`, `Application`, `DocumentRecord`, `Loan`, `LoanOpsData`, `ApplicationDraft`, `ApiResult<T>`, `BorrowerRequirements`, and `SubmissionReadiness`.

`BORROWER_DOCUMENT_REQUIREMENTS` is client configuration: Students get student ID, admission letter, and identity document; Employed get employment letter and identity document; Unemployed get identity document. The UI/docs explicitly say some of these policies still require lender confirmation.

`Customer.id` and `Application.customerId` are numeric. The supplied local schema snapshot says `customers.id` is UUID and `applications.customer_id` is UUID; the profile RPC returns UUID `customer_id`. This is a material mismatch for a real LoanOps mapping. In legacy Supabase mapping the service substitutes numeric customer ID `1`. `Application.id`, document IDs, and loan IDs use JS `number` although database `bigint` values are represented in the local schema; very large IDs could exceed JavaScript integer precision.

There is no `Payment` or `Reminder` model. `DocumentRecord.documentType` is an unvalidated `string`; `Loan.status` is also `string`. Status unions omit possible denied/rejected/request-information states.

### Services and shared state

| Service | Main responsibilities/state | Gaps/observations |
|---|---|---|
| `AuthService` | Auth client, session/user/loading/ready/error/recovery/customer-profile signals, RPC caching, Auth operations. | No role/account-status state. |
| `LoanOpsApiService` | Demo fixture state, API calls, legacy Supabase reads/writes, busy/error signals. | Mixes three modes and custom row mapping in one service. It caches `LoanOpsData` in memory. |
| `BorrowerAccountService` | Profile/document types and methods expected by Settings. | All current operations throw explicit “not implemented” errors. |
| `ThemeService` | Theme signal and document theme attributes; persists theme preference only. | Theme value is localStorage state. |

Angular Signals hold Auth/data/UI state. RxJS Observables wrap HTTP and legacy Supabase calls. Forms are component-local (reactive wizard; template-driven Auth/settings/Admin forms). No global NgRx/store, persistent business-data cache, or generated Supabase schema types were found.

`LoanOpsApiService`’s demo fixture is cloned into memory; mutations affect the service signal only and do not persist across reloads. Auth tokens are persisted by the Supabase client in selected browser storage. Theme preference is separately stored under `pjloans-theme`. No intentional browser persistence for loan/customer/application records was found.

One lifecycle concern: `AuthService.signOut()` clears Auth/profile signals but does not clear `LoanOpsApiService.data`. In the same SPA runtime, prior borrower data remains in the in-memory signal until a later successful load replaces it. The guarded UI limits normal logged-out access, but a subsequent account switch could briefly render stale data while the new load is pending. This deserves targeted privacy/state cleanup before multi-account use.

## J. Borrower application workflow

1. On dashboard construction, the component calls `reload()` and loads requirements. The component also directly calls `refreshRequirements()` after `reload()`; successful `reload()` calls `refreshRequirements()` again, so API mode can issue duplicate initial requirements requests.
2. The active application is selected from loaded `LoanOpsData`; in API/Supabase mode it is not filtered by client customer ID because the server is expected to scope the response.
3. If no active application exists, demo mode can initialize the sample draft, legacy Supabase mode can use the profile, and API mode blocks new starts pending authoritative account verification/eligibility.
4. Wizard category selection supports the three borrower categories. Legacy Supabase mode disables changing category in the application wizard.
5. Personal stage collects name, phone, national ID/passport number. The phone is explicitly labeled as a matching value, not identity verification.
6. Details stage conditionally asks students for institution/student ID and employed borrowers for employer/status. Unemployed borrowers have no additional fields in the current client.
7. Amount, six payout methods, recipient name, same-name option, and non-cash recipient identifier are collected. Client checks do not replace backend validation.
8. Document stage displays required categories but disables its file input. Account verification is directed to Settings, whose upload API is also unavailable.
9. Review stage saves draft data through the service. In demo mode this creates/updates in-memory data. API mode can save via proposed POST/PUT paths, but backend route availability is not verified.
10. Submission: demo is explicitly disabled; API mode is explicitly blocked until account verification/eligibility exists; the legacy Supabase branch performs local readiness calculation then a direct table update.
11. The dashboard reloads data after a successful legacy submission. API mutation reloads are performed for Admin actions but borrower `saveApplication()` returns to home without an explicit reload (it uses the returned record only to set selected customer ID/message).

The client uses statuses `IN_PROGRESS`, `SUBMITTED`, `APPROVED`, and `DISBURSED`; it does not model declined/request-more-information states. Eligibility, duplicate active application, outstanding-loan prevention, document status, borrower ownership, and final submission readiness must be authoritatively checked server-side.

## K. Admin workflow

Admin displays demo application/customer/document/loan records, supports client-side sorting/filtering and shows details. Approval asks the operator to confirm and validates that approved principal is a finite positive number. Disbursement collects due date and reference. Document review supports `VERIFIED`/`REJECTED` and requires a note for rejection. The in-memory demo enforces simple state checks.

These are not proof of operational backend integration. API mode sends proposed HTTP requests, but current docs say the complete Admin endpoints were absent in the audited Node-RED flow. There is no Admin Supabase login, role lookup, route guard, server-authorized actor identity, or test of Admin RBAC. Admin creation/approval/disbursement/document review must remain disabled from real data until those controls are deployed and verified.

The backend integration docs identify `adminId` as a value that must be derived server-side, not trusted from a browser body. Current component calls pass `"DEMO_ADMIN"` to the API service; it is appropriate only for demo and should not be used as evidence of a trusted actor.

## L. Financial and payment implementation

- Currency presentation uses `Intl.NumberFormat('en-BW', { style: 'currency', currency: 'BWP', minimumFractionDigits: 2 })`.
- The UI previews flat interest as `approvedAmount * 0.3` and total repayable as `approvedAmount * 1.3`.
- Demo disbursement computes `interestAmount = Number((principal * 0.3).toFixed(2))`, then rounds total/outstanding to two decimal places. This is JS floating-point arithmetic, suitable for a display/demo only—not an authoritative ledger calculation.
- Demo loan data contains principal, interest rate/amount, total due, amount paid, outstanding, due date, status, and a demo disbursement reference. The Admin view sums outstanding values.
- No payment entry, payment submission, payment verification, overpayment prevention, repayment schedule, or verified-payment balance mutation exists in the frontend.
- The API adapter’s disbursement body sends application ID, date, reference, and `adminId`; it does not send approved principal. The server must read the persisted approved amount and perform the transaction/idempotency/audit logic.

The required rules—30% one-time flat interest, BWP precision of two decimal places, no overpayment, outstanding equals total due minus verified paid amounts—are not implemented as a complete authoritative workflow. The only frontend calculations are previews/demo state. The database/backend must remain the source of truth.

## M. Document management

The client distinguishes application-specific requirements from account-level verification documents. Requirement categories are configured in `models.ts`; UI labels include student identification, admission letter, identity document (Omang/passport), and employment/contract letter.

- Borrower application wizard and Documents section display status/feedback from the service shape but have disabled upload controls.
- The disabled file input advertises `.pdf`, `.jpg`, `.jpeg`, `.png`; no enabled upload flow, file-size validation, metadata registration call, object-key management, or private download is implemented.
- `BorrowerAccountService` explicitly rejects account-document list/upload calls as unavailable.
- Legacy Supabase mode reads verification-document metadata but contains no `.storage()` usage.
- Admin review works only against demo metadata or a proposed API route. The Admin UI states previews are unavailable.
- No R2 client, Cloudflare SDK, signed URL handling, public file URL, or Supabase Storage call exists in Angular.

The earlier Node-RED audit documented upload URL and confirmation endpoints that bypassed the auth/role subflow and did not establish application ownership. Treat those routes as unsafe for real documents until secured server-side. Existing schema notes do not prove an account-level reusable verification-document lifecycle. Do not equate application document metadata with private file storage or account eligibility.

## N. Demo and live data modes

There are separate Auth, Admin/data, and borrower-data settings:

- The ignored `.env` values documented in this historical audit described the prior API configuration and are not a description of current frontend runtime configuration.
- `PJLOANS_AUTH_MODE` accepts `supabase` or `mock`; mock Auth is rejected by `AuthService` in production.
- `PJLOANS_MODE` accepts `demo` or `api`.
- `PJLOANS_BORROWER_MODE` accepts `demo` or `api` in `prepare-public-config.mjs`; borrower lending data in Supabase is explicitly rejected by that generator.
- The legacy `supabase` path still exists in the service, and `PublicRuntimeConfig` still types it for borrower data, but the generator prevents selecting it under normal startup.
- The `.env` variable names include `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL`, the four `PJLOANS_*` settings above, and `R2_ENDPOINT`, `R2_REGION`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. The URL, publishable key, secret-key variable, and JWKS URL are present; raw values are intentionally omitted. `R2_REGION` is set, while endpoint, bucket, access key, and secret are blank. R2/JWKS values are not copied to the browser config; the frontend source does not consume `SUPABASE_JWKS_URL`.
- `.env.example` is absent. `.gitignore` excludes `.env` and `.env.*` except `.env.example`, and also excludes generated `public/runtime-config.json`. The config script checks for Supabase secret/service-role keys and rejects them as the browser key.

Demo data is fictional, cloned into an in-memory service signal, and the UI displays prominent demo badges/banners. Demo mutations alter only in-memory data and are not persistent. A failed API request sets an error and does not fall back to demo data (covered by unit test).

The README says all five R2 settings are blank; the current non-secret presence check found `R2_REGION` set and the other four blank. No secret or configuration value was printed in this report.

If runtime config cannot be loaded, `loadPublicRuntimeConfig()` logs the failure and returns defaults that select demo data and have blank Auth/API configuration. This is not a request-failure fallback, but it can lead to a visibly labeled demo runtime after a config-load failure. Admin is a demo regardless and must not be exposed as an operational Admin system.

## O. UI, theme, and responsive architecture

- Tailwind CSS 4 and daisyUI 5 are actively wired through `@import 'tailwindcss'`, CSS plugin declarations, and `.postcssrc.json`.
- Shared CSS defines daisyUI dark/light themes plus a second, custom CSS-variable palette; styles for both applications live in one large `src/styles.css`.
- ThemeService reads the saved `pjloans-theme` preference or system light preference, toggles `data-theme`, and persists the selection.
- Dark page base uses `#4f3f40`, matching the required dark background. Light page base uses `#c0bcdf`; the requested light primary background `#9ebd60` is not used as the page background (it appears in the dark theme as the `--sage` token). This is a confirmed palette requirement mismatch.
- Several light-theme tokens intentionally map semantic colors to the same values; some rules also repeat `:root` / `:root[data-theme='light']` blocks later in the same CSS file. DaisyUI tokens and custom application tokens form overlapping theme systems.
- Responsive breakpoints are present at 960, 760, 640, 480, and 380 pixels.
- Native form labels, button labels/ARIA labels, `role=alert/status`, `aria-live`, progressbar values, and semantic headings are used in many key screens. This was source-inspected, not tested with an accessibility tool.
- GSAP handles component-scoped entrance and ambient animations. `gsap.matchMedia()` checks reduced motion and compact layouts; Angular native `animate.enter`/`animate.leave` appears in templates. CSS also reduces animation and transition durations for `prefers-reduced-motion`.
- The Admin portal uses responsive tables and compact mobile layouts in shared CSS. Loading, error, empty, retry, and unavailable states are present across borrower and Admin pages.

## P. Security and reliability findings

### Confirmed from current source

1. **Admin UI routes are unguarded.** `/dashboard` is available without Auth and the “Login” page is only a link. This is explicitly a development demo, but it must not be exposed or connected to sensitive records.
2. **No frontend Admin role or account-status check exists.** Borrower `authGuard` only checks authentication and customer setup; it does not authorize server operations.
3. **Admin actor identity is caller-supplied.** Admin actions currently pass the literal `DEMO_ADMIN` into the API adapter body. A server must ignore caller identity and derive the actor from a validated session.
4. **Legacy direct Supabase lending-table operations remain in source.** Current startup config rejects the legacy borrower mode and documentation says not to use the migration, but the code still exists and is not an approved production boundary.
5. **Application and Admin API calls are not proven live.** Current repository backend docs distinguish proposed paths from the limited Node-RED routes and record 404s for application routes.
6. **No payment operations exist.** Thus no overpayment prevention or verified-payment-only balance update is enforced in this frontend.
7. **Auth state is not the same as backend authorization.** A browser route guard can be bypassed and cannot replace server RBAC/ownership checks.
8. **Service data is not cleared on sign-out.** `LoanOpsApiService.data` can retain the prior user’s customer/application/loan data in memory until a successful reload. This merits clearing on account change/logout and avoiding stale display during reload.
9. **Requirements can be fetched twice initially in the borrower dashboard.** The constructor calls `refreshRequirements()` and `reload()`; `reload()` calls it again after applications load.
10. **Shared `busy` state is a boolean for potentially concurrent calls.** One request’s `finalize()` can clear it while another request remains active. This can make loading UX inaccurate.

### Potential risks that need runtime/backend verification

- The profile RPC must be idempotent and enforce active borrower role, auth-derived identity, and uniqueness; only the supplied contract and mocked client tests were available.
- API mode manually sends a bearer token if one exists, but the server must validate the token, role/status, ownership, CSRF/CORS policy, and data-field allowlists. No frontend-only control can establish these properties.
- There is no global session-expiry redirect while already inside a protected component. Supabase auto-refresh and the route guard cover session restoration/route entry, but expiry during an active view should be tested against the Auth state callback and API errors.
- API origin defaults to plain HTTP localhost, and Angular dev servers bind to `0.0.0.0`; those settings are for local/trusted development and need HTTPS/origin restrictions for deployment.
- Old Node-RED R2 routes were documented as lacking auth/ownership checks. They should be disabled or fixed before using real documents.
- A same-browser account switch could render stale cached service data before the next response arrives; actual exposure depends on rendering/timing and should be tested.
- Auth tokens use browser storage by design. Protect account access against XSS and keep all privileged keys out of browser configuration.
- Error logging includes Supabase PostgREST error objects in the legacy mode and a config error in the public-config loader. No explicit logging of access tokens or borrower row data was found in the frontend source search; backend logs and browser runtime were not audited here.

## Q. Build and test results

Commands were run using existing dependencies; no packages were installed.

| Command | Result |
|---|---|
| `pnpm run build` | **Passed.** Borrower and Admin production builds completed. Borrower initial output: 844.63 kB raw / 197.57 kB estimated transfer, with a lazy settings chunk. Admin initial output: 790.24 kB raw / 186.61 kB estimated transfer. |
| `pnpm test` | **Passed.** Borrower: 1 test file, 18 tests. Admin: 1 test file, 1 test. |

The borrower tests cover welcome/register UI, metadata and confirmation timing, profile RPC request schema/arguments/response, no user UUID, retry/no-navigation, role-denial handling, mock-mode environment rule, demo memory behavior, no API-to-demo fallback, requirements path/token forwarding, independent Settings errors, password operations, missing-route error, readiness request, and theme persistence. Admin has one test confirming credential-free demo navigation. There are no E2E tests, live Supabase tests, live Node-RED contract tests, financial-calculation tests, Admin authorization tests, or borrower ownership tests.

Builds generate ignored bundles under `dist/borrower` and `dist/admin`; the build script also generates ignored `public/runtime-config.json`. `.angular` is a generated/cache directory. These were not committed or added to the report output.

## R. Missing functionality and implementation gaps

Priority order:

1. **Secure backend contract and identity mapping:** verify the actual Auth role lifecycle, `initialize_customer_profile` grants/idempotency, and `get_my_profile`; ensure Node-RED derives local customer identity from verified Supabase identity.
2. **Admin security:** implement real Admin sign-in/session/role guards and server-side Admin RBAC before exposing the Admin portal or connecting it to real data.
3. **Borrower operational APIs:** deploy and contract-test application list/create/update/readiness/submit and account eligibility routes, with server-side ownership and validation.
4. **Profile/settings APIs:** implement authenticated profile read/update and category-change behavior; return saved backend values, not signup form state.
5. **Account verification and document lifecycle:** establish a borrower-owned private storage/metadata model, secure upload/download and review routes, category applicability/history, and authoritative eligibility; separate account verification from application documents.
6. **Financial ledger and payments:** add payment submission/verification, no-overpayment and balance invariants, audit events, idempotency, and authoritative decimal-safe DB calculations.
7. **Admin operations:** implement and verify list/details, approval, manual disbursement, document review, rejection/request-information, and actor attribution.
8. **Align TypeScript IDs/contracts:** UUID `customers.id` vs numeric frontend `Customer.id`/`Application.customerId`; verify API payload/response shapes, status unions, numeric handling, and missing payment/reminder types.
9. **Resolve borrower policy questions:** student registration evidence, employed requirements, unemployed confirmation, passport vs national-ID requirement, and requirements/eligibility semantics.
10. **Clean up/retire legacy Supabase lending mode** after confirming there are no supported consumers; do not apply the deprecated migration.
11. **Improve state/error lifecycle:** clear service-held borrower data on logout/account switch, avoid duplicate requirements loads, and track concurrent requests reliably.
12. **Theme and accessibility verification:** resolve the requested light background mismatch and validate keyboard/screen-reader/responsive behavior in browser tests.

## S. Recommended next implementation sequence

1. Reconcile this frontend audit with the owner-supplied backend implementation report and verify exact RPC signatures/return rows, role grants, Auth hooks, and idempotency without exposing secrets or borrower data.
2. Complete customer-profile verification by using the confirmed `get_my_profile` contract after initialization, if that is the required authoritative check; do not guess its signature.
3. Define and test the server-side Auth UUID → `loanops.customers.id` path; enforce borrower ownership and Admin roles on every endpoint.
4. Implement a small borrower API slice end-to-end (profile/eligibility, application retrieval/create/update/readiness/submit) with integration tests before enabling API-mode UX.
5. Add private account-document metadata and storage/upload/review paths only after ownership is secured. Keep documents private and do not use the historical unauthenticated R2 endpoints.
6. Implement Admin authentication/RBAC and protected APIs before allowing `api` mode or real data in `AdminPortal`. Remove caller-supplied `DEMO_ADMIN` actor semantics.
7. Add payment submission and verification after the database ledger rules are agreed, with decimal-safe authoritative calculations, no overpayment, audit trail, and idempotency.
8. Align frontend models to actual DB/API contracts and add API integration tests, ownership tests, role tests, and browser E2E coverage.
9. Remove or isolate the legacy Supabase lending mode after confirming compatibility and migration history. Keep the deprecated migration clearly non-runnable.
10. Fix client state lifecycle and usability issues (stale data after logout, duplicate requirements fetch, concurrent busy tracking), then complete visual/accessibility verification.

Do not treat a successful Angular build or mocked unit test as proof that any backend endpoint or RPC is deployed.

## T. File reference index

| Topic | Primary references |
|---|---|
| Angular projects/builds/ports | [`angular.json`](../angular.json#L8) lines 8-156, [`package.json`](../package.json#L1) lines 1-53 |
| Borrower route table | [`apps/borrower/src/main.ts`](../apps/borrower/src/main.ts#L14) lines 14-32 |
| Admin route table | [`apps/admin/src/main.ts`](../apps/admin/src/main.ts#L11) lines 11-19 |
| Auth initialization and session | [`src/core/auth.service.ts`](../src/core/auth.service.ts#L105) lines 105-483; session restoration 189-205; Auth change callback 163-175 |
| Signup/sign-in/profile provisioning | [`src/core/borrower-auth.ts`](../src/core/borrower-auth.ts#L54) lines 54-93 and 186-292; [`src/core/auth.service.ts`](../src/core/auth.service.ts#L207) lines 207-298 and 347-428; guard 471-483 |
| API modes/routes/errors | [`src/core/loanops-api.service.ts`](../src/core/loanops-api.service.ts#L162) lines 162-410, legacy Supabase reads/writes 411-650, error/request handling 651-710 |
| Types and requirements | [`src/core/models.ts`](../src/core/models.ts#L1) lines 1-111 |
| Borrower application/dashboards | [`src/core/borrower-portal.ts`](../src/core/borrower-portal.ts#L102) lines 102-433; application handlers 197-320 |
| Settings/profile/documents/password | [`src/core/borrower-settings.ts`](../src/core/borrower-settings.ts#L217) lines 217-438; [`src/core/borrower-account.service.ts`](../src/core/borrower-account.service.ts#L24) lines 24-47 |
| Admin demo/workflows | [`src/core/admin-portal.ts`](../src/core/admin-portal.ts#L30) lines 30-61 and 132-302 |
| Runtime config and secret allowlist | [`src/core/public-config.ts`](../src/core/public-config.ts#L1) lines 1-69; [`scripts/prepare-public-config.mjs`](../scripts/prepare-public-config.mjs#L1) lines 1-59; [`.gitignore`](../.gitignore#L1) lines 1-57 |
| Theme and motion | [`src/core/theme.service.ts`](../src/core/theme.service.ts#L1) lines 1-36; [`src/core/portal-motion.ts`](../src/core/portal-motion.ts#L1) lines 1-65; [`src/styles.css`](../src/styles.css#L1) lines 1-3005 |
| Backend routes/contracts/status | [`docs/API_CONTRACT.md`](./API_CONTRACT.md), [`docs/BACKEND_INTEGRATION.md`](./BACKEND_INTEGRATION.md), [`docs/AUTH_DATA_ARCHITECTURE.md`](./AUTH_DATA_ARCHITECTURE.md) |
| Local schema and deprecated migration | [`supabase/loanops.md`](../supabase/loanops.md), [`supabase/migrations/20261029153000_borrower_accounts.sql`](../supabase/migrations/20261029153000_borrower_accounts.sql) |
| Tests | [`apps/borrower/src/borrower.spec.ts`](../apps/borrower/src/borrower.spec.ts), [`apps/admin/src/admin.spec.ts`](../apps/admin/src/admin.spec.ts) |
