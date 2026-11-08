import { HttpClient, HttpErrorResponse, HttpEvent, HttpEventType, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, Subscription, from, map } from 'rxjs';
import { AuthService } from './auth.service';
import { BorrowerDocumentType, DocumentStatus } from './models';

export const MAX_APPLICATION_DOCUMENT_SIZE = 20 * 1024 * 1024;
const allowedMimeTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);

export type DocumentUploadStage =
  | 'NOT_UPLOADED'
  | 'REQUESTING_UPLOAD'
  | 'UPLOADING'
  | 'VERIFYING'
  | 'PENDING_REVIEW'
  | 'VERIFIED'
  | 'REJECTED'
  | 'FAILED';

export interface DocumentUploadUpdate {
  stage: DocumentUploadStage;
  progress: number;
  documentId?: number;
  documentStatus?: Exclude<DocumentStatus, 'MISSING'>;
}

export interface DocumentViewUrl {
  url: string;
  expiresIn: number;
  expiresAt: string;
  contentType: string;
  filename: string;
}

interface UploadIntent {
  intentId: string;
  uploadUrl: string;
  method: 'PUT';
  requiredHeaders: Record<string, string>;
  expiresAt: string;
  urlExpiresInSeconds: number;
}

export function validateApplicationDocument(file: File): string | null {
  if (!allowedMimeTypes.has(file.type)) {
    return 'Choose a PDF, JPEG, or PNG file.';
  }
  if (file.size === 0) {
    return 'The selected file is empty.';
  }
  if (file.size > MAX_APPLICATION_DOCUMENT_SIZE) {
    return 'Choose a file that is no larger than 20 MiB.';
  }
  return null;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`The ${label} response has an invalid format.`);
  }
  return value as Record<string, unknown>;
}

function uploadIntent(value: unknown, mimeType: string): UploadIntent {
  const result = objectValue(value, 'upload');
  const id = result['intent_id'];
  const url = result['upload_url'];
  const method = result['upload_method'];
  const headers = result['required_headers'];
  const expiresAt = result['expires_at'];
  const urlExpiresInSeconds = result['url_expires_in_seconds'];
  if (
    typeof id !== 'string'
    || !id
    || typeof url !== 'string'
    || method !== 'PUT'
    || typeof headers !== 'object'
    || headers === null
    || Array.isArray(headers)
    || typeof expiresAt !== 'string'
    || !Number.isFinite(Date.parse(expiresAt))
    || Date.parse(expiresAt) <= Date.now()
    || typeof urlExpiresInSeconds !== 'number'
    || !Number.isSafeInteger(urlExpiresInSeconds)
    || urlExpiresInSeconds < 1
    || urlExpiresInSeconds > 300
  ) {
    throw new Error('The upload service returned incomplete upload instructions.');
  }
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname.endsWith('.r2.cloudflarestorage.com')) {
    throw new Error('The upload service returned an untrusted storage URL.');
  }
  const entries = Object.entries(headers);
  if (!entries.every((entry): entry is [string, string] => typeof entry[1] === 'string')) {
    throw new Error('The upload service returned invalid required headers.');
  }
  const requiredHeaders = Object.fromEntries(entries);
  const contentType = Object.entries(requiredHeaders)
    .find(([name]) => name.toLowerCase() === 'content-type')?.[1];
  if (contentType !== mimeType) {
    throw new Error('The upload service did not return the required content-type header.');
  }
  return {
    intentId: id,
    uploadUrl: url,
    method,
    requiredHeaders,
    expiresAt,
    urlExpiresInSeconds,
  };
}

function finalizedDocument(
  value: unknown,
  intentId: string,
): { documentId: number; status: Exclude<DocumentStatus, 'MISSING'>; stage: DocumentUploadStage } {
  const result = objectValue(value, 'finalization');
  const id = result['document_id'];
  const responseIntentId = result['intent_id'];
  const status = result['status'];
  const idempotent = result['idempotent'];
  const numericId = typeof id === 'number' ? id : typeof id === 'string' ? Number(id) : NaN;
  if (
    !Number.isSafeInteger(numericId)
    || numericId <= 0
    || responseIntentId !== intentId
    || (status !== 'PENDING' && status !== 'VERIFIED' && status !== 'REJECTED')
    || typeof idempotent !== 'boolean'
  ) {
    throw new Error('The upload could not be confirmed by the document service.');
  }
  return {
    documentId: numericId,
    status,
    stage: status === 'PENDING' ? 'PENDING_REVIEW' : status,
  };
}

async function edgeErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (typeof error !== 'object' || error === null) return fallback;
  const value = error as { message?: unknown; context?: unknown };
  if (value.context instanceof Response) {
    if (value.context.status === 401) return 'Your session has expired. Sign in again and retry.';
    if (value.context.status === 403) return 'You are not authorized to access this document operation.';
    if (value.context.status === 410) return 'The upload intent has expired. Retry the upload to request a new one.';
    try {
      const body: unknown = await value.context.clone().json();
      const topLevel = objectValue(body, 'error');
      if (typeof topLevel['error'] === 'string' && topLevel['error']) return topLevel['error'];
    } catch {
      if (typeof value.message === 'string' && value.message) return value.message;
    }
  }
  return typeof value.message === 'string' && value.message ? value.message : fallback;
}

