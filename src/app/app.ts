import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, OnDestroy, PLATFORM_ID, effect, inject, isDevMode, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import {
  AdminDocumentPreviewError,
  BackendService,
  AdminApplication,
  AdminApplicationDocument,
  AdminRequestRecord,
  BorrowerApiError,
  BorrowerLinkExchangeError,
  BorrowerSessionPersistenceError,
  BorrowerRequestStatus,
  BorrowerSession,
  PjVaultRequirement,
  AdminLoanRecord,
} from './backend.service';

type Theme = 'dark' | 'light';
type Screen = 'login' | 'admin' | 'borrower';
type AdminView = 'home' | 'requests' | 'review' | 'loans' | 'create';
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

type DocumentPreviewKind = 'image' | 'pdf' | 'other';
type DocumentPreviewDiagnosticCode =
  | 'VIEW_URL_FAILED'
  | 'DOCUMENT_FETCH_FAILED'
  | 'IMAGE_DECODE_FAILED'
  | 'PDF_PREVIEW_FAILED'
  | 'VIEW_URL_EXPIRED';

interface DocumentPreviewState {
  documentId: string;
  operationId: string;
  url: string;
  safePdfUrl: SafeResourceUrl | null;
  fileName: string;
  mimeType: string;
  kind: DocumentPreviewKind;
  expiresAt: number;
  httpStatus: number | null;
  loading: boolean;
  loaded: boolean;
  zoomed: boolean;
  errorCode: DocumentPreviewDiagnosticCode | null;
  errorMessage: string | null;
}

const FILE_TYPES = [
  { value: 'application/pdf', label: 'PDF' },
  { value: 'image/jpeg', label: 'JPG' },
  { value: 'image/png', label: 'PNG' },
];
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const DOCUMENT_PREVIEW_LOAD_TIMEOUT_MS = 15_000;
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
export class App implements OnDestroy {
  readonly backend = inject(BackendService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly sanitizer = inject(DomSanitizer);
  private previewOperationSequence = 0;
  private activePreviewOperationId: string | null = null;
  private previewExpiryTimer: ReturnType<typeof setTimeout> | null = null;

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
  readonly selectedApplication = signal<AdminApplication | null>(null);
  readonly applicationLoading = signal(false);
  readonly applicationError = signal('');
  readonly documentPreview = signal<DocumentPreviewState | null>(null);
  readonly documentPreviewError = signal('');
  readonly documentBusyId = signal<string | null>(null);
  readonly documentReviewBusyId = signal<string | null>(null);
  readonly documentReviewError = signal('');
  readonly rejectingDocumentId = signal<string | null>(null);
  readonly documentRejectionReason = signal('');
  readonly approvalBusy = signal(false);
  readonly approvalError = signal('');
  readonly approvalSuccess = signal('');
  readonly selectedLoan = signal<AdminLoanRecord | null>(null);
  readonly loanDetailLoading = signal(false);
  readonly loanDetailError = signal('');
  readonly loanFilter = signal<'ALL' | 'APPROVED' | 'DISBURSED'>('ALL');
  readonly loanOffset = signal(0);
  readonly loanDecisionMode = signal<'APPROVE' | 'REJECT'>('APPROVE');
  readonly disbursementBusy = signal(false);
  readonly disbursementError = signal('');
  readonly disbursementSuccess = signal('');
  readonly applicationReturnView = signal<'requests' | 'review' | 'loans'>('review');
  readonly linkTtlPresets = LINK_TTL_PRESETS;
  documentReviewNote = '';
  loanAmount = 0;
  loanDueDate = '';
  loanDecisionNote = '';
  loanRejectionReason = '';
  disbursedAmount = 0;
  disbursedAt = '';
  disbursementPaymentMethod = '';
  disbursementTransactionReference = '';
  disbursementAdminNotes = '';

  ngOnDestroy(): void {
    this.closeDocumentPreview();
  }

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
    this.selectedApplication.set(null);
    this.pageMessage.set('');
    this.mobileNavOpen.set(false);
  }

  openCreateLink(): void {
    this.adminView.set('create');
    this.selectedApplication.set(null);
    this.mobileNavOpen.set(false);
  }

