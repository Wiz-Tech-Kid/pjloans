import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  BackendService,
  AdminRequestRecord,
  BorrowerApiError,
  BorrowerLinkExchangeError,
  BorrowerSessionPersistenceError,
  BorrowerRequestStatus,
  BorrowerSession,
  PjVaultRequirement,
} from './backend.service';

type Theme = 'dark' | 'light';
type Screen = 'login' | 'admin' | 'borrower';
type AdminView = 'home' | 'requests' | 'archive' | 'create';
type UploadState = 'idle' | 'uploading' | 'finalized' | 'error';

interface RequirementForm {
  documentType: string;
  label: string;
  description: string;
  required: boolean;
  allowedMimeTypes: string[];
  maxFileSizeMb: number;
  isDefault: boolean;
}

interface UploadSlot extends PjVaultRequirement {
  file: File | null;
  progress: number;
  state: UploadState;
  error: string;
}

const FILE_TYPES = [
  { value: 'application/pdf', label: 'PDF' },
  { value: 'image/jpeg', label: 'JPG' },
  { value: 'image/png', label: 'PNG' },
];
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_LINK_TTL_MINUTES = 43_200;
const LINK_TTL_PRESETS = [
  { value: '15', label: '15 minutes (default)' },
  { value: '60', label: '1 hour' },
  { value: '360', label: '6 hours' },
  { value: '1440', label: '24 hours' },
  { value: '10080', label: '7 days' },
  { value: '43200', label: '30 days' },
  { value: 'custom', label: 'Custom duration' },
];

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly backend = inject(BackendService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly theme = signal<Theme>(this.initialTheme());
  readonly screen = signal<Screen>('login');
  readonly adminView = signal<AdminView>('home');
  readonly mobileNavOpen = signal(false);
  readonly linkBusy = signal(false);
  readonly expiryBusyRequestId = signal<string | null>(null);
  readonly expiryEditorRequestId = signal<string | null>(null);
  readonly requestExpiryErrors = signal<Record<string, string>>({});
  readonly requestExpirySuccess = signal<Record<string, string>>({});
  readonly generatedLink = signal<{ url: string; expiresAt: string } | null>(null);
  readonly pageMessage = signal('');
  readonly linkTtlPresets = LINK_TTL_PRESETS;

  loginEmail = '';
  loginPassword = '';
  rememberMe = false;
  loginError = '';

  recipientLabel = '';
  externalReference = '';
  createTtlPreset = '15';
  createCustomTtlMinutes = 15;
  existingTtlPreset = '15';
  existingCustomTtlMinutes = 15;
  requirementForms: RequirementForm[] = [
    this.newRequirement('STUDENT_ID', 'Verify student identity and institution', true, 'Student ID'),
    this.newRequirement('IDENTITY_DOCUMENT', 'Verify personal identity', true, 'National ID or Passport'),
    this.newRequirement('ADMISSION_LETTER', 'Confirm admission into the institution', true, 'Admission Letter'),
    this.newRequirement('SPONSORSHIP_LETTER', 'Verify sponsorship or funding arrangements', true, 'Sponsorship Letter'),
    this.newRequirement('SEMESTER_TIMETABLE', 'Screenshot showing evidence of current semester registration', true, 'Current Semester Timetable'),
  ];

  borrowerToken = this.readBorrowerToken();
  readonly borrowerSession = signal<BorrowerSession | null>(null);
  readonly borrowerStatus = signal<BorrowerRequestStatus | null>(null);
  readonly borrowerBusy = signal(false);
  readonly borrowerError = signal('');
  readonly borrowerSubmitted = signal(false);
  readonly borrowerStep = signal(0);
  borrowerWhatsApp = '';
  borrowerCourseName = '';
  borrowerAcademicYear = '';
  borrowerUploads: UploadSlot[] = [];

  constructor() {
    effect(() => {
      const value = this.theme();
      if (typeof document !== 'undefined') document.documentElement.dataset['theme'] = value;
      if (typeof localStorage !== 'undefined') localStorage.setItem('pjvault-theme', value);
    });

    if (isPlatformBrowser(this.platformId)) {
      this.rememberMe = localStorage.getItem('pjvault-remember-admin') === 'true';
      if (this.rememberMe) this.loginEmail = localStorage.getItem('pjvault-admin-email') ?? '';
    }

    const hasSavedBorrowerSession = isPlatformBrowser(this.platformId) && this.backend.hasSavedBorrowerSession();
    const previousExchangeFailure = isPlatformBrowser(this.platformId)
      ? this.backend.borrowerLinkExchangeFailureMessage()
      : null;
    if (this.borrowerToken || hasSavedBorrowerSession || previousExchangeFailure) {
      this.screen.set('borrower');
      if (!this.borrowerToken && !hasSavedBorrowerSession && previousExchangeFailure) {
        this.borrowerError.set(previousExchangeFailure);
      } else {
        void this.loadBorrowerLink();
      }
    } else if (isPlatformBrowser(this.platformId)) {
      void this.backend.initialize().then(() => {
        if (this.backend.adminUser()) {
          this.screen.set('admin');
          this.adminView.set('home');
        }
      });
    }
  }

  toggleTheme(): void {
    this.theme.update((value) => value === 'dark' ? 'light' : 'dark');
  }

  async signIn(): Promise<void> {
    this.loginError = '';
    try {
      await this.backend.signInAdmin(this.loginEmail, this.loginPassword, this.rememberMe);
      if (this.rememberMe) localStorage.setItem('pjvault-admin-email', this.loginEmail.trim());
      else localStorage.removeItem('pjvault-admin-email');
      this.screen.set('admin');
      this.adminView.set('home');
    } catch (error) {
      this.loginError = error instanceof Error ? error.message : 'Administrator sign-in failed.';
    }
  }

  signOut(): void {
    this.backend.signOut();
    this.screen.set('login');
    this.loginPassword = '';
    this.generatedLink.set(null);
    this.pageMessage.set('');
    this.adminView.set('home');
  }

  openHome(): void {
    this.adminView.set('home');
    this.pageMessage.set('');
    this.mobileNavOpen.set(false);
  }

  openCreateLink(): void {
    this.adminView.set('create');
    this.mobileNavOpen.set(false);
  }

  openRequests(): void {
    this.adminView.set('requests');
    this.mobileNavOpen.set(false);
    void this.backend.loadAdminRequests();
  }

  openArchive(): void {
    this.adminView.set('archive');
    this.mobileNavOpen.set(false);
    void this.backend.loadAdminRequests();
  }

  goHome(event: MouseEvent): void {
    if (this.screen() !== 'admin') return;
    event.preventDefault();
    this.openHome();
  }

  requestCount(status?: string): number {
    const requests = this.backend.requests();
    return status ? requests.filter((request) => request.status === status).length : requests.length;
  }

  archiveEntries(): Array<{ requestCode: string; documentType: string; status: string }> {
    return this.backend.requests().flatMap((request) => request.requirements.map((requirement) => ({
      requestCode: request.requestCode,
      documentType: requirement.document_type,
      status: requirement.latest_status ?? (request.submissionComplete ? 'SUBMITTED' : 'PENDING'),
    })));
  }

  addRequirement(): void {
    if (this.requirementForms.length < 5) {
      this.requirementForms = [...this.requirementForms, this.newRequirement('', '', false)];
    }
  }

  removeRequirement(index: number): void {
    if (this.requirementForms[index]?.isDefault) return;
    if (this.requirementForms.length > 1) {
      this.requirementForms = this.requirementForms.filter((_, current) => current !== index);
    }
  }

  toggleMimeType(requirement: RequirementForm, mimeType: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const types = new Set(requirement.allowedMimeTypes);
    if (checked) types.add(mimeType);
    else types.delete(mimeType);
    requirement.allowedMimeTypes = [...types];
    this.requirementForms = [...this.requirementForms];
  }

  async createLink(): Promise<void> {
    const requirements = this.validatedRequirements();
    if (!requirements) return;
    const ttlMinutes = this.selectedTtlMinutes(this.createTtlPreset, this.createCustomTtlMinutes);
    if (ttlMinutes === null) {
      this.pageMessage.set('Enter a whole-number link duration between 1 and 43,200 minutes.');
      return;
    }
    this.linkBusy.set(true);
    this.pageMessage.set('');
    this.generatedLink.set(null);
    let requestCreated = false;
    try {
      let link = await this.backend.createBorrowerLink({
        expiresAt: null,
        recipientLabel: this.recipientLabel,
        externalReference: this.externalReference,
        requirements,
      });
      requestCreated = true;
      if (ttlMinutes !== 15) {
        const requestId = link.requestId;
        if (!requestId) throw new Error('PJVault did not return the request ID needed to set this link duration.');
        const expiry = await this.backend.setBorrowerLinkTtl(requestId, ttlMinutes);
        link = { ...link, expiresAt: expiry.expiresAt };
        await this.backend.loadAdminRequests();
        this.backend.updateAdminRequestExpiry(requestId, expiry.expiresAt);
      }
      this.generatedLink.set({ url: link.url, expiresAt: link.expiresAt });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The PJVault request link could not be created.';
      if (requestCreated && ttlMinutes !== 15) {
        void this.backend.loadAdminRequests();
        this.pageMessage.set(`The request was created, but the selected link duration could not be confirmed. The URL is withheld. ${message}`);
      } else {
        this.pageMessage.set(message);
      }
    } finally {
      this.linkBusy.set(false);
    }
  }

  selectCreateTtlPreset(value: string): void {
    this.createTtlPreset = value;
    if (value !== 'custom') this.createCustomTtlMinutes = Number(value);
  }

  selectExistingTtlPreset(value: string): void {
    this.existingTtlPreset = value;
    if (value !== 'custom') this.existingCustomTtlMinutes = Number(value);
  }

  openExpiryEditor(requestId: string): void {
    this.requestExpiryErrors.update((errors) => ({ ...errors, [requestId]: '' }));
    this.requestExpirySuccess.update((messages) => ({ ...messages, [requestId]: '' }));
    this.existingTtlPreset = '15';
    this.existingCustomTtlMinutes = 15;
    this.expiryEditorRequestId.set(requestId);
  }

  async setExistingRequestExpiry(request: AdminRequestRecord): Promise<void> {
    const ttlMinutes = this.selectedTtlMinutes(this.existingTtlPreset, this.existingCustomTtlMinutes);
    if (ttlMinutes === null) {
      this.requestExpiryErrors.update((errors) => ({
        ...errors,
        [request.requestId]: 'Enter a whole-number link duration between 1 and 43,200 minutes.',
      }));
      return;
    }

    this.expiryBusyRequestId.set(request.requestId);
    this.requestExpiryErrors.update((errors) => ({ ...errors, [request.requestId]: '' }));
    this.requestExpirySuccess.update((messages) => ({ ...messages, [request.requestId]: '' }));
    try {
      const expiry = await this.backend.setBorrowerLinkTtl(request.requestId, ttlMinutes);
      await this.backend.loadAdminRequests();
      this.backend.updateAdminRequestExpiry(request.requestId, expiry.expiresAt);
      this.requestExpirySuccess.update((messages) => ({
        ...messages,
        [request.requestId]: `Expiry set to ${this.shortDate(expiry.expiresAt)}. This duration starts now; the link URL and token are unchanged.`,
      }));
      this.expiryEditorRequestId.set(null);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'The link expiry could not be updated.';
      const ineligible = /closed|revoked|submitted|ineligible|not eligible/i.test(detail);
      this.requestExpiryErrors.update((errors) => ({
        ...errors,
        [request.requestId]: `PJVault did not confirm the requested expiry.${ineligible ? ' This request is closed, revoked, submitted, or otherwise ineligible.' : ' Check that the request is active and eligible.'} ${detail}`,
      }));
    } finally {
      this.expiryBusyRequestId.set(null);
    }
  }

  isRequestExpiryEligible(request: AdminRequestRecord): boolean {
    const status = request.status.toUpperCase();
    return ['OPEN', 'NEEDS_REUPLOAD'].includes(status)
      && !request.borrowerDetailsSubmitted
      && !request.submissionComplete;
  }

  private selectedTtlMinutes(preset: string, customMinutes: number): number | null {
    const minutes = preset === 'custom' ? customMinutes : Number(preset);
    return Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= MAX_LINK_TTL_MINUTES
      ? minutes
      : null;
  }

  async copyLink(): Promise<void> {
    const link = this.generatedLink()?.url;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      this.pageMessage.set('Borrower link copied.');
    } catch {
      this.pageMessage.set('Copy was blocked by the browser. Select the link and copy it manually.');
    }
  }

  async loadBorrowerLink(): Promise<void> {
    const hasSavedSession = this.backend.hasSavedBorrowerSession();
    const token = hasSavedSession ? null : this.borrowerToken;
    if (!token && !hasSavedSession) return;
    this.borrowerBusy.set(true);
    this.borrowerError.set('');
    try {
      let session: BorrowerSession;
      if (hasSavedSession) {
        session = await this.backend.restoreBorrowerSession();
      } else if (token) {
        session = await this.backend.exchangeBorrowerToken(token);
      } else {
        return;
      }
      this.borrowerStatus.set(session.status);
      if (this.borrowerToken) this.removeBorrowerTokenFromAddress();

      if (session.status.submission_complete || session.status.borrower_details_submitted) {
        this.borrowerSubmitted.set(true);
        return;
      }

      const statusMessage = this.unavailableStatusMessage(session.status.status);
      if (statusMessage) {
        this.borrowerSession.set(null);
        this.borrowerError.set(statusMessage);
        return;
      }

      this.borrowerSession.set(session);
      this.borrowerUploads = session.requirements.map((requirement) => ({
        ...requirement,
        file: null,
        progress: 0,
        state: 'idle',
        error: '',
      }));
    } catch (error) {
      if (error instanceof BorrowerLinkExchangeError || error instanceof BorrowerSessionPersistenceError) {
        this.removeBorrowerTokenFromAddress();
      }
      this.borrowerError.set(error instanceof BorrowerLinkExchangeError
        ? error.message
        : this.borrowerLinkError(error));
    } finally {
      this.borrowerBusy.set(false);
    }
  }

  nextBorrowerStep(): void {
    this.borrowerError.set('');
    if (this.borrowerStep() === 0) {
      const phoneDigits = this.borrowerWhatsApp.replace(/\D/g, '');
      if (phoneDigits.length < 7 || phoneDigits.length > 15) {
        this.borrowerError.set('Enter a valid WhatsApp number, including its country code.');
        return;
      }
      if (!this.borrowerCourseName.trim()) {
        this.borrowerError.set('Enter your course name.');
        return;
      }
      if (!this.borrowerAcademicYear.trim()) {
        this.borrowerError.set('Enter your academic year.');
        return;
      }
    }
    if (this.borrowerStep() === 1) {
      const missing = this.borrowerUploads.find((slot) => slot.required && slot.state !== 'finalized');
      if (missing) {
        this.borrowerError.set(`Upload and finish “${this.documentLabel(missing.document_type)}” before continuing.`);
        return;
      }
    }
    this.borrowerStep.update((step) => Math.min(2, step + 1));
  }

  previousBorrowerStep(): void {
    this.borrowerError.set('');
    this.borrowerStep.update((step) => Math.max(0, step - 1));
  }

  onBorrowerFile(event: Event, documentType: string): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    const slot = this.borrowerUploads.find((item) => item.document_type === documentType);
    if (!slot || !file || slot.state === 'finalized' || slot.state === 'uploading') return;

    if (!slot.allowed_mime_types.includes(file.type) || file.size < 1 || file.size > slot.max_file_size_bytes) {
      slot.error = `Choose ${this.mimeLabel(slot.allowed_mime_types)} no larger than ${this.fileSize(slot.max_file_size_bytes)}.`;
      slot.file = null;
      input.value = '';
    } else {
      slot.file = file;
      slot.error = '';
      slot.state = 'idle';
      slot.progress = 0;
    }
    this.borrowerUploads = [...this.borrowerUploads];
  }

  async uploadDocument(documentType: string): Promise<void> {
    const session = this.borrowerSession();
    const slot = this.borrowerUploads.find((item) => item.document_type === documentType);
    if (!session || !slot?.file || slot.state === 'uploading' || slot.state === 'finalized') return;

    slot.state = 'uploading';
    slot.progress = 0;
    slot.error = '';
    this.borrowerUploads = [...this.borrowerUploads];
    try {
      await this.backend.uploadBorrowerDocument(
        session.requestId,
        slot.document_type,
        slot.file,
        (progress) => {
          slot.progress = progress;
          this.borrowerUploads = [...this.borrowerUploads];
        },
      );
      slot.state = 'finalized';
      slot.progress = 100;
      this.borrowerStatus.set(await this.backend.loadBorrowerRequestStatus());
    } catch (error) {
      slot.state = 'error';
      slot.error = error instanceof Error ? error.message : 'The file could not be finalized. Retry the upload.';
      this.markBorrowerSessionUnavailable(error);
    } finally {
      this.borrowerUploads = [...this.borrowerUploads];
    }
  }

  async submitBorrower(): Promise<void> {
    if (!this.borrowerSession()) return;
    this.borrowerBusy.set(true);
    this.borrowerError.set('');
    try {
      const status = await this.backend.submitBorrowerDetails({
        whatsappNumber: this.borrowerWhatsApp,
        courseName: this.borrowerCourseName,
        academicYear: this.borrowerAcademicYear,
      });
      this.borrowerStatus.set(status);
      this.borrowerSubmitted.set(true);
    } catch (error) {
      this.borrowerError.set(error instanceof Error ? error.message : 'Your PJVault details could not be submitted. Retry when ready.');
      this.markBorrowerSessionUnavailable(error);
    } finally {
      this.borrowerBusy.set(false);
    }
  }

  documentLabel(documentType: string): string {
    return documentType.replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
  }

  mimeLabel(mimeTypes: string[]): string {
    return mimeTypes.map((mimeType) => FILE_TYPES.find((type) => type.value === mimeType)?.label ?? mimeType).join(', ');
  }

  fileSize(bytes: number): string {
    return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MiB`;
  }

  shortDate(value: string | null | undefined): string {
    if (!value) return 'Not supplied';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleString('en-BW', { dateStyle: 'medium', timeStyle: 'short' });
  }

  private validatedRequirements(): PjVaultRequirement[] | null {
    if (this.requirementForms.length < 1 || this.requirementForms.length > 5) {
      this.pageMessage.set('PJVault requests support up to five document requirements.');
      return null;
    }
    const seen = new Set<string>();
    const requirements: PjVaultRequirement[] = [];
    for (const requirement of this.requirementForms) {
      const documentType = requirement.documentType.trim();
      const maxFileSizeBytes = requirement.maxFileSizeMb * 1024 * 1024;
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(documentType)) {
        this.pageMessage.set('Each document type must use 1–64 letters, numbers, underscores, or hyphens.');
        return null;
      }
      if (seen.has(documentType)) {
        this.pageMessage.set('Document types must be unique within a request.');
        return null;
      }
      if (requirement.allowedMimeTypes.length === 0) {
        this.pageMessage.set(`Choose at least one file type for ${this.documentLabel(documentType)}.`);
        return null;
      }
      if (
        !Number.isSafeInteger(maxFileSizeBytes) ||
        maxFileSizeBytes < 1 ||
        maxFileSizeBytes > MAX_FILE_SIZE_BYTES
      ) {
        this.pageMessage.set('Each file size limit must be between 1 byte and 20 MiB.');
        return null;
      }
      seen.add(documentType);
      requirements.push({
        document_type: documentType,
        required: requirement.required,
        allowed_mime_types: [...requirement.allowedMimeTypes],
        max_file_size_bytes: maxFileSizeBytes,
      });
    }
    return requirements;
  }

  private borrowerLinkError(error: unknown): string {
    if (error instanceof BorrowerApiError) {
      switch (error.code) {
        case 'LINK_EXPIRED':
        case 'SESSION_EXPIRED':
        case 'CLEANUP_DEADLINE':
          return 'This PJVault link or session has expired. Ask the administrator for a new link.';
        case 'LINK_REVOKED':
        case 'SESSION_REVOKED':
          return 'This PJVault link was revoked by the administrator.';
        case 'REQUEST_CLOSED':
          return 'This PJVault request is closed. Ask the administrator for an active link.';
        case 'UPLOAD_INTENT_EXPIRED':
          return 'This upload attempt expired; retry this file.';
        case 'LINK_ALREADY_USED':
          return 'This PJVault link has already been used or submitted. Ask the administrator for a fresh link.';
      }
      return error.message;
    }
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('expired')) return 'This PJVault link has expired. Ask the administrator for a new link.';
    if (message.includes('revoked')) return 'This PJVault link was revoked by the administrator.';
    if (message.includes('closed')) return 'This PJVault request is closed.';
    if (message.includes('already') || message.includes('used') || message.includes('submitted')) {
      return 'This PJVault link has already been used or submitted.';
    }
    if (message.includes('invalid') || message.includes('not found') || message.includes('token')) {
      return 'This PJVault link is invalid or unavailable. Check that you opened the complete link.';
    }
    return error instanceof Error ? error.message : 'This PJVault link could not be opened. Try again or contact the administrator.';
  }

  private markBorrowerSessionUnavailable(error: unknown): void {
    if (
      !(error instanceof BorrowerApiError) ||
      !['LINK_EXPIRED', 'SESSION_EXPIRED', 'LINK_REVOKED', 'SESSION_REVOKED', 'CLEANUP_DEADLINE', 'REQUEST_CLOSED'].includes(error.code ?? '')
    ) return;
    this.borrowerSession.set(null);
    this.borrowerStatus.set(null);
    this.borrowerError.set(this.borrowerLinkError(error));
  }

  private unavailableStatusMessage(status: string): string {
    const normalized = status.toUpperCase();
    if (normalized.includes('EXPIRED')) return 'This PJVault request has expired. Ask the administrator for a new link.';
    if (normalized.includes('REVOKED')) return 'This PJVault request was revoked by the administrator.';
    if (normalized.includes('CLOSED')) return 'This PJVault request is closed.';
    if (normalized.includes('USED') || normalized.includes('SUBMITTED')) return 'This PJVault request has already been submitted.';
    return '';
  }

  private newRequirement(documentType: string, description = '', isDefault = false, label = 'Additional document'): RequirementForm {
    return {
      documentType,
      label,
      description,
      required: true,
      allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
      maxFileSizeMb: 10,
      isDefault,
    };
  }

  private initialTheme(): Theme {
    if (!isPlatformBrowser(this.platformId)) return 'dark';
    const saved = localStorage.getItem('pjvault-theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }

  private readBorrowerToken(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    return new URL(window.location.href).searchParams.get('token');
  }

  private removeBorrowerTokenFromAddress(): void {
    const url = new URL(window.location.href);
    url.searchParams.delete('token');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    this.borrowerToken = null;
  }
}