@Injectable({ providedIn: 'root' })
export class DocumentStorageService {
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);

  getDocumentViewUrl(documentId: number): Observable<DocumentViewUrl> {
    return from(this.auth.getSupabaseClient().functions.invoke('get-document-view-url', {
      body: { document_id: documentId },
    })).pipe(
      map(({ data, error }) => {
        if (error) throw Object.assign(new Error('The document preview could not be opened.'), { context: error.context });
        const result = objectValue(data, 'document preview');
        const url = result['url'];
        const expiresAt = result['expires_at'];
        const contentType = result['content_type'];
        const filename = result['filename'];
        const expiresIn = result['expires_in'];
        if (typeof url !== 'string' || !/^https:\/\//.test(url)
          || typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt))
          || typeof contentType !== 'string' || !['application/pdf', 'image/jpeg', 'image/png'].includes(contentType)
          || typeof filename !== 'string'
          || typeof expiresIn !== 'number' || expiresIn <= 0) {
          throw new Error('The document preview response was incomplete.');
        }
        return { url, expiresAt, expiresIn, contentType, filename };
      }),
    );
  }

  uploadApplicationDocument(
    applicationId: number,
    documentType: BorrowerDocumentType,
    file: File,
  ): Observable<DocumentUploadUpdate> {
    return this.uploadDocument(applicationId, documentType, file);
  }

  uploadDisbursementProof(applicationId: number, file: File): Observable<DocumentUploadUpdate> {
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      return new Observable((observer) => observer.error(new Error('Choose a PNG or JPEG proof screenshot.')));
    }
    return this.uploadDocument(applicationId, 'DISBURSEMENT_PROOF', file);
  }

  private uploadDocument(
    applicationId: number,
    documentType: BorrowerDocumentType | 'DISBURSEMENT_PROOF',
    file: File,
  ): Observable<DocumentUploadUpdate> {
    const invalidFile = validateApplicationDocument(file);
    if (invalidFile) {
      return new Observable((observer) => observer.error(new Error(invalidFile)));
    }

    return new Observable((observer) => {
      let uploadSubscription: Subscription | undefined;
      let finalizeSubscription: Subscription | undefined;
      let cancelled = false;
      observer.next({ stage: 'REQUESTING_UPLOAD', progress: 0 });

      const client = this.auth.getSupabaseClient();
      void client.functions.invoke('create-document-upload', {
        body: {
          application_id: applicationId,
          document_type: documentType,
          original_filename: file.name,
          mime_type: file.type,
          expected_size: file.size,
        },
      }).then(async ({ data, error }) => {
        if (error) throw new Error(await edgeErrorMessage(error, 'The upload could not be started.'));
        if (cancelled) return;

        const intent = uploadIntent(data, file.type);
        const headers = new HttpHeaders(intent.requiredHeaders);
        observer.next({ stage: 'UPLOADING', progress: 0 });
        uploadSubscription = this.http.request(intent.method, intent.uploadUrl, {
          body: file,
          headers,
          observe: 'events',
          reportProgress: true,
          responseType: 'text',
        }).subscribe({
          next: (event: HttpEvent<string>) => {
            if (event.type === HttpEventType.UploadProgress) {
              const progress = event.total
                ? Math.min(100, Math.round((event.loaded / event.total) * 100))
                : 0;
              observer.next({ stage: 'UPLOADING', progress });
            }
            if (event.type === HttpEventType.Response) {
              observer.next({ stage: 'VERIFYING', progress: 100 });
              finalizeSubscription = from(client.functions.invoke('finalize-document-upload', {
                body: { intent_id: intent.intentId },
              })).subscribe({
                next: ({ data: finalized, error: finalizeError }) => {
                  if (finalizeError) {
                    void edgeErrorMessage(finalizeError, 'The uploaded file could not be verified.')
                      .then((message) => observer.error(new Error(message)));
                    return;
                  }
                  try {
                    const result = finalizedDocument(finalized, intent.intentId);
                    observer.next({
                      stage: result.stage,
                      progress: 100,
                      documentId: result.documentId,
                      documentStatus: result.status,
                    });
                    observer.complete();
                  } catch (error) {
                    observer.error(error);
                  }
                },
                error: (error: unknown) => observer.error(error),
              });
            }
          },
          error: (error: unknown) => observer.error(this.uploadError(error)),
        });
      }).catch((error: unknown) => {
        if (!cancelled) observer.error(error instanceof Error ? error : new Error('The upload could not be started.'));
      });

      return () => {
        cancelled = true;
        uploadSubscription?.unsubscribe();
        finalizeSubscription?.unsubscribe();
      };
    });
  }

  private uploadError(error: unknown): Error {
    if (error instanceof HttpErrorResponse) {
      return new Error(error.status === 0
        ? 'Could not connect to private storage. Check your connection and retry.'
        : 'Private storage rejected the upload. The temporary URL may have expired; retry to request a new one.');
    }
    if (error instanceof Error && error.message) return error;
    return new Error('The file could not be uploaded. Check your connection and try again.');
  }
}
