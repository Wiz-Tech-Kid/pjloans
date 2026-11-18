import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import {
  AdminApplication,
  AdminApplicationDocument,
  BackendService,
  BorrowerLinkExchangeError,
  BorrowerSession,
} from './backend.service';

function borrowerSession(): BorrowerSession {
  return {
    requestId: '11111111-1111-4111-8111-111111111111',
    requestCode: 'PV-EXAMPLE',
    requestStatus: 'OPEN',
    sessionExpiresAt: '2026-11-15T13:00:00.000Z',
    requirements: [{
      document_type: 'STUDENT_ID',
      required: true,
      allowed_mime_types: ['application/pdf'],
      max_file_size_bytes: 10 * 1024 * 1024,
    }],
    status: {
      request_code: 'PV-EXAMPLE',
      status: 'OPEN',
      link_expires_at: '2026-11-15T13:15:00.000Z',
      session_expires_at: '2026-11-15T13:00:00.000Z',
      first_session_created_at: null,
      cleanup_deadline: '2026-11-15T15:00:00.000Z',
      borrower_details_submitted: false,
      submission_complete: false,
      submitted_at: null,
      requirements: [{ document_type: 'STUDENT_ID', required: true, latest_status: null }],
    },
  };
}

function previewDocument(
  fileName: string,
  mimeType: string,
): AdminApplicationDocument {
  return {
    documentId: '22222222-2222-4222-8222-222222222222',
    documentType: 'STUDENT_ID',
    fileName,
    mimeType,
    reviewStatus: 'PENDING',
    submittedAt: null,
    reviewNote: null,
    required: true,
  };
}

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    })
      .compileComponents();
  });

  afterEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/');
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('should create the app', () => {
    vi.spyOn(TestBed.inject(BackendService), 'initialize').mockResolvedValue();
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render administrator access', async () => {
    vi.spyOn(TestBed.inject(BackendService), 'initialize').mockResolvedValue();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Keep every request moving');
  });

  it('removes the original link token from the address after exchange succeeds', async () => {
    const backend = TestBed.inject(BackendService);
    vi.spyOn(backend, 'initialize').mockResolvedValue();
    const exchange = vi.spyOn(backend, 'exchangeBorrowerToken').mockResolvedValue(borrowerSession());
    window.history.replaceState(null, '', '/?token=original-token&keep=1#section');

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    expect(exchange).toHaveBeenCalledWith('original-token');
    expect(window.location.search).toBe('?keep=1');
    expect(window.location.hash).toBe('#section');
  });

  it('restores a saved borrower session on load without exchanging the original token', async () => {
    const backend = TestBed.inject(BackendService);
    vi.spyOn(backend, 'initialize').mockResolvedValue();
    window.sessionStorage.setItem('pjvault-borrower-upload-session', JSON.stringify({
      sessionToken: 'b'.repeat(64),
      requestId: '11111111-1111-4111-8111-111111111111',
      requestCode: 'PV-EXAMPLE',
      sessionExpiresAt: '2026-11-15T13:00:00.000Z',
      linkTokenFingerprint: 'c'.repeat(64),
      requirements: borrowerSession().requirements,
    }));
    const restore = vi.spyOn(backend, 'restoreBorrowerSession').mockResolvedValue(borrowerSession());
    const exchange = vi.spyOn(backend, 'exchangeBorrowerToken');
    window.history.replaceState(null, '', '/?token=original-token');

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    expect(restore).toHaveBeenCalledOnce();
    expect(exchange).not.toHaveBeenCalled();
    expect(fixture.componentInstance.borrowerSession()?.requestCode).toBe('PV-EXAMPLE');
    expect(window.location.search).toBe('');
  });

  it('shows a used-link message and removes the token after a failed exchange', async () => {
    const backend = TestBed.inject(BackendService);
    vi.spyOn(backend, 'initialize').mockResolvedValue();
    vi.spyOn(backend, 'exchangeBorrowerToken').mockRejectedValue(
      new BorrowerLinkExchangeError('already-used'),
    );
    window.history.replaceState(null, '', '/?token=original-token&keep=1');

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    expect(window.location.search).toBe('?keep=1');
    expect(fixture.componentInstance.borrowerError()).toContain('already been used');
  });

  it('applies a custom TTL before exposing the created borrower URL', async () => {
    vi.spyOn(TestBed.inject(BackendService), 'initialize').mockResolvedValue();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    const backend = TestBed.inject(BackendService);
    const link = {
      url: 'https://pjvault.example/?token=unchanged',
      expiresAt: '2026-12-01T12:15:00.000Z',
      requestId: '11111111-1111-4111-8111-111111111111',
    };
    vi.spyOn(backend, 'createBorrowerLink').mockResolvedValue(link);
    const setTtl = vi.spyOn(backend, 'setBorrowerLinkTtl').mockImplementation(async (requestId, ttlMinutes) => {
      expect(app.generatedLink()).toBeNull();
      expect(requestId).toBe(link.requestId);
      expect(ttlMinutes).toBe(60);
      return { expiresAt: '2026-12-01T13:00:00.000Z' };
    });
    vi.spyOn(backend, 'loadAdminRequests').mockResolvedValue();
    vi.spyOn(backend, 'updateAdminRequestExpiry');

    app.createTtlPreset = '60';
    await app.createLink();

    expect(setTtl).toHaveBeenCalledOnce();
    expect(app.generatedLink()).toEqual({
      url: link.url,
      expiresAt: '2026-12-01T13:00:00.000Z',
    });
  });

  it('withholds the borrower URL and reports when custom TTL setting fails', async () => {
    vi.spyOn(TestBed.inject(BackendService), 'initialize').mockResolvedValue();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    const backend = TestBed.inject(BackendService);
    vi.spyOn(backend, 'createBorrowerLink').mockResolvedValue({
      url: 'https://pjvault.example/?token=unchanged',
      expiresAt: '2026-12-01T12:15:00.000Z',
      requestId: '11111111-1111-4111-8111-111111111111',
    });
    vi.spyOn(backend, 'setBorrowerLinkTtl').mockRejectedValue(new Error('Request is closed.'));
    vi.spyOn(backend, 'loadAdminRequests').mockResolvedValue();

    app.createTtlPreset = '60';
    await app.createLink();

    expect(app.generatedLink()).toBeNull();
    expect(app.pageMessage()).toContain('selected link duration could not be confirmed');
    expect(app.pageMessage()).toContain('Request is closed.');
  });

  it('only enables loan approval after details and every submitted document are accepted', async () => {
    vi.spyOn(TestBed.inject(BackendService), 'initialize').mockResolvedValue();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    const application: AdminApplication = {
      requestId: '11111111-1111-4111-8111-111111111111',
      requestCode: 'PV-EXAMPLE',
      status: 'SUBMITTED',
      recipientLabel: null,
      submittedAt: null,
      borrowerDetailsSubmitted: true,
      borrowerDetails: { whatsappNumber: '+26770000000', courseName: 'Engineering', academicYear: 'Year 4' },
      documents: [
        {
          documentId: '22222222-2222-4222-8222-222222222222',
          documentType: 'STUDENT_ID',
          fileName: 'student-id.pdf',
          mimeType: 'application/pdf',
          reviewStatus: 'ACCEPTED',
          submittedAt: null,
          reviewNote: null,
          required: true,
        },
        {
          documentId: '33333333-3333-4333-8333-333333333333',
          documentType: 'OPTIONAL_DOCUMENT',
          fileName: 'optional.pdf',
          mimeType: 'application/pdf',
          reviewStatus: 'PENDING',
          submittedAt: null,
          reviewNote: null,
          required: false,
        },
      ],
    };

    expect(app.canApproveApplication(application)).toBe(false);
    application.documents[1]!.reviewStatus = 'ACCEPTED';
    expect(app.canApproveApplication(application)).toBe(true);
    application.borrowerDetailsSubmitted = false;
    expect(app.canApproveApplication(application)).toBe(false);
  });

  it.each([
    ['image/png', 'student-id.png'],
    ['image/jpeg', 'student-id.jpg'],
    ['image/webp', 'student-id.webp'],
  ])('binds the private URL and renders %s with image load tracking', async (mimeType, fileName) => {
    vi.spyOn(TestBed.inject(BackendService), 'initialize').mockResolvedValue();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    const backend = TestBed.inject(BackendService);
    const url = 'https://storage.example/private-document?X-Amz-Signature=temporary';
    vi.spyOn(backend, 'createAdminDocumentPreview').mockResolvedValue({
      url,
      expiresInSeconds: 60,
      expiresAt: Date.now() + 60_000,
      httpStatus: 200,
      operationId: 'service-operation',
    });

    await app.viewApplicationDocument(previewDocument(fileName, mimeType));

    const preview = app.documentPreview();
    expect(preview?.kind).toBe('image');
    expect(preview?.url).toBe(url);
    const image = document.createElement('img');
    Object.defineProperty(image, 'decode', { value: () => Promise.resolve() });
    app.onPreviewImageLoad({ currentTarget: image } as unknown as Event, preview!.operationId);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(app.documentPreview()?.loaded).toBe(true);
    expect(app.documentPreview()?.errorCode).toBeNull();
    app.closeDocumentPreview();
  });

  it('uses the PDF viewer, reports PDF errors distinctly, and fetches a fresh URL on reopen', async () => {
    vi.spyOn(TestBed.inject(BackendService), 'initialize').mockResolvedValue();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    const backend = TestBed.inject(BackendService);
    const document = previewDocument('student-id.pdf', 'application/pdf');
    const previewResponse = (url: string) => ({
      url,
      expiresInSeconds: 60,
      expiresAt: Date.now() + 60_000,
      httpStatus: 200,
      operationId: 'service-operation',
    });
    const createPreview = vi.spyOn(backend, 'createAdminDocumentPreview')
      .mockResolvedValueOnce(previewResponse('https://storage.example/first.pdf?X-Amz-Signature=first'))
      .mockResolvedValueOnce(previewResponse('https://storage.example/second.pdf?X-Amz-Signature=second'));
    app.selectedApplication.set({
      requestId: '11111111-1111-4111-8111-111111111111',
      requestCode: 'PV-EXAMPLE',
      status: 'SUBMITTED',
      recipientLabel: null,
      submittedAt: null,
      borrowerDetailsSubmitted: true,
      borrowerDetails: { whatsappNumber: '+26770000000', courseName: 'Engineering', academicYear: 'Year 4' },
      documents: [document],
    });

    await app.viewApplicationDocument(document);
    const firstPreview = app.documentPreview();
    expect(firstPreview?.kind).toBe('pdf');
    expect(firstPreview?.safePdfUrl).not.toBeNull();
    app.onPdfPreviewError(firstPreview!.operationId);
    expect(app.documentPreview()?.errorCode).toBe('PDF_PREVIEW_FAILED');
    app.closeDocumentPreview();
    await app.viewApplicationDocument(document);

    expect(createPreview).toHaveBeenCalledTimes(2);
    expect(app.documentPreview()?.url).toContain('second.pdf');
    app.closeDocumentPreview();
  });
});
