import { HttpClient, HttpEventType, HttpHeaders, HttpResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { firstValueFrom, lastValueFrom, of, tap, toArray } from 'rxjs';
import { AuthService } from '../../../src/core/auth.service';
import { DocumentStorageService, DocumentUploadUpdate } from '../../../src/core/document-storage.service';

const uploadUrl = 'https://account.r2.cloudflarestorage.com/private-bucket/document?signature=test';

function createHarness(finalizeResponse: { data: unknown; error: unknown } = {
  data: { document_id: 81, intent_id: 'intent-123', status: 'PENDING', idempotent: false },
  error: null,
}) {
  const invoke = vi.fn(async (name: string) => {
    if (name === 'create-document-upload') {
      return {
        data: {
          intent_id: 'intent-123',
          expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          upload_url: uploadUrl,
          upload_method: 'PUT',
          required_headers: { 'Content-Type': 'application/pdf' },
          url_expires_in_seconds: 300,
        },
        error: null,
      };
    }
    if (name === 'finalize-document-upload') return finalizeResponse;
    return {
      data: { document_id: 81, download_url: uploadUrl, expires_in_seconds: 120 },
      error: null,
    };
  });
  const request = vi.fn().mockReturnValue(of(
    { type: HttpEventType.UploadProgress, loaded: 50, total: 100 },
    new HttpResponse({ status: 200, body: '' }),
  ));
  const client = { functions: { invoke } };
  TestBed.configureTestingModule({
    providers: [
      DocumentStorageService,
      { provide: AuthService, useValue: { getSupabaseClient: () => client } },
      { provide: HttpClient, useValue: { request } },
    ],
  });
  return {
    service: TestBed.inject(DocumentStorageService),
    invoke,
    request,
  };
}

describe('DocumentStorageService deployed function contracts', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('creates an upload intent, PUTs directly to R2, then finalizes with the intent ID', async () => {
    const { service, invoke, request } = createHarness();
    const file = new File(['test document'], 'identity.pdf', { type: 'application/pdf' });
    const updates = await lastValueFrom(
      service.uploadApplicationDocument(42, 'IDENTITY_DOCUMENT', file).pipe(toArray()),
    );

    expect(invoke).toHaveBeenNthCalledWith(1, 'create-document-upload', {
      body: {
        application_id: 42,
        document_type: 'IDENTITY_DOCUMENT',
        original_filename: 'identity.pdf',
        mime_type: 'application/pdf',
        expected_size: file.size,
      },
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe('PUT');
    expect(request.mock.calls[0][1]).toBe(uploadUrl);
    const requestOptions = request.mock.calls[0][2] as { body: File; headers: HttpHeaders };
    expect(requestOptions.body).toBe(file);
    expect(requestOptions.headers.get('Content-Type')).toBe('application/pdf');
    expect(invoke).toHaveBeenNthCalledWith(2, 'finalize-document-upload', {
      body: { intent_id: 'intent-123' },
    });
    expect(updates.at(-1)).toMatchObject({
      stage: 'PENDING_REVIEW',
      documentId: 81,
      documentStatus: 'PENDING',
    });
  });

  it('does not report success when R2 accepts a PUT but finalization fails', async () => {
    const { service, invoke } = createHarness({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: new Response(JSON.stringify({ error: 'Finalization failed; verify R2 and server configuration' }), {
          status: 500,
        }),
      },
    });
    const updates: DocumentUploadUpdate[] = [];
    const file = new File(['test document'], 'identity.pdf', { type: 'application/pdf' });

    await expect(lastValueFrom(
      service.uploadApplicationDocument(42, 'IDENTITY_DOCUMENT', file).pipe(
        tap((update) => updates.push(update)),
        toArray(),
      ),
    )).rejects.toThrow('Finalization failed; verify R2 and server configuration');

    expect(invoke).toHaveBeenCalledWith('finalize-document-upload', {
      body: { intent_id: 'intent-123' },
    });
    expect(updates.map((update) => update.stage)).toContain('VERIFYING');
    expect(updates.some((update) => update.documentId !== undefined)).toBe(false);
  });

  it('requests a short-lived authorized viewing URL using the document ID', async () => {
    const { service, invoke } = createHarness();
    invoke.mockResolvedValueOnce({
      data: { url: uploadUrl, expires_in: 90, expires_at: '2099-01-01T00:00:00Z', content_type: 'application/pdf', filename: 'identity.pdf' },
      error: null,
    });

    await expect(firstValueFrom(service.getDocumentViewUrl(81))).resolves.toMatchObject({
      url: uploadUrl,
      filename: 'identity.pdf',
      contentType: 'application/pdf',
    });
    expect(invoke).toHaveBeenCalledWith('get-document-view-url', {
      body: { document_id: 81 },
    });
  });
});
