export type BorrowerType = 'STUDENT' | 'EMPLOYED' | 'UNEMPLOYED';
export type BorrowerDocumentType = 'STUDENT_ID' | 'ADMISSION_LETTER' | 'IDENTITY_DOCUMENT' | 'EMPLOYMENT_LETTER';
export type ApplicationStatus = 'IN_PROGRESS' | 'SUBMITTED' | 'NEEDS_CORRECTION' | 'APPROVED' | 'DISBURSED' | 'REJECTED' | 'CANCELLED';
export type DocumentStatus = 'MISSING' | 'PENDING' | 'VERIFIED' | 'REJECTED';
export type DocumentReviewStatus = Exclude<DocumentStatus, 'MISSING'>;
export type ReceivingMethod = 'CASH' | 'FNB_PAY_TO_CELL' | 'EFT' | 'ORANGE_MONEY' | 'MYZAKA' | 'SMEGA';
export type DecimalValue = string | number;

export type FeatureId =
  | 'borrower_profile_initialize'
  | 'borrower_profile_read'
  | 'borrower_applications'
  | 'application_create'
  | 'application_update'
  | 'application_submission'
  | 'borrower_requirements'
  | 'application_readiness'
  | 'borrower_loans'
  | 'admin_loan_list'
  | 'payment_submission'
  | 'borrower_payment_history'
  | 'admin_in_progress_queue'
  | 'admin_submitted_queue'
  | 'admin_correction_queue'
  | 'admin_approved_queue'
  | 'admin_approval'
  | 'admin_disbursement'
  | 'document_listing'
  | 'document_viewing'
  | 'document_review'
  | 'document_upload'
  | 'admin_payment_queue'
  | 'payment_verification'
  | 'customer_management';

export interface KycDocument {
  documentId: number;
  documentType: string;
  originalFilename: string;
  mimeType: string;
  verificationStatus: DocumentReviewStatus;
  uploadedAt: string;
  verifiedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  originalApplicationId: number | null;
}

export interface ApplicationDocumentEvidence {
  applicationId: number;
  documentId: number;
  requirementType: string;
  documentType: string;
  originalFilename: string;
  mimeType: string;
  verificationStatus: DocumentReviewStatus;
  isReused: boolean;
  sourceApplicationId: number | null;
  uploadedAt: string;
  reviewNote: string | null;
}

export interface ApplicationRequirement {
  applicationId: number;
  borrowerType: BorrowerType;
  requirementType: string;
  policyConfirmed: boolean;
  satisfied: boolean;
  documentId: number | null;
  documentStatus: DocumentReviewStatus | null;
  isReused: boolean;
  uploadRequired: boolean;
}

export interface ApplicationCancellation {
  applicationId: number;
  status: 'CANCELLED';
  cancelledAt: string;
  alreadyCancelled: boolean;
}

export interface AdminCustomer {
  customerId: string;
  phone: string;
  fullName: string | null;
  nationalId: string | null;
  borrowerType: BorrowerType;
  createdAt: string;
  updatedAt: string;
  applicationCount?: number;
  loanCount?: number;
}

export interface AdminLoan {
  loanId: number;
  applicationId: number;
  applicationReference: string;
  customerId: string;
  borrowerName: string;
  approvedPrincipal: DecimalValue;
  interestRate: DecimalValue;
  interestAmount: DecimalValue;
  totalRepayable: DecimalValue;
  amountPaid: DecimalValue;
  outstandingBalance: DecimalValue;
  dueDate: string;
  loanStatus: string;
  disbursementReference: string;
  disbursedAt: string;
}

export interface AdminDashboardSummary {
  applicationsInProgress: number;
  applicationsAwaitingReview: number;
  approvedAwaitingDisbursement: number;
  activeLoans: number;
  documentsPendingReview: number;
  totalOutstandingBalance: DecimalValue;
}

export type FeatureAvailability =
  | 'available'
  | 'pending_backend'
  | 'pending_policy'
  | 'configuration_required'
  | 'temporarily_unavailable'
  | 'unauthorized';

