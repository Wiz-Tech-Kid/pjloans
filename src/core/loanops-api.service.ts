import { Injectable, effect, inject, signal } from '@angular/core';
import { Observable, catchError, concatMap, defer, filter, finalize, forkJoin, from, map, of, switchMap, tap, throwError, toArray } from 'rxjs';
import { AuthService } from './auth.service';
import { DocumentStorageService } from './document-storage.service';
import { compareDecimalValues } from './money';
import { PUBLIC_RUNTIME_CONFIG } from './public-config';
import {
  Application,
  ApplicationDraft,
  BORROWER_DOCUMENT_REQUIREMENTS,
  BorrowerRequirements,
  BorrowerType,
  DecimalValue,
  DisbursementResult,
  ApplicationCancellation,
  ApplicationDocumentEvidence,
  ApplicationRequirement,
  AdminCustomer,
  AdminDashboardSummary,
  AdminLoan,
  DocumentRecord,
  DocumentReviewStatus,
  FeatureAvailability,
  FeatureId,
  FeatureState,
  Loan,
  LoanOpsData,
  Payment,
  PaymentVerificationResult,
  ReceivingMethod,
  StartApplicationResult,
  SubmissionReadiness,
  KycDocument,
} from './models';

const demoData: LoanOpsData = {
  customers: [
    { id: 'DEMO-CUSTOMER-001', phone: '+26771000001', fullName: 'Naledi Demo', nationalId: '•••••••482', borrowerType: 'STUDENT' },
    { id: 'DEMO-CUSTOMER-002', phone: '+26771000002', fullName: 'Kabelo Demo', nationalId: '•••••••193', borrowerType: 'EMPLOYED' },
  ],
  applications: [
    {
      id: 1,
      applicationNumber: 'APP-000021',
      customerId: 'DEMO-CUSTOMER-001',
      borrowerType: 'STUDENT',
      requestedAmount: 1500,
      currentStep: 'ADMISSION_LETTER',
      status: 'IN_PROGRESS',
      createdAt: '2026-10-18T08:00:00.000Z',
      receivingMethod: 'FNB_PAY_TO_CELL',
      recipientName: 'Naledi Demo',
      recipientIdentifier: '+26771000001',
      institution: 'Demo University',
      studentId: 'DEMO-STU-021',
    },
    {
      id: 2,
      applicationNumber: 'APP-000020',
      customerId: 'DEMO-CUSTOMER-002',
      borrowerType: 'EMPLOYED',
      requestedAmount: 2400,
      approvedAmount: 2000,
      currentStep: 'APPROVED',
      status: 'APPROVED',
      createdAt: '2026-10-16T09:00:00.000Z',
      submittedAt: '2026-10-17T10:00:00.000Z',
      receivingMethod: 'EFT',
      recipientName: 'Kabelo Demo',
      recipientIdentifier: 'DEMO-ACCOUNT-002',
      employer: 'Demo Services',
      employmentStatus: 'FULL_TIME',
    },
    {
      id: 3,
      applicationNumber: 'APP-000019',
      customerId: 'DEMO-CUSTOMER-001',
      borrowerType: 'STUDENT',
      requestedAmount: 1200,
      approvedAmount: 1200,
      currentStep: 'DISBURSED',
      status: 'DISBURSED',
      createdAt: '2026-10-01T08:00:00.000Z',
      submittedAt: '2026-10-02T08:00:00.000Z',
      receivingMethod: 'CASH',
      recipientName: 'Naledi Demo',
      institution: 'Demo University',
      studentId: 'DEMO-STU-019',
    },
    {
      id: 4,
      applicationNumber: 'APP-000018',
      customerId: 'DEMO-CUSTOMER-002',
      borrowerType: 'EMPLOYED',
      requestedAmount: 1800,
      currentStep: 'SUBMITTED',
      status: 'SUBMITTED',
      createdAt: '2026-10-15T08:00:00.000Z',
      submittedAt: '2026-10-16T09:30:00.000Z',
      receivingMethod: 'ORANGE_MONEY',
      recipientName: 'Kabelo Demo',
      recipientIdentifier: '+26771000002',
      employer: 'Demo Services',
      employmentStatus: 'CONTRACT',
    },
  ],
  documents: [
    { id: 1, applicationId: 1, documentType: 'STUDENT_ID', fileName: 'demo-student-id.jpg', status: 'VERIFIED', createdAt: '2026-10-18T08:10:00.000Z' },
    { id: 2, applicationId: 1, documentType: 'ADMISSION_LETTER', fileName: 'demo-admission.pdf', status: 'PENDING', createdAt: '2026-10-18T08:12:00.000Z' },
    { id: 3, applicationId: 1, documentType: 'IDENTITY_DOCUMENT', fileName: 'demo-identity.jpg', status: 'REJECTED', reviewNote: 'Image not readable. Please provide a clearer copy.', createdAt: '2026-10-18T08:15:00.000Z' },
    { id: 4, applicationId: 2, documentType: 'EMPLOYMENT_LETTER', fileName: 'demo-employment.pdf', status: 'VERIFIED', createdAt: '2026-10-17T09:00:00.000Z' },
    { id: 5, applicationId: 2, documentType: 'IDENTITY_DOCUMENT', fileName: 'demo-identity-2.jpg', status: 'VERIFIED', createdAt: '2026-10-17T09:05:00.000Z' },
  ],
  loans: [
    {
      id: 1,
      applicationId: 3,
      principal: 1200,
      interestRate: 30,
      interestAmount: 360,
      totalDue: 1560,
      amountPaid: 0,
      outstandingAmount: 1560,
      dueDate: '2026-11-27',
      status: 'ACTIVE',
      disbursementReference: 'DEMO-TRANSFER-001',
      disbursedAt: '2026-10-03T12:00:00.000Z',
    },
  ],
  payments: [],
};

function emptyData(): LoanOpsData {
  return { customers: [], applications: [], documents: [], loans: [], payments: [] };
}

const featureAvailability: Record<FeatureId, FeatureAvailability> = {
  borrower_profile_initialize: 'available',
  borrower_profile_read: 'available',
  borrower_applications: 'available',
  application_create: 'available',
  application_update: 'available',
  application_submission: 'available',
  borrower_requirements: 'available',
  application_readiness: 'available',
  borrower_loans: 'available',
  admin_loan_list: 'pending_backend',
  payment_submission: 'available',
  borrower_payment_history: 'pending_backend',
  admin_in_progress_queue: 'available',
  admin_submitted_queue: 'available',
  admin_correction_queue: 'available',
  admin_approved_queue: 'available',
  admin_approval: 'available',
  admin_disbursement: 'available',
  document_listing: 'available',
  document_viewing: 'available',
  document_review: 'available',
  document_upload: 'available',
  admin_payment_queue: 'pending_backend',
  payment_verification: 'available',
  customer_management: 'pending_backend',
};

function initialFeatureStates(mode: 'demo' | 'api', configured: boolean): Record<FeatureId, FeatureState> {
  return Object.fromEntries(
    Object.entries(featureAvailability).map(([feature, availability]) => [
      feature,
      {
        availability: mode === 'api' && !configured && availability === 'available'
          ? 'configuration_required'
          : availability,
        request: 'idle',
        error: null,
        errorCode: null,
      },
    ]),
  ) as Record<FeatureId, FeatureState>;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`The ${label} response has an invalid format.`);
  }
  return value as Record<string, unknown>;
}