  openRequests(): void {
    this.adminView.set('requests');
    this.selectedApplication.set(null);
    this.mobileNavOpen.set(false);
    void this.backend.loadAdminRequests();
  }

  openReviewQueue(): void {
    this.adminView.set('review');
    this.selectedApplication.set(null);
    this.mobileNavOpen.set(false);
    void this.backend.loadAdminRequests();
  }

  openLoans(): void {
    this.adminView.set('loans');
    this.selectedApplication.set(null);
    this.selectedLoan.set(null);
    this.mobileNavOpen.set(false);
    this.loanOffset.set(0);
    this.loadLoansPage();
  }

  setLoanFilter(filter: 'ALL' | 'APPROVED' | 'DISBURSED'): void {
    this.loanFilter.set(filter);
    this.loanOffset.set(0);
    this.loadLoansPage();
  }

  loadLoansPage(offset = this.loanOffset()): void {
    this.loanOffset.set(offset);
    const filter = this.loanFilter();
    void this.backend.loadAdminLoans(filter === 'ALL' ? null : filter, 50, offset);
  }

  previousLoansPage(): void {
    this.loadLoansPage(Math.max(0, this.loanOffset() - 50));
  }

  async openLoan(loan: AdminLoanRecord): Promise<void> {
    this.loanDetailLoading.set(true);
    this.loanDetailError.set('');
    this.disbursementError.set('');
    this.disbursementSuccess.set('');
    this.selectedLoan.set(loan);
    try {
      this.selectedLoan.set(await this.backend.getAdminLoan(loan.loanId));
    } catch (error) {
      this.loanDetailError.set(error instanceof Error ? error.message : 'The loan details could not be loaded.');
    } finally {
      this.loanDetailLoading.set(false);
    }
  }

  closeLoanDetail(): void {
    this.selectedLoan.set(null);
    this.loanDetailError.set('');
  }

  async openApplication(request: AdminRequestRecord | string): Promise<void> {
    const requestId = typeof request === 'string' ? request : request.requestId;
    const currentView = this.adminView();
    this.applicationReturnView.set(currentView === 'loans' || currentView === 'requests' ? currentView : 'review');
    this.adminView.set('review');
    this.selectedApplication.set(null);
    this.applicationLoading.set(true);
    this.applicationError.set('');
    this.approvalError.set('');
    this.approvalSuccess.set('');
    this.documentReviewNote = '';
    this.loanAmount = 0;
    this.loanDueDate = '';
    this.loanDecisionNote = '';
    this.mobileNavOpen.set(false);
    try {
      this.selectedApplication.set(await this.backend.loadAdminApplication(requestId));
    } catch (error) {
      this.applicationError.set(error instanceof Error ? error.message : 'Application details could not be loaded.');
    } finally {
      this.applicationLoading.set(false);
    }
  }

  closeApplication(): void {
    this.selectedApplication.set(null);
    this.applicationError.set('');
    this.documentReviewError.set('');
    const returnView = this.applicationReturnView();
    this.adminView.set(returnView);
    if (returnView === 'loans') void this.backend.loadAdminLoans();
    else void this.backend.loadAdminRequests();
  }

  canApproveApplication(application: AdminApplication): boolean {
    const requestStatus = (application.requestStatus ?? application.status).toUpperCase();
    const counts = application.documentCounts;
    return requestStatus === 'REVIEWED'
      && !application.lendingDecision
      && application.borrowerDetailsSubmitted
      && (counts ? counts.total > 0 && counts.pendingReview === 0 && counts.rejected === 0
        : application.documents.length > 0
          && application.documents.every((document) => document.reviewStatus.toUpperCase() === 'ACCEPTED'));
  }

  canReviewApplicationDocument(application: AdminApplication, document: AdminApplicationDocument): boolean {
    const requestStatus = (application.requestStatus ?? application.status).toUpperCase();
    return requestStatus !== 'APPROVED'
      && document.reviewStatus.toUpperCase() === 'PENDING_REVIEW';
  }