export type FeatureRequestState = 'idle' | 'loading' | 'success' | 'empty' | 'error';

export interface FeatureState {
  availability: FeatureAvailability;
  request: FeatureRequestState;
  error: string | null;
  errorCode: string | null;
}

export const BORROWER_DOCUMENT_REQUIREMENTS: Record<BorrowerType, BorrowerDocumentType[]> = {
  STUDENT: ['STUDENT_ID', 'ADMISSION_LETTER', 'IDENTITY_DOCUMENT'],
  EMPLOYED: ['EMPLOYMENT_LETTER', 'IDENTITY_DOCUMENT'],
  UNEMPLOYED: ['IDENTITY_DOCUMENT'],
};

export interface Customer {
  id: string;
  phone: string;
  fullName: string;
  nationalId?: string | null;
  borrowerType?: BorrowerType | null;
}

export interface Application {
  id: number;
  applicationNumber: string;
  customerId: string;
  borrowerType: BorrowerType;
  requestedAmount: DecimalValue;
  approvedAmount?: DecimalValue | null;
  currentStep: string;
  status: ApplicationStatus;
  createdAt: string;
  submittedAt?: string;
  reviewedAt?: string;
  updatedAt?: string;
  fullName?: string;
  phone?: string;
  nationalId?: string | null;
  receivingMethod?: ReceivingMethod;
  recipientName?: string;
  recipientNameSameAsId?: boolean;
  recipientIdentifier?: string;
  institution?: string;
  studentId?: string;
  employer?: string;
  employmentStatus?: string;
}

export interface DocumentRecord {
  id: number;
  applicationId: number;
  documentType: string;
  fileName?: string;
  status: Exclude<DocumentStatus, 'MISSING'>;
  reviewNote?: string;
  createdAt: string;
}

export interface Loan {
  id: number;
  applicationId: number;
  principal: DecimalValue;
  interestRate?: DecimalValue;
  interestAmount: DecimalValue;
  totalDue: DecimalValue;
  amountPaid?: DecimalValue;
  outstandingAmount: DecimalValue;
  dueDate: string;
  status: string;
  disbursementMethod?: string;
  disbursementReference?: string;
  disbursedAt?: string;
  closedAt?: string;
}

export interface Payment {
  id: number;
  loanId: number;
  amount: DecimalValue;
  status: string;
  paymentMethod?: string;
  paymentReference?: string;
  submittedAt: string;
  verifiedAt?: string | null;
}

export interface LoanOpsData {
  customers: Customer[];
  applications: Application[];
  documents: DocumentRecord[];
  loans: Loan[];
  payments: Payment[];
}

export interface ApplicationDraft {
  phone: string;
  fullName: string;
  nationalId: string;
  borrowerType: BorrowerType;
  requestedAmount: DecimalValue;
  institution: string;
  studentId: string;
  employer: string;
  employmentStatus: string;
  receivingMethod: ReceivingMethod;
  recipientName: string;
  sameAsId: boolean;
  recipientIdentifier: string;
}

export interface BorrowerRequirements {
  borrowerType: BorrowerType;
  requiredDocuments: string[];
  requirementsConfirmed: boolean;
  pendingConfirmation: boolean;
}

export interface SubmissionReadiness {
  ready: boolean;
  decision: string;
  missingFields: string[];
  missingDocuments: string[];
  requirementsConfirmed: boolean;
}

export interface StartApplicationResult {
  applicationId: number;
  applicationNumber: string;
  currentStep: string;
  status: ApplicationStatus;
}

export interface DisbursementResult {
  loanId: number;
  applicationId: number;
  principal: DecimalValue;
  interestAmount: DecimalValue;
  totalDue: DecimalValue;
  outstandingAmount: DecimalValue;
  dueDate: string;
  status: string;
}

export interface PaymentVerificationResult {
  paymentId: number;
  loanId: number;
  amount: DecimalValue;
  loanAmountPaid: DecimalValue;
  outstandingAmount: DecimalValue;
  paymentStatus: string;
  loanStatus: string;
}