function rows(value: unknown, label: string): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map((row) => record(row, label));
  if (typeof value === 'object' && value !== null) {
    const candidate = value as Record<string, unknown>;
    for (const key of ['data', 'rows', 'applications', 'result', 'records', 'items', 'row']) {
      if (key in candidate && candidate[key] !== undefined && candidate[key] !== null) {
        const nested = candidate[key];
        if (Array.isArray(nested)) return rows(nested, label);
        if (typeof nested === 'object') return rows(nested, label);
      }
    }
    return [record(candidate, label)];
  }
  throw new Error(`The ${label} response was not a row collection.`);
}

function rowSummary(value: unknown, label: string): { rowCount: number; fieldNames: string[] } {
  try {
    const rowsValue = rows(value, label);
    return {
      rowCount: rowsValue.length,
      fieldNames: [...new Set(rowsValue.flatMap((row) => Object.keys(row)))].sort(),
    };
  } catch {
    return { rowCount: 0, fieldNames: [] };
  }
}

function requiredString(row: Record<string, unknown>, key: string, label: string): string {
  const value = row[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`The ${label} response is missing ${key}.`);
  }
  return value;
}

function optionalString(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  return typeof value === 'string' ? value : undefined;
}

function safeBigint(value: unknown, label: string): number {
  let parsed: bigint;
  try {
    if (typeof value === 'number' && Number.isSafeInteger(value)) parsed = BigInt(value);
    else if (typeof value === 'string' && /^\d+$/.test(value)) parsed = BigInt(value);
    else throw new Error();
  } catch {
    throw new Error(`The ${label} identifier is invalid.`);
  }
  if (parsed <= 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`The ${label} identifier cannot be represented safely in this browser.`);
  }
  return Number(parsed);
}

function decimal(value: unknown, label: string): DecimalValue {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`The ${label} value is invalid.`);
  }
  const normalized = String(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized) || !Number.isFinite(Number(normalized))) {
    throw new Error(`The ${label} value is invalid.`);
  }
  return normalized;
}

function normalizeEnumValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim().toUpperCase();
}

function applicationStatus(value: unknown): Application['status'] {
  const normalized = normalizeEnumValue(value);
  if (normalized === 'IN_PROGRESS' || normalized === 'SUBMITTED' || normalized === 'NEEDS_CORRECTION' || normalized === 'APPROVED'
    || normalized === 'DISBURSED' || normalized === 'REJECTED' || normalized === 'CANCELLED') {
    return normalized as Application['status'];
  }
  throw new Error('The application response contains an unsupported status.');
}

function borrowerType(value: unknown): BorrowerType {
  const normalized = normalizeEnumValue(value);
  if (normalized === 'STUDENT' || normalized === 'EMPLOYED' || normalized === 'UNEMPLOYED') return normalized as BorrowerType;
  throw new Error('The application response contains an unsupported borrower category.');
}

function receivingMethod(value: unknown): ReceivingMethod | undefined {
  const normalized = normalizeEnumValue(value);
  return normalized === 'CASH' || normalized === 'FNB_PAY_TO_CELL' || normalized === 'EFT'
    || normalized === 'ORANGE_MONEY' || normalized === 'MYZAKA' || normalized === 'SMEGA'
    ? normalized as ReceivingMethod
    : undefined;
}

function mapApplication(row: Record<string, unknown>, customerId?: string, statusOverride?: Application['status']): Application {
  const mappedCustomerId = optionalString(row, 'customer_id')
    ?? optionalString(row, 'borrower_id')
    ?? customerId
    ?? `admin-queue-${safeBigint(row['application_id'] ?? row['id'] ?? 0, 'application')}`;

  const status = statusOverride ?? applicationStatus(row['status']);
  const requestedAmount = decimal(row['requested_amount'], 'requested amount');
  const approvedAmount = row['approved_amount'] === null || row['approved_amount'] === undefined
    ? null
    : decimal(row['approved_amount'], 'approved amount');
  const method = receivingMethod(row['receiving_method'] ?? row['reception_method']);
  return {
    id: safeBigint(row['application_id'] ?? row['id'], 'application'),
    applicationNumber: requiredString(row, 'application_number', 'application'),
    customerId: mappedCustomerId,
    borrowerType: borrowerType(row['borrower_type']),
    requestedAmount,
    approvedAmount,
    currentStep: optionalString(row, 'current_step') ?? status,
    status,
    createdAt: optionalString(row, 'created_at') ?? '',
    updatedAt: optionalString(row, 'updated_at'),
    submittedAt: optionalString(row, 'submitted_at'),
    reviewedAt: optionalString(row, 'reviewed_at'),
    fullName: optionalString(row, 'full_name') ?? optionalString(row, 'customer_full_name') ?? optionalString(row, 'borrower_name'),
    phone: optionalString(row, 'phone') ?? optionalString(row, 'customer_phone') ?? optionalString(row, 'borrower_phone'),
    nationalId: optionalString(row, 'national_id') ?? optionalString(row, 'customer_national_id') ?? null,
    receivingMethod: method,
    recipientName: optionalString(row, 'receiving_name') ?? optionalString(row, 'reception_name'),
    recipientNameSameAsId: typeof row['receiving_name_same_as_id'] === 'boolean'
      ? row['receiving_name_same_as_id']
      : typeof row['reception_name_same_as_id'] === 'boolean'
        ? row['reception_name_same_as_id']
        : undefined,
    recipientIdentifier: optionalString(row, 'receiving_identifier') ?? optionalString(row, 'reception_identifier'),
    institution: optionalString(row, 'institution'),
    studentId: optionalString(row, 'student_id'),
    employer: optionalString(row, 'employer'),
    employmentStatus: optionalString(row, 'employment_status'),
  };
}

function mapLoan(row: Record<string, unknown>): Loan {
  return {
    id: safeBigint(row['loan_id'], 'loan'),
    applicationId: safeBigint(row['application_id'], 'application'),
    principal: decimal(row['principal'], 'principal'),
    interestRate: decimal(row['interest_rate'], 'interest rate'),
    interestAmount: decimal(row['interest_amount'], 'interest amount'),
    totalDue: decimal(row['total_due'], 'total due'),
    amountPaid: decimal(row['amount_paid'], 'amount paid'),
    outstandingAmount: decimal(row['outstanding_amount'], 'outstanding amount'),
    dueDate: requiredString(row, 'due_date', 'loan'),
    status: requiredString(row, 'status', 'loan'),
    disbursementMethod: optionalString(row, 'disbursement_method'),
    disbursementReference: optionalString(row, 'disbursement_reference'),
    disbursedAt: optionalString(row, 'disbursed_at'),
    closedAt: optionalString(row, 'closed_at'),
  };
}

function mapPayment(row: Record<string, unknown>): Payment {
  return {
    id: safeBigint(row['payment_id'], 'payment'),
    loanId: safeBigint(row['loan_id'], 'loan'),
    amount: decimal(row['amount'], 'payment amount'),
    status: requiredString(row, 'status', 'payment'),
    paymentMethod: optionalString(row, 'payment_method'),
    paymentReference: optionalString(row, 'payment_reference'),
    submittedAt: requiredString(row, 'submitted_at', 'payment'),
  };
}

