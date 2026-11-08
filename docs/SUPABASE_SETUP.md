# Supabase Auth and LoanOps setup

Supabase Auth provides identity and sessions. The existing exposed `loanops` schema and its approved RPC functions are the lending interface. PostgreSQL remains authoritative for applications, loans, payments, and balances. Do not introduce direct operational-table access or a second HTTP proxy.

## Do not apply the obsolete borrower migration

[`20261029153000_borrower_accounts.sql`](../supabase/migrations/20261029153000_borrower_accounts.sql) belongs to an earlier direct-table design. Do not apply or re-apply it.

## Browser-safe configuration

The ignored repository-root `.env` supplies:

```dotenv
PJLOANS_AUTH_MODE=supabase
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
PJLOANS_MODE=demo
PJLOANS_BORROWER_MODE=demo
```

Only the project URL, publishable key, and mode values are emitted to `public/runtime-config.json`. Never expose `SUPABASE_SECRET_KEY`, service-role keys, database credentials, R2 secrets, or other privileged values in Angular configuration or bundles.

## Borrower registration

`AuthService` uses the existing Supabase client. Once a signup or later sign-in yields an authenticated session, it calls `loanops.initialize_customer_profile` through `.schema('loanops').rpc(...)` with `p_phone`, `p_full_name`, `p_national_id`, and `p_borrower_type`. No browser-supplied user/customer ID is sent. When email confirmation is required, initialization waits until sign-in.

The client checks that initialization returns exactly one profile row, then calls `loanops.get_my_profile` and verifies that the profile UUID matches the authenticated user. If initialization succeeds but profile retrieval fails, retrying does not repeat initialization. The deployed function signatures, idempotency behavior, role check, and live responses have not been independently inspected from this workspace; do not treat successful local mocks as live verification.

## Admin authorization

The non-demo Admin route requires a Supabase session and requests only `app_role` and `account_status` from the current user's `public.user_roles` row, using the user ID returned by `auth.getUser()`. It fails closed unless the role is `ADMIN` and status is `ACTIVE`. It never uses editable `user_metadata` as authorization and never writes `user_roles`.

The role query is a client-side navigation check only. Every Admin RPC must independently enforce authorization. Do not widen table privileges to make the UI guard work; if the established role policy does not allow the caller to read their own row, use the existing secured role mechanism or update its policy through the approved database process.

## Admin invitation and password setup

On the Admin login screen, **Create or reset your password** asks for the invited Admin's email and calls Supabase Auth `resetPasswordForEmail` with a redirect to `/auth/callback?flow=admin-password-setup`. The page gives the same success response whether or not an account exists, so it does not disclose registered emails. Supabase sends the one-time recovery link to the registered address; mailbox access—not knowledge of an email address—is required to continue. Users can also accept the original developer invitation link.

The callback supports Supabase `token_hash` verification, PKCE `code` exchange, and implicit access-token fragments handled by the existing Supabase client. It then verifies the authenticated user and the existing `public.user_roles` ADMIN/ACTIVE row. The password screen only accepts a callback session established by the one-time invite/recovery link, scoped to the current browser tab and user ID. Direct visits, expired/reused links, unauthenticated sessions, and non-Admin accounts cannot set a password. No role is granted by this flow.

In Supabase Authentication URL Configuration, allow the Admin callback URL for each environment (for example `http://localhost:4201/auth/callback` during local development and `https://<admin-host>/auth/callback` in production). Supabase's password recovery email must use its standard confirmation URL and honor the `redirect_to` supplied by the app. If dashboard invitations use the Site URL instead, the Admin root forwards invite links; leave the Site URL unchanged if changing it would affect Borrower auth flows.

After password setup, the frontend calls `auth.updateUser({ password })`, refreshes the session, rechecks the trusted role, and routes the active Admin to `/dashboard`. Supabase sends the password-changed security email only when that project-level notification is enabled. In the Supabase Dashboard, enable **Password changed** under Authentication security notifications (Auth configuration key: `mailer_notifications_password_changed_enabled`) and review its **Password changed notification** email template under Authentication > Email Templates. This is a security notification, not another email-verification link. The frontend does not send email directly.

## Schema exposure and operation contracts

Verify that `loanops` is exposed in Supabase Data API settings and grant only the needed schema/function access. Do not use blanket grants on all tables, routines, or sequences. The frontend is wired to the RPC contracts supplied with the implementation request; backend owners still need to compare deployed argument names, result shapes, authorization rules, and transaction/idempotency behavior against those contracts. Operations without supplied contracts remain unavailable.

The public Supabase OpenAPI endpoint in this environment reports that a secret API key is required; no secret key is used for client or agent introspection. Local PostgreSQL catalog access also requires unavailable database credentials. Current operation blockers and a safe migration proposal are in [FRONTEND_INTEGRATION_STATUS.md](./FRONTEND_INTEGRATION_STATUS.md).
