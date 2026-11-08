import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { authGuard } from '../../../src/core/auth.service';
import {
  BorrowerPasswordRecovery,
  BorrowerPasswordReset,
  BorrowerRegister,
  BorrowerSignIn,
} from '../../../src/core/borrower-auth';
import { BorrowerLogin, BorrowerPortal } from '../../../src/core/borrower-portal';
import { BorrowerRoot } from '../../../src/core/borrower-root';
import { loadPublicRuntimeConfig, PUBLIC_RUNTIME_CONFIG } from '../../../src/core/public-config';

void loadPublicRuntimeConfig().then((runtimeConfig) => bootstrapApplication(BorrowerRoot, {
  providers: [
    { provide: PUBLIC_RUNTIME_CONFIG, useValue: { ...runtimeConfig, dataMode: runtimeConfig.borrowerDataMode } },
    provideHttpClient(),
    provideRouter([
      { path: '', pathMatch: 'full', component: BorrowerLogin },
      { path: 'welcome', pathMatch: 'full', redirectTo: '' },
      { path: 'login', component: BorrowerSignIn },
      { path: 'sign-in', component: BorrowerSignIn },
      { path: 'register', component: BorrowerRegister },
      { path: 'forgot-password', component: BorrowerPasswordRecovery },
      { path: 'reset-password', component: BorrowerPasswordReset },
      { path: 'dashboard', component: BorrowerPortal, canActivate: [authGuard] },
      { path: 'settings', loadComponent: () => import('../../../src/core/borrower-settings').then((module) => module.BorrowerSettings), canActivate: [authGuard] },
      { path: '**', redirectTo: 'login' },
    ]),
  ],
})).catch((error: unknown) => console.error(error));