function mapDocument(row: Record<string, unknown>, applicationId: number): DocumentRecord {
  const status = requiredString(row, 'verification_status', 'document');
  if (status !== 'PENDING' && status !== 'VERIFIED' && status !== 'REJECTED') {
    throw new Error('The document response contains an unsupported verification status.');
  }
  return {
    id: safeBigint(row['document_id'], 'document'),
    applicationId: safeBigint(row['application_id'] ?? applicationId, 'application'),
    documentType: requiredString(row, 'document_type', 'document'),
    fileName: optionalString(row, 'original_filename'),
    status,
    reviewNote: optionalString(row, 'review_note'),
    createdAt: requiredString(row, 'uploaded_at', 'document'),
  };
}

@Injectable({ providedIn: 'root' })
export class LoanOpsApiService {
  private readonly auth = inject(AuthService);
  private readonly documentStorage = inject(DocumentStorageService);
  readonly mode = inject(PUBLIC_RUNTIME_CONFIG).dataMode;
  readonly data = signal<LoanOpsData>(this.mode === 'demo' ? structuredClone(demoData) : emptyData());
  readonly featureStates = signal(initialFeatureStates(this.mode, this.auth.configured));

  private lastUserId: string | null | undefined;

  constructor() {
    effect(() => {
      const userId = this.auth.user()?.id ?? null;
      if (this.lastUserId !== undefined && userId !== this.lastUserId && this.mode !== 'demo') {
        this.data.set(emptyData());
        this.resetRequestStates();
      }
      this.lastUserId = userId;
    });
  }

  featureState(feature: FeatureId): FeatureState {
    if (feature === 'borrower_profile_initialize') return this.auth.profileInitializationState();
    if (feature === 'borrower_profile_read') return this.auth.profileRetrievalState();
    return this.featureStates()[feature];
  }

  isLoading(feature: FeatureId): boolean {
    return this.featureState(feature).request === 'loading';
  }

  setFeatureAvailability(feature: FeatureId, availability: FeatureAvailability): void {
    this.updateFeature(feature, { availability });
  }

  loadApplications(portal: 'borrower' | 'admin' = 'borrower'): Observable<LoanOpsData> {
    if (this.mode === 'demo') return of(this.data());
    if (portal === 'borrower') {
      return this.loadMyApplications().pipe(map(() => this.data()));
    }
    return forkJoin({
      submitted: this.loadAdminApplications('SUBMITTED').pipe(catchError(() => of([]))),
      approved: this.loadAdminApplications('APPROVED').pipe(catchError(() => of([]))),
      inProgress: this.loadAdminApplications('IN_PROGRESS').pipe(catchError(() => of([]))),
    }).pipe(map(() => this.data()));
  }

  cancelApplication(applicationId: number): Observable<ApplicationCancellation> {
    if (this.mode === 'demo') {
      return this.updateDemoApplication(applicationId, { status: 'CANCELLED', currentStep: 'CANCELLED' }).pipe(
        map((application) => ({
          applicationId: application.id,
          status: 'CANCELLED',
          cancelledAt: new Date().toISOString(),
          alreadyCancelled: false,
        })),
      );
    }
    return this.requestSingle('borrower_applications', 'cancel_my_application', { p_application_id: applicationId }, (row): ApplicationCancellation => ({
      applicationId: safeBigint(row['application_id'], 'application cancellation'),
      status: 'CANCELLED',
      cancelledAt: requiredString(row, 'cancelled_at', 'application cancellation'),
      alreadyCancelled: row['already_cancelled'] === true,
    })).pipe(tap(() => this.loadMyApplications().subscribe()));
  }

  loadMyKycDocuments(): Observable<KycDocument[]> {
    return this.requestRows('document_listing', 'get_my_kyc_documents', {}, (row) => ({
      documentId: safeBigint(row['document_id'], 'KYC document'),
      documentType: requiredString(row, 'document_type', 'KYC document'),
      originalFilename: requiredString(row, 'original_filename', 'KYC document'),
      mimeType: requiredString(row, 'mime_type', 'KYC document'),
      verificationStatus: this.documentReviewStatus(row['verification_status']),
      uploadedAt: requiredString(row, 'uploaded_at', 'KYC document'),
      verifiedAt: optionalString(row, 'verified_at') ?? null,
      reviewedAt: optionalString(row, 'reviewed_at') ?? null,
      reviewNote: optionalString(row, 'review_note') ?? null,
      originalApplicationId: row['original_application_id'] == null ? null : safeBigint(row['original_application_id'], 'application'),
    }));
  }

  loadMyApplicationEvidence(applicationId: number): Observable<ApplicationDocumentEvidence[]> {
    return this.requestRows(
      'document_listing',
      'get_my_application_document_evidence',
      { p_application_id: applicationId },
      (row) => ({
        applicationId: safeBigint(row['application_id'], 'application evidence'),
        documentId: safeBigint(row['document_id'], 'application evidence'),
        requirementType: requiredString(row, 'requirement_type', 'application evidence'),
        documentType: requiredString(row, 'document_type', 'application evidence'),
        originalFilename: requiredString(row, 'original_filename', 'application evidence'),
        mimeType: requiredString(row, 'mime_type', 'application evidence'),
        verificationStatus: this.documentReviewStatus(row['verification_status']),
        isReused: row['is_reused'] === true,
        sourceApplicationId: row['source_application_id'] == null ? null : safeBigint(row['source_application_id'], 'application evidence'),
        uploadedAt: requiredString(row, 'uploaded_at', 'application evidence'),
        reviewNote: optionalString(row, 'review_note') ?? null,
      }),
    );
  }

  loadMyApplicationRequirements(applicationId: number): Observable<ApplicationRequirement[]> {
    return this.requestRows(
      'borrower_requirements',
      'get_my_application_requirements',
      { p_application_id: applicationId },
      (row) => ({
        applicationId: safeBigint(row['application_id'], 'application requirements'),
        borrowerType: requiredString(row, 'borrower_type', 'application requirements') as BorrowerType,
        requirementType: requiredString(row, 'requirement_type', 'application requirements'),
        policyConfirmed: row['policy_confirmed'] === true,
        satisfied: row['satisfied'] === true,
        documentId: row['document_id'] == null ? null : safeBigint(row['document_id'], 'application requirements'),
        documentStatus: row['document_status'] == null ? null : this.documentReviewStatus(row['document_status']),
        isReused: row['is_reused'] === true,
        uploadRequired: row['upload_required'] === true,
      }),
    );
  }

  updateMyBorrowerType(borrowerType: BorrowerType): Observable<{ customerId: string; borrowerType: BorrowerType; changed: boolean }> {
    return this.requestSingle('borrower_profile_read', 'update_my_borrower_type', { p_borrower_type: borrowerType }, (row) => ({
      customerId: requiredString(row, 'customer_id', 'borrower category'),
      borrowerType: requiredString(row, 'borrower_type', 'borrower category') as BorrowerType,
      changed: row['changed'] === true,
    }));
  }

