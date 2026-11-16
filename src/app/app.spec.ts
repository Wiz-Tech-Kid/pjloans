import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { BackendService, BorrowerLinkExchangeError, BorrowerSession } from './backend.service';

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
});
