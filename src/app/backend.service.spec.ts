import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackendService, PjVaultRequirement } from './backend.service';

const config = {
  supabaseUrl: 'https://pjvault.example.supabase.co',
  supabasePublishableKey: 'sb_publishable_test',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('BackendService', () => {
  afterEach(() => {
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('checks admin membership through the PJVault admin-session function', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'admin-jwt',
        refresh_token: 'admin-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
        user: { id: 'auth-response-id', email: 'admin@example.com' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: 'admin-id',
        email: 'admin@example.com',
        user_metadata: { full_name: 'Admin' },
      }))
      .mockResolvedValueOnce(jsonResponse([
        { user_id: 'admin-id', app_role: 'ADMIN', account_status: 'ACTIVE' },
      ]))
      .mockResolvedValueOnce(jsonResponse([]));
    const backend = TestBed.inject(BackendService);
    backend.config.set(config);

    await backend.signInAdmin(' admin@example.com ', 'password');

    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'https://pjvault.example.supabase.co/auth/v1/token?grant_type=password',
    );
    expect(fetchSpy.mock.calls[1]?.[0]).toBe(
      'https://pjvault.example.supabase.co/auth/v1/user',
    );
    expect(fetchSpy.mock.calls[2]?.[0]).toBe(
      'https://pjvault.example.supabase.co/functions/v1/pjvault-admin-session',
    );
    const sessionRequest = fetchSpy.mock.calls[2]?.[1] as RequestInit;
    expect(sessionRequest.method).toBe('POST');
    expect(sessionRequest.body).toBe('{}');
    expect(new Headers(sessionRequest.headers).get('authorization')).toBe('Bearer admin-jwt');
    expect(backend.adminUser()?.id).toBe('admin-id');
  });

  it('keeps authentication success separate from PJVault admin denial', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'user-jwt',
        refresh_token: 'user-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
        user: { id: 'auth-response-id', email: 'user@example.com' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: 'user-id',
        email: 'user@example.com',
      }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValue(jsonResponse({}));
    const backend = TestBed.inject(BackendService);
    backend.config.set(config);

    await expect(backend.signInAdmin('user@example.com', 'password'))
      .rejects.toThrow('not an active PJVault administrator');
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'https://pjvault.example.supabase.co/auth/v1/token?grant_type=password',
    );
    expect(backend.adminUser()).toBeNull();
  });

  it('loads every page of administrator requests instead of dropping older rows after 100', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(Array.from({ length: 100 }, (_, index) => ({
        request_id: `request-${index}`,
        request_code: `PV-${index}`,
        status: 'SUBMITTED',
      }))))
      .mockResolvedValueOnce(jsonResponse([{
        request_id: 'request-retgfbv',
        request_code: 'retgfbv',
        status: 'SUBMITTED',
      }]));
    const backend = TestBed.inject(BackendService);
    backend.config.set(config);
    Reflect.set(backend, 'accessToken', 'admin-jwt');
    backend.adminUser.set({ id: 'admin-id', email: 'admin@example.com', name: 'Admin' });

    await backend.loadAdminRequests();

    expect(backend.requests()).toHaveLength(101);
    expect(backend.requests().at(-1)?.requestCode).toBe('retgfbv');
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toMatchObject({
      action: 'list_requests',
      limit: 100,
      offset: 0,
    });
    expect(JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body))).toMatchObject({
      action: 'list_requests',
      limit: 100,
      offset: 100,
    });
  });

  it('creates a PJVault link with the documented admin request action', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'admin-jwt',
        refresh_token: 'admin-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
        user: { id: 'auth-response-id', email: 'admin@example.com' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: 'admin-id',
        email: 'admin@example.com',
      }))
      .mockResolvedValueOnce(jsonResponse([{ user_id: 'admin-id', app_role: 'ADMIN', account_status: 'ACTIVE' }]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({
        request_id: '11111111-1111-4111-8111-111111111111',
        expires_at: '2026-12-01T12:00:00.000Z',
        upload_token: 'a'.repeat(64),
      }));
    const backend = TestBed.inject(BackendService);
    backend.config.set(config);
    await backend.signInAdmin('admin@example.com', 'password');

    const requirements: PjVaultRequirement[] = [{
      document_type: 'STUDENT_ID',
      required: true,
      allowed_mime_types: ['application/pdf'],
      max_file_size_bytes: 10 * 1024 * 1024,
    }];
    const link = await backend.createBorrowerLink({
      expiresAt: '2026-12-01T12:00:00.000Z',
      recipientLabel: 'Sample borrower',
      externalReference: 'PV-100',
      requirements,
    });

    expect(fetchSpy.mock.calls[4]?.[0]).toBe(
      'https://pjvault.example.supabase.co/functions/v1/pjvault-admin-api',
    );
    const request = fetchSpy.mock.calls[4]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      action: 'create_request',
      expires_at: '2026-12-01T12:00:00.000Z',
      recipient_label: 'Sample borrower',
      external_reference: 'PV-100',
      requirements,
    });
    const url = new URL(link.url);
    expect(url.searchParams.get('token')).toBe('a'.repeat(64));
    expect(link.requestId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('loads borrower application details, reviews documents, and approves with loan terms', async () => {
    const requestId = '11111111-1111-4111-8111-111111111111';
    const documentId = '22222222-2222-4222-8222-222222222222';
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'admin-jwt',
        refresh_token: 'admin-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
        user: { id: 'auth-response-id', email: 'admin@example.com' },
      }))
      .mockResolvedValueOnce(jsonResponse({ id: 'admin-id', email: 'admin@example.com' }))
      .mockResolvedValueOnce(jsonResponse([{ user_id: 'admin-id', app_role: 'ADMIN', account_status: 'ACTIVE' }]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({
        application: {
          request_id: requestId,
          request_code: 'PV-EXAMPLE',
          application_status: 'SUBMITTED',
          borrower_details_submitted: true,
          borrower_details: {
            whatsapp_number: '+26770000000',
            course_name: 'Computer Engineering',
            academic_year: 'Year 4',
          },
          documents: [{
            document_id: documentId,
            document_type: 'STUDENT_ID',
            original_filename: 'student-id.pdf',
            mime_type: 'application/pdf',
            review_status: 'PENDING',
          }],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ document_id: documentId, review_status: 'ACCEPTED' }))
      .mockResolvedValueOnce(jsonResponse({ decision: 'APPROVED' }))
      .mockResolvedValueOnce(jsonResponse({
        url: 'https://storage.example/private-document?X-Amz-Signature=temporary',
        expires_in_seconds: 60,
      }));
    const backend = TestBed.inject(BackendService);
    backend.config.set(config);
    await backend.signInAdmin('admin@example.com', 'password');

    const application = await backend.loadAdminApplication(requestId);
    expect(application).toMatchObject({
      requestId,
      requestCode: 'PV-EXAMPLE',
      status: 'SUBMITTED',
      borrowerDetailsSubmitted: true,
      borrowerDetails: {
        whatsappNumber: '+26770000000',
        courseName: 'Computer Engineering',
        academicYear: 'Year 4',
      },
      documents: [{
        documentId,
        documentType: 'STUDENT_ID',
        fileName: 'student-id.pdf',
        mimeType: 'application/pdf',
        reviewStatus: 'PENDING',
      }],
    });

    await backend.reviewAdminDocument(documentId, 'ACCEPTED', 'Verified');
    await backend.approveAdminApplication(requestId, 25000, '2027-06-30', 'Approved after verification');
    const preview = await backend.createAdminDocumentPreview(documentId, 'preview-operation');
    expect(preview).toMatchObject({
      url: 'https://storage.example/private-document?X-Amz-Signature=temporary',
      expiresInSeconds: 60,
      httpStatus: 200,
      operationId: 'preview-operation',
    });
    expect(preview.expiresAt).toBeGreaterThan(Date.now());

    expect(JSON.parse(String(fetchSpy.mock.calls[4]?.[1]?.body))).toEqual({
      action: 'get_application',
      request_id: requestId,
    });
    expect(JSON.parse(String(fetchSpy.mock.calls[5]?.[1]?.body))).toEqual({
      action: 'review_document',
      document_id: documentId,
      decision: 'ACCEPTED',
      note: 'Verified',
    });
    expect(JSON.parse(String(fetchSpy.mock.calls[6]?.[1]?.body))).toEqual({
      action: 'approve_application',
      request_id: requestId,
      loan_amount: 25000,
      due_date: '2027-06-30',
      decision_note: 'Approved after verification',
    });
    expect(JSON.parse(String(fetchSpy.mock.calls[7]?.[1]?.body))).toEqual({
      document_id: documentId,
    });
    for (const index of [4, 5, 6, 7]) {
      const request = fetchSpy.mock.calls[index]?.[1] as RequestInit;
      const headers = new Headers(request.headers);
      expect(headers.get('authorization')).toBe('Bearer admin-jwt');
      expect(headers.get('apikey')).toBe(config.supabasePublishableKey);
    }
    expect(fetchSpy.mock.calls[7]?.[0]).toBe(
      'https://pjvault.example.supabase.co/functions/v1/pjvault-admin-view-url',
    );
  });

  it('loads approved loan rows from the admin loans action', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'admin-jwt',
        refresh_token: 'admin-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
        user: { id: 'auth-response-id', email: 'admin@example.com' },
      }))
      .mockResolvedValueOnce(jsonResponse({ id: 'admin-id', email: 'admin@example.com' }))
      .mockResolvedValueOnce(jsonResponse([{ user_id: 'admin-id', app_role: 'ADMIN', account_status: 'ACTIVE' }]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({
        loans: [{
          loan_id: '33333333-3333-4333-8333-333333333333',
          request_id: '11111111-1111-4111-8111-111111111111',
          request_code: 'PV-EXAMPLE',
          borrower_details: {
            full_name: 'Sample Borrower',
            whatsapp_number: '+26770000000',
            course_name: 'Computer Engineering',
            academic_year: 'Year 4',
          },
          loan_amount: 25000,
          due_date: '2027-06-30',
          status: 'ACTIVE',
        }],
      }));
    const backend = TestBed.inject(BackendService);
    backend.config.set(config);
    await backend.signInAdmin('admin@example.com', 'password');
    await backend.loadAdminLoans();

    expect(backend.loans()).toEqual([expect.objectContaining({
      loanId: '33333333-3333-4333-8333-333333333333',
      requestId: '11111111-1111-4111-8111-111111111111',
      requestCode: 'PV-EXAMPLE',
      borrowerName: 'Sample Borrower',
      courseName: 'Computer Engineering',
      academicYear: 'Year 4',
      whatsappNumber: '+26770000000',
      amount: 25000,
      dueDate: '2027-06-30',
      status: 'ACTIVE',
      loanStatus: 'ACTIVE',
      currency: 'BWP',
      disbursedAmount: null,
    })]);
    expect(JSON.parse(String(fetchSpy.mock.calls[4]?.[1]?.body))).toEqual({
      action: 'list_loans',
      status: null,
      limit: 50,
      offset: 0,
    });
  });

  it('sets link expiry through the authenticated Supabase RPC and returns its expiry', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'admin-jwt',
        refresh_token: 'admin-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
        user: { id: 'auth-response-id', email: 'admin@example.com' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: 'admin-id',
        email: 'admin@example.com',
      }))
      .mockResolvedValueOnce(jsonResponse([{ user_id: 'admin-id', app_role: 'ADMIN', account_status: 'ACTIVE' }]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse('2026-12-01T13:00:00.000Z'));
    const backend = TestBed.inject(BackendService);
    backend.config.set(config);
    await backend.signInAdmin('admin@example.com', 'password');

    const expiry = await backend.setBorrowerLinkTtl('11111111-1111-4111-8111-111111111111', 60);

    expect(fetchSpy.mock.calls[4]?.[0]).toBe(
      'https://pjvault.example.supabase.co/rest/v1/rpc/pjvault_admin_set_upload_link_ttl',
    );
    const rpcRequest = fetchSpy.mock.calls[4]?.[1] as RequestInit;
    expect(JSON.parse(String(rpcRequest.body))).toEqual({
      p_request_id: '11111111-1111-4111-8111-111111111111',
      p_ttl_minutes: 60,
    });
    expect(new Headers(rpcRequest.headers).get('authorization')).toBe('Bearer admin-jwt');
    expect(expiry.expiresAt).toBe('2026-12-01T13:00:00.000Z');
  });

  it('persists the exchanged session and restores it for status calls after reload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
      session_token: 'b'.repeat(64),
      exchange: {
        request_id: '11111111-1111-4111-8111-111111111111',
        request_code: 'PV-EXAMPLE',
        request_status: 'OPEN',
        session_expires_at: '2026-11-11T20:00:00Z',
        requirements: [{
          document_type: 'STUDENT_ID',
          required: true,
          allowed_mime_types: ['application/pdf'],
          max_file_size_bytes: 10 * 1024 * 1024,
        }],
      },
      status: {
        request_code: 'PV-EXAMPLE',
        status: 'OPEN',
        link_expires_at: '2026-11-12T00:00:00Z',
        session_expires_at: '2026-11-11T20:00:00Z',
        first_session_created_at: '2026-11-11T19:45:00Z',
        cleanup_deadline: '2026-11-11T21:45:00Z',
        borrower_details_submitted: false,
        submission_complete: false,
        submitted_at: null,
        requirements: [{ document_type: 'STUDENT_ID', required: true, latest_status: null }],
      },
      }))
      .mockResolvedValueOnce(jsonResponse({
        request_code: 'PV-EXAMPLE',
        status: 'OPEN',
        link_expires_at: '2026-11-12T00:00:00Z',
        session_expires_at: '2026-11-11T20:00:00Z',
        first_session_created_at: '2026-11-11T19:45:00Z',
        cleanup_deadline: '2026-11-11T21:45:00Z',
        borrower_details_submitted: false,
        submission_complete: false,
        submitted_at: null,
        requirements: [{ document_type: 'STUDENT_ID', required: true, latest_status: null }],
      }));
    const backend = TestBed.inject(BackendService);
    backend.config.set(config);

    const exchangedSession = await backend.exchangeBorrowerToken('a'.repeat(64));
    const reloadedBackend = new BackendService();
    reloadedBackend.config.set(config);
    const restoredSession = await reloadedBackend.restoreBorrowerSession();

    expect(exchangedSession.requirements[0]?.document_type).toBe('STUDENT_ID');
    expect(restoredSession.requestId).toBe('11111111-1111-4111-8111-111111111111');
    expect(restoredSession.status.request_code).toBe('PV-EXAMPLE');
    expect(JSON.parse(window.sessionStorage.getItem('pjvault-borrower-upload-session') ?? '{}').sessionToken).toBe('b'.repeat(64));
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'https://pjvault.example.supabase.co/functions/v1/pjvault-borrower-api',
    );
    const exchangeRequest = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(exchangeRequest.body))).toEqual({
      action: 'exchange_token',
      token: 'a'.repeat(64),
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1]?.[0]).toBe(
      'https://pjvault.example.supabase.co/functions/v1/pjvault-borrower-api',
    );
    const statusRequest = fetchSpy.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(statusRequest.body))).toEqual({ action: 'request_status' });
    expect(new Headers(statusRequest.headers).get('authorization')).toBe(`Bearer ${'b'.repeat(64)}`);
  });

  it('does not send a second exchange for a link whose one-time exchange failed', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({
      code: 'LINK_ALREADY_USED',
      error: 'This one-time PJVault link has already been used or is no longer available.',
    }, 409));
    const backend = new BackendService();
    backend.config.set(config);

    await expect(backend.exchangeBorrowerToken('a'.repeat(64)))
      .rejects.toThrow('already been used');
    await expect(backend.exchangeBorrowerToken('a'.repeat(64)))
      .rejects.toThrow('already been used');

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(backend.borrowerLinkExchangeFailureMessage()).toContain('already been used');
    expect(window.sessionStorage.getItem('pjvault-borrower-link-exchange-attempt'))
      .not.toContain('a'.repeat(64));
  });

  it('clears a saved session when the server confirms the session expired', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({
      code: 'SESSION_EXPIRED',
      error: 'This PJVault link or session has expired or is no longer available.',
    }, 410));
    window.sessionStorage.setItem('pjvault-borrower-upload-session', JSON.stringify({
      sessionToken: 'b'.repeat(64),
      requestId: '11111111-1111-4111-8111-111111111111',
      requestCode: 'PV-EXAMPLE',
      sessionExpiresAt: '2026-11-11T20:00:00Z',
      linkTokenFingerprint: 'c'.repeat(64),
      requirements: [{
        document_type: 'STUDENT_ID',
        required: true,
        allowed_mime_types: ['application/pdf'],
        max_file_size_bytes: 10 * 1024 * 1024,
      }],
    }));
    const backend = new BackendService();
    backend.config.set(config);

    await expect(backend.restoreBorrowerSession()).rejects.toThrow('expired');

    expect(backend.hasSavedBorrowerSession()).toBe(false);
    expect(backend.borrowerLinkExchangeFailureMessage()).toContain('expired');
    const statusRequest = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(statusRequest.headers).get('authorization')).toBe(`Bearer ${'b'.repeat(64)}`);
  });

  it('keeps the borrower session when only an upload intent is no longer active', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        request_code: 'PV-EXAMPLE',
        status: 'OPEN',
        link_expires_at: '2026-11-14T20:00:00Z',
        session_expires_at: '2026-11-16T20:00:00Z',
        first_session_created_at: '2026-11-15T12:00:00Z',
        cleanup_deadline: '2026-11-15T14:00:00Z',
        borrower_details_submitted: false,
        submission_complete: false,
        submitted_at: null,
        requirements: [{ document_type: 'STUDENT_ID', required: true, latest_status: null }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 'UPLOAD_INTENT_EXPIRED',
        error: 'This upload attempt expired; retry this file.',
      }, 410))
      .mockResolvedValueOnce(jsonResponse({
        code: 'UPLOAD_INTENT_EXPIRED',
        error: 'This upload attempt expired; retry this file.',
      }, 410));
    window.sessionStorage.setItem('pjvault-borrower-upload-session', JSON.stringify({
      sessionToken: 'b'.repeat(64),
      requestId: '11111111-1111-4111-8111-111111111111',
      requestCode: 'PV-EXAMPLE',
      sessionExpiresAt: '2026-11-16T20:00:00Z',
      linkTokenFingerprint: 'c'.repeat(64),
      requirements: [{
        document_type: 'STUDENT_ID',
        required: true,
        allowed_mime_types: ['application/pdf'],
        max_file_size_bytes: 10 * 1024 * 1024,
      }],
    }));
    const backend = new BackendService();
    backend.config.set(config);
    await backend.restoreBorrowerSession();

    await expect(backend.uploadBorrowerDocument(
      '11111111-1111-4111-8111-111111111111',
      'STUDENT_ID',
      new File(['document'], 'student-id.pdf', { type: 'application/pdf' }),
      () => undefined,
    )).rejects.toThrow('This upload attempt expired; retry this file.');

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(backend.hasSavedBorrowerSession()).toBe(true);
  });

  it('does not interpret an unclassified upload 410 as an expired borrower session', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        request_code: 'PV-EXAMPLE',
        status: 'OPEN',
        link_expires_at: '2026-11-14T20:00:00Z',
        session_expires_at: '2026-11-16T20:00:00Z',
        first_session_created_at: '2026-11-15T12:00:00Z',
        cleanup_deadline: '2026-11-15T14:00:00Z',
        borrower_details_submitted: false,
        submission_complete: false,
        submitted_at: null,
        requirements: [{ document_type: 'STUDENT_ID', required: true, latest_status: null }],
      }))
      .mockResolvedValueOnce(jsonResponse({ error: 'The upload service could not complete the request.' }, 410));
    window.sessionStorage.setItem('pjvault-borrower-upload-session', JSON.stringify({
      sessionToken: 'b'.repeat(64),
      requestId: '11111111-1111-4111-8111-111111111111',
      requestCode: 'PV-EXAMPLE',
      sessionExpiresAt: '2026-11-16T20:00:00Z',
      linkTokenFingerprint: 'c'.repeat(64),
      requirements: [{
        document_type: 'STUDENT_ID',
        required: true,
        allowed_mime_types: ['application/pdf'],
        max_file_size_bytes: 10 * 1024 * 1024,
      }],
    }));
    const backend = new BackendService();
    backend.config.set(config);
    await backend.restoreBorrowerSession();

    await expect(backend.uploadBorrowerDocument(
      '11111111-1111-4111-8111-111111111111',
      'STUDENT_ID',
      new File(['document'], 'student-id.pdf', { type: 'application/pdf' }),
      () => undefined,
    )).rejects.toThrow('The upload service could not complete the request.');

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(backend.hasSavedBorrowerSession()).toBe(true);
    expect(backend.borrowerLinkExchangeFailureMessage()).toBeNull();
  });

  it('uses the opaque saved session token for upload-intent and finalization calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        session_token: 'b'.repeat(64),
        exchange: {
          request_id: '11111111-1111-4111-8111-111111111111',
          request_code: 'PV-EXAMPLE',
          request_status: 'OPEN',
          session_expires_at: '2026-11-11T20:00:00Z',
          requirements: [{
            document_type: 'STUDENT_ID',
            required: true,
            allowed_mime_types: ['application/pdf'],
            max_file_size_bytes: 10 * 1024 * 1024,
          }],
        },
        status: {
          request_code: 'PV-EXAMPLE',
          status: 'OPEN',
          link_expires_at: '2026-11-12T00:00:00Z',
          session_expires_at: '2026-11-11T20:00:00Z',
          first_session_created_at: null,
          cleanup_deadline: '2026-11-11T21:45:00Z',
          borrower_details_submitted: false,
          submission_complete: false,
          submitted_at: null,
          requirements: [{ document_type: 'STUDENT_ID', required: true, latest_status: null }],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        intent_id: '22222222-2222-4222-8222-222222222222',
        request_id: '11111111-1111-4111-8111-111111111111',
        upload_url: 'https://storage.example/upload?X-Amz-Signature=test&X-Amz-Credential=test&X-Amz-Date=20261116T000000Z&X-Amz-Expires=300',
        required_headers: { 'Content-Type': 'application/pdf' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        document: {
          document_id: '33333333-3333-4333-8333-333333333333',
          document_type: 'STUDENT_ID',
          review_status: 'PENDING',
        },
      }));
    class SuccessfulUploadRequest extends EventTarget {
      readonly upload = new EventTarget();
      status = 200;
      timeout = 0;

      open(_method: string, url: string): void {
        uploadedUrls.push(url);
      }
      setRequestHeader(): void {}
      send(): void {
        this.dispatchEvent(new Event('load'));
      }
    }
    const uploadedUrls: string[] = [];
    vi.stubGlobal('XMLHttpRequest', SuccessfulUploadRequest);
    const backend = new BackendService();
    backend.config.set(config);
    await backend.exchangeBorrowerToken('a'.repeat(64));

    const file = new File(['document'], 'student-id.pdf', { type: 'application/pdf' });
    await Promise.all([
      backend.uploadBorrowerDocument(
        '11111111-1111-4111-8111-111111111111',
        'STUDENT_ID',
        file,
        () => undefined,
      ),
      backend.uploadBorrowerDocument(
        '11111111-1111-4111-8111-111111111111',
        'STUDENT_ID',
        file,
        () => undefined,
      ),
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(uploadedUrls).toEqual([
      'https://storage.example/upload?X-Amz-Signature=test&X-Amz-Credential=test&X-Amz-Date=20261116T000000Z&X-Amz-Expires=300',
    ]);
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({
      action: 'exchange_token',
      token: 'a'.repeat(64),
    });
    for (const index of [1, 2]) {
      const request = fetchSpy.mock.calls[index]?.[1] as RequestInit;
      expect(JSON.parse(String(request.body))).not.toHaveProperty('token');
    }

    for (const index of [1, 2]) {
      const request = fetchSpy.mock.calls[index]?.[1] as RequestInit;
      const headers = new Headers(request.headers);
      expect(headers.get('authorization')).toBe(`Bearer ${'b'.repeat(64)}`);
      expect(headers.get('apikey')).toBe(config.supabasePublishableKey);
    }
    expect(JSON.parse(String((fetchSpy.mock.calls[1]?.[1] as RequestInit).body))).toEqual({
      action: 'create_upload_intent',
      document_type: 'STUDENT_ID',
      original_filename: 'student-id.pdf',
      mime_type: 'application/pdf',
      expected_size: 8,
    });
    expect(JSON.parse(String((fetchSpy.mock.calls[2]?.[1] as RequestInit).body))).toEqual({
      action: 'finalize_upload',
      intent_id: '22222222-2222-4222-8222-222222222222',
      request_id: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('creates a fresh upload intent when retrying after an expired intent', async () => {
    const requestId = '11111111-1111-4111-8111-111111111111';
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        session_token: 'b'.repeat(64),
        exchange: {
          request_id: requestId,
          request_code: 'PV-EXAMPLE',
          request_status: 'OPEN',
          session_expires_at: '2026-11-11T20:00:00Z',
          requirements: [{
            document_type: 'STUDENT_ID',
            required: true,
            allowed_mime_types: ['application/pdf'],
            max_file_size_bytes: 10 * 1024 * 1024,
          }],
        },
        status: {
          request_code: 'PV-EXAMPLE',
          status: 'OPEN',
          link_expires_at: '2026-11-12T00:00:00Z',
          session_expires_at: '2026-11-11T20:00:00Z',
          first_session_created_at: null,
          cleanup_deadline: '2026-11-11T21:45:00Z',
          borrower_details_submitted: false,
          submission_complete: false,
          submitted_at: null,
          requirements: [{ document_type: 'STUDENT_ID', required: true, latest_status: null }],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        intent_id: '22222222-2222-4222-8222-222222222222',
        request_id: requestId,
        upload_url: 'https://storage.example/upload/first?X-Amz-Signature=first&X-Amz-Credential=test&X-Amz-Date=20261116T000000Z&X-Amz-Expires=300',
        required_headers: { 'Content-Type': 'application/pdf' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 'UPLOAD_INTENT_EXPIRED',
        error: 'This upload attempt expired; retry this file.',
      }, 410))
      .mockResolvedValueOnce(jsonResponse({
        intent_id: '44444444-4444-4444-8444-444444444444',
        request_id: requestId,
        upload_url: 'https://storage.example/upload/retry?X-Amz-Signature=retry&X-Amz-Credential=test&X-Amz-Date=20261116T000000Z&X-Amz-Expires=300',
        required_headers: { 'Content-Type': 'application/pdf' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        document: {
          document_id: '55555555-5555-4555-8555-555555555555',
          document_type: 'STUDENT_ID',
          review_status: 'PENDING',
        },
      }));
    const uploadedUrls: string[] = [];
    class SuccessfulUploadRequest extends EventTarget {
      readonly upload = new EventTarget();
      status = 200;
      timeout = 0;

      open(_method: string, url: string): void {
        uploadedUrls.push(url);
      }
      setRequestHeader(): void {}
      send(): void {
        this.dispatchEvent(new Event('load'));
      }
    }
    vi.stubGlobal('XMLHttpRequest', SuccessfulUploadRequest);
    const backend = new BackendService();
    backend.config.set(config);
    await backend.exchangeBorrowerToken('a'.repeat(64));
    const file = new File(['document'], 'student-id.pdf', { type: 'application/pdf' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await backend.uploadBorrowerDocument(requestId, 'STUDENT_ID', file, () => undefined);

    expect(warnSpy).toHaveBeenCalledWith('PJVault borrower API request failed', {
      action: 'finalize_upload',
      status: 410,
      reason: 'UPLOAD_INTENT_EXPIRED',
    });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('a'.repeat(64));
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('b'.repeat(64));
    expect(uploadedUrls).toEqual([
      'https://storage.example/upload/first?X-Amz-Signature=first&X-Amz-Credential=test&X-Amz-Date=20261116T000000Z&X-Amz-Expires=300',
      'https://storage.example/upload/retry?X-Amz-Signature=retry&X-Amz-Credential=test&X-Amz-Date=20261116T000000Z&X-Amz-Expires=300',
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(JSON.parse(String((fetchSpy.mock.calls[2]?.[1] as RequestInit).body))).toEqual({
      action: 'finalize_upload',
      intent_id: '22222222-2222-4222-8222-222222222222',
      request_id: requestId,
    });
    expect(JSON.parse(String((fetchSpy.mock.calls[3]?.[1] as RequestInit).body))).toEqual({
      action: 'create_upload_intent',
      document_type: 'STUDENT_ID',
      original_filename: 'student-id.pdf',
      mime_type: 'application/pdf',
      expected_size: 8,
    });
    expect(JSON.parse(String((fetchSpy.mock.calls[4]?.[1] as RequestInit).body))).toEqual({
      action: 'finalize_upload',
      intent_id: '44444444-4444-4444-8444-444444444444',
      request_id: requestId,
    });
  });
});