  loadAdminCustomers(search = ''): Observable<AdminCustomer[]> {
    return this.requestRows('customer_management', 'list_customers_for_admin', { p_search: search || null }, (row) => ({
      customerId: requiredString(row, 'customer_id', 'customer directory'),
      phone: requiredString(row, 'phone', 'customer directory'),
      fullName: optionalString(row, 'full_name') ?? null,
      nationalId: null,
      borrowerType: requiredString(row, 'borrower_type', 'customer directory') as BorrowerType,
      createdAt: requiredString(row, 'created_at', 'customer directory'),
      updatedAt: requiredString(row, 'updated_at', 'customer directory'),
      applicationCount: typeof row['application_count'] === 'number' ? row['application_count'] : 0,
      loanCount: typeof row['loan_count'] === 'number' ? row['loan_count'] : 0,
    }));
  }

  loadAdminCustomerDetail(customerId: string): Observable<AdminCustomer> {
    return this.requestSingle('customer_management', 'get_customer_detail_for_admin', { p_customer_id: customerId }, (row) => ({
      customerId: requiredString(row, 'customer_id', 'customer detail'),
      phone: requiredString(row, 'phone', 'customer detail'),
      fullName: optionalString(row, 'full_name') ?? null,
      nationalId: optionalString(row, 'national_id') ?? null,
      borrowerType: requiredString(row, 'borrower_type', 'customer detail') as BorrowerType,
      createdAt: requiredString(row, 'created_at', 'customer detail'),
      updatedAt: requiredString(row, 'updated_at', 'customer detail'),
    }));
  }

  loadAdminLoans(status: string | null = null, search = ''): Observable<AdminLoan[]> {
    return this.requestRows('admin_loan_list', 'list_loans_for_admin', {
      p_status: status,
      p_search: search || null,
    }, (row) => ({
      loanId: safeBigint(row['loan_id'], 'loan'),
      applicationId: safeBigint(row['application_id'], 'loan'),
      applicationReference: requiredString(row, 'application_reference', 'loan'),
      customerId: requiredString(row, 'customer_id', 'loan'),
      borrowerName: requiredString(row, 'borrower_name', 'loan'),
      approvedPrincipal: decimal(row['approved_principal'], 'approved principal'),
      interestRate: decimal(row['interest_rate'], 'interest rate'),
      interestAmount: decimal(row['interest_amount'], 'interest amount'),
      totalRepayable: decimal(row['total_repayable'], 'total repayable'),
      amountPaid: decimal(row['amount_paid'], 'amount paid'),
      outstandingBalance: decimal(row['outstanding_balance'], 'outstanding balance'),
      dueDate: requiredString(row, 'due_date', 'loan'),
      loanStatus: requiredString(row, 'loan_status', 'loan'),
      disbursementReference: typeof row['disbursement_reference'] === 'string' ? row['disbursement_reference'] : '',
      disbursedAt: typeof row['disbursed_at'] === 'string' ? row['disbursed_at'] : '',
    }));
  }

  loadAdminDashboardSummary(): Observable<AdminDashboardSummary> {
    return this.requestSingle('admin_in_progress_queue', 'get_admin_dashboard_summary', {}, (row) => ({
      applicationsInProgress: Number(row['applications_in_progress'] ?? 0),
      applicationsAwaitingReview: Number(row['applications_awaiting_review'] ?? 0),
      approvedAwaitingDisbursement: Number(row['approved_awaiting_disbursement'] ?? 0),
      activeLoans: Number(row['active_loans'] ?? 0),
      documentsPendingReview: Number(row['documents_pending_review'] ?? 0),
      totalOutstandingBalance: decimal(row['total_outstanding_balance'] ?? 0, 'outstanding balance'),
    }));
  }

  private documentReviewStatus(value: unknown): DocumentReviewStatus {
    if (value !== 'PENDING' && value !== 'VERIFIED' && value !== 'REJECTED') {
      throw new Error('The document verification status returned by the backend is invalid.');
    }
    return value;
  }

  loadMyApplications(): Observable<Application[]> {
    if (this.mode === 'demo') return of(this.data().applications);
    const customerId = this.auth.customerProfile()?.customerId;
    return this.requestRows('borrower_applications', 'get_my_applications', {}, (row) =>
      mapApplication(row, customerId),
    ).pipe(tap((applications) => this.data.update((current) => ({ ...current, applications }))));
  }

  loadMyLoans(): Observable<Loan[]> {
    if (this.mode === 'demo') return of(this.data().loans);
    return this.requestRows('borrower_loans', 'get_my_loans', {}, mapLoan)
      .pipe(tap((loans) => this.data.update((current) => ({ ...current, loans }))));
  }

  loadMyApplicationDocuments(applicationId: number): Observable<DocumentRecord[]> {
    if (this.mode === 'demo') {
      return of(this.data().documents.filter((document) => document.applicationId === applicationId));
    }
    return this.requestRows(
      'document_listing',
      'get_my_application_documents',
      { p_application_id: applicationId },
      (row) => mapDocument(row, applicationId),
    ).pipe(tap((documents) => this.replaceApplicationDocuments(applicationId, documents)));
  }

  loadAdminApplicationDocuments(applicationId: number): Observable<DocumentRecord[]> {
    if (this.mode === 'demo') {
      return of(this.data().documents.filter((document) => document.applicationId === applicationId));
    }
    return this.requestRows(
      'document_listing',
      'list_documents_for_admin',
      { p_application_id: applicationId },
      (row) => mapDocument(row, applicationId),
    ).pipe(tap((documents) => this.replaceApplicationDocuments(applicationId, documents)));
  }

  loadAdminDocuments(): Observable<DocumentRecord[]> {
    const applicationIds = [...new Set(this.data().applications
      .map((application) => application.id))];
    if (applicationIds.length === 0) {
      this.updateFeature('document_listing', { request: 'empty', error: null, errorCode: null });
      return of([]);
    }
    return from(applicationIds).pipe(
      concatMap((applicationId) => this.loadAdminApplicationDocuments(applicationId)),
      toArray(),
      map((groups) => groups.flat()),
    );
  }

  loadAdminApplications(status: 'IN_PROGRESS' | 'SUBMITTED' | 'NEEDS_CORRECTION' | 'APPROVED'): Observable<Application[]> {
    if (this.mode === 'demo') {
      return of(this.data().applications.filter((app) => app.status === status));
    }
    const feature: FeatureId = status === 'IN_PROGRESS'
      ? 'admin_in_progress_queue'
      : status === 'SUBMITTED'
        ? 'admin_submitted_queue'
        : status === 'NEEDS_CORRECTION'
          ? 'admin_correction_queue'
          : 'admin_approved_queue';
    return this.requestRows(feature, 'list_applications_for_admin', { p_status: status }, (row) =>
      mapApplication(row, undefined, status),
    ).pipe(tap((applications) => this.mergeAdminQueue(status, applications)));
  }

  loadAllAdminApplications(): Observable<Application[]> {
    if (this.mode === 'demo') {
      return of(this.data().applications);
    }
    return forkJoin([
      this.loadAdminApplications('IN_PROGRESS').pipe(catchError(() => of([]))),
      this.loadAdminApplications('SUBMITTED').pipe(catchError(() => of([]))),
      this.loadAdminApplications('NEEDS_CORRECTION').pipe(catchError(() => of([]))),
      this.loadAdminApplications('APPROVED').pipe(catchError(() => of([]))),
    ]).pipe(
      map((queues) => queues.flat()),
      tap((applications) => this.mergeAllAdminApplications(applications)),
    );
  }

