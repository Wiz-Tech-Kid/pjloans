import { Injectable, isDevMode, signal } from '@angular/core';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

export interface RuntimeConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
}

export interface PjVaultRequirement {
  document_type: string;
  required: boolean;
  allowed_mime_types: string[];
  max_file_size_bytes: number;
}

export interface BorrowerRequirementStatus {
  document_type: string;
  required: boolean;
  latest_status: string | null;
}

export interface BorrowerRequestStatus {
  request_code: string;
  status: string;
  link_expires_at: string | null;
  session_expires_at: string | null;
  first_session_created_at: string | null;
  cleanup_deadline: string | null;
  borrower_details_submitted: boolean;
  submission_complete: boolean;
  submitted_at: string | null;
  requirements: BorrowerRequirementStatus[];
}

export interface BorrowerSession {
  requestId: string;
  requestCode: string;
  requestStatus: string;
  sessionExpiresAt: string;
  requirements: PjVaultRequirement[];
  status: BorrowerRequestStatus;
}

interface PersistedBorrowerSession {
  sessionToken: string;
  requestId: string;
  requestCode: string;
  sessionExpiresAt: string;
  requirements: PjVaultRequirement[];
  linkTokenFingerprint?: string;
}

export class BorrowerSessionPersistenceError extends Error {}

export class BorrowerApiError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message);
  }
}

type BorrowerLinkExchangeFailureReason = 'already-used' | 'expired' | 'revoked' | 'closed' | 'unavailable';

interface BorrowerLinkExchangeAttempt {
  tokenFingerprint: string;
  reason: BorrowerLinkExchangeFailureReason | 'pending';
}

export class BorrowerLinkExchangeError extends Error {
  constructor(readonly reason: BorrowerLinkExchangeFailureReason) {
    super(borrowerLinkExchangeFailureMessage(reason));
  }
}

export interface BorrowerLinkInput {
  expiresAt: string | null;
  recipientLabel: string;
  externalReference: string;
  requirements: PjVaultRequirement[];
}

export interface BorrowerLink {
  url: string;
  expiresAt: string;
  requestId: string | null;
}

export interface BorrowerLinkExpiry {
  expiresAt: string;
}

export interface AdminRequestRecord {
  requestId: string;
  requestCode: string;
  status: string;
  recipientLabel: string | null;
  externalReference: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  submittedAt: string | null;
  borrowerDetailsSubmitted: boolean;
  submissionComplete: boolean;
  requirements: BorrowerRequirementStatus[];
}

export interface BorrowerDetails {
  whatsappNumber: string;
  courseName: string;
  academicYear: string;
}

export interface FinalizedDocument {
  documentId: string;
  documentType: string;
  reviewStatus: string;
}

const DEFAULT_RUNTIME_ERROR = 'Live configuration is unavailable. Run the project configuration step and try again.';
const BORROWER_SESSION_STORAGE_KEY = 'pjvault-borrower-upload-session';
const BORROWER_EXCHANGE_ATTEMPT_STORAGE_KEY = 'pjvault-borrower-link-exchange-attempt';
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return isRecord(value[0]) ? value[0] : null;
  return isRecord(value) ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function valueString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function borrowerLinkExchangeFailureMessage(reason: BorrowerLinkExchangeFailureReason): string {
  switch (reason) {
    case 'already-used':
      return 'This PJVault link has already been used or is no longer available. Ask the administrator for a fresh link.';
    case 'expired':
      return 'This PJVault link has expired. Ask the administrator for a fresh link.';
    case 'revoked':
      return 'This PJVault link was revoked by the administrator.';
    case 'closed':
      return 'This PJVault request is closed. Ask the administrator for an active link.';
    case 'unavailable':
      return 'This one-time PJVault link could not be exchanged. It may already have been used; ask the administrator for a fresh link.';
  }
}

function isBorrowerLinkExchangeFailureReason(value: unknown): value is BorrowerLinkExchangeFailureReason | 'pending' {
  return value === 'already-used' || value === 'expired' || value === 'revoked' || value === 'closed'
    || value === 'unavailable' || value === 'pending';
}

function borrowerSessionFailureReason(code: string | null): 'expired' | 'revoked' | 'closed' | null {
  if (code === 'LINK_REVOKED' || code === 'SESSION_REVOKED') return 'revoked';
  if (code === 'LINK_EXPIRED' || code === 'SESSION_EXPIRED' || code === 'CLEANUP_DEADLINE') return 'expired';
  if (code === 'REQUEST_CLOSED') return 'closed';
  return null;
}

function rows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => isRecord(item));
  }
  if (isRecord(value)) {
    for (const key of ['data', 'rows', 'items', 'records', 'result']) {
      if (key in value) return rows(value[key]);
    }
    return [value];
  }
  return [];
}