  async viewApplicationDocument(document: AdminApplicationDocument): Promise<void> {
    this.closeDocumentPreview();
    const operationId = this.nextPreviewOperationId();
    this.activePreviewOperationId = operationId;
    this.documentBusyId.set(document.documentId);
    this.documentPreviewError.set('');
    try {
      const preview = await this.backend.createAdminDocumentPreview(
        document.documentId,
        operationId,
      );
      if (this.activePreviewOperationId !== operationId) return;
      const kind = this.documentPreviewKind(document.mimeType, document.fileName);
      this.documentPreview.set({
        documentId: document.documentId,
        operationId,
        url: preview.url,
        safePdfUrl: kind === 'pdf'
          ? this.sanitizer.bypassSecurityTrustResourceUrl(preview.url)
          : null,
        fileName: document.fileName,
        mimeType: document.mimeType,
        kind,
        expiresAt: preview.expiresAt,
        httpStatus: preview.httpStatus,
        loading: kind !== 'other',
        loaded: kind === 'other',
        zoomed: false,
        errorCode: null,
        errorMessage: null,
      });
      this.logDocumentPreviewDiagnostic('VIEW_URL_RECEIVED', {
        documentId: document.documentId,
        mimeType: document.mimeType,
        operationId,
        urlReceived: true,
        httpStatus: preview.httpStatus,
      });
      this.startPreviewExpiryTimer(operationId, preview.expiresAt);
    } catch (error) {
      const diagnosticCode = error instanceof AdminDocumentPreviewError
        ? error.diagnosticCode
        : 'VIEW_URL_FAILED';
      const httpStatus = error instanceof AdminDocumentPreviewError ? error.httpStatus : null;
      this.logDocumentPreviewDiagnostic(diagnosticCode, {
        documentId: document.documentId,
        mimeType: document.mimeType,
        operationId,
        urlReceived: false,
        httpStatus,
      });
      if (this.activePreviewOperationId !== operationId) return;
      this.documentPreviewError.set(error instanceof Error ? error.message : 'The document preview could not be opened.');
    } finally {
      if (
        this.activePreviewOperationId === operationId &&
        this.documentBusyId() === document.documentId
      ) this.documentBusyId.set(null);
    }
  }

  closeDocumentPreview(): void {
    this.activePreviewOperationId = null;
    this.documentBusyId.set(null);
    this.clearPreviewExpiryTimer();
    this.documentPreview.set(null);
  }

  refreshDocumentPreview(): void {
    const preview = this.documentPreview();
    const document = this.selectedApplication()?.documents.find(
      (item) => item.documentId === preview?.documentId,
    );
    if (document) void this.viewApplicationDocument(document);
  }

  toggleDocumentPreviewZoom(): void {
    this.documentPreview.update((preview) => (
      preview?.kind === 'image' && preview.loaded
        ? { ...preview, zoomed: !preview.zoomed }
        : preview
    ));
  }

  onPreviewImageLoad(event: Event, operationId: string): void {
    const image = event.currentTarget;
    if (!(image instanceof HTMLImageElement) || !this.isCurrentPreview(operationId)) return;
    void Promise.resolve()
      .then(() => image.decode?.())
      .then(() => {
        const preview = this.documentPreview();
        if (!preview || preview.operationId !== operationId) return;
        this.documentPreview.set({ ...preview, loading: false, loaded: true, errorCode: null, errorMessage: null });
        this.clearPreviewExpiryTimer();
        this.logDocumentPreviewDiagnostic('IMAGE_LOAD_SUCCEEDED', {
          documentId: preview.documentId,
          mimeType: preview.mimeType,
          operationId,
          urlReceived: true,
          httpStatus: this.previewResponseStatus(preview.url),
          imageLoad: 'success',
        });
      })
      .catch(() => this.failDocumentPreview(
        operationId,
        'IMAGE_DECODE_FAILED',
        'The file was received, but the browser could not decode it as an image.',
        this.previewResponseStatus(this.documentPreview()?.url),
        'failure',
      ));
  }

  onPreviewImageError(operationId: string): void {
    const preview = this.documentPreview();
    if (!preview || preview.operationId !== operationId) return;
    const expired = Date.now() >= preview.expiresAt;
    this.failDocumentPreview(
      operationId,
      expired ? 'VIEW_URL_EXPIRED' : 'DOCUMENT_FETCH_FAILED',
      expired
        ? 'This temporary preview URL expired. Refresh the preview to get a new secure URL.'
        : 'The private document could not be loaded. Refresh the preview and try again.',
      this.previewResponseStatus(preview.url),
      'failure',
    );
  }