  private mergeAllAdminApplications(applications: Application[]): void {
    const queuedById = new Map(applications.map((application) => [application.id, application]));
    this.data.update((current) => ({
      ...current,
      applications: [...queuedById.values()],
      customers: this.mergeCustomers(current.customers, applications),
    }));
  }

  startApplication(draft: ApplicationDraft): Observable<Application> {
    if (this.mode !== 'demo') {
      const args = {
        p_borrower_type: draft.borrowerType,
        p_requested_amount: String(draft.requestedAmount),
      };
      return this.requestSingle('application_create', 'start_application', args, (row) => {
        const result: StartApplicationResult = {
          applicationId: safeBigint(row['application_id'], 'application'),
          applicationNumber: requiredString(row, 'application_number', 'application'),
          currentStep: requiredString(row, 'current_step', 'application'),
          status: applicationStatus(row['status']),
        };
        const application: Application = {
          id: result.applicationId,
          applicationNumber: result.applicationNumber,
          customerId: this.auth.customerProfile()?.customerId ?? '',
          borrowerType: draft.borrowerType,
          requestedAmount: args.p_requested_amount,
          currentStep: result.currentStep,
          status: result.status,
          createdAt: new Date().toISOString(),
        };
        return application;
      }).pipe(tap((application) => this.data.update((current) => ({
        ...current,
        applications: [...current.applications.filter((entry) => entry.id !== application.id), application],
      }))));
    }

    const current = this.data();
    const customer = current.customers.find((entry) => entry.phone === draft.phone);
    if (customer && current.applications.some((app) => app.customerId === customer.id && ['IN_PROGRESS', 'SUBMITTED'].includes(app.status))) {
      return throwError(() => new Error('An active demo application already exists for this borrower.'));
    }
    if (customer && current.loans.some((loan) => loan.status === 'ACTIVE'
      && compareDecimalValues(loan.outstandingAmount, 0) > 0
      && current.applications.some((app) => app.id === loan.applicationId && app.customerId === customer.id))) {
      return throwError(() => new Error('An outstanding demo loan prevents starting another application.'));
    }

    const id = Math.max(0, ...current.applications.map((app) => app.id)) + 1;
    const borrowerId = customer?.id ?? `DEMO-CUSTOMER-${String(current.customers.length + 1).padStart(3, '0')}`;
    const now = new Date().toISOString();
    const app: Application = {
      id,
      applicationNumber: `APP-${id.toString().padStart(6, '0')}`,
      customerId: borrowerId,
      borrowerType: draft.borrowerType,
      requestedAmount: draft.requestedAmount,
      currentStep: 'IN_PROGRESS',
      status: 'IN_PROGRESS',
      createdAt: now,
      receivingMethod: draft.receivingMethod,
      recipientName: draft.sameAsId ? draft.fullName : draft.recipientName,
      recipientIdentifier: draft.recipientIdentifier,
      institution: draft.institution || undefined,
      studentId: draft.studentId || undefined,
      employer: draft.employer || undefined,
      employmentStatus: draft.employmentStatus || undefined,
    };
    const customers = customer ? current.customers : [...current.customers, {
      id: borrowerId,
      phone: draft.phone,
      fullName: draft.fullName,
      nationalId: draft.nationalId || null,
      borrowerType: draft.borrowerType,
    }];
    this.data.set({ ...current, customers, applications: [...current.applications, app] });
    return of(app);
  }

  submitApplication(applicationId: number): Observable<Application> {
    if (this.mode !== 'demo') {
      return this.requestSingle('application_submission', 'submit_application', { p_application_id: applicationId }, (row) => {
        const updated = mapApplication(row);
        this.data.update((current) => ({
          ...current,
          applications: current.applications.map((entry) => entry.id === updated.id ? updated : entry),
        }));
        return updated;
      });
    }
    return this.updateDemoApplication(applicationId, {
      status: 'SUBMITTED',
      currentStep: 'SUBMITTED',
      submittedAt: new Date().toISOString(),
    });
  }

  checkSubmissionReadiness(applicationId: number): Observable<SubmissionReadiness> {
    if (this.mode !== 'demo') {
      return this.requestSingle('application_readiness', 'check_application_readiness', { p_application_id: applicationId }, (row) => {
        console.log('check_application_readiness raw response', { row, applicationId });

        const ready = typeof row['is_ready'] === 'boolean' ? row['is_ready'] : false;
        const policyConfirmationPending = typeof row['policy_confirmation_pending'] === 'boolean' ? row['policy_confirmation_pending'] : false;
        const documentStorageVerificationPending = typeof row['document_storage_verification_pending'] === 'boolean'
          ? row['document_storage_verification_pending']
          : false;
        const missingFields = Array.isArray(row['missing_fields']) ? row['missing_fields'].filter((value): value is string => typeof value === 'string') : [];
        const missingDocuments = Array.isArray(row['missing_documents']) ? row['missing_documents'].filter((value): value is string => typeof value === 'string') : [];
        const message = typeof row['message'] === 'string' ? row['message'] : '';
        const decision = ready ? 'READY_FOR_REVIEW' : 'INCOMPLETE';
        const requirementsConfirmed = !policyConfirmationPending && !documentStorageVerificationPending;

        return {
          ready,
          decision,
          missingFields,
          missingDocuments,
          requirementsConfirmed,
        };
      });
    }
    const application = this.data().applications.find((entry) => entry.id === applicationId);
    if (!application) {
      return throwError(() => new Error('There is no active application to submit.'));
    }
    const requiredDocuments = this.getRequirements(application.borrowerType);
    const uploadedDocuments = this.data().documents.filter((document) => document.applicationId === applicationId);
    const missingDocuments = requiredDocuments.filter((documentType) => !uploadedDocuments.some((document) => document.documentType === documentType));
    const missingFields = [
      !application.fullName && !application.phone ? 'Borrower details are incomplete.' : null,
      !application.requestedAmount ? 'Requested loan amount is missing.' : null,
      !application.receivingMethod ? 'Receiving method is missing.' : null,
      !application.recipientName ? 'Recipient details are missing.' : null,
    ].filter((value): value is string => Boolean(value));
    const ready = missingFields.length === 0 && missingDocuments.length === 0;
    return of({
      ready,
      decision: ready ? 'READY_FOR_REVIEW' : 'INCOMPLETE',
      missingFields,
      missingDocuments,
      requirementsConfirmed: ready,
    });
  }

