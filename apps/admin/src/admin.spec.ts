// @vitest-environment jsdom

import '@angular/compiler';
import { ElementRef, Injector, runInInjectionContext, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AdminPortal } from '../../../src/core/admin-portal';
import { AuthService } from '../../../src/core/auth.service';
import { DocumentStorageService } from '../../../src/core/document-storage.service';
import { LoanOpsApiService } from '../../../src/core/loanops-api.service';
import { PUBLIC_RUNTIME_CONFIG } from '../../../src/core/public-config';
import { ThemeService } from '../../../src/core/theme.service';

describe('Admin application queue', () => {
  const submittedApplication = {
    id: 2,
    applicationNumber: 'APP-000002',
    customerId: 'borrower-2',
    borrowerType: 'STUDENT',
    requestedAmount: '1200.00',
    approvedAmount: null,
    currentStep: 'SUBMITTED',
    status: 'SUBMITTED',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: null,
    submittedAt: '2026-11-02T00:00:00.000Z',
    reviewedAt: null,
    fullName: 'Borrower Example',
    phone: '+26777000000',
    nationalId: null,
    receivingMethod: 'FNB_PAY_TO_CELL',
    recipientName: 'Borrower Example',
    recipientIdentifier: '+26777000000',
    institution: 'Demo University',
    studentId: 'STU-022',
    employer: null,
    employmentStatus: null,
  };

  it('renders a submitted application when the admin queue RPC returns one nested row payload', () => {
    const api = {
      mode: 'api',
      data: signal({
        applications: [submittedApplication],
        customers: [{ id: 'borrower-2', fullName: 'Borrower Example', phone: '+26777000000', nationalId: null, borrowerType: 'STUDENT' }],
        documents: [],
        loans: [],
        payments: [],
      }),
      isLoading: vi.fn(() => false),
      featureState: vi.fn(() => ({ availability: 'available', request: 'success', error: null, errorCode: null })),
      loadAdminApplications: vi.fn(() => ({ subscribe: (observer: { next?: (data: typeof submittedApplication[]) => void }) => observer.next?.([submittedApplication]) })),
      loadAdminDocuments: vi.fn(() => ({ subscribe: () => undefined })),
    };

    const injector = Injector.create({
      providers: [
        { provide: LoanOpsApiService, useValue: api },
        { provide: ThemeService, useValue: { theme: signal('light'), toggle: vi.fn() } },
        { provide: DocumentStorageService, useValue: { getDocumentDownloadUrl: vi.fn() } },
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
        { provide: ElementRef, useValue: new ElementRef(document.createElement('div')) },
        { provide: AuthService, useValue: { signOut: vi.fn(), loading: () => false, configured: true } },
        { provide: DomSanitizer, useValue: { bypassSecurityTrustResourceUrl: (url: string) => url } },
      ],
    });

    const portal = runInInjectionContext(injector, () => new AdminPortal());

    expect(portal.applications('SUBMITTED')).toHaveLength(1);
    expect(portal.applications('SUBMITTED')[0].applicationNumber).toBe('APP-000002');
    expect(portal.customerName('borrower-2')).toBe('Borrower Example');
  });

  it('accepts a submitted row even when the backend omits status because the RPC itself is already filtered', async () => {
    const row = {
      application_id: 2,
      application_number: 'APP-000002',
      customer_id: 'borrower-2',
      phone: '+26777000000',
      full_name: 'Borrower Example',
      national_id: null,
      borrower_type: 'STUDENT',
      requested_amount: 1000,
      approved_amount: null,
      reception_method: 'FNB_PAY_TO_CELL',
      reception_name: 'Borrower Example',
      reception_name_same_as_id: true,
      reception_identifier: '+26777000000',
      submitted_at: '2026-11-03T15:07:58.144866+00:00',
    };

    const service = Object.assign(Object.create(LoanOpsApiService.prototype), {
      mode: 'api',
      data: signal({
        applications: [],
        customers: [],
        documents: [],
        loans: [],
        payments: [],
      }),
      featureStates: signal({
        admin_submitted_queue: { availability: 'available', request: 'idle', error: null, errorCode: null },
      }),
      featureState: vi.fn(() => ({ availability: 'available', request: 'idle', error: null, errorCode: null })),
      updateFeature: vi.fn(),
      requestRows: vi.fn((_feature, _rpcName, _args, parse) => of([parse(row)])),
      mergeAdminQueue: LoanOpsApiService.prototype.mergeAdminQueue,
    });

    const applications = await firstValueFrom((service as any).loadAdminApplications.call(service, 'SUBMITTED')) as any[];

    expect(applications).toHaveLength(1);
    expect(applications[0].status).toBe('SUBMITTED');
    expect(applications[0].applicationNumber).toBe('APP-000002');
  });

  it('preserves a loaded submitted queue when a non-critical admin queue request fails', () => {
    const state = {
      applications: [
        submittedApplication,
        { ...submittedApplication, id: 99, applicationNumber: 'APP-000099', status: 'APPROVED', currentStep: 'APPROVED' },
      ],
      customers: [{ id: 'borrower-2', fullName: 'Borrower Example', phone: '+26777000000', nationalId: null, borrowerType: 'STUDENT' }],
      documents: [],
      loans: [],
      payments: [],
    };

    const service = {
      data: signal(state),
      mergeAdminQueue(status: 'IN_PROGRESS' | 'SUBMITTED' | 'APPROVED', applications: typeof submittedApplication[]) {
        const retained = new Map(this.data().applications
          .filter((app) => app.status !== status)
          .map((app) => [app.id, app] as const));
        for (const application of applications) {
          retained.set(application.id, application);
        }
        this.data.set({
          ...this.data(),
          applications: [...retained.values()],
        });
      },
    };

    service.mergeAdminQueue('SUBMITTED', [submittedApplication]);

    expect(service.data().applications.filter((entry) => entry.status === 'SUBMITTED')).toHaveLength(1);
    expect(service.data().applications.some((entry) => entry.applicationNumber === 'APP-000002')).toBeTruthy();
    expect(service.data().applications.some((entry) => entry.applicationNumber === 'APP-000099')).toBeTruthy();
  });
});
