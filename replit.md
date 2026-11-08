# Replit run instructions

Replit's default Run action starts the **Borrower Portal** only:

```bash
npm run start:borrower
```

It binds to `0.0.0.0:4200`. In a separate Replit Shell, start the independent **Admin Portal**:

```bash
npm run start:admin
```

The Admin Portal binds to `0.0.0.0:4201`. If Replit does not expose port 4201 automatically, open the Ports tool and expose/forward that port if the workspace permits it. The exact public URL and multi-port availability are controlled by the active Replit workspace; do not assume port 4201 is publicly forwarded. Both runtimes are unauthenticated development demos containing fictional data only.

Install once with `pnpm install` (or npm if the environment uses npm), then run either script from the repository root. Build verification:

```bash
npm run build:borrower
npm run build:admin
```

Port conflicts: stop the process already using the port, or pass a one-off CLI port override, for example `npx ng serve borrower --host 0.0.0.0 --port 4300`. Update the Replit port forwarding configuration to match.

For local IDE use, open two terminals in the downloaded repository and run `npm run start:borrower` and `npm run start:admin` separately. See [docs/REPLIT.md](./docs/REPLIT.md).