  updateApplication(applicationId: number, draft: ApplicationDraft): Observable<Application> {
    if (this.mode !== 'demo') {
      const current = this.data().applications.find((entry) => entry.id === applicationId);
      if (!current) {
        return this.fail('application_update', 'available', 'Load the application before saving changes.');
      }
      const changes = {
        borrower_type: draft.borrowerType,
        requested_amount: Number(draft.requestedAmount),
        institution: draft.institution || null,
        student_id: draft.studentId || null,
        employment_status: draft.employmentStatus || null,
        employer: draft.employer || null,
        reception_method: draft.receivingMethod,
        reception_name: draft.sameAsId ? draft.fullName : draft.recipientName,
        reception_name_same_as_id: draft.sameAsId,
        reception_identifier: draft.receivingMethod === 'CASH' ? null : draft.recipientIdentifier,
      };
      return this.requestVoid('application_update', 'update_application', {
        p_application_id: applicationId,
        p_changes: changes,
      }).pipe(map(() => {
        const updated: Application = {
          ...current,
          borrowerType: draft.borrowerType,
          requestedAmount: draft.requestedAmount,
          receivingMethod: draft.receivingMethod,
          recipientName: draft.sameAsId ? draft.fullName : draft.recipientName,
          recipientNameSameAsId: draft.sameAsId,
          recipientIdentifier: draft.receivingMethod === 'CASH' ? undefined : draft.recipientIdentifier,
          institution: draft.institution || undefined,
          studentId: draft.studentId || undefined,
          employer: draft.employer || undefined,
          employmentStatus: draft.employmentStatus || undefined,
        };
        this.data.update((data) => ({
          ...data,
          applications: data.applications.map((entry) => entry.id === applicationId ? updated : entry),
        }));
        return updated;
      }));
    }

    const current = this.data();
    const app = current.applications.find((entry) => entry.id === applicationId);
    if (!app || app.status !== 'IN_PROGRESS') {
      return throwError(() => new Error('Only an in-progress demo application can be updated.'));
    }
    const updated: Application = {
      ...app,
      borrowerType: draft.borrowerType,
      requestedAmount: draft.requestedAmount,
      recipientName: draft.sameAsId ? draft.fullName : draft.recipientName,
      recipientIdentifier: draft.recipientIdentifier,
      receivingMethod: draft.receivingMethod,
      institution: draft.institution || undefined,
      studentId: draft.studentId || undefined,
      employer: draft.employer || undefined,
      employmentStatus: draft.employmentStatus || undefined,
    };
    this.data.set({
      ...current,
      applications: current.applications.map((entry) => entry.id === applicationId ? updated : entry),
    });
    return of(updated);
  }

  approveApplication(applicationId: number, approvedAmount: DecimalValue): Observable<Application> {
    if (this.mode !== 'demo') {
      const current = this.data().applications.find((app) => app.id === applicationId);
      if (!current) {
        return this.fail('admin_approval', 'available', 'Load the submitted application before approving it.');
      }
      return this.requestVoid('admin_approval', 'approve_application', {
        p_application_id: applicationId,
        p_approved_amount: String(approvedAmount),
      }).pipe(map(() => {
        const updated = { ...current, approvedAmount, status: 'APPROVED' as const, currentStep: 'APPROVED' };
        this.data.update((data) => ({
          ...data,
          applications: data.applications.map((app) => app.id === applicationId ? updated : app),
        }));
        return updated;
      }));
    }
    if (this.data().applications.find((entry) => entry.id === applicationId)?.status !== 'SUBMITTED') {
      return throwError(() => new Error('Only submitted demo applications can be approved.'));
    }
    return this.updateDemoApplication(applicationId, {
      approvedAmount,
      status: 'APPROVED',
      currentStep: 'APPROVED',
    });
  }

  uploadDisbursementProof(applicationId: number, file: File): Observable<number> {
    if (this.mode === 'demo') {
      return throwError(() => new Error('Disbursement proofs can only be uploaded in the live portal.'));
    }
    const allowed = new Set(['image/png', 'image/jpeg']);
    if (!allowed.has(file.type)) {
      return throwError(() => new Error('Choose a PNG or JPEG proof screenshot.'));
    }
    if (file.size === 0 || file.size > 10 * 1024 * 1024) {
      return throwError(() => new Error('The proof screenshot must be non-empty and no larger than 10 MiB.'));
    }
    return this.documentStorage.uploadDisbursementProof(applicationId, file).pipe(
      filter((update) => Number.isSafeInteger(update.documentId)),
      map((update) => update.documentId as number),
    );
  }

  getDisbursementProof(loanId: number): Observable<string> {
    return defer(() => this.auth.getSupabaseClient().schema('loanops').rpc('get_loan_disbursement_proof', {
      p_loan_id: loanId,
    })).pipe(
      map((result) => {
        if (result.error) throw new Error(result.error.message || 'The proof metadata could not be loaded.');
        const row = Array.isArray(result.data) ? result.data[0] : result.data;
        const documentId = row && typeof row === 'object'
          ? Number((row as Record<string, unknown>)['document_id'])
          : NaN;
        if (!Number.isSafeInteger(documentId) || documentId <= 0) {
          throw new Error('This loan has no valid disbursement proof.');
        }
        return documentId;
      }),
      switchMap((documentId) => this.documentStorage.getDocumentViewUrl(documentId)),
      map((proof) => proof.url),
    );
  }

  disburseLoan(application: Application, dueDate: string, disbursementReference: string, proofDocumentId = 0): Observable<Loan | DisbursementResult> {
    if (this.mode !== 'demo') {
      if (application.status !== 'APPROVED' || !application.approvedAmount) {
        return throwError(() => new Error('Only an approved application with a saved principal can be recorded as disbursed.'));
      }
      if (!Number.isSafeInteger(proofDocumentId) || proofDocumentId <= 0) {
        return throwError(() => new Error('Attach a disbursement proof before recording the disbursement.'));
      }
      return this.requestSingle('admin_disbursement', 'record_manual_disbursement_with_proof', {
        p_application_id: application.id,
        p_proof_document_id: proofDocumentId,
        p_due_date: dueDate,
        p_disbursement_reference: disbursementReference.trim() || null,
      }, (row) => {
        const result: DisbursementResult = {
          loanId: safeBigint(row['loan_id'], 'loan'),
          applicationId: safeBigint(row['application_id'], 'application'),
          principal: decimal(row['principal'], 'principal'),
          interestAmount: decimal(row['interest_amount'], 'interest amount'),
          totalDue: decimal(row['total_due'], 'total due'),
          outstandingAmount: decimal(row['outstanding_amount'], 'outstanding amount'),
          dueDate: requiredString(row, 'due_date', 'loan'),
          status: requiredString(row, 'status', 'loan'),
        };
        return result;
      });
    }
    const principal = Number(application.approvedAmount);
    if (application.status !== 'APPROVED' || !Number.isFinite(principal) || principal <= 0) {
      return throwError(() => new Error('Only an approved demo application can be disbursed.'));
    }
    if (this.data().loans.some((entry) => entry.applicationId === application.id)) {
      return throwError(() => new Error('A demo loan already exists for this application.'));
    }
    const principalMinor = Math.round(principal * 100);
    const interestMinor = Math.round(principalMinor * 0.3);
    const totalMinor = principalMinor + interestMinor;
    const loan: Loan = {
      id: Math.max(0, ...this.data().loans.map((entry) => entry.id)) + 1,
      applicationId: application.id,
      principal: principalMinor / 100,
      interestRate: 30,
      interestAmount: interestMinor / 100,
      totalDue: totalMinor / 100,
      amountPaid: 0,
      outstandingAmount: totalMinor / 100,
      dueDate,
      status: 'ACTIVE',
      disbursementReference,
      disbursedAt: new Date().toISOString(),
    };
    const current = this.data();
    this.data.set({
      ...current,
      loans: [...current.loans, loan],
      applications: current.applications.map((entry) => entry.id === application.id
        ? { ...entry, status: 'DISBURSED', currentStep: 'DISBURSED' }
        : entry),
    });
    return of(loan);
  }

