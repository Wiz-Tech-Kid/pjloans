import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { adminGuard, adminPasswordSetupGuard } from '../../../src/core/auth.service';
import { AdminAuthCallback, AdminLogin, AdminPasswordSetup, AdminPortal } from '../../../src/core/admin-portal';
import { AdminRoot } from '../../../src/core/admin-root';
import { loadPublicRuntimeConfig, PUBLIC_RUNTIME_CONFIG } from '../../../src/core/public-config';

void loadPublicRuntimeConfig().then((runtimeConfig) => bootstrapApplication(AdminRoot, {
  providers: [
    { provide: PUBLIC_RUNTIME_CONFIG, useValue: runtimeConfig },
    provideHttpClient(),
    provideRouter([
      { path: '', pathMatch: 'full', component: AdminLogin },
      { path: 'login', component: AdminLogin },
      { path: 'auth/callback', component: AdminAuthCallback },
      {
        path: 'admin/setup-password',
        component: AdminPasswordSetup,
        canActivate: [adminPasswordSetupGuard],
      },
      {
        path: 'dashboard',
        component: AdminPortal,
        canActivate: runtimeConfig.dataMode === 'demo' ? [] : [adminGuard],
      },
      { path: '**', redirectTo: 'login' },
    ]),
  ],
})).catch((error: unknown) => console.error(error));