function stringValue(row: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    if (typeof row[key] === 'string' && row[key]) return row[key] as string;
    if (typeof row[key] === 'number') return String(row[key]);
  }
  return fallback;
}

function nullableString(row: Record<string, unknown>, keys: string[]): string | null {
  const value = stringValue(row, keys);
  return value || null;
}

async function errorDetails(response: Response, fallback: string): Promise<{ message: string; code: string | null }> {
  try {
    const body: unknown = await response.clone().json();
    if (isRecord(body)) {
      const code = typeof body['code'] === 'string' ? body['code'] : null;
      for (const key of ['error', 'message']) {
        if (typeof body[key] === 'string' && body[key]) return { message: body[key], code };
      }
      if (isRecord(body['details']) && typeof body['details']['message'] === 'string') {
        return { message: body['details']['message'], code };
      }
      return { message: fallback, code };
    }
  } catch {
    return { message: fallback, code: null };
  }
  return { message: fallback, code: null };
}

function requirementsFrom(value: unknown): PjVaultRequirement[] {
  if (!Array.isArray(value)) throw new Error('The PJVault request did not include its document requirements.');
  return value.map((item) => {
    if (!isRecord(item)) throw new Error('The PJVault request returned an invalid document requirement.');
    const documentType = valueString(item['document_type']);
    const mimeTypes = strings(item['allowed_mime_types']);
    const maxFileSize = item['max_file_size_bytes'];
    if (
      !documentType ||
      typeof item['required'] !== 'boolean' ||
      mimeTypes.length === 0 ||
      typeof maxFileSize !== 'number' ||
      !Number.isSafeInteger(maxFileSize) ||
      maxFileSize < 1 ||
      maxFileSize > MAX_FILE_SIZE_BYTES ||
      mimeTypes.some((mimeType) => !ALLOWED_MIME_TYPES.has(mimeType))
    ) {
      throw new Error('The PJVault request returned invalid document upload requirements.');
    }
    return {
      document_type: documentType,
      required: item['required'],
      allowed_mime_types: mimeTypes,
      max_file_size_bytes: maxFileSize,
    };
  });
}

function requestStatusFrom(value: unknown): BorrowerRequestStatus {
  const row = firstRecord(value);
  if (!row || typeof row['status'] !== 'string' || typeof row['request_code'] !== 'string') {
    throw new Error('PJVault returned incomplete request status.');
  }
  const requirements = Array.isArray(row['requirements'])
    ? row['requirements'].flatMap((item): BorrowerRequirementStatus[] => {
        if (!isRecord(item) || typeof item['document_type'] !== 'string') return [];
        return [{
          document_type: item['document_type'],
          required: item['required'] === true,
          latest_status: typeof item['latest_status'] === 'string' ? item['latest_status'] : null,
        }];
      })
    : [];
  return {
    request_code: row['request_code'],
    status: row['status'],
    link_expires_at: typeof row['link_expires_at'] === 'string' ? row['link_expires_at'] : null,
    session_expires_at: typeof row['session_expires_at'] === 'string' ? row['session_expires_at'] : null,
    first_session_created_at: typeof row['first_session_created_at'] === 'string' ? row['first_session_created_at'] : null,
    cleanup_deadline: typeof row['cleanup_deadline'] === 'string' ? row['cleanup_deadline'] : null,
    borrower_details_submitted: row['borrower_details_submitted'] === true,
    submission_complete: row['submission_complete'] === true,
    submitted_at: typeof row['submitted_at'] === 'string' ? row['submitted_at'] : null,
    requirements,
  };
}

@Injectable({ providedIn: 'root' })
export class BackendService {
  readonly config = signal<RuntimeConfig | null>(null);
  readonly configError = signal('');
  readonly adminUser = signal<AdminUser | null>(null);
  readonly requests = signal<AdminRequestRecord[]>([]);
  readonly requestsLoading = signal(false);
  readonly requestsError = signal('');
  readonly loading = signal(false);

  private accessToken: string | null = null;
  private borrowerSessionToken: string | null = null;
  private borrowerLinkTokenFingerprint: string | null = null;
  private configPromise: Promise<RuntimeConfig> | null = null;
  private supabaseClient: SupabaseClient | null = null;
  private supabaseStorageMode: 'local' | 'session' | null = null;
  private rememberSession = false;
  private readonly borrowerUploadOperations = new WeakMap<File, Map<string, Promise<FinalizedDocument>>>();