  onPdfPreviewLoad(operationId: string): void {
    const preview = this.documentPreview();
    if (!preview || preview.operationId !== operationId) return;
    if (Date.now() >= preview.expiresAt) {
      this.failDocumentPreview(
        operationId,
        'VIEW_URL_EXPIRED',
        'This temporary preview URL expired. Refresh the preview to get a new secure URL.',
        this.previewResponseStatus(preview.url),
        'failure',
      );
      return;
    }
    const responseStatus = this.previewResponseStatus(preview.url);
    if (responseStatus !== null && responseStatus >= 400) {
      this.failDocumentPreview(
        operationId,
        'PDF_PREVIEW_FAILED',
        'The PDF viewer could not load this document. Refresh the preview and try again.',
        responseStatus,
        undefined,
        'failure',
      );
      return;
    }
    this.documentPreview.set({ ...preview, loading: false, loaded: true, errorCode: null, errorMessage: null });
    this.clearPreviewExpiryTimer();
    this.logDocumentPreviewDiagnostic('PDF_PREVIEW_LOADED', {
      documentId: preview.documentId,
      mimeType: preview.mimeType,
      operationId,
      urlReceived: true,
      httpStatus: responseStatus,
      pdfLoad: 'success',
    });
  }

  onPdfPreviewError(operationId: string): void {
    const preview = this.documentPreview();
    if (!preview || preview.operationId !== operationId) return;
    const expired = Date.now() >= preview.expiresAt;
    this.failDocumentPreview(
      operationId,
      expired ? 'VIEW_URL_EXPIRED' : 'PDF_PREVIEW_FAILED',
      expired
        ? 'This temporary preview URL expired. Refresh the preview to get a new secure URL.'
        : 'The PDF viewer could not load this document. Refresh the preview and try again.',
      this.previewResponseStatus(preview.url),
      'failure',
    );
  }

  private documentPreviewKind(mimeType: string, fileName: string): DocumentPreviewKind {
    const mime = mimeType.toLowerCase().split(';', 1)[0].trim();
    const extension = fileName.toLowerCase().split('.').pop() ?? '';
    if (mime === 'application/pdf' || extension === 'pdf') return 'pdf';
    if (
      ['image/png', 'image/jpeg', 'image/webp'].includes(mime) ||
      ['png', 'jpg', 'jpeg', 'webp'].includes(extension)
    ) return 'image';
    return 'other';
  }

  private nextPreviewOperationId(): string {
    this.previewOperationSequence += 1;
    return globalThis.crypto?.randomUUID?.()
      ?? `preview-${Date.now()}-${this.previewOperationSequence}`;
  }

  private isCurrentPreview(operationId: string): boolean {
    return this.documentPreview()?.operationId === operationId;
  }

  private startPreviewExpiryTimer(operationId: string, expiresAt: number): void {
    this.clearPreviewExpiryTimer();
    const delay = Math.min(
      Math.max(0, expiresAt - Date.now()),
      DOCUMENT_PREVIEW_LOAD_TIMEOUT_MS,
    );
    this.previewExpiryTimer = setTimeout(() => {
      const preview = this.documentPreview();
      if (!preview || preview.operationId !== operationId || !preview.loading) return;
      const expired = Date.now() >= expiresAt;
      const errorCode: DocumentPreviewDiagnosticCode = expired
        ? 'VIEW_URL_EXPIRED'
        : preview.kind === 'pdf' ? 'PDF_PREVIEW_FAILED' : 'DOCUMENT_FETCH_FAILED';
      this.failDocumentPreview(
        operationId,
        errorCode,
        expired
          ? 'This temporary preview URL expired. Refresh the preview to get a new secure URL.'
          : 'The document preview did not finish loading. Refresh the preview and try again.',
        this.previewResponseStatus(preview.url),
        preview.kind === 'image' ? 'failure' : undefined,
        preview.kind === 'pdf' ? 'failure' : undefined,
      );
    }, delay);
  }

