import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../../src/core/environment';
import { AuthService } from '../../../src/core/auth.service';
import { BorrowerRegister } from '../../../src/core/borrower-auth';
import { BorrowerAccountService } from '../../../src/core/borrower-account.service';
import { LoanOpsApiService } from '../../../src/core/loanops-api.service';
import { BorrowerSettings } from '../../../src/core/borrower-settings';
import { ApplicationDraft } from '../../../src/core/models';
import { BorrowerLogin, BorrowerPortal } from '../../../src/core/borrower-portal';
import { AdminPortal } from '../../../src/core/admin-portal';
import { DocumentStorageService, MAX_APPLICATION_DOCUMENT_SIZE, validateApplicationDocument } from '../../../src/core/document-storage.service';
import { PUBLIC_RUNTIME_CONFIG } from '../../../src/core/public-config';
import { ThemeService } from '../../../src/core/theme.service';
import { firstValueFrom, of } from 'rxjs';

const draft: ApplicationDraft = {
  phone: '+26772000003',
  fullName: 'Fictional Test Borrower',
  nationalId: 'DEMO-ID-003',
  borrowerType: 'STUDENT',
  requestedAmount: 1000,
  institution: 'Demo College',
  studentId: 'DEMO-003',
  employer: '',
  employmentStatus: '',
  receivingMethod: 'CASH',
  recipientName: 'Fictional Test Borrower',
  sameAsId: true,
  recipientIdentifier: '',
};

const apiConfig = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  authMode: 'supabase' as const,
  dataMode: 'demo' as const,
  borrowerDataMode: 'demo' as const,
  loadError: null,
};

const authConfig = {
  ...apiConfig,
  supabaseUrl: 'https://unit-test.supabase.co',
  supabaseAnonKey: 'test-publishable-key',
  authMode: 'supabase' as const,
};

const authUserId = 'c0a80123-4567-489a-8abc-123456789abc';
const loanOpsCustomerId = authUserId;

function authenticatedRpcProvider(rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>) {
  const profile = {
    customerId: authUserId,
    phone: '+267 71 234 567',
    fullName: 'Test Borrower',
    nationalId: null,
    borrowerType: 'STUDENT' as const,
  };
  return {
    configured: true,
    user: () => ({ id: authUserId }),
    customerProfile: () => profile,
    isAuthenticated: () => true,
    getSupabaseClient: () => ({
      schema: (schema: string) => {
        if (schema !== 'loanops') throw new Error('Unexpected schema');
        return { rpc };
      },
    }),
  };
}

const applicationRow = {
  application_id: '41',
  application_number: 'APP-000041',
  customer_id: authUserId,
  borrower_type: 'STUDENT',
  requested_amount: '1250.25',
  approved_amount: null,
  current_step: 'IN_PROGRESS',
  status: 'IN_PROGRESS',
  created_at: '2026-10-30T12:00:00.000Z',
  reception_method: 'CASH',
  reception_name: 'Test Borrower',
  reception_name_same_as_id: true,
  reception_identifier: null,
  institution: 'Test College',
  student_id: 'STU-41',
};

function makeAuthUser(
  userMetadata: Record<string, unknown> = {
    full_name: 'Test Borrower',
    phone: '+267 71 234 567',
    borrower_type: 'STUDENT',
  },
) {
  return {
    id: authUserId,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'borrower@example.com',
    email_confirmed_at: '2026-10-30T12:00:00.000Z',
    phone: '',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: userMetadata,
    identities: [],
    created_at: '2026-10-30T12:00:00.000Z',
    updated_at: '2026-10-30T12:00:00.000Z',
  };
}

function makeAuthSession(user = makeAuthUser()) {
  return {
    access_token: 'test-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'test-refresh-token',
    user,
  };
}

function mockSupabaseFetch(
  options: {
    signupRequiresConfirmation?: boolean;
    rpcStatus?: number;
    rpcBody?: unknown;
  } = {},
) {
  const requests: Array<{ url: string; method: string; headers: Headers; body: string }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = await request.clone().text();
    requests.push({
      url: request.url,
      method: request.method,
      headers: new Headers(request.headers),
      body,
    });

    if (url.pathname === '/auth/v1/signup') {
      const user = makeAuthUser();
      const response = options.signupRequiresConfirmation ? user : makeAuthSession(user);
      return Response.json(response);
    }
    if (url.pathname === '/auth/v1/token') {
      return Response.json(makeAuthSession());
    }
    if (url.pathname === '/rest/v1/rpc/initialize_customer_profile') {
      return Response.json(
        options.rpcBody ?? [
          {
            customer_id: loanOpsCustomerId,
            phone: '+267 71 234 567',
            full_name: 'Test Borrower',
            national_id: null,
            borrower_type: 'STUDENT',
          },
        ],
        { status: options.rpcStatus ?? 200 },
      );
    }
    if (url.pathname === '/rest/v1/rpc/get_my_profile') {
      return Response.json([
        {
          customer_id: loanOpsCustomerId,
          phone: '+267 71 234 567',
          full_name: 'Test Borrower',
          national_id: null,
          borrower_type: 'STUDENT',
        },
      ]);
    }
    return Response.json({ message: 'Unexpected test request.' }, { status: 500 });
  });
  return { fetchMock, requests };
}