  reviewDocument(documentId: number, decision: 'VERIFIED' | 'REJECTED', reviewNote: string): Observable<void> {
    if (this.mode !== 'demo') {
      return this.requestVoid('document_review', 'review_document', {
        p_document_id: documentId,
        p_decision: decision,
        p_note: reviewNote.trim(),
      });
    }
    const current = this.data();
    const document = current.documents.find((entry) => entry.id === documentId);
    if (!document) return throwError(() => new Error('Demo document was not found.'));
    if (document.status !== 'PENDING') {
      return throwError(() => new Error('Only pending demo documents can be reviewed.'));
    }
    const updated = { ...document, status: decision, reviewNote };
    const applicationDocuments = current.documents.filter((entry) => entry.applicationId === document.applicationId);
    const allVerified = applicationDocuments.every((entry) => entry.id === documentId ? decision === 'VERIFIED' : entry.status === 'VERIFIED');
    const hasRejected = applicationDocuments.some((entry) => entry.id === documentId ? decision === 'REJECTED' : entry.status === 'REJECTED');
    const applications = current.applications.map((entry) => {
      if (entry.id !== document.applicationId) return entry;
      if (hasRejected) {
        return { ...entry, status: 'REJECTED' as const, currentStep: 'SUBMITTED' };
      }
      return { ...entry, status: allVerified ? 'SUBMITTED' : entry.status, currentStep: 'SUBMITTED' };
    });
    this.data.set({
      ...current,
      documents: current.documents.map((entry) => entry.id === documentId ? updated : entry),
      applications,
    });
    return of(updated).pipe(map(() => undefined));
  }

  getRequirements(type: string): string[] {
    if (type === 'STUDENT' || type === 'EMPLOYED' || type === 'UNEMPLOYED') {
      return [...BORROWER_DOCUMENT_REQUIREMENTS[type]];
    }
    return [];
  }

  loadBorrowerRequirements(type: BorrowerType): Observable<BorrowerRequirements> {
    if (this.mode !== 'demo') {
      return this.unavailable('borrower_requirements', 'Borrower requirements remain pending backend implementation and lender policy confirmation.');
    }
    return of({
      borrowerType: type,
      requiredDocuments: this.getRequirements(type),
      requirementsConfirmed: false,
      pendingConfirmation: true,
    });
  }

  private updateDemoApplication(id: number, changes: Partial<Application>): Observable<Application> {
    const current = this.data();
    const application = current.applications.find((entry) => entry.id === id);
    if (!application) return throwError(() => new Error('Demo application was not found.'));
    const updated = { ...application, ...changes };
    this.data.set({
      ...current,
      applications: current.applications.map((entry) => entry.id === id ? updated : entry),
    });
    return of(updated);
  }

  submitPayment(
    loanId: number,
    amount: DecimalValue,
    paymentMethod: string,
    paymentReference: string,
  ): Observable<Payment> {
    if (this.mode === 'demo') {
      return this.unavailable('payment_submission', 'Demo payment submission is not enabled.');
    }
    if (!Number.isSafeInteger(loanId) || loanId <= 0
      || !/^\d+(?:\.\d{1,2})?$/.test(String(amount))
      || compareDecimalValues(amount, 0) <= 0
      || !paymentMethod.trim()
      || !paymentReference.trim()) {
      return this.fail('payment_submission', 'available', 'Enter a positive amount, valid loan, payment method, and reference.');
    }
    return this.requestSingle('payment_submission', 'submit_payment', {
      p_loan_id: loanId,
      p_amount: String(amount),
      p_payment_method: paymentMethod,
      p_payment_reference: paymentReference.trim(),
    }, (row) => {
      const payment = mapPayment(row);
      if (payment.status !== 'PENDING') {
        throw new Error('The payment response did not confirm a pending verification state.');
      }
      return payment;
    }).pipe(
      tap((payment) => this.data.update((current) => ({
        ...current,
        payments: [...current.payments.filter((entry) => entry.id !== payment.id), payment],
      }))),
    );
  }

  verifyPayment(paymentId: number): Observable<PaymentVerificationResult> {
    if (this.mode === 'demo') {
      return this.unavailable('payment_verification', 'Demo payment verification is not enabled.');
    }
    if (!Number.isSafeInteger(paymentId) || paymentId <= 0) {
      return this.fail('payment_verification', 'available', 'Enter a valid payment identifier.');
    }
    return this.requestSingle('payment_verification', 'verify_payment', {
      p_payment_id: paymentId,
    }, (row) => ({
      paymentId: safeBigint(row['payment_id'], 'payment'),
      loanId: safeBigint(row['loan_id'], 'loan'),
      amount: decimal(row['amount'], 'payment amount'),
      loanAmountPaid: decimal(row['loan_amount_paid'], 'amount paid'),
      outstandingAmount: decimal(row['outstanding_amount'], 'outstanding amount'),
      paymentStatus: requiredString(row, 'payment_status', 'payment'),
      loanStatus: requiredString(row, 'loan_status', 'loan'),
    }));
  }

  loadMyPayments(_loanId?: number): Observable<Payment[]> {
    return this.unavailable('borrower_payment_history', 'Payment history is unavailable until get_my_payments is deployed.');
  }

  loadPendingAdminPayments(_loanId?: number): Observable<Payment[]> {
    return this.unavailable('admin_payment_queue', 'The Admin payment queue is unavailable until its backend operation is deployed.');
  }

  private requestRows<T>(
    feature: FeatureId,
    rpcName: string,
    args: Record<string, unknown>,
    parseRow: (row: Record<string, unknown>) => T,
  ): Observable<T[]> {
    return this.runRpc(feature, rpcName, args, (value) => rows(value, rpcName).map(parseRow));
  }

  private requestSingle<T>(
    feature: FeatureId,
    rpcName: string,
    args: Record<string, unknown>,
    parseRow: (row: Record<string, unknown>) => T,
  ): Observable<T> {
    return this.runRpc(feature, rpcName, args, (value) => {
      const returnedRows = rows(value, rpcName);
      if (returnedRows.length !== 1) {
        throw new Error(`The ${rpcName} operation did not return exactly one row.`);
      }
      return parseRow(returnedRows[0]);
    });
  }

  private requestVoid(
    feature: FeatureId,
    rpcName: string,
    args: Record<string, unknown>,
  ): Observable<void> {
    return this.runRpc(feature, rpcName, args, () => undefined);
  }

