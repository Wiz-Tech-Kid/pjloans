import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { BorrowerDocumentType, BorrowerType, DocumentStatus } from './models';

export interface BorrowerProfile {
  fullName: string;
  phone: string;
  borrowerType: BorrowerType;
}

export interface BorrowerVerificationDocument {
  id: string;
  documentType: BorrowerDocumentType;
  fileName: string;
  status: Exclude<DocumentStatus, 'MISSING'>;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt?: string | null;
}

const PROFILE_API_UNAVAILABLE = 'Borrower profile operations are unavailable until the deployed LoanOps profile contract is verified.';
const DOCUMENT_API_UNAVAILABLE = 'Private verification-document operations are unavailable until secure storage and metadata registration are implemented.';

@Injectable({ providedIn: 'root' })
export class BorrowerAccountService {
  private readonly auth = inject(AuthService);

  async loadProfile(): Promise<BorrowerProfile> {
    const profile = this.auth.customerProfile();
    if (!profile) throw new Error(PROFILE_API_UNAVAILABLE);
    if (!profile.borrowerType) {
      throw new Error('Your saved borrower category is missing. Contact support before changing application details.');
    }
    return {
      fullName: profile.fullName ?? '',
      phone: profile.phone,
      borrowerType: profile.borrowerType,
    };
  }

  async updateProfile(_fullName: string, _phone: string): Promise<BorrowerProfile> {
    throw new Error(PROFILE_API_UNAVAILABLE);
  }

  async requestBorrowerTypeChange(_borrowerType: BorrowerType): Promise<BorrowerProfile> {
    throw new Error('Borrower category changes are unavailable until the deployed LoanOps profile contract is verified.');
  }

  async loadVerificationDocuments(): Promise<BorrowerVerificationDocument[]> {
    throw new Error(DOCUMENT_API_UNAVAILABLE);
  }

  async uploadVerificationDocument(
    _documentType: BorrowerDocumentType,
    _file: File,
  ): Promise<BorrowerVerificationDocument> {
    throw new Error(DOCUMENT_API_UNAVAILABLE);
  }
}