  async initialize(): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      const config = await this.loadConfig();
      this.rememberSession = this.readRememberPreference();
      const client = this.getSupabaseClient(config, this.rememberSession);
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError || !sessionData.session) return;
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user?.id || !userData.user.email) {
        await client.auth.signOut({ scope: 'local' });
        return;
      }
      this.accessToken = sessionData.session.access_token;
      try {
        await this.authorizeAdmin(userData.user, this.accessToken);
        void this.loadAdminRequests();
      } catch {
        this.accessToken = null;
        this.adminUser.set(null);
        await client.auth.signOut({ scope: 'local' });
      }
    } catch (error) {
      this.configError.set(error instanceof Error ? error.message : DEFAULT_RUNTIME_ERROR);
    }
  }

  async signInAdmin(email: string, password: string, rememberSession = false): Promise<void> {
    const config = await this.loadConfig();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      throw new Error('Enter the administrator email and password.');
    }

    this.loading.set(true);
    this.accessToken = null;
    this.borrowerSessionToken = null;
    this.adminUser.set(null);
    this.rememberSession = rememberSession;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('pjvault-remember-admin', String(rememberSession));
    }

    try {
      const client = this.getSupabaseClient(config, rememberSession);
      const { data: authData, error: authError } = await client.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });
      if (authError || !authData.session) {
        throw new Error(authError?.message || 'The administrator email or password is incorrect.');
      }

      const accessToken = authData.session.access_token;
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user?.id || !userData.user.email) {
        throw new Error(userError?.message || 'The authenticated user could not be loaded.');
      }
      const user = userData.user;
      if (!accessToken) {
        throw new Error('The administrator session was incomplete.');
      }
      this.accessToken = accessToken;
      await this.authorizeAdmin(user, accessToken);
      void this.loadAdminRequests();
    } catch (error) {
      this.accessToken = null;
      this.adminUser.set(null);
      await this.supabaseClient?.auth.signOut({ scope: 'local' });
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  signOut(): void {
    void this.supabaseClient?.auth.signOut({ scope: 'local' });
    this.accessToken = null;
    this.borrowerSessionToken = null;
    this.adminUser.set(null);
    this.requests.set([]);
    this.requestsError.set('');
  }

  async loadAdminRequests(): Promise<void> {
    if (!this.accessToken || !this.adminUser()) return;
    this.requestsLoading.set(true);
    this.requestsError.set('');
    try {
      const response = await this.edgeRequest('pjvault-admin-api', {
        action: 'list_requests',
        limit: 100,
        offset: 0,
      }, this.accessToken);
      this.requests.set(rows(response).map((row) => this.mapAdminRequest(row)));
    } catch (error) {
      this.requestsError.set(error instanceof Error ? error.message : 'PJVault requests could not be loaded.');
    } finally {
      this.requestsLoading.set(false);
    }
  }

  async createBorrowerLink(input: BorrowerLinkInput): Promise<BorrowerLink> {
    if (!this.accessToken || !this.adminUser()) {
      throw new Error('Sign in with an active PJVault administrator account to create a request link.');
    }
    const response = await this.edgeRequest('pjvault-admin-api', {
      action: 'create_request',
      expires_at: input.expiresAt,
      recipient_label: input.recipientLabel.trim() || null,
      external_reference: input.externalReference.trim() || null,
      requirements: input.requirements,
    }, this.accessToken);
    const row = firstRecord(response);
    const token = valueString(row?.['upload_token']);
    if (!token) throw new Error('PJVault did not return a borrower link token.');

    const url = new URL('/', window.location.origin);
    url.searchParams.set('token', token);
    return {
      url: url.toString(),
      expiresAt: valueString(row?.['expires_at']) || input.expiresAt || '',
      requestId: valueString(row?.['request_id']) || null,
    };
  }

  async setBorrowerLinkTtl(requestId: string, ttlMinutes: number): Promise<BorrowerLinkExpiry> {
    if (!this.accessToken || !this.adminUser()) {
      throw new Error('Sign in with an active PJVault administrator account to update a request link.');
    }
    if (!requestId || !Number.isSafeInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 43_200) {
      throw new Error('Choose a whole-number link duration between 1 and 43,200 minutes.');
    }

    const client = this.getSupabaseClient(await this.loadConfig());
    const { data, error } = await client.rpc('pjvault_admin_set_upload_link_ttl', {
      p_request_id: requestId,
      p_ttl_minutes: ttlMinutes,
    });
    if (error) throw new Error(error.message);

    const row = firstRecord(data);
    const expiresAt = typeof data === 'string'
      ? data
      : valueString(row?.['expires_at'] ?? row?.['link_expires_at']);
    if (!expiresAt || !Number.isFinite(Date.parse(expiresAt))) {
      throw new Error('PJVault did not return a valid updated link expiry.');
    }
    return { expiresAt };
  }

  updateAdminRequestExpiry(requestId: string, expiresAt: string): void {
    this.requests.update((requests) => requests.map((request) =>
      request.requestId === requestId ? { ...request, expiresAt } : request,
    ));
  }

  async exchangeBorrowerToken(token: string): Promise<BorrowerSession> {
    const tokenFingerprint = await this.borrowerTokenFingerprint(token);
    const previousAttempt = this.readBorrowerLinkExchangeAttempt();
    if (previousAttempt?.tokenFingerprint === tokenFingerprint) {
      throw new BorrowerLinkExchangeError(
        previousAttempt.reason === 'pending' ? 'unavailable' : previousAttempt.reason,
      );
    }

    this.writeBorrowerLinkExchangeAttempt({ tokenFingerprint, reason: 'pending' });
    try {
      const response = await this.edgeRequest('pjvault-borrower-api', {
        action: 'exchange_token',
        token,
      });
      const body = firstRecord(response);
      const exchange = firstRecord(body?.['exchange']);
      const status = requestStatusFrom(body?.['status']);
      const sessionToken = valueString(body?.['session_token']);
      if (!exchange || !sessionToken) {
        throw new Error('PJVault returned an incomplete borrower session.');
      }

      const requestId = valueString(exchange['request_id']);
      const requestCode = valueString(exchange['request_code']);
      const requestStatus = valueString(exchange['request_status']);
      const sessionExpiresAt = valueString(exchange['session_expires_at']);
      if (!requestId || !requestCode || !requestStatus || !sessionExpiresAt) {
        throw new Error('PJVault returned incomplete borrower request details.');
      }

      const borrowerSession: BorrowerSession = {
        requestId,
        requestCode,
        requestStatus,
        sessionExpiresAt,
        requirements: requirementsFrom(exchange['requirements']),
        status,
      };
      this.persistBorrowerSession(sessionToken, borrowerSession, tokenFingerprint);
      this.borrowerSessionToken = sessionToken;
      this.borrowerLinkTokenFingerprint = tokenFingerprint;
      this.clearBorrowerLinkExchangeAttempt(tokenFingerprint);
      if (status.submission_complete || status.borrower_details_submitted) {
        this.clearPersistedBorrowerSession();
      } else {
        this.clearUnavailableBorrowerSession(status.status, tokenFingerprint);
      }
      return borrowerSession;
    } catch (error) {
      const reason = error instanceof BorrowerSessionPersistenceError
        ? 'unavailable'
        : this.classifyBorrowerLinkExchangeFailure(error);
      this.writeBorrowerLinkExchangeAttempt({ tokenFingerprint, reason });
      if (error instanceof BorrowerSessionPersistenceError) throw error;
      throw new BorrowerLinkExchangeError(reason);
    }
  }

  hasSavedBorrowerSession(): boolean {
    return typeof window !== 'undefined'
      && window.sessionStorage.getItem(BORROWER_SESSION_STORAGE_KEY) !== null;
  }

  borrowerLinkExchangeFailureMessage(): string | null {
    const attempt = this.readBorrowerLinkExchangeAttempt();
    if (!attempt) return null;
    return borrowerLinkExchangeFailureMessage(
      attempt.reason === 'pending' ? 'unavailable' : attempt.reason,
    );
  }

  async restoreBorrowerSession(): Promise<BorrowerSession> {
    const saved = this.readPersistedBorrowerSession();
    this.borrowerSessionToken = saved.sessionToken;
    this.borrowerLinkTokenFingerprint = saved.linkTokenFingerprint ?? null;
    let status: BorrowerRequestStatus;
    try {
      status = await this.loadBorrowerRequestStatus();
    } catch (error) {
      const reason = error instanceof BorrowerApiError
        ? borrowerSessionFailureReason(error.code)
        : null;
      if (reason) {
        this.clearPersistedBorrowerSession();
        if (saved.linkTokenFingerprint) {
          this.writeBorrowerLinkExchangeAttempt({
            tokenFingerprint: saved.linkTokenFingerprint,
            reason,
          });
        }
      }
      throw error;
    }
    if (status.submission_complete || status.borrower_details_submitted) {
      this.clearPersistedBorrowerSession();
    } else {
      this.clearUnavailableBorrowerSession(status.status, saved.linkTokenFingerprint);
    }
    return {
      requestId: saved.requestId,
      requestCode: saved.requestCode,
      requestStatus: status.status,
      sessionExpiresAt: saved.sessionExpiresAt,
      requirements: saved.requirements,
      status,
    };
  }

  async loadBorrowerRequestStatus(): Promise<BorrowerRequestStatus> {
    return requestStatusFrom(await this.edgeRequest('pjvault-borrower-api', {
      action: 'request_status',
    }, this.requireBorrowerSession()));
  }

  async uploadBorrowerDocument(
    requestId: string,
    documentType: string,
    file: File,
    onProgress: (progress: number) => void,
  ): Promise<FinalizedDocument> {
    let operations = this.borrowerUploadOperations.get(file);
    if (!operations) {
      operations = new Map<string, Promise<FinalizedDocument>>();
      this.borrowerUploadOperations.set(file, operations);
    }
    const operationKey = `${requestId}\u0000${documentType}`;
    const existing = operations.get(operationKey);
    if (existing) return existing;

    const operation = this.createAndFinalizeBorrowerUpload(requestId, documentType, file, onProgress);
    operations.set(operationKey, operation);
    try {
      return await operation;
    } catch (error) {
      if (operations.get(operationKey) === operation) operations.delete(operationKey);
      if (operations.size === 0) this.borrowerUploadOperations.delete(file);
      throw error;
    }
  }

  private async createAndFinalizeBorrowerUpload(
    requestId: string,
    documentType: string,
    file: File,
    onProgress: (progress: number) => void,
  ): Promise<FinalizedDocument> {
    const sessionToken = this.requireBorrowerSession();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.uploadWithFreshIntent(requestId, documentType, file, onProgress, sessionToken);
      } catch (error) {
        if (attempt === 0 && error instanceof BorrowerApiError && error.code === 'UPLOAD_INTENT_EXPIRED') {
          continue;
        }
        throw error;
      }
    }
    throw new Error('The upload attempt expired. Retry this file.');
  }

  private async uploadWithFreshIntent(
    requestId: string,
    documentType: string,
    file: File,
    onProgress: (progress: number) => void,
    sessionToken: string,
  ): Promise<FinalizedDocument> {
    const intentResponse = await this.edgeRequest('pjvault-borrower-api', {
      action: 'create_upload_intent',
      document_type: documentType,
      original_filename: file.name,
      mime_type: file.type,
      expected_size: file.size,
    }, sessionToken);
    const intent = firstRecord(intentResponse);
    const intentId = valueString(intent?.['intent_id']);
    const intentRequestId = valueString(intent?.['request_id']);
    const uploadUrl = valueString(intent?.['upload_url']);
    const requiredHeaders = isRecord(intent?.['required_headers']) ? intent['required_headers'] : null;
    if (!intentId || !intentRequestId || !uploadUrl || !requiredHeaders) {
      throw new Error('PJVault did not return a complete private upload intent.');
    }
    if (intentRequestId !== requestId) {
      throw new Error('The upload intent does not belong to this PJVault request.');
    }

    // Correlation identifiers let us trace this exact transfer without logging
    // the presigned URL, borrower token, filename or other sensitive data.
    await this.putFile(uploadUrl, file, requiredHeaders, onProgress, {
      requestId: intentRequestId,
      intentId,
      fileSize: file.size,
      mimeType: file.type,
    });
    const result = await this.edgeRequest('pjvault-borrower-api', {
      action: 'finalize_upload',
      intent_id: intentId,
      request_id: intentRequestId,
    }, sessionToken);
    const document = firstRecord(isRecord(result) ? result['document'] : null);
    const documentId = valueString(document?.['document_id']);
    const finalizedType = valueString(document?.['document_type']);
    const reviewStatus = valueString(document?.['review_status']);
    if (!documentId || !finalizedType || !reviewStatus) {
      throw new Error('PJVault did not confirm document finalization.');
    }
    return { documentId, documentType: finalizedType, reviewStatus };
  }

  async submitBorrowerDetails(details: BorrowerDetails): Promise<BorrowerRequestStatus> {
    const sessionToken = this.requireBorrowerSession();
    const response = await this.edgeRequest('pjvault-borrower-api', {
      action: 'submit_details',
      whatsapp_number: details.whatsappNumber.trim(),
      course_name: details.courseName.trim(),
      academic_year: details.academicYear.trim(),
    }, sessionToken);
    const status = requestStatusFrom(isRecord(response) ? response['status'] : null);
    if (!status.borrower_details_submitted) {
      throw new Error('PJVault did not confirm that your details were submitted.');
    }
    this.clearPersistedBorrowerSession();
    return status;
  }

  private async borrowerTokenFingerprint(token: string): Promise<string> {
    const bytes = new TextEncoder().encode(token);
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  private readBorrowerLinkExchangeAttempt(): BorrowerLinkExchangeAttempt | null {
    if (typeof window === 'undefined') return null;
    const raw = window.sessionStorage.getItem(BORROWER_EXCHANGE_ATTEMPT_STORAGE_KEY);
    if (!raw) return null;

    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      window.sessionStorage.removeItem(BORROWER_EXCHANGE_ATTEMPT_STORAGE_KEY);
      return null;
    }
    if (
      !isRecord(value) ||
      typeof value['tokenFingerprint'] !== 'string' ||
      !isBorrowerLinkExchangeFailureReason(value['reason'])
    ) {
      window.sessionStorage.removeItem(BORROWER_EXCHANGE_ATTEMPT_STORAGE_KEY);
      return null;
    }
    return {
      tokenFingerprint: value['tokenFingerprint'],
      reason: value['reason'],
    };
  }

  private writeBorrowerLinkExchangeAttempt(attempt: BorrowerLinkExchangeAttempt): void {
    if (typeof window === 'undefined') {
      throw new Error('The one-time borrower link exchange cannot be tracked outside a browser.');
    }
    window.sessionStorage.setItem(BORROWER_EXCHANGE_ATTEMPT_STORAGE_KEY, JSON.stringify(attempt));
  }

  private clearBorrowerLinkExchangeAttempt(tokenFingerprint: string): void {
    const attempt = this.readBorrowerLinkExchangeAttempt();
    if (attempt?.tokenFingerprint === tokenFingerprint) {
      window.sessionStorage.removeItem(BORROWER_EXCHANGE_ATTEMPT_STORAGE_KEY);
    }
  }

  private classifyBorrowerLinkExchangeFailure(error: unknown): BorrowerLinkExchangeFailureReason {
    if (error instanceof BorrowerApiError) {
      const reason = borrowerSessionFailureReason(error.code);
      if (reason) return reason;
    }
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('revoked')) return 'revoked';
    if (message.includes('expired')) return 'expired';
    if (message.includes('closed')) return 'closed';
    if (message.includes('already') || message.includes('used') || message.includes('redeemed')) {
      return 'already-used';
    }
    return 'unavailable';
  }

  private clearPersistedBorrowerSession(): void {
    this.borrowerSessionToken = null;
    this.borrowerLinkTokenFingerprint = null;
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(BORROWER_SESSION_STORAGE_KEY);
    }
  }

  private invalidateBorrowerSession(reason: 'expired' | 'revoked' | 'closed'): void {
    const tokenFingerprint = this.borrowerLinkTokenFingerprint;
    this.clearPersistedBorrowerSession();
    if (tokenFingerprint) {
      this.writeBorrowerLinkExchangeAttempt({
        tokenFingerprint,
        reason,
      });
    }
  }

  private clearUnavailableBorrowerSession(status: string, tokenFingerprint?: string): void {
    const normalized = status.toUpperCase();
    const reason = normalized.includes('REVOKED')
      ? 'revoked'
      : normalized.includes('EXPIRED') ? 'expired'
        : normalized.includes('CLOSED') ? 'closed' : null;
    if (!reason) return;
    this.clearPersistedBorrowerSession();
    if (tokenFingerprint) this.writeBorrowerLinkExchangeAttempt({ tokenFingerprint, reason });
  }

  private requireBorrowerSession(): string {
    if (!this.borrowerSessionToken) {
      throw new Error('Your secure upload session is unavailable or expired. Ask the administrator for a new PJVault link.');
    }
    return this.borrowerSessionToken;
  }

  private persistBorrowerSession(
    sessionToken: string,
    session: BorrowerSession,
    linkTokenFingerprint: string,
  ): void {
    if (typeof window === 'undefined') {
      throw new Error('The secure upload session cannot be saved outside a browser.');
    }
    try {
      const saved: PersistedBorrowerSession = {
        sessionToken,
        requestId: session.requestId,
        requestCode: session.requestCode,
        sessionExpiresAt: session.sessionExpiresAt,
        requirements: session.requirements,
        linkTokenFingerprint,
      };
      window.sessionStorage.setItem(BORROWER_SESSION_STORAGE_KEY, JSON.stringify(saved));
    } catch (error) {
      throw new BorrowerSessionPersistenceError(
        `The borrower link was opened, but this browser could not save the secure upload session. ${error instanceof Error ? error.message : ''}`.trim(),
      );
    }
  }

  private readPersistedBorrowerSession(): PersistedBorrowerSession {
    if (typeof window === 'undefined') {
      throw new Error('The saved secure upload session is unavailable outside a browser.');
    }
    let raw: string | null;
    try {
      raw = window.sessionStorage.getItem(BORROWER_SESSION_STORAGE_KEY);
    } catch (error) {
      throw new Error(`The saved secure upload session could not be read. ${error instanceof Error ? error.message : ''}`.trim());
    }
    if (!raw) {
      throw new Error('The saved secure upload session is unavailable. Ask the administrator for a new PJVault link.');
    }

    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      window.sessionStorage.removeItem(BORROWER_SESSION_STORAGE_KEY);
      throw new Error('The saved secure upload session is invalid. Ask the administrator for a new PJVault link.');
    }
    if (!isRecord(value)) {
      window.sessionStorage.removeItem(BORROWER_SESSION_STORAGE_KEY);
      throw new Error('The saved secure upload session is invalid. Ask the administrator for a new PJVault link.');
    }

    const sessionToken = valueString(value['sessionToken']);
    const requestId = valueString(value['requestId']);
    const requestCode = valueString(value['requestCode']);
    const sessionExpiresAt = valueString(value['sessionExpiresAt']);
    const linkTokenFingerprint = valueString(value['linkTokenFingerprint']);
    if (
      sessionToken.length < 32 ||
      !requestId ||
      !requestCode ||
      !sessionExpiresAt ||
      !Array.isArray(value['requirements'])
    ) {
      window.sessionStorage.removeItem(BORROWER_SESSION_STORAGE_KEY);
      throw new Error('The saved secure upload session is invalid. Ask the administrator for a new PJVault link.');
    }

    return {
      sessionToken,
      requestId,
      requestCode,
      sessionExpiresAt,
      requirements: requirementsFrom(value['requirements']),
      ...(linkTokenFingerprint ? { linkTokenFingerprint } : {}),
    };
  }

  private mapAdminRequest(row: Record<string, unknown>): AdminRequestRecord {
    const requirements = Array.isArray(row['requirements'])
      ? row['requirements'].flatMap((item): BorrowerRequirementStatus[] => {
        if (!isRecord(item) || typeof item['document_type'] !== 'string') return [];
        return [{
          document_type: item['document_type'],
          required: item['required'] === true,
          latest_status: typeof item['latest_status'] === 'string' ? item['latest_status'] : null,
        }];
      })
      : [];
    return {
      requestId: stringValue(row, ['request_id', 'id'], 'unknown'),
      requestCode: stringValue(row, ['request_code', 'code'], 'Request'),
      status: stringValue(row, ['status'], 'OPEN'),
      recipientLabel: nullableString(row, ['recipient_label', 'borrower_name']),
      externalReference: nullableString(row, ['external_reference']),
      expiresAt: nullableString(row, ['expires_at', 'link_expires_at']),
      createdAt: nullableString(row, ['created_at']),
      submittedAt: nullableString(row, ['submitted_at']),
      borrowerDetailsSubmitted: row['borrower_details_submitted'] === true,
      submissionComplete: row['submission_complete'] === true,
      requirements,
    };
  }

  private async edgeRequest(
    functionName: string,
    body: Record<string, unknown>,
    bearerToken?: string,
  ): Promise<unknown> {
    const config = await this.loadConfig();
    const headers = new Headers({
      apikey: config.supabasePublishableKey,
      'content-type': 'application/json',
    });
    if (bearerToken) headers.set('authorization', `Bearer ${bearerToken}`);
    const response = await fetch(
      `${config.supabaseUrl.replace(/\/$/, '')}/functions/v1/${functionName}`,
      { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store' },
    );
    if (!response.ok) {
      const action = valueString(body['action']);
      const isUploadAction = action === 'create_upload_intent' || action === 'finalize_upload';
      const fallback = isUploadAction
        ? 'The upload could not be completed. Retry this file.'
        : 'The PJVault request could not be completed. Please try again.';
      const details = await errorDetails(response, fallback);
      if (functionName === 'pjvault-borrower-api') {
        if (isDevMode()) {
          console.warn('PJVault borrower API request failed', {
            action,
            status: response.status,
            reason: details.code ?? 'UNCLASSIFIED',
          });
        }
        const reason = borrowerSessionFailureReason(details.code);
        if (bearerToken && reason) this.invalidateBorrowerSession(reason);
        throw new BorrowerApiError(details.message, details.code);
      }
      throw new Error(details.message);
    }
    return response.json();
  }

  private async putFile(
    uploadUrl: string,
    file: File,
    headers: Record<string, unknown>,
    onProgress: (progress: number) => void,
    context: {
      requestId: string;
      intentId: string;
      fileSize: number;
      mimeType: string;
    },
  ): Promise<void> {
    // Refuse malformed or non-HTTPS URLs before giving them to XMLHttpRequest.
    // Do not log uploadUrl: it is a bearer credential until it expires.
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(uploadUrl);
    } catch {
      throw new Error('PJVault returned an invalid private upload URL. Request a new upload attempt.');
    }
    if (
      parsedUrl.protocol !== 'https:' ||
      !parsedUrl.searchParams.has('X-Amz-Signature') ||
      !parsedUrl.searchParams.has('X-Amz-Credential') ||
      !parsedUrl.searchParams.has('X-Amz-Date') ||
      !parsedUrl.searchParams.has('X-Amz-Expires')
    ) {
      throw new Error('PJVault returned an invalid private upload authorization. Request a new upload attempt.');
    }

    // The backend signs Content-Type. Ensure the required value is present and
    // exactly matches the selected browser File's MIME type.
    const contentType = headers['Content-Type'] ?? headers['content-type'];
    if (typeof contentType !== 'string' || !contentType || contentType !== file.type) {
      throw new Error('The upload Content-Type does not match the selected file. Select the file again and retry.');
    }

    await new Promise<void>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('PUT', uploadUrl);
      request.timeout = 5 * 60 * 1000;
      request.withCredentials = false;

      for (const [name, value] of Object.entries(headers)) {
        if (typeof value === 'string') request.setRequestHeader(name, value);
      }

      request.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
        }
      });

      request.addEventListener('load', () => {
        if (request.status >= 200 && request.status < 300) {
          onProgress(100);
          resolve();
          return;
        }

        // Some R2 error responses may not expose their XML body to the browser.
        // Record only safe diagnostics; never include the signed URL or headers.
        let r2ErrorCode = '';
        try {
          const match = /<Code>\s*([^<]+)\s*<\/Code>/i.exec(request.responseText ?? '');
          r2ErrorCode = match?.[1]?.trim() ?? '';
        } catch {
          r2ErrorCode = '';
        }
        if (isDevMode()) {
          console.error('PJVault R2 PUT failed', {
            requestId: context.requestId,
            intentId: context.intentId,
            httpStatus: request.status,
            statusText: request.statusText,
            r2ErrorCode: r2ErrorCode || 'NOT_EXPOSED',
            fileSize: context.fileSize,
            mimeType: context.mimeType,
          });
        }
        reject(new Error(
          r2ErrorCode
            ? `Private file upload failed (${r2ErrorCode}, HTTP ${request.status}). Retry the upload.`
            : `Private file upload failed (HTTP ${request.status}). Retry the upload.`,
        ));
      });

      request.addEventListener('error', () => {
        if (isDevMode()) {
          console.error('PJVault R2 PUT network/CORS failure', {
            requestId: context.requestId,
            intentId: context.intentId,
            httpStatus: request.status,
            statusText: request.statusText,
            fileSize: context.fileSize,
            mimeType: context.mimeType,
          });
        }
        reject(new Error(
          request.status === 0
            ? 'The browser could not read the R2 upload response. Check the R2 CORS response and inspect the matching PUT request.'
            : 'Private file upload failed. Check your connection and retry.',
        ));
      });

      request.addEventListener('timeout', () => {
        if (isDevMode()) {
          console.error('PJVault R2 PUT timed out', {
            requestId: context.requestId,
            intentId: context.intentId,
            fileSize: context.fileSize,
            mimeType: context.mimeType,
          });
        }
        reject(new Error('Private file upload timed out. Retry the upload.'));
      });

      request.send(file);
    });
  }

  private async loadConfig(): Promise<RuntimeConfig> {
    const current = this.config();
    if (current) return current;
    this.configPromise ??= fetch('/runtime-config.json', { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error(DEFAULT_RUNTIME_ERROR);
      const value: unknown = await response.json();
      if (!isRecord(value)) throw new Error(DEFAULT_RUNTIME_ERROR);
      const supabaseUrl = valueString(value['supabaseUrl']);
      const supabasePublishableKey = valueString(value['supabasePublishableKey']);
      if (
        !supabaseUrl ||
        !supabasePublishableKey ||
        supabasePublishableKey === valueString(value['supabaseSecretKey']) ||
        supabasePublishableKey.startsWith('sb_secret_')
      ) {
        throw new Error('The browser received an invalid Supabase public configuration.');
      }
      const config = { supabaseUrl, supabasePublishableKey };
      this.config.set(config);
      return config;
    }).catch((error: unknown) => {
      this.configPromise = null;
      throw error;
    });
    return this.configPromise;
  }

  private getSupabaseClient(config: RuntimeConfig, rememberSession = this.rememberSession): SupabaseClient {
    const storageMode = rememberSession ? 'local' : 'session';
    if (this.supabaseClient && this.supabaseStorageMode === storageMode) return this.supabaseClient;
    this.supabaseStorageMode = storageMode;
    const storage = typeof window === 'undefined'
      ? undefined
      : rememberSession ? window.localStorage : window.sessionStorage;
    this.supabaseClient = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: {
        persistSession: true,
        storage,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
    return this.supabaseClient;
  }

  private async authorizeAdmin(user: User, accessToken: string): Promise<void> {
    const roleResponse = await this.edgeRequest('pjvault-admin-session', {}, accessToken);
    const roleRows = Array.isArray(roleResponse) ? roleResponse : [roleResponse];
    const isThisUserAdmin = roleRows.some(
      (row) => isRecord(row)
        && row['user_id'] === user.id
        && row['app_role'] === 'ADMIN'
        && row['account_status'] === 'ACTIVE',
    );
    if (!isThisUserAdmin) throw new Error('This account is not an active PJVault administrator.');

    const metadata = isRecord(user.user_metadata) ? user.user_metadata : null;
    const userEmail = user.email;
    if (!userEmail) throw new Error('The administrator session was incomplete.');
    this.adminUser.set({
      id: user.id,
      email: userEmail,
      name: valueString(metadata?.['full_name']) || userEmail.split('@')[0],
    });
  }

  private readRememberPreference(): boolean {
    return typeof localStorage !== 'undefined' && localStorage.getItem('pjvault-remember-admin') === 'true';
  }
}