  private clearPreviewExpiryTimer(): void {
    if (this.previewExpiryTimer !== null) clearTimeout(this.previewExpiryTimer);
    this.previewExpiryTimer = null;
  }

  private failDocumentPreview(
    operationId: string,
    errorCode: DocumentPreviewDiagnosticCode,
    errorMessage: string,
    httpStatus: number | null,
    imageLoad?: 'failure',
    pdfLoad?: 'failure',
  ): void {
    const preview = this.documentPreview();
    if (!preview || preview.operationId !== operationId) return;
    this.clearPreviewExpiryTimer();
    this.documentPreview.set({
      ...preview,
      loading: false,
      loaded: false,
      errorCode,
      errorMessage,
    });
    this.logDocumentPreviewDiagnostic(errorCode, {
      documentId: preview.documentId,
      mimeType: preview.mimeType,
      operationId,
      urlReceived: true,
      httpStatus,
      imageLoad,
      pdfLoad,
    });
  }

  private previewResponseStatus(url: string | undefined): number | null {
    if (!url || typeof performance === 'undefined') return null;
    const entry = performance.getEntriesByName(url)
      .find((item) => item.entryType === 'resource') as (PerformanceResourceTiming & { responseStatus?: number }) | undefined;
    return typeof entry?.responseStatus === 'number' && entry.responseStatus > 0
      ? entry.responseStatus
      : null;
  }

  private logDocumentPreviewDiagnostic(
    category: string,
    details: {
      documentId: string;
      mimeType: string;
      operationId: string;
      urlReceived: boolean;
      httpStatus: number | null;
      imageLoad?: 'success' | 'failure';
      pdfLoad?: 'success' | 'failure';
    },
  ): void {
    if (!isDevMode()) return;
    const log = category.endsWith('_FAILED') || category === 'VIEW_URL_EXPIRED' ? console.warn : console.info;
    log('PJVault document preview diagnostic', { category, ...details });
  }

  openDocumentRejection(document: AdminApplicationDocument): void {
    this.rejectingDocumentId.set(document.documentId);
    this.documentRejectionReason.set('');
    this.documentReviewError.set('');
  }

  cancelDocumentRejection(): void {
    this.rejectingDocumentId.set(null);
    this.documentRejectionReason.set('');
  }

  async reviewApplicationDocument(
    document: AdminApplicationDocument,
    decision: 'ACCEPTED' | 'REJECTED',
  ): Promise<void> {
    const application = this.selectedApplication();
    if (!application) return;
    if (decision === 'REJECTED') {
      const reason = this.documentRejectionReason().trim();
      if (!reason) {
        this.documentReviewError.set('A rejection reason is required before the borrower can re-upload.');
        return;
      }
      if (reason.length > 2000) {
        this.documentReviewError.set('The rejection reason cannot exceed 2,000 characters.');
        return;
      }
    }
    this.documentReviewBusyId.set(document.documentId);
    this.documentReviewError.set('');
    try {
      const note = decision === 'REJECTED'
        ? this.documentRejectionReason().trim()
        : this.documentReviewNote.trim();
      await this.backend.reviewAdminDocument(document.documentId, decision, note);
      this.documentReviewNote = '';
      this.documentRejectionReason.set('');
      this.rejectingDocumentId.set(null);
      this.selectedApplication.set(await this.backend.loadAdminApplication(application.requestId));
      await this.backend.loadAdminRequests();
    } catch (error) {
      this.documentReviewError.set(error instanceof Error ? error.message : 'The document review could not be saved.');
    } finally {
      this.documentReviewBusyId.set(null);
    }
  }

  async approveApplication(): Promise<void> {
    const application = this.selectedApplication();
    if (!application || !this.canApproveApplication(application)) return;
    if (!window.confirm('Approve this application and create the BWP loan?')) return;
    this.approvalBusy.set(true);
    this.approvalError.set('');
    this.approvalSuccess.set('');
    try {
      await this.backend.decideAdminApplication(
        application.requestId,
        'APPROVED',
        this.loanAmount,
        this.loanDueDate,
        this.loanDecisionNote,
      );
      await this.backend.loadAdminRequests();
      await this.backend.loadAdminLoans();
      this.selectedApplication.set(await this.backend.loadAdminApplication(application.requestId));
      this.approvalSuccess.set(`Lending decision approved. Request ${application.requestCode} now has a loan.`);
    } catch (error) {
      this.approvalError.set(error instanceof Error ? error.message : 'The application could not be approved.');
    } finally {
      this.approvalBusy.set(false);
    }
  }

