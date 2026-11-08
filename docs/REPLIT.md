# Replit and local multi-port development

## Replit

1. Run the default Run action. The `.replit` file starts `npm run start:borrower` on `0.0.0.0:4200`.
2. Open a second Shell from the Replit workspace.
3. Run `npm run start:admin`; it starts the independent Admin Angular application on `0.0.0.0:4201`.
4. Use the preview for port 4200 for borrowers. If port 4201 is not forwarded, expose it in the Replit Ports panel where available. Multi-port forwarding depends on the workspace; the app cannot guarantee that Replit publishes every port.
5. The portals are separate app builds and runtimes, not roles on a shared page.

Replit dependency setup: run `pnpm install` when pnpm is available. The package scripts can also be run with npm after dependencies are installed.

## Downloaded codebase / local IDE

```bash
pnpm install
```

Open two terminals at the repository root:

```bash
pnpm run start:borrower
```

```bash
pnpm run start:admin
```

Local defaults are `http://localhost:4200` and `http://localhost:4201`. Both bind to `0.0.0.0` for trusted LAN device testing. If a port is occupied, stop the conflicting process or run `npx ng serve borrower --host 0.0.0.0 --port 4300` and adjust forwarding accordingly.

The development admin app is not authenticated. Keep it on a trusted network and use only fictional demo data.