  private runRpc<T>(
    feature: FeatureId,
    rpcName: string,
    args: Record<string, unknown>,
    parse: (value: unknown) => T,
  ): Observable<T> {
    if (this.mode !== 'api') {
      return this.unavailable(feature, 'Live LoanOps operations are not enabled in demo mode.');
    }
    if (feature === 'application_create' && !this.auth.configured) {
      return this.fail(feature, 'configuration_required', 'Supabase is not configured for this operation.');
    }
    if ((feature === 'application_readiness' || feature === 'application_submission') && !this.auth.isAuthenticated()) {
      return this.fail(feature, 'unauthorized', 'Sign in again to continue.');
    }
    if (!this.auth.configured) {
      return this.fail(feature, 'configuration_required', 'Supabase is not configured for this operation.');
    }
    if (!this.auth.isAuthenticated()) {
      return this.fail(feature, 'unauthorized', 'Sign in again to continue.');
    }
    const current = this.featureState(feature);
    if (current.request === 'loading') {
      return throwError(() => new Error('This operation is already in progress.'));
    }

    this.updateFeature(feature, { request: 'loading', error: null, errorCode: null });
    return defer(() => from(this.auth.getSupabaseClient().schema('loanops').rpc(rpcName, args)))
      .pipe(
        map((result) => {
          const rpcError = (
            result &&
            typeof result === 'object' &&
            'error' in result &&
            result.error !== null &&
            typeof result.error === 'object'
          )
            ? (result.error as Partial<{ code: string; message: string; status: number }>)
            : null;

          const rpcStatus = rpcError && 'status' in rpcError && typeof rpcError.status === 'number'
            ? rpcError.status
            : null;
          const rpcCode = rpcError && typeof rpcError === 'object' && 'code' in rpcError
            ? rpcError['code']
            : undefined;
          const rpcMessage = rpcError && typeof rpcError === 'object' && 'message' in rpcError
            ? rpcError['message']
            : undefined;

          if (rpcError) {
            const failure = this.rpcFailure(feature, rpcName, {
              code: typeof rpcCode === 'string' ? rpcCode : undefined,
              message: typeof rpcMessage === 'string' ? rpcMessage : undefined,
              status: rpcStatus ?? undefined,
            });
            throw Object.assign(new Error(failure.message), { featureFailure: failure });
          }

          if (feature === 'admin_in_progress_queue' || feature === 'admin_submitted_queue' || feature === 'admin_approved_queue') {
            const summary = rowSummary(result.data, rpcName);
            console.log('admin queue rpc summary', {
              rpcName,
              args,
              rowCount: summary.rowCount,
              fieldNames: summary.fieldNames,
              hasError: Boolean(rpcError),
              errorCode: typeof rpcCode === 'string' ? rpcCode : null,
              errorStatus: rpcStatus,
            });
          }

          return parse(result.data);
        }),
        tap((result) => this.updateFeature(feature, {
          request: Array.isArray(result) && result.length === 0 ? 'empty' : 'success',
          error: null,
          errorCode: null,
          availability: 'available',
        })),
        catchError((error: unknown) => {
          const failure = this.failureFrom(error, feature, rpcName);
          this.updateFeature(feature, {
            availability: failure.availability,
            request: 'error',
            error: failure.message,
            errorCode: failure.code,
          });
          return throwError(() => new Error(failure.message));
        }),
        finalize(() => {
          if (this.featureState(feature).request === 'loading') {
            this.updateFeature(feature, { request: 'idle' });
          }
        }),
      );
  }

  private rpcFailure(
    feature: FeatureId,
    rpcName: string,
    error: { code?: string; message?: string; status?: number },
  ): { availability: FeatureAvailability; code: string; message: string } {
    const code = error.code ?? '';
    if (code === 'PGRST202' || code === '42883') {
      return {
        availability: 'pending_backend',
        code,
        message: `The ${rpcName} operation is not available in the deployed backend yet.`,
      };
    }
    if (code === '42501' || error.status === 401 || error.status === 403) {
      return {
        availability: 'unauthorized',
        code,
        message: 'Your account is not authorized for this operation, or your session has expired.',
      };
    }
    if (code === '23505') {
      return { availability: 'available', code, message: 'A conflicting record already exists.' };
    }
    if (code === '23514' || code === '22P02' || code === '22023') {
      return { availability: 'available', code, message: 'Some submitted details are invalid. Review them and try again.' };
    }
    if (error.status && error.status >= 500) {
      return { availability: 'temporarily_unavailable', code, message: 'The service is temporarily unavailable. Try again shortly.' };
    }
    return {
      availability: 'available',
      code,
      message: `The ${feature.replaceAll('_', ' ')} operation could not be completed. Review the details and try again.`,
    };
  }

  private failureFrom(
    error: unknown,
    feature: FeatureId,
    rpcName: string,
  ): { availability: FeatureAvailability; code: string; message: string } {
    if (typeof error === 'object' && error !== null && 'featureFailure' in error) {
      return error.featureFailure as { availability: FeatureAvailability; code: string; message: string };
    }
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      const isNetworkFailure = error.name === 'TypeError'
        && /(failed to fetch|networkerror|load failed|fetch failed|connection refused|timeout)/i.test(error.message)
        || error.name === 'AbortError'
        || /failed to fetch|networkerror|load failed|fetch failed|timed out|connection refused/i.test(message);
      if (isNetworkFailure) {
        return {
          availability: 'temporarily_unavailable',
          code: 'NETWORK_ERROR',
          message: `Could not connect to complete ${feature.replaceAll('_', ' ')}. Check your connection and retry.`,
        };
      }
    }
    return {
      availability: 'available',
      code: 'INVALID_RESPONSE',
      message: error instanceof Error ? error.message : `The ${rpcName} response could not be processed.`,
    };
  }

  private unavailable<T>(feature: FeatureId, message: string): Observable<T> {
    const current = this.featureState(feature);
    const availability = !this.auth.configured && this.mode === 'api' && current.availability === 'available'
      ? 'configuration_required'
      : current.availability;
    this.updateFeature(feature, { availability, request: 'error', error: message, errorCode: null });
    return throwError(() => new Error(message));
  }

  private fail<T>(feature: FeatureId, availability: FeatureAvailability, message: string): Observable<T> {
    this.updateFeature(feature, { availability, request: 'error', error: message, errorCode: null });
    return throwError(() => new Error(message));
  }

  private updateFeature(feature: FeatureId, patch: Partial<FeatureState>): void {
    this.featureStates.update((current) => ({
      ...current,
      [feature]: { ...current[feature], ...patch },
    }));
  }

  private resetRequestStates(): void {
    this.featureStates.update((current) => Object.fromEntries(
      Object.entries(current).map(([feature, state]) => [feature, {
        ...state,
        availability: !this.auth.configured && state.availability === 'available'
          ? 'configuration_required'
          : featureAvailability[feature as FeatureId],
        request: 'idle',
        error: null,
        errorCode: null,
      }]),
    ) as Record<FeatureId, FeatureState>);
  }

  mergeAdminQueue(
    status: 'IN_PROGRESS' | 'SUBMITTED' | 'NEEDS_CORRECTION' | 'APPROVED',
    applications: Application[],
  ): void {
    const retained = this.data().applications.filter((app) => app.status !== status);
    this.data.update((current) => ({
      ...current,
      applications: [
        ...retained,
        ...applications.filter((application, index, rows) =>
          rows.findIndex((candidate) => candidate.id === application.id && candidate.status === application.status) === index),
      ],
      customers: this.mergeCustomers(current.customers, applications),
    }));
  }

  private replaceApplicationDocuments(applicationId: number, documents: DocumentRecord[]): void {
    this.data.update((current) => ({
      ...current,
      documents: [
        ...current.documents.filter((document) => document.applicationId !== applicationId),
        ...documents,
      ],
    }));
  }

  private mergeCustomers(existing: LoanOpsData['customers'], applications: Application[]): LoanOpsData['customers'] {
    const customers = new Map(existing.map((customer) => [customer.id, customer]));
    for (const application of applications) {
      if (!application.fullName && !application.phone) continue;
      customers.set(application.customerId, {
        id: application.customerId,
        fullName: application.fullName ?? 'Borrower',
        phone: application.phone ?? '',
        nationalId: application.nationalId ?? null,
        borrowerType: application.borrowerType,
      });
    }
    return [...customers.values()];
  }
}