  async rejectApplication(): Promise<void> {
    const application = this.selectedApplication();
    if (!application || !this.canApproveApplication(application)) return;
    const reason = this.loanRejectionReason.trim();
    if (!reason) {
      this.approvalError.set('A rejection reason is required.');
      return;
    }
    if (reason.length > 2000) {
      this.approvalError.set('The rejection reason cannot exceed 2,000 characters.');
      return;
    }
    if (!window.confirm('Reject this lending application? No loan will be created.')) return;
    this.approvalBusy.set(true);
    this.approvalError.set('');
    this.approvalSuccess.set('');
    try {
      await this.backend.decideAdminApplication(
        application.requestId,
        'REJECTED',
        null,
        null,
        reason,
      );
      await this.backend.loadAdminRequests();
      await this.backend.loadAdminLoans();
      this.selectedApplication.set(await this.backend.loadAdminApplication(application.requestId));
      this.approvalSuccess.set(`Lending decision rejected for request ${application.requestCode}. No loan was created.`);
    } catch (error) {
      this.approvalError.set(error instanceof Error ? error.message : 'The application could not be rejected.');
    } finally {
      this.approvalBusy.set(false);
    }
  }

  async recordExternalDisbursement(): Promise<void> {
    const loan = this.selectedLoan();
    if (!loan || loan.loanStatus !== 'APPROVED') return;
    if (!this.disbursedAmount || this.disbursedAmount <= 0) {
      this.disbursementError.set('Enter a positive actual disbursed amount.');
      return;
    }
    if (!this.disbursedAt) {
      this.disbursementError.set('Enter the actual transaction date and time.');
      return;
    }
    if (!this.disbursementPaymentMethod.trim()) {
      this.disbursementError.set('Enter the payment method.');
      return;
    }
    if (!window.confirm('Confirm that the transfer was completed externally, then record it in PJVault?')) return;
    this.disbursementBusy.set(true);
    this.disbursementError.set('');
    this.disbursementSuccess.set('');
    try {
      await this.backend.recordAdminDisbursement(
        loan.loanId,
        this.disbursedAmount,
        new Date(this.disbursedAt).toISOString(),
        this.disbursementPaymentMethod,
        this.disbursementTransactionReference,
        this.disbursementAdminNotes,
      );
      this.selectedLoan.set(await this.backend.getAdminLoan(loan.loanId));
      const filter = this.loanFilter();
      await this.backend.loadAdminLoans(filter === 'ALL' ? null : filter === 'APPROVED' ? 'APPROVED' : 'DISBURSED', 50, this.loanOffset());
      this.disbursementSuccess.set('External disbursement recorded successfully.');
    } catch (error) {
      this.disbursementError.set(error instanceof Error ? error.message : 'The disbursement could not be recorded.');
    } finally {
      this.disbursementBusy.set(false);
    }
  }

  formatLoanAmount(amount: number | null): string {
    if (amount === null) return '—';
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'BWP',
      maximumFractionDigits: 2,
    }).format(amount);
  }

  goHome(event: MouseEvent): void {
    if (this.screen() !== 'admin') return;
    event.preventDefault();
    this.openHome();
  }

  requestCount(status?: string): number {
    const requests = this.backend.requests();
    return status ? requests.filter((request) => request.status.toUpperCase() === status.toUpperCase()).length : requests.length;
  }

  reviewQueueRequests(): AdminRequestRecord[] {
    return this.backend.requests().filter((request) => {
      const status = request.status.toUpperCase();
      if (['APPROVED', 'REJECTED', 'DISBURSED', 'CLOSED', 'REVOKED'].includes(status)) return false;
      return request.borrowerDetailsSubmitted || request.submissionComplete
        || ['SUBMITTED', 'PENDING_REVIEW', 'UNDER_REVIEW', 'REVIEWED', 'NEEDS_REUPLOAD'].includes(status);
    });
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
