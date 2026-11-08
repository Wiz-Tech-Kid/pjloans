import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import {
  BorrowerAccountService,
  BorrowerProfile,
  BorrowerVerificationDocument,
} from './borrower-account.service';
import { LoanOpsApiService } from './loanops-api.service';
import {
  BorrowerRequirements,
  BorrowerType,
} from './models';
import { ThemeService } from './theme.service';

const BORROWER_TYPES: BorrowerType[] = ['STUDENT', 'EMPLOYED', 'UNEMPLOYED'];

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <main class="portal-page borrower-portal settings-page">
      <header class="topbar">
        <a class="brand-mark compact" routerLink="/dashboard"><span class="brand-glyph">PJ</span><span>loans</span></a>
        <nav class="portal-nav" aria-label="Borrower navigation">
          <a class="button secondary-button" routerLink="/dashboard">Overview</a>
          <span class="current" aria-current="page">Account settings</span>
        </nav>
        <div class="topbar-actions">
          <button class="button secondary-button" type="button" (click)="logout()" [disabled]="signingOut()">{{ signingOut() ? 'Signing out…' : 'Sign out' }}</button>
          <button class="icon-button" type="button" (click)="theme.toggle()" aria-label="Toggle theme">{{ theme.theme() === 'dark' ? '☼' : '◐' }}</button>
        </div>
      </header>

      <div class="page-content">
        <div class="page-heading settings-heading">
          <div>
            <p class="eyebrow">Your account</p>
            <h1>Settings</h1>
            <p class="muted">Manage account details, verification, security, and your sign-in session.</p>
          </div>
          <span class="status-chip" [ngClass]="api.mode === 'demo' ? 'settings-demo' : 'settings-unavailable'">
            {{ api.mode === 'demo' ? 'DEMO DATA — Not connected to the live backend' : 'Account verification status unavailable' }}
          </span>
        </div>

        <section class="surface-card settings-overview" aria-labelledby="account-overview-title">
          <div>
            <p class="eyebrow">Account overview</p>
            <h2 id="account-overview-title">{{ auth.user()?.email ?? 'Signed-in account' }}</h2>
            <p class="muted">Your email and password are managed by the sign-in provider. Borrower profile and lending verification require verified LoanOps operations.</p>
          </div>
          <div class="settings-overview-status">
            <span class="status-chip status-unknown">Verification not confirmed</span>
            <span class="muted">The backend has not supplied an account-verification or loan-eligibility result.</span>
          </div>
        </section>

        <div class="two-columns settings-columns">
          <section class="surface-card settings-panel" aria-labelledby="profile-title" aria-busy="{{ profileLoading() }}">
            <p class="eyebrow">Account information</p>
            <h2 id="profile-title">Personal details</h2>
            <p class="muted">Your profile must be loaded from the authenticated LoanOps profile operation. It is not inferred from sign-up form data.</p>

            <p class="loading-state" *ngIf="profileLoading()" role="status">Loading your saved account information…</p>
            <div class="error-card" *ngIf="profileError()" role="alert">
              <p>{{ profileError() }}</p>
              <button class="button secondary-button" type="button" (click)="reloadProfile()" [disabled]="profileLoading()">Retry profile</button>
            </div>

            <form class="auth-form" *ngIf="profile() as account" (ngSubmit)="saveProfile()">
              <label><span>Full name</span><input name="fullName" [(ngModel)]="fullName" required maxlength="120" autocomplete="name"></label>
              <label><span>Email address</span><input [value]="auth.user()?.email ?? ''" readonly autocomplete="email"></label>
              <label><span>Mobile number</span><input name="phone" [(ngModel)]="phone" required minlength="7" maxlength="24" autocomplete="tel"></label>
              <label><span>Saved borrower category</span><input [value]="categoryLabel(account.borrowerType)" readonly></label>
              <p class="error-message" *ngIf="profileSaveError()" role="alert">{{ profileSaveError() }}</p>
              <p class="success-message" *ngIf="profileSuccess()" role="status">{{ profileSuccess() }}</p>
              <button class="button secondary-button" type="button" (click)="cancelProfileEdit()" [disabled]="savingProfile()">Cancel changes</button>
              <button class="button primary-button" type="submit" [disabled]="savingProfile()">{{ savingProfile() ? 'Saving…' : 'Save profile' }}</button>
            </form>

            <div class="empty-card settings-unavailable-card" *ngIf="!profile() && !profileLoading() && !profileError()">
              <h3>Profile service unavailable</h3>
              <p>The authenticated profile read/update endpoints have not been implemented. No unsaved or sign-up form values are shown as saved.</p>
            </div>
          </section>

          <section class="surface-card settings-panel" aria-labelledby="password-title">
            <p class="eyebrow">Security</p>
            <h2 id="password-title">Change password</h2>
            <p class="muted">Choose a new password for this account. This updates your authenticated sign-in with Supabase Auth.</p>
            <form class="auth-form" (ngSubmit)="changePassword()" #passwordForm="ngForm" novalidate>
              <label>
                <span>New password</span>
                <span class="password-control">
                  <input [type]="showNewPassword() ? 'text' : 'password'" name="newPassword" [(ngModel)]="newPassword" required minlength="10" autocomplete="new-password" aria-describedby="password-requirements">
                  <button class="password-toggle" type="button" (click)="toggleNewPassword()" [attr.aria-label]="showNewPassword() ? 'Hide new password' : 'Show new password'" [attr.aria-pressed]="showNewPassword()">{{ showNewPassword() ? 'Hide' : 'Show' }}</button>
                </span>
              </label>
              <label>
                <span>Confirm new password</span>
                <span class="password-control">
                  <input [type]="showConfirmPassword() ? 'text' : 'password'" name="confirmPassword" [(ngModel)]="confirmPassword" required autocomplete="new-password" aria-describedby="password-requirements">
                  <button class="password-toggle" type="button" (click)="toggleConfirmPassword()" [attr.aria-label]="showConfirmPassword() ? 'Hide confirmation password' : 'Show confirmation password'" [attr.aria-pressed]="showConfirmPassword()">{{ showConfirmPassword() ? 'Hide' : 'Show' }}</button>
                </span>
              </label>
              <p id="password-requirements" class="password-hint" aria-live="polite">At least 10 characters, including a number and a symbol.</p>
              <p class="error-message" *ngIf="passwordError()" role="alert">{{ passwordError() }}</p>
              <p class="success-message" *ngIf="passwordSuccess()" role="status">{{ passwordSuccess() }}</p>
              <button class="button primary-button" type="submit" [disabled]="changingPassword() || !auth.configured || !auth.user()">
                {{ changingPassword() ? 'Updating…' : 'Update password' }}
              </button>
              <p class="inline-warning" *ngIf="!auth.configured" role="status">Password changes are unavailable until Supabase Auth is configured.</p>
              <p class="muted" *ngIf="auth.configured && !auth.user()">Sign in to manage your password.</p>
            </form>
          </section>
        </div>

        <div class="two-columns settings-columns">
          <section class="surface-card settings-panel" aria-labelledby="category-title">
            <p class="eyebrow">Borrower category</p>
            <h2 id="category-title">Category and requirements</h2>
            <p class="muted">The saved borrower category determines the account-verification requirements. Changing it may affect eligibility while the new requirements are reviewed.</p>
            <p class="loading-state" *ngIf="profileLoading()" role="status">Waiting for the saved borrower category…</p>
            <ng-container *ngIf="profile() as account">
              <p><strong>Current saved category:</strong> {{ categoryLabel(account.borrowerType) }}</p>
              <button class="button secondary-button" type="button" (click)="openCategoryDialog()" [disabled]="changingCategory()">Request category change</button>
              <p class="error-message" *ngIf="categoryError()" role="alert">{{ categoryError() }}</p>
              <p class="success-message" *ngIf="categorySuccess()" role="status">{{ categorySuccess() }}</p>
              <p class="muted" *ngIf="requirementsLoading()" role="status">Loading requirements from the backend…</p>
              <p class="inline-warning" *ngIf="requirementsError()" role="alert">{{ requirementsError() }}</p>
              <div *ngIf="requirements() as accountRequirements">
                <ul class="settings-requirements">
                  <li *ngFor="let requirement of accountRequirements.requiredDocuments">{{ documentLabel(requirement) }}</li>
                </ul>
                <p class="inline-warning" *ngIf="!accountRequirements.requirementsConfirmed || accountRequirements.pendingConfirmation" role="status">
                  Requirements for this category are not fully confirmed. Account eligibility cannot be assumed.
                </p>
              </div>
            </ng-container>
            <div class="empty-card settings-unavailable-card" *ngIf="!profile() && !profileLoading()">
              <h3>Saved category unavailable</h3>
              <p>The current profile API does not provide a borrower category. Category changes and current requirements cannot be confirmed yet.</p>
              <details class="settings-policy-reference">
                <summary>Configured document requirements reference</summary>
                <p>This is reference policy only, not a confirmation of your saved category or account eligibility.</p>
                <strong>Student</strong>
                <ul><li>Student identification</li><li>Admission letter</li><li>Omang or passport</li></ul>
                <strong>Employed</strong>
                <ul><li>Employment or contract letter</li><li>Omang or passport</li></ul>
                <strong>Unemployed</strong>
                <ul><li>Omang or passport</li></ul>
                <p class="inline-warning">Unemployed requirements are pending lender confirmation. Student registration proof and passport acceptance against the national-ID completeness check also need backend clarification.</p>
              </details>
            </div>
          </section>

          <section class="surface-card settings-panel verification-panel" aria-labelledby="verification-title" aria-busy="{{ documentsLoading() }}">
            <p class="eyebrow">Account verification</p>
            <h2 id="verification-title">Verification documents</h2>
            <p class="muted">Verification is account-level. Reusing verified documents across applications requires the backend to store and check them against the borrower account.</p>
            <p class="loading-state" *ngIf="documentsLoading()" role="status">Loading account verification documents…</p>
            <div class="error-card" *ngIf="documentsError()" role="alert">
              <p>{{ documentsError() }}</p>
              <button class="button secondary-button" type="button" (click)="reloadDocuments()" [disabled]="documentsLoading()">Retry documents</button>
            </div>
            <div *ngIf="documents().length">
              <article class="checklist-row verification-row" *ngFor="let document of documents()">
                <div>
                  <strong>{{ documentLabel(document.documentType) }}</strong>
                  <p>{{ document.fileName }}</p>
                  <p class="muted" *ngIf="document.createdAt">Submitted {{ document.createdAt | date:'mediumDate' }}</p>
                  <p class="muted" *ngIf="document.reviewedAt">Reviewed {{ document.reviewedAt | date:'mediumDate' }}</p>
                  <p class="rejection-note" *ngIf="document.reviewNote">{{ document.reviewNote }}</p>
                </div>
                <span class="status-chip" [ngClass]="statusClass(document.status)">{{ statusLabel(document.status) }}</span>
              </article>
            </div>
            <div class="empty-card settings-unavailable-card" *ngIf="!documents().length && !documentsLoading() && !documentsError()">
              <h3>Account document service unavailable</h3>
              <p>Borrower-owned document retrieval, private upload, and metadata registration are not connected. No file is treated as uploaded or verified here.</p>
            </div>
            <p class="inline-warning" *ngIf="profile()?.borrowerType === 'UNEMPLOYED' && requirements()?.requirementsConfirmed === false" role="status">
              The unemployed-borrower requirements are pending confirmation. Identity evidence alone does not establish eligibility.
            </p>
            <p class="muted">Known policy questions remain: whether students need registration proof in addition to the configured documents, and how passport identity evidence relates to the backend national-ID completeness check.</p>
          </section>
        </div>

        <section class="surface-card settings-privacy" aria-label="Privacy information">
          <h2>Keeping your information private</h2>
          <p class="muted">Identity documents should be sent only through the authenticated, borrower-owned private upload flow. Do not send sensitive documents until that backend flow is available.</p>
        </section>
      </div>

      <dialog #categoryDialog class="settings-dialog" aria-labelledby="category-dialog-title" (cancel)="cancelCategoryChange()">
        <form method="dialog" class="settings-dialog-content" (ngSubmit)="confirmCategoryChange($event)">
          <p class="eyebrow">Account category</p>
          <h2 id="category-dialog-title">Request a category change</h2>
          <p>Changing your category changes the documents required for account verification. You may temporarily be unable to submit loan applications while the new requirements are satisfied and reviewed.</p>
          <label for="new-category">New borrower category</label>
          <select id="new-category" name="newCategory" [(ngModel)]="pendingCategory">
            <option *ngFor="let type of borrowerTypes" [ngValue]="type">{{ categoryLabel(type) }}</option>
          </select>
          <p class="error-message" *ngIf="categoryError()" role="alert">{{ categoryError() }}</p>
          <div class="settings-dialog-actions">
            <button class="button secondary-button" type="button" (click)="cancelCategoryChange()">Cancel</button>
            <button class="button primary-button" type="submit" [disabled]="changingCategory()">{{ changingCategory() ? 'Submitting…' : 'Confirm change' }}</button>
          </div>
        </form>
      </dialog>
    </main>
  `,
})
export class BorrowerSettings {
  @ViewChild('categoryDialog') private categoryDialog?: ElementRef<HTMLDialogElement>;

  readonly auth = inject(AuthService);
  readonly account = inject(BorrowerAccountService);
  readonly api = inject(LoanOpsApiService);
  readonly router = inject(Router);
  readonly theme = inject(ThemeService);
  readonly profile = signal<BorrowerProfile | null>(null);
  readonly documents = signal<BorrowerVerificationDocument[]>([]);
  readonly requirements = signal<BorrowerRequirements | null>(null);
  readonly profileLoading = signal(false);
  readonly documentsLoading = signal(false);
  readonly requirementsLoading = signal(false);
  readonly savingProfile = signal(false);
  readonly changingPassword = signal(false);
  readonly changingCategory = signal(false);
  readonly signingOut = signal(false);
  readonly showNewPassword = signal(false);
  readonly showConfirmPassword = signal(false);
  readonly profileError = signal('');
  readonly documentsError = signal('');
  readonly requirementsError = signal('');
  readonly profileSaveError = signal('');
  readonly profileSuccess = signal('');
  readonly passwordError = signal('');
  readonly passwordSuccess = signal('');
  readonly categoryError = signal('');
  readonly categorySuccess = signal('');
  readonly borrowerTypes = BORROWER_TYPES;
  fullName = '';
  phone = '';
  newPassword = '';
  confirmPassword = '';
  pendingCategory: BorrowerType = 'STUDENT';

  constructor() {
    void this.reloadProfile();
    void this.reloadDocuments();
  }

  async reloadProfile(): Promise<void> {
    this.profileError.set('');
    this.profileLoading.set(true);
    try {
      const profile = await this.account.loadProfile();
      this.profile.set(profile);
      this.fullName = profile.fullName;
      this.phone = profile.phone;
      this.pendingCategory = profile.borrowerType;
      void this.reloadRequirements(profile.borrowerType);
    } catch (error) {
      this.profileError.set(error instanceof Error ? error.message : 'Account information could not be loaded.');
    } finally {
      this.profileLoading.set(false);
    }
  }

  async reloadDocuments(): Promise<void> {
    this.documentsError.set('');
    this.documentsLoading.set(true);
    try {
      this.documents.set(await this.account.loadVerificationDocuments());
    } catch (error) {
      this.documentsError.set(error instanceof Error ? error.message : 'Verification documents could not be loaded.');
    } finally {
      this.documentsLoading.set(false);
    }
  }

  reloadRequirements(type: BorrowerType): void {
    this.requirementsError.set('');
    this.requirementsLoading.set(true);
    this.api.loadBorrowerRequirements(type).subscribe({
      next: (requirements) => {
        this.requirements.set(requirements);
        this.requirementsLoading.set(false);
      },
      error: (error: unknown) => {
        this.requirementsError.set(error instanceof Error ? error.message : 'Borrower requirements could not be loaded.');
        this.requirementsLoading.set(false);
      },
    });
  }

  async saveProfile(): Promise<void> {
    this.profileSaveError.set('');
    this.profileSuccess.set('');
    this.savingProfile.set(true);
    try {
      const profile = await this.account.updateProfile(this.fullName, this.phone);
      this.profile.set(profile);
      this.fullName = profile.fullName;
      this.phone = profile.phone;
      this.profileSuccess.set('Your profile has been updated.');
    } catch (error) {
      this.profileSaveError.set(error instanceof Error ? error.message : 'Your profile could not be saved.');
    } finally {
      this.savingProfile.set(false);
    }
  }

  cancelProfileEdit(): void {
    const savedProfile = this.profile();
    if (!savedProfile) return;
    this.fullName = savedProfile.fullName;
    this.phone = savedProfile.phone;
    this.profileSaveError.set('');
    this.profileSuccess.set('');
  }

  async changePassword(): Promise<void> {
    this.passwordError.set('');
    this.passwordSuccess.set('');
    if (this.newPassword.length < 10 || !/\d/.test(this.newPassword) || !/[^A-Za-z0-9]/.test(this.newPassword)) {
      this.passwordError.set('Use at least 10 characters, including a number and a symbol.');
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.passwordError.set('Your passwords do not match.');
      return;
    }
    if (!this.auth.configured || !this.auth.user()) {
      this.passwordError.set('Sign in with a configured account before changing your password.');
      return;
    }

    this.changingPassword.set(true);
    try {
      await this.auth.updatePassword(this.newPassword);
      this.newPassword = '';
      this.confirmPassword = '';
      this.passwordSuccess.set('Your password has been updated.');
    } catch (error) {
      this.passwordError.set(error instanceof Error ? error.message : 'Your password could not be updated.');
    } finally {
      this.changingPassword.set(false);
    }
  }

  toggleNewPassword(): void {
    this.showNewPassword.update((visible) => !visible);
  }

  toggleConfirmPassword(): void {
    this.showConfirmPassword.update((visible) => !visible);
  }

  openCategoryDialog(): void {
    this.categoryError.set('');
    this.categorySuccess.set('');
    this.pendingCategory = this.profile()?.borrowerType ?? 'STUDENT';
    this.categoryDialog?.nativeElement.showModal();
  }

  cancelCategoryChange(): void {
    if (this.categoryDialog?.nativeElement.open) {
      this.categoryDialog.nativeElement.close();
    }
    this.pendingCategory = this.profile()?.borrowerType ?? 'STUDENT';
  }

  async confirmCategoryChange(event: Event): Promise<void> {
    event.preventDefault();
    const currentProfile = this.profile();
    if (!currentProfile || this.pendingCategory === currentProfile.borrowerType) {
      this.cancelCategoryChange();
      return;
    }
    this.categoryError.set('');
    this.changingCategory.set(true);
    try {
      const updatedCategory = await firstValueFrom(this.api.updateMyBorrowerType(this.pendingCategory));
      const updatedProfile = { ...currentProfile, borrowerType: updatedCategory.borrowerType };
      this.profile.set(updatedProfile);
      this.pendingCategory = updatedProfile.borrowerType;
      this.categorySuccess.set('Your borrower category has been updated.');
      this.categoryDialog?.nativeElement.close();
      this.reloadRequirements(updatedProfile.borrowerType);
      await this.reloadDocuments();
    } catch (error) {
      this.categoryError.set(error instanceof Error ? error.message : 'Your category change could not be submitted.');
    } finally {
      this.changingCategory.set(false);
    }
  }

  async logout(): Promise<void> {
    this.signingOut.set(true);
    try {
      await this.auth.signOut();
      await this.router.navigateByUrl('/login');
    } catch (error) {
      this.profileError.set(error instanceof Error ? error.message : 'Unable to sign out.');
    } finally {
      this.signingOut.set(false);
    }
  }

  categoryLabel(type: BorrowerType): string {
    return type === 'STUDENT' ? 'Student' : type === 'EMPLOYED' ? 'Employed' : 'Unemployed';
  }

  documentLabel(type: string): string {
    return ({
      STUDENT_ID: 'Student identification',
      ADMISSION_LETTER: 'Admission letter',
      IDENTITY_DOCUMENT: 'Omang or passport',
      EMPLOYMENT_LETTER: 'Employment or contract letter',
    } as Record<string, string>)[type] ?? type.replaceAll('_', ' ').toLowerCase();
  }

  statusLabel(status: string): string {
    return status === 'PENDING' ? 'Submitted — awaiting review'
      : status === 'VERIFIED' ? 'Verified'
        : status === 'REJECTED' ? 'Rejected — replacement required'
          : status;
  }

  statusClass(status: string): string {
    return `status-${status.toLowerCase().replaceAll('_', '-')}`;
  }
}