describe('Borrower application', () => {
  const originalProduction = environment.production;

  it('accepts supported document formats up to 20 MiB', () => {
    for (const [mimeType, extension] of [
      ['application/pdf', 'pdf'],
      ['image/jpeg', 'jpg'],
      ['image/png', 'png'],
    ]) {
      expect(validateApplicationDocument(new File(['safe test file'], `test.${extension}`, { type: mimeType }))).toBeNull();
    }
    expect(validateApplicationDocument(new File(
      [new Uint8Array(MAX_APPLICATION_DOCUMENT_SIZE)],
      'at-limit.pdf',
      { type: 'application/pdf' },
    ))).toBeNull();
    expect(validateApplicationDocument(new File(
      [new Uint8Array(MAX_APPLICATION_DOCUMENT_SIZE + 1)],
      'large.pdf',
      { type: 'application/pdf' },
    ))).toContain('20 MiB');
  });

  it('rejects empty files and unsupported document formats', () => {
    expect(validateApplicationDocument(new File([], 'empty.pdf', { type: 'application/pdf' }))).toContain('empty');
    expect(validateApplicationDocument(new File(['test'], 'document.txt', { type: 'text/plain' }))).toContain('PDF, JPEG, or PNG');
  });

  it('treats real backend response errors as application errors, not network errors', async () => {
    await TestBed.configureTestingModule({
      imports: [BorrowerPortal],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        { provide: PUBLIC_RUNTIME_CONFIG, useValue: { ...apiConfig, dataMode: 'api' as const, borrowerDataMode: 'api' as const } },
        { provide: AuthService, useValue: authenticatedRpcProvider(async () => ({ data: null, error: { message: 'The application response could not be processed.' } })) },
      ],
    }).compileComponents();

    const service = TestBed.inject(LoanOpsApiService) as any;
    const backendFailure = service.failureFrom(
      new Error('The application response could not be processed.'),
      'application_submission',
      'submit_application',
    );
    expect(backendFailure.code).toBe('INVALID_RESPONSE');
    expect(backendFailure.message).toContain('The application response could not be processed.');

    const networkFailure = service.failureFrom(
      new TypeError('Failed to fetch'),
      'application_submission',
      'submit_application',
    );
    expect(networkFailure.code).toBe('NETWORK_ERROR');
    expect(networkFailure.message).toContain('Could not connect to complete application submission');
  });


  it('refreshes borrower documents after finalization and displays the listed backend status', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'get_my_applications') return { data: [applicationRow], error: null };
      return { data: [], error: null };
    });
    const uploadApplicationDocument = vi.fn(() => of({
      stage: 'PENDING_REVIEW' as const,
      progress: 100,
      documentId: 81,
      documentStatus: 'PENDING' as const,
    }));
    await TestBed.configureTestingModule({
      imports: [BorrowerPortal],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        {
          provide: PUBLIC_RUNTIME_CONFIG,
          useValue: { ...apiConfig, dataMode: 'api' as const, borrowerDataMode: 'api' as const },
        },
        { provide: AuthService, useValue: authenticatedRpcProvider(rpc) },
        { provide: DocumentStorageService, useValue: { uploadApplicationDocument } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(BorrowerPortal);
    fixture.detectChanges();
    await fixture.whenStable();
    const api = TestBed.inject(LoanOpsApiService);
    const refreshDocuments = vi.spyOn(api, 'loadMyApplicationDocuments').mockReturnValue(of([{
      id: 81,
      applicationId: 41,
      documentType: 'IDENTITY_DOCUMENT',
      fileName: 'identity.pdf',
      status: 'VERIFIED',
      createdAt: '2026-11-02T12:00:00.000Z',
    }]));
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['test file'], 'identity.pdf', { type: 'application/pdf' })],
    });
    fixture.componentInstance.selectDocumentFile({ target: input } as unknown as Event, 41, 'IDENTITY_DOCUMENT');

    fixture.componentInstance.startUpload(41, 'IDENTITY_DOCUMENT');

    expect(uploadApplicationDocument).toHaveBeenCalledOnce();
    expect(refreshDocuments).toHaveBeenCalledWith(41);
    expect(fixture.componentInstance.uploadState(41, 'IDENTITY_DOCUMENT')).toMatchObject({
      stage: 'VERIFIED',
      documentId: 81,
      documentStatus: 'VERIFIED',
    });
    expect(fixture.componentInstance.message()).toContain('Backend status: VERIFIED');
    fixture.destroy();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
    environment.production = originalProduction;
    TestBed.resetTestingModule();
  });

  it('offers account creation and sign-in without provider implementation copy', async () => {
    await TestBed.configureTestingModule({
      imports: [BorrowerLogin],
      providers: [
        provideRouter([]),
        { provide: PUBLIC_RUNTIME_CONFIG, useValue: { ...apiConfig, authMode: 'mock' as const } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(BorrowerLogin);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Make your next move count.');
    expect(element.querySelector('a[routerLink="/register"]')?.textContent).toContain(
      'Create account',
    );
    expect(element.querySelector('a[routerLink="/sign-in"]')?.textContent).toContain('Sign in');
    expect(element.querySelector('a[routerLink="/dashboard"]')?.textContent).toContain(
      'Continue to Borrower Portal',
    );
    expect(element.textContent).not.toMatch(/supabase|auth enabled|provider/i);
    expect(element.querySelector('a[routerLink="/admin"]')).toBeNull();
  });

  it('offers Botswana institutions, BCET locations, and a manual institution option', async () => {
    await TestBed.configureTestingModule({
      imports: [BorrowerPortal],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        { provide: PUBLIC_RUNTIME_CONFIG, useValue: apiConfig },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(BorrowerPortal);
    fixture.componentInstance.page.set('application');
    fixture.componentInstance.wizardStep.set(2);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const institutionSelect = [...element.querySelectorAll('select')]
      .find((select) => select.closest('label')?.textContent?.includes('Institution'));
    expect(institutionSelect).toBeDefined();
    const institutionNames = [...(institutionSelect?.options ?? [])]
      .map((option) => option.textContent?.trim() ?? '')
      .filter((name) => name && name !== 'Choose your institution' && name !== 'Other institution');
    expect(institutionNames).toEqual([...institutionNames].sort((left, right) => left.localeCompare(right)));
    expect(institutionSelect?.textContent).toContain('University of Botswana (UB)');
    expect(institutionSelect?.textContent).toContain('Botho University');
    expect(institutionSelect?.textContent).toContain('Kanye Seventh-day Adventist (SDA) College of Nursing');
    expect(institutionSelect?.textContent).toContain('Other institution');

    if (!institutionSelect) throw new Error('Expected the institution selector to render.');
    institutionSelect.value = 'Botswana College of Engineering and Technology (BCET)';
    institutionSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const locationSelect = [...element.querySelectorAll('select')]
      .find((select) => select.closest('label')?.textContent?.includes('BCET location'));
    expect(locationSelect?.textContent).toContain('Ramotswa');
    if (!locationSelect) throw new Error('Expected the BCET location selector to render.');
    locationSelect.value = 'Ramotswa';
    locationSelect.dispatchEvent(new Event('change'));
    expect(fixture.componentInstance.form.controls.institution.value)
      .toBe('Botswana College of Engineering and Technology (BCET) - Ramotswa');

    institutionSelect.value = 'OTHER';
    institutionSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const manualInput = element.querySelector<HTMLInputElement>('input[formControlName="institution"]');
    expect(manualInput).not.toBeNull();
    if (!manualInput) throw new Error('Expected a manual institution input.');
    manualInput.value = 'My Training Institute';
    manualInput.dispatchEvent(new Event('input'));
    expect(fixture.componentInstance.form.controls.institution.value).toBe('My Training Institute');
  });

  it('resumes an existing application instead of reopening the first step', async () => {
    await TestBed.configureTestingModule({
      imports: [BorrowerPortal],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        { provide: PUBLIC_RUNTIME_CONFIG, useValue: apiConfig },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(BorrowerPortal);
    fixture.detectChanges();

    fixture.componentInstance.continueApplication();
    fixture.detectChanges();

    expect(fixture.componentInstance.page()).toBe('application');
    expect(fixture.componentInstance.wizardStep()).toBe(3);
    expect(fixture.nativeElement.textContent).toContain('Step 4 of 5');

    fixture.componentInstance.form.controls.fullName.setValue('Unsaved edit');
    fixture.componentInstance.continueApplication();
    expect(fixture.componentInstance.form.controls.fullName.value).toBe('Unsaved edit');
  });

  it('restores the last saved wizard step for an existing application', async () => {
    await TestBed.configureTestingModule({
      imports: [BorrowerPortal],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        { provide: PUBLIC_RUNTIME_CONFIG, useValue: apiConfig },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(BorrowerPortal);
    fixture.detectChanges();
    sessionStorage.setItem('pjloans.application-step:DEMO-CUSTOMER-001:1', '2');

    fixture.componentInstance.continueApplication();
    fixture.detectChanges();

    expect(fixture.componentInstance.wizardStep()).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('Step 3 of 5');
  });

  it('creates an application draft as soon as the borrower continues from the first step', async () => {
    await TestBed.configureTestingModule({
      imports: [BorrowerPortal],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        { provide: PUBLIC_RUNTIME_CONFIG, useValue: apiConfig },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(BorrowerPortal);
    fixture.detectChanges();
    const api = TestBed.inject(LoanOpsApiService);
    api.data.update((current) => ({ ...current, applications: [] }));
    fixture.componentInstance.page.set('application');
    fixture.componentInstance.wizardStep.set(0);

    fixture.componentInstance.nextStep();
    fixture.detectChanges();

    expect(fixture.componentInstance.wizardStep()).toBe(1);
    expect(api.data().applications).toHaveLength(1);
    expect(api.data().applications[0].status).toBe('IN_PROGRESS');
  });

  it('sends normalized borrower type and profile fields, then shows confirmation only when requested', async () => {
    const signUp = vi.fn(async (_email: string, _password: string, _profile: unknown) => ({
      user: {},
      confirmationRequired: true,
    }));
    await TestBed.configureTestingModule({
      imports: [BorrowerRegister],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { loading: () => false, signUp } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(BorrowerRegister);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.fullName = '  Test Borrower  ';
    component.email = 'borrower@example.com';
    component.phone = '+267 71 234 567';
    component.borrowerType = 'EMPLOYED';
    component.password = 'LongPassword9!';
    component.confirmPassword = 'LongPassword9!';

    await component.register();
    fixture.detectChanges();

    expect(signUp).toHaveBeenCalledWith('borrower@example.com', 'LongPassword9!', {
      fullName: 'Test Borrower',
      phone: '+267 71 234 567',
      borrowerType: 'EMPLOYED',
    });
    expect(fixture.nativeElement.textContent).toContain('Check your inbox');
    expect(fixture.nativeElement.textContent).not.toContain('Supabase');
  });

  it('does not navigate after customer setup fails and offers a retry without repeating signup', async () => {
    const signUp = vi.fn(async () => ({
      confirmationRequired: false,
      profileInitializationError: 'The borrower role is not active yet.',
    }));
    const initializeOperationalCustomerProfile = vi.fn(async () => ({
      customerId: loanOpsCustomerId,
      phone: '+267 71 234 567',
      fullName: 'Test Borrower',
      nationalId: null,
      borrowerType: 'EMPLOYED' as const,
    }));
    await TestBed.configureTestingModule({
      imports: [BorrowerRegister],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            loading: () => false,
            signUp,
            initializeOperationalCustomerProfile,
          },
        },
      ],
    }).compileComponents();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(BorrowerRegister);
    const component = fixture.componentInstance;
    component.fullName = 'Test Borrower';
    component.email = 'borrower@example.com';
    component.phone = '+267 71 234 567';
    component.borrowerType = 'EMPLOYED';
    component.password = 'LongPassword9!';
    component.confirmPassword = component.password;

    await component.register();
    fixture.detectChanges();
    expect(component.profileInitializationError()).toBe('The borrower role is not active yet.');
    const retryButton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button');
    expect(retryButton?.textContent).toContain('Retry customer setup');
    expect(navigate).not.toHaveBeenCalled();

    if (!retryButton) throw new Error('Expected the customer setup retry button to render.');
    retryButton.click();
    await fixture.whenStable();
    expect(signUp).toHaveBeenCalledTimes(1);
    expect(initializeOperationalCustomerProfile).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('rejects whitespace-only names before calling the account service', async () => {
    const signUp = vi.fn();
    await TestBed.configureTestingModule({
      imports: [BorrowerRegister],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { loading: () => false, signUp } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(BorrowerRegister);
    fixture.detectChanges();
    fixture.componentInstance.fullName = '   ';
    fixture.componentInstance.password = 'LongPassword9!';
    fixture.componentInstance.confirmPassword = 'LongPassword9!';

    await fixture.componentInstance.register();

    expect(signUp).not.toHaveBeenCalled();
    expect(fixture.componentInstance.error()).toBe('Enter your full name.');
  });

  it('allows mock authentication only outside production', async () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PUBLIC_RUNTIME_CONFIG, useValue: { ...apiConfig, authMode: 'mock' as const } },
      ],
    });
    const auth = TestBed.inject(AuthService);
    const result = await auth.signUp('borrower@example.com', 'LongPassword9!', {
      fullName: 'Test Borrower',
      phone: '+267 71 234 567',
      borrowerType: 'STUDENT',
    });
    expect(result.confirmationRequired).toBe(false);
    await auth.signIn('', '');
    expect(auth.isAuthenticated()).toBe(true);
    await auth.signOut();
    expect(auth.isAuthenticated()).toBe(false);

    TestBed.resetTestingModule();
    environment.production = true;
    TestBed.configureTestingModule({
      providers: [
        { provide: PUBLIC_RUNTIME_CONFIG, useValue: { ...apiConfig, authMode: 'mock' as const } },
      ],
    });
    expect(() => TestBed.inject(AuthService)).toThrow(
      'Mock authentication is not allowed in production.',
    );
  });

  it('initializes the LoanOps customer after signup returns an authenticated session', async () => {
    const { fetchMock, requests } = mockSupabaseFetch();
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({
      providers: [{ provide: PUBLIC_RUNTIME_CONFIG, useValue: authConfig }],
    });
    const auth = TestBed.inject(AuthService);
    await auth.whenReady();

    const result = await auth.signUp('borrower@example.com', 'LongPassword9!', {
      fullName: 'Test Borrower',
      phone: '+267 71 234 567',
      borrowerType: 'STUDENT',
    });

    expect(result).toEqual({ confirmationRequired: false });
    const rpcRequest = requests.find((request) =>
      request.url.includes('/rest/v1/rpc/initialize_customer_profile'),
    );
    expect(rpcRequest).toBeDefined();
    expect(rpcRequest?.method).toBe('POST');
    expect(rpcRequest?.headers.get('Content-Profile')).toBe('loanops');
    expect(rpcRequest?.headers.get('Authorization')).toBe('Bearer test-access-token');
    expect(JSON.parse(rpcRequest?.body ?? '{}')).toEqual({
      p_phone: '+267 71 234 567',
      p_full_name: 'Test Borrower',
      p_national_id: null,
      p_borrower_type: 'STUDENT',
    });
    expect(JSON.parse(rpcRequest?.body ?? '{}')).not.toHaveProperty('user_id');
    expect(requests.some((request) => request.url.includes('/rest/v1/rpc/get_my_profile'))).toBe(true);
    expect(auth.customerProfile()).toEqual({
      customerId: loanOpsCustomerId,
      phone: '+267 71 234 567',
      fullName: 'Test Borrower',
      nationalId: null,
      borrowerType: 'STUDENT',
    });
  });

  it('waits for email confirmation and initializes LoanOps only after sign-in', async () => {
    const { fetchMock, requests } = mockSupabaseFetch({ signupRequiresConfirmation: true });
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({
      providers: [{ provide: PUBLIC_RUNTIME_CONFIG, useValue: authConfig }],
    });
    const auth = TestBed.inject(AuthService);
    await auth.whenReady();

    const registration = await auth.signUp('borrower@example.com', 'LongPassword9!', {
      fullName: 'Test Borrower',
      phone: '+267 71 234 567',
      borrowerType: 'STUDENT',
    });
    expect(registration.confirmationRequired).toBe(true);
    expect(
      requests.some((request) => request.url.includes('/rest/v1/rpc/initialize_customer_profile')),
    ).toBe(false);

    await auth.signIn('borrower@example.com', 'LongPassword9!');
    expect(
      requests.some((request) => request.url.includes('/rest/v1/rpc/initialize_customer_profile')),
    ).toBe(true);
    expect(auth.customerProfile()?.customerId).toBe(loanOpsCustomerId);
  });

  it('keeps an authenticated signup out of the portal when the customer RPC fails', async () => {
    const { fetchMock } = mockSupabaseFetch({
      rpcStatus: 403,
      rpcBody: { code: '42501', message: 'permission denied' },
    });
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({
      providers: [{ provide: PUBLIC_RUNTIME_CONFIG, useValue: authConfig }],
    });
    const auth = TestBed.inject(AuthService);
    await auth.whenReady();

    const result = await auth.signUp('borrower@example.com', 'LongPassword9!', {
      fullName: 'Test Borrower',
      phone: '+267 71 234 567',
      borrowerType: 'STUDENT',
    });
    expect(result.confirmationRequired).toBe(false);
    expect(result.profileInitializationError).toContain('active BORROWER role');
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.customerProfile()).toBeNull();
  });

  it('uses the selected data mode from runtime configuration', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PUBLIC_RUNTIME_CONFIG, useValue: { ...apiConfig, dataMode: 'demo' as const } },
      ],
    });
    expect(TestBed.inject(LoanOpsApiService).mode).toBe('demo');
  });

  it('keeps fictional demo applications in memory', () => {
    TestBed.configureTestingModule({});
    const api = TestBed.inject(LoanOpsApiService);
    let createdNumber = '';
    api.startApplication(draft).subscribe((application) => {
      createdNumber = application.applicationNumber;
    });

    expect(createdNumber).toMatch(/^APP-/);
    expect(api.data().customers.some((customer) => customer.fullName === draft.fullName)).toBe(
      true,
    );
  });

  it('does not use legacy HTTP routes or fall back to demo data in API mode', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PUBLIC_RUNTIME_CONFIG, useValue: { ...apiConfig, dataMode: 'api' as const } },
      ],
    });
    const api = TestBed.inject(LoanOpsApiService);
    let message = '';
    api.loadApplications('borrower').subscribe({
      error: (error: Error) => (message = error.message),
    });

    expect(message).toContain('Supabase is not configured');
    expect(api.data().customers).toHaveLength(0);
    expect(api.data().applications).toHaveLength(0);
    expect(api.featureState('borrower_applications').error).toBe(message);
  });

  it('loads borrower applications and loans independently and preserves decimal strings', async () => {
    const rpc = vi.fn(async (name: string, _args: Record<string, unknown>) => {
      if (name === 'get_my_applications') return { data: [applicationRow], error: null };
      if (name === 'get_my_loans') {
        return {
          data: [{
            loan_id: '9',
            application_id: '41',
            principal: '1250.25',
            interest_rate: '30',
            interest_amount: '375.08',
            total_due: '1625.33',
            amount_paid: '0',
            outstanding_amount: '1625.33',
            due_date: '2026-11-27',
            status: 'ACTIVE',
          }],
          error: null,
        };
      }
      return { data: null, error: { code: 'PGRST202', message: `Unexpected RPC ${name}` } };
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: PUBLIC_RUNTIME_CONFIG, useValue: { ...apiConfig, dataMode: 'api' as const } },
        { provide: AuthService, useValue: authenticatedRpcProvider(rpc) },
      ],
    });
    const api = TestBed.inject(LoanOpsApiService);

    const [applications, loans] = await Promise.all([
      firstValueFrom(api.loadMyApplications()),
      firstValueFrom(api.loadMyLoans()),
    ]);

    expect(applications[0].requestedAmount).toBe('1250.25');
    expect(loans[0].outstandingAmount).toBe('1625.33');
    expect(api.featureState('borrower_applications').request).toBe('success');
    expect(api.featureState('borrower_loans').request).toBe('success');
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['get_my_applications', 'get_my_loans']);
  });

  it('keeps loan details available when the application list fails', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'get_my_applications') {
        return { data: null, error: { code: 'PGRST202', message: 'not deployed' } };
      }
      if (name === 'get_my_loans') {
        return {
          data: [{
            loan_id: '9',
            application_id: '41',
            principal: '1250.25',
            interest_rate: '30',
            interest_amount: '375.08',
            total_due: '1625.33',
            amount_paid: '0',
            outstanding_amount: '1625.33',
            due_date: '2026-11-27',
            status: 'ACTIVE',
          }],
          error: null,
        };
      }
      return { data: null, error: null };
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: PUBLIC_RUNTIME_CONFIG, useValue: { ...apiConfig, dataMode: 'api' as const } },
        { provide: AuthService, useValue: authenticatedRpcProvider(rpc) },
      ],
    });
    const api = TestBed.inject(LoanOpsApiService);

    const results = await Promise.allSettled([
      firstValueFrom(api.loadMyApplications()),
      firstValueFrom(api.loadMyLoans()),
    ]);

    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('fulfilled');
    expect(api.featureState('borrower_applications').availability).toBe('pending_backend');
    expect(api.featureState('borrower_loans').request).toBe('success');
    expect(api.data().loans).toHaveLength(1);
  });

  it('uses the verified create and update RPC contracts with a strict change whitelist', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === 'start_application') {
        return {
          data: [{ application_id: '41', application_number: 'APP-000041', current_step: 'IN_PROGRESS', status: 'IN_PROGRESS' }],
          error: null,
        };
      }
      if (name === 'get_my_applications') return { data: [applicationRow], error: null };
      if (name === 'update_application') return { data: null, error: null };
      return { data: null, error: { code: 'PGRST202', message: `Unexpected RPC ${name}` } };
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: PUBLIC_RUNTIME_CONFIG, useValue: { ...apiConfig, dataMode: 'api' as const } },
        { provide: AuthService, useValue: authenticatedRpcProvider(rpc) },
      ],
    });
    const api = TestBed.inject(LoanOpsApiService);

    const created = await firstValueFrom(api.startApplication(draft));
    const updated = await firstValueFrom(api.updateApplication(created.id, draft));

    expect(created.id).toBe(41);
    expect(updated.id).toBe(41);
    expect(calls[0]).toEqual({
      name: 'start_application',
      args: { p_borrower_type: 'STUDENT', p_requested_amount: '1000' },
    });
    const changeKeys = Object.keys(calls.find((call) => call.name === 'update_application')?.args['p_changes'] as object).sort();
    const changes = calls.find((call) => call.name === 'update_application')?.args['p_changes'] as Record<string, unknown>;
    expect(changes['requested_amount']).toBe(1000);
    expect(typeof changes['requested_amount']).toBe('number');
    expect(changeKeys).toEqual([
      'borrower_type',
      'employment_status',
      'employer',
      'institution',
      'reception_identifier',
      'reception_method',
      'reception_name',
      'reception_name_same_as_id',
      'requested_amount',
      'student_id',
    ].sort());
    expect(changeKeys).not.toContain('phone');
    expect(changeKeys).not.toContain('national_id');
    expect(api.featureState('application_create').request).toBe('success');
    expect(api.featureState('application_update').request).toBe('success');
  });

  it('keeps each Admin application queue independent', async () => {
    const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
      if (args['p_status'] === 'SUBMITTED') {
        return { data: null, error: { code: 'PGRST202', message: 'not deployed' } };
      }
      if (args['p_status'] === 'IN_PROGRESS') {
        return { data: [applicationRow], error: null };
      }
      return {
        data: [{ ...applicationRow, approved_amount: '1000.00', current_step: 'APPROVED', status: 'APPROVED' }],
        error: null,
      };
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: PUBLIC_RUNTIME_CONFIG, useValue: { ...apiConfig, dataMode: 'api' as const } },
        { provide: AuthService, useValue: authenticatedRpcProvider(rpc) },
      ],
    });
    const api = TestBed.inject(LoanOpsApiService);

    const results = await Promise.allSettled([
      firstValueFrom(api.loadAdminApplications('SUBMITTED')),
      firstValueFrom(api.loadAdminApplications('APPROVED')),
      firstValueFrom(api.loadAdminApplications('IN_PROGRESS')),
    ]);

    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('fulfilled');
    expect(results[2].status).toBe('fulfilled');
    expect(api.featureState('admin_submitted_queue').availability).toBe('pending_backend');
    expect(api.featureState('admin_approved_queue').request).toBe('success');
    expect(api.featureState('admin_in_progress_queue').request).toBe('success');
    expect(api.featureState('admin_loan_list').availability).toBe('pending_backend');
    expect(api.data().applications.map((application) => application.status)).toContain('APPROVED');
    expect(api.data().applications.map((application) => application.status)).toContain('IN_PROGRESS');
  });

  it('lists documents for in-progress applications so Admin can review uploads', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === 'list_applications_for_admin') {
        return { data: args['p_status'] === 'IN_PROGRESS' ? [applicationRow] : [], error: null };
      }
      if (name === 'list_documents_for_admin') {
        return {
          data: [{
            document_id: '77',
            application_id: '41',
            document_type: 'STUDENT_ID',
            original_filename: 'student-id.pdf',
            verification_status: 'PENDING',
            uploaded_at: '2026-11-02T12:00:00.000Z',
          }],
          error: null,
        };
      }
      return { data: null, error: { code: 'PGRST202', message: `Unexpected RPC ${name}` } };
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: PUBLIC_RUNTIME_CONFIG, useValue: { ...apiConfig, dataMode: 'api' as const } },
        { provide: AuthService, useValue: authenticatedRpcProvider(rpc) },
      ],
    });
    const api = TestBed.inject(LoanOpsApiService);

    await firstValueFrom(api.loadAdminApplications('IN_PROGRESS'));
    const documents = await firstValueFrom(api.loadAdminDocuments());

    expect(calls).toContainEqual({
      name: 'list_documents_for_admin',
      args: { p_application_id: 41 },
    });
    expect(documents).toMatchObject([
      { id: 77, applicationId: 41, documentType: 'STUDENT_ID', status: 'PENDING' },
    ]);
  });

  it('uses the supplied Admin approval, disbursement, and document-review RPC contracts', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === 'approve_application' || name === 'review_document') return { data: null, error: null };
      if (name === 'list_applications_for_admin') {
        return {
          data: args['p_status'] === 'SUBMITTED'
            ? [{ ...applicationRow, current_step: 'SUBMITTED', status: 'SUBMITTED' }]
            : [],
          error: null,
        };
      }
      if (name === 'record_manual_disbursement_with_proof') {
        return {
          data: [{
            loan_id: '9',
            application_id: '41',
            principal: '1000.00',
            interest_amount: '300.00',
            total_due: '1300.00',
            outstanding_amount: '1300.00',
            due_date: '2026-11-27',
            status: 'ACTIVE',
          }],
          error: null,
        };
      }
      return { data: null, error: { code: 'PGRST202', message: `Unexpected RPC ${name}` } };
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: PUBLIC_RUNTIME_CONFIG, useValue: { ...apiConfig, dataMode: 'api' as const } },
        { provide: AuthService, useValue: authenticatedRpcProvider(rpc) },
      ],
    });
    const api = TestBed.inject(LoanOpsApiService);

    await firstValueFrom(api.loadAdminApplications('SUBMITTED'));
    const approved = await firstValueFrom(api.approveApplication(41, '1000.00'));
    const disbursement = await firstValueFrom(api.disburseLoan(approved, '2026-11-27', 'BANK-REF-9', 123));
    await firstValueFrom(api.reviewDocument(77, 'REJECTED', 'Unreadable image'));

    expect(approved.status).toBe('APPROVED');
    expect(disbursement).toMatchObject({ loanId: 9, applicationId: 41, totalDue: '1300.00' });
    expect(calls).toContainEqual({
      name: 'approve_application',
      args: { p_application_id: 41, p_approved_amount: '1000.00' },
    });
    expect(calls).toContainEqual({
      name: 'record_manual_disbursement_with_proof',
      args: {
        p_application_id: 41,
        p_disbursement_reference: 'BANK-REF-9',
        p_due_date: '2026-11-27',
        p_proof_document_id: 123,
      },
    });
    expect(calls).toContainEqual({
      name: 'review_document',
      args: { p_document_id: 77, p_decision: 'REJECTED', p_note: 'Unreadable image' },
    });
    expect(api.featureState('admin_approval').request).toBe('success');
    expect(api.featureState('admin_disbursement').request).toBe('success');
    expect(api.featureState('document_review').request).toBe('success');
  });

  it('records payment submission as pending and leaves loan balances to server verification', async () => {
    const rpc = vi.fn(async (name: string, _args: Record<string, unknown>) => {
      if (name === 'submit_payment') {
        return {
          data: [{
            payment_id: '12',
            loan_id: '9',
            amount: '100.50',
            status: 'PENDING',
            payment_method: 'MOBILE_MONEY',
            payment_reference: 'PAY-12',
            submitted_at: '2026-10-30T12:00:00.000Z',
          }],
          error: null,
        };
      }
      if (name === 'verify_payment') {
        return {
          data: [{
            payment_id: '12',
            loan_id: '9',
            amount: '100.50',
            loan_amount_paid: '100.50',
            outstanding_amount: '1524.83',
            payment_status: 'VERIFIED',
            loan_status: 'ACTIVE',
          }],
          error: null,
        };
      }
      return { data: null, error: { code: 'PGRST202', message: `Unexpected RPC ${name}` } };
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: PUBLIC_RUNTIME_CONFIG, useValue: { ...apiConfig, dataMode: 'api' as const } },
        { provide: AuthService, useValue: authenticatedRpcProvider(rpc) },
      ],
    });
    const api = TestBed.inject(LoanOpsApiService);

    const payment = await firstValueFrom(api.submitPayment(9, '100.50', 'MOBILE_MONEY', 'PAY-12'));
    const verified = await firstValueFrom(api.verifyPayment(payment.id));

    expect(payment.status).toBe('PENDING');
    expect(verified.paymentStatus).toBe('VERIFIED');
    expect(api.data().payments).toEqual([payment]);
    expect(api.data().loans).toHaveLength(0);
    expect(rpc.mock.calls.map(([name, args]) => [name, args])).toEqual([
      ['submit_payment', {
        p_loan_id: 9,
        p_amount: '100.50',
        p_payment_method: 'MOBILE_MONEY',
        p_payment_reference: 'PAY-12',
      }],
      ['verify_payment', { p_payment_id: 12 }],
    ]);
  });

  it('does not present locally listed document types as confirmed lender policy', () => {
    TestBed.configureTestingModule({});
    const api = TestBed.inject(LoanOpsApiService);
    let requirementsConfirmed = true;
    let pendingConfirmation = false;
    api.loadBorrowerRequirements('UNEMPLOYED').subscribe((requirements) => {
      requirementsConfirmed = requirements.requirementsConfirmed;
      pendingConfirmation = requirements.pendingConfirmation;
    });

    expect(requirementsConfirmed).toBe(false);
    expect(pendingConfirmation).toBe(true);
    expect(api.getRequirements('UNEMPLOYED')).toEqual(['IDENTITY_DOCUMENT']);
  });

  it('keeps password management visible when profile and document APIs fail independently', async () => {
    await TestBed.configureTestingModule({
      imports: [BorrowerSettings],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: { configured: true, user: () => ({ email: 'borrower@example.com' }) },
        },
        {
          provide: BorrowerAccountService,
          useValue: {
            loadProfile: vi.fn(async () => {
              throw new Error('Profile API unavailable.');
            }),
            loadVerificationDocuments: vi.fn(async () => {
              throw new Error('Document API unavailable.');
            }),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(BorrowerSettings);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('input[name="newPassword"]')).not.toBeNull();
    expect(element.querySelector('input[name="confirmPassword"]')).not.toBeNull();
    expect(element.textContent).toContain('Profile API unavailable.');
    expect(element.textContent).toContain('Document API unavailable.');
    expect(element.textContent).toContain('borrower@example.com');
  });

  it('requires matching passwords and reports success only after Auth confirms the update', async () => {
    const updatePassword = vi.fn(async () => undefined);
    await TestBed.configureTestingModule({
      imports: [BorrowerSettings],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            configured: true,
            user: () => ({ email: 'borrower@example.com' }),
            updatePassword,
          },
        },
        {
          provide: BorrowerAccountService,
          useValue: {
            loadProfile: vi.fn(async () => {
              throw new Error('Profile API unavailable.');
            }),
            loadVerificationDocuments: vi.fn(async () => {
              throw new Error('Document API unavailable.');
            }),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(BorrowerSettings);
    const component = fixture.componentInstance;
    component.newPassword = 'StrongPassword9!';
    component.confirmPassword = 'DifferentPassword9!';
    await component.changePassword();

    expect(updatePassword).not.toHaveBeenCalled();
    expect(component.passwordError()).toBe('Your passwords do not match.');

    component.confirmPassword = component.newPassword;
    await component.changePassword();
    expect(updatePassword).toHaveBeenCalledWith('StrongPassword9!');
    expect(component.passwordSuccess()).toBe('Your password has been updated.');
    expect(component.newPassword).toBe('');
    expect(component.confirmPassword).toBe('');
  });

  it('keeps draft creation blocked by missing configuration but allows readiness/submission checks to surface real backend errors when configured', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PUBLIC_RUNTIME_CONFIG, useValue: { ...apiConfig, dataMode: 'api' as const } },
      ],
    });
    const api = TestBed.inject(LoanOpsApiService);
    const errors: string[] = [];
    api.startApplication(draft).subscribe({ error: (error: Error) => errors.push(error.message) });
    api.checkSubmissionReadiness(21).subscribe({ error: (error: Error) => errors.push(error.message) });
    api.submitApplication(21).subscribe({ error: (error: Error) => errors.push(error.message) });

    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain('Supabase is not configured');
    expect(errors[1]).toContain('Sign in again to continue');
    expect(errors[2]).toContain('Sign in again to continue');
    expect(api.featureState('application_create').request).toBe('error');
    expect(api.featureState('application_readiness').availability).toBe('unauthorized');
    expect(api.featureState('application_submission').availability).toBe('unauthorized');
    expect(api.data().applications).toHaveLength(0);
  });

  it('persists only the selected theme preference when toggled', () => {
    TestBed.configureTestingModule({});
    const theme = TestBed.inject(ThemeService);
    const original = theme.theme();
    theme.toggle();

    expect(theme.theme()).not.toBe(original);
    expect(document.documentElement.dataset['theme']).toBe(theme.theme());
    expect(localStorage.getItem('pjloans-theme')).toBe(theme.theme());
  });
});
