# PjVault

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.2.3.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.

## PJVault borrower requests

The browser runtime needs `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`). Only the publishable key is written to `public/runtime-config.json`; secret keys belong in the Edge Function environment only.

The admin app uses:

- `POST /functions/v1/pjvault-admin-session` with the authenticated session. The function validates the JWT and calls `private.pjvault_is_active_admin()`, which enforces the PJVault membership and admin-role records. The browser never reads private authorization tables or uses a service-role key.
- `POST /functions/v1/pjvault-admin-api` with `action: "create_request"` to create a request. Raw link tokens are returned only to form the shareable `?token=` URL.
- The same authenticated admin API supports submitted-application details, document decisions, loan approval, and paginated loan lists. The admin workspace reviews submitted documents before enabling approval; approval records a BWP amount and due date.
- `POST /functions/v1/pjvault-admin-view-url` issues a short-lived, audited URL for an administrator to view a private borrower document. Keep document objects private in R2; the browser receives only the temporary preview URL.

Borrower exchange, request status, upload intents, R2 upload authorization, file verification/finalization, and details submission are handled by `POST /functions/v1/pjvault-borrower-api`. That function uses the PJVault `public.pjvault_borrower_*` RPCs and must be deployed with JWT verification disabled: borrower upload sessions are opaque, short-lived bearer tokens rather than Supabase Auth JWTs. Its server environment needs the existing Supabase secret-key map and the R2 endpoint, access credentials, and bucket name used by PJVault document viewing. Do not copy those values into Angular or the runtime configuration.

Keep the R2 bucket private. Configure its CORS policy for the deployed app origin, `PUT`, and the `Content-Type` request header so browser uploads to presigned URLs work. CORS does not make the bucket public. The app marks a file complete only after the Edge Function verifies its stored bytes and the PJVault finalization RPC succeeds.
