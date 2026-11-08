import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, finalize, forkJoin, Observable, of, switchMap } from 'rxjs';
import { AuthService } from './auth.service';
import { DocumentStorageService, DocumentViewUrl } from './document-storage.service';
import { LoanOpsApiService } from './loanops-api.service';
import { compareDecimalValues, formatBwp, multiplyDecimalByRatio, sumDecimalValues } from './money';
import { animatePortal } from './portal-motion';
import { ThemeService } from './theme.service';
import { AdminCustomer, AdminDashboardSummary, AdminLoan, Application, ApplicationStatus, DecimalValue, PaymentVerificationResult } from './models';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <main class="login-page admin-login">
      <div class="theme-control"><button class="icon-button" type="button" (click)="theme.toggle()" aria-label="Toggle theme">{{ theme.theme() === 'dark' ? '☼' : '◐' }}</button></div>
      <section class="login-card admin-welcome">
        <div class="brand-mark welcome-brand" data-motion="brand"><span class="brand-glyph">PJ</span><span>loans</span><small>OPERATIONS</small></div>
        <p class="eyebrow">Administration</p>
        <h1 data-motion="copy">A sharper view of <span>every move.</span></h1>
        <p class="muted">Review borrower applications, verify document metadata and manage approved loan disbursements.</p>
        <div class="admin-login-note" data-motion="copy">
          <strong>{{ api.mode === 'demo' ? 'Private workspace' : 'Administrator sign-in' }}</strong>
          <p>{{ api.mode === 'demo' ? 'Admin interface is a separate development application. Authentication is not enabled in this demo.' : 'Sign in with an active administrator account. Borrower accounts cannot access this portal.' }}</p>
        </div>
        <a *ngIf="api.mode === 'demo'" routerLink="/dashboard" class="btn button primary-button welcome-cta" data-motion="copy">Login <span aria-hidden="true">→</span></a>
        <ng-container *ngIf="api.mode !== 'demo'">
          <form *ngIf="!passwordSetupMode; else passwordSetupRequest" class="auth-form" (ngSubmit)="login()" #adminSignInForm="ngForm" novalidate>
            <label><span>Email address</span><input type="email" name="email" [(ngModel)]="email" required email autocomplete="username" inputmode="email"></label>
            <label><span>Password</span><input type="password" name="password" [(ngModel)]="password" required autocomplete="current-password"></label>
            <p class="auth-error" *ngIf="error() || auth.authError()" role="alert">{{ error() || auth.authError() }}</p>
            <button type="submit" class="button primary-button welcome-cta" [disabled]="auth.loading() || !auth.configured || !adminSignInForm.form.valid">{{ auth.loading() ? 'Signing in…' : 'Sign in' }}</button>
            <button class="text-button" type="button" (click)="openPasswordSetup()">Create or reset your password</button>
          </form>
          <ng-template #passwordSetupRequest>
            <form class="auth-form" (ngSubmit)="requestPasswordSetup()" #passwordSetupRequestForm="ngForm" novalidate>
              <p class="muted">Enter the email address your developer invited. We’ll send a secure link to verify the inbox before you create your password.</p>
              <label><span>Admin email address</span><input type="email" name="setupEmail" [(ngModel)]="email" required email autocomplete="email" inputmode="email"></label>
              <p *ngIf="error()" class="auth-error" role="alert">{{ error() }}</p>
              <p *ngIf="setupMessage()" class="success-message" role="status" aria-live="polite">{{ setupMessage() }}</p>
              <button type="submit" class="button primary-button welcome-cta" [disabled]="auth.loading() || !auth.configured || !passwordSetupRequestForm.form.valid">{{ auth.loading() ? 'Sending email…' : 'Email me a password setup link' }}</button>
              <button class="text-button" type="button" (click)="passwordSetupMode = false; error.set(''); setupMessage.set('')">Back to sign in</button>
            </form>
          </ng-template>
        </ng-container>
        <p class="demo-label" *ngIf="api.mode === 'demo'">DEMO MODE — Authentication disabled</p>
        <p class="demo-label" *ngIf="api.mode !== 'demo'">Access requires an active ADMIN role and account status.</p>
        <p class="small-note" data-motion="copy" *ngIf="api.mode === 'demo'">Do not connect this unauthenticated demonstration to real borrower records.</p>
      </section>
      <div class="admin-login-art" aria-hidden="true"><span class="admin-art-ring ring-a" data-ambient-orbit></span><span class="admin-art-ring ring-b"></span><span class="admin-art-node node-a" data-ambient-float></span><span class="admin-art-node node-b" data-ambient-float></span><span class="admin-art-line"></span></div>
    </main>
  `,
})
export class AdminLogin implements OnInit, AfterViewInit, OnDestroy {
  readonly theme = inject(ThemeService);
  readonly api = inject(LoanOpsApiService);
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly element = inject(ElementRef<HTMLElement>);
  readonly error = signal('');
  readonly setupMessage = signal('');
  email = '';
  password = '';
  passwordSetupMode = false;
  private cleanupMotion?: () => void;

  async login(): Promise<void> {
    this.error.set('');
    try {
      await this.auth.signInAsAdmin(this.email, this.password);
      await this.router.navigateByUrl('/dashboard');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Administrator sign-in could not be completed.');
    }
  }

  openPasswordSetup(): void {
    this.error.set('');
    this.setupMessage.set('');
    this.passwordSetupMode = true;
  }

  async requestPasswordSetup(): Promise<void> {
    this.error.set('');
    this.setupMessage.set('');
    try {
      await this.auth.requestAdminPasswordSetup(this.email);
      this.setupMessage.set(
        'If an Admin account exists for this email, a secure password setup link will be sent. Open that link to verify your email and choose your password.',
      );
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'We could not process that request. Please try again.');
    }
  }

  async ngOnInit(): Promise<void> {
    if (this.route.snapshot.queryParamMap.get('passwordSetup') === 'true') {
      this.passwordSetupMode = true;
    }
    if (this.auth.hasAdminInvitationCallback()) {
      await this.router.navigateByUrl('/auth/callback', { replaceUrl: true });
    }
  }

  ngAfterViewInit(): void {
    this.cleanupMotion = animatePortal(this.element.nativeElement, 'welcome');
  }

  ngOnDestroy(): void {
    this.cleanupMotion?.();
  }

}

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <main class="login-page admin-login">
      <section class="login-card admin-welcome">
        <div class="brand-mark welcome-brand"><span class="brand-glyph">PJ</span><span>loans</span><small>OPERATIONS</small></div>
        <p class="eyebrow">Admin password setup</p>
        <h1>{{ error() ? 'Password setup link could not be verified' : 'Verifying your secure link' }}</h1>
        <p *ngIf="!error()" class="muted" role="status" aria-live="polite">Checking your one-time email link with Supabase Auth and confirming your Admin access…</p>
        <p *ngIf="error()" class="auth-error" role="alert">{{ error() }}</p>
        <a *ngIf="error()" routerLink="/login" class="button primary-button welcome-cta">Return to Admin sign in</a>
      </section>
    </main>
  `,
})
export class AdminAuthCallback implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly error = signal('');

  ngOnInit(): void {
    if (this.route.snapshot.queryParamMap.has('reason')) {
      this.error.set('Open the secure password setup link sent to your Admin email. If it has expired or was already used, return to sign in and request a new link.');
      this.auth.clearAdminAuthCallbackUrl();
      return;
    }
    void this.processInvitation();
  }

  async processInvitation(): Promise<void> {
    try {
      await this.auth.acceptAdminPasswordLink();
      await this.router.navigateByUrl('/admin/setup-password', { replaceUrl: true });
    } catch (error) {
      this.error.set(error instanceof Error
        ? error.message
        : 'This password setup link could not be verified. Return to Admin sign in and request a new link.');
    } finally {
      this.auth.clearAdminAuthCallbackUrl();
    }
  }
}

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <main class="login-page admin-login">
      <div class="theme-control"><button class="icon-button" type="button" (click)="theme.toggle()" aria-label="Toggle theme">{{ theme.theme() === 'dark' ? '☼' : '◐' }}</button></div>
      <section class="login-card admin-welcome">
        <div class="brand-mark welcome-brand"><span class="brand-glyph">PJ</span><span>loans</span><small>OPERATIONS</small></div>
        <p class="eyebrow">Admin account setup</p>
        <h1>Create your <span>password.</span></h1>
        <p class="muted">Choose a password for the Admin account confirmed by your secure email link.</p>
        <form class="auth-form" (ngSubmit)="savePassword()" #setupForm="ngForm" novalidate>
          <label>
            <span>Password</span>
            <span class="password-input-row">
              <input [type]="showPassword ? 'text' : 'password'" name="password" [(ngModel)]="password" required autocomplete="new-password">
              <button class="secondary-button password-visibility" type="button" (click)="showPassword = !showPassword" [attr.aria-label]="showPassword ? 'Hide password' : 'Show password'" [attr.aria-pressed]="showPassword">{{ showPassword ? 'Hide' : 'Show' }}</button>
            </span>
          </label>
          <label>
            <span>Confirm password</span>
            <span class="password-input-row">
              <input [type]="showConfirmPassword ? 'text' : 'password'" name="confirmPassword" [(ngModel)]="confirmPassword" required autocomplete="new-password">
              <button class="secondary-button password-visibility" type="button" (click)="showConfirmPassword = !showConfirmPassword" [attr.aria-label]="showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'" [attr.aria-pressed]="showConfirmPassword">{{ showConfirmPassword ? 'Hide' : 'Show' }}</button>
            </span>
          </label>
          <p *ngIf="confirmPassword && password !== confirmPassword" class="auth-error" role="alert">The passwords do not match.</p>
          <p class="small-note">Supabase will enforce this project’s configured password requirements.</p>
          <p *ngIf="error()" class="auth-error" role="alert">{{ error() }}</p>
          <p *ngIf="success()" class="success-message" role="status" aria-live="polite">{{ success() }}</p>
          <button type="submit" class="button primary-button welcome-cta" [disabled]="saving() || auth.loading() || !auth.configured || !setupForm.form.valid || password !== confirmPassword">{{ saving() || auth.loading() ? 'Saving password…' : 'Create password' }}</button>
        </form>
        <a routerLink="/login" class="text-button">Return to Admin sign in</a>
      </section>
    </main>
  `,
})
export class AdminPasswordSetup {
  readonly theme = inject(ThemeService);
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly error = signal('');
  readonly success = signal('');
  readonly saving = signal(false);
  password = '';
  confirmPassword = '';
  showPassword = false;
  showConfirmPassword = false;

  async savePassword(): Promise<void> {
    this.error.set('');
    this.success.set('');
    if (!this.password || this.password !== this.confirmPassword) {
      this.error.set(this.password ? 'The passwords do not match.' : 'Enter and confirm your new password.');
      return;
    }

    this.saving.set(true);
    try {
      await this.auth.requireAdminPasswordSetupSession();
      await this.auth.updatePassword(this.password);
      await this.auth.refreshAdminSession();
      await this.auth.completeAdminPasswordSetup();
      this.password = '';
      this.confirmPassword = '';
      this.success.set('Your password has been created. You are being taken to the Admin Portal.');
      await new Promise((resolve) => setTimeout(resolve, 700));
      await this.router.navigateByUrl('/dashboard', { replaceUrl: true });
    } catch (error) {
      this.error.set(error instanceof Error
        ? error.message
        : 'We could not set your password. Please try again or request a fresh invitation.');
    } finally {
      this.saving.set(false);
    }
  }
}

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <main class="portal-page admin-portal">
      <div class="portal-atmosphere" aria-hidden="true"><span class="atmosphere-glow glow-amber"></span><span class="atmosphere-glow glow-green" data-ambient-float></span><svg class="atmosphere-orbit" viewBox="0 0 480 480" data-ambient-orbit><circle cx="240" cy="240" r="210"/><circle cx="240" cy="240" r="160"/></svg></div>
      <header class="topbar">
        <a class="brand-mark compact" href="/dashboard"><span class="brand-glyph">PJ</span><span>loans</span><small>ADMIN</small></a>
        <nav class="portal-nav" aria-label="Admin navigation">
          <button type="button" [class.current]="section() === 'overview'" (click)="section.set('overview')">Overview</button>
          <button type="button" [class.current]="section() === 'applications'" (click)="section.set('applications')">Applications</button>
          <button type="button" [class.current]="section() === 'documents'" (click)="openDocuments()">Documents</button>
          <button type="button" [class.current]="section() === 'loans'" (click)="section.set('loans')">Loans</button>
          <button type="button" [class.current]="section() === 'customers'" (click)="section.set('customers')">Customers</button>
        </nav>
        <div class="topbar-actions"><span class="demo-badge">{{ api.mode === 'demo' ? 'DEMO DATA' : 'LIVE DATA' }}</span><button *ngIf="api.mode !== 'demo'" class="button secondary-button" type="button" (click)="logout()">Sign out</button><button class="icon-button" type="button" (click)="theme.toggle()" aria-label="Toggle theme">{{ theme.theme() === 'dark' ? '☼' : '◐' }}</button></div>
      </header>
      <div class="demo-banner" *ngIf="api.mode === 'demo'">DEMO DATA — Not connected to the live backend</div>
      <div class="page-content">
        <div class="page-heading"><div><p class="eyebrow">Admin workspace</p><h1>{{ heading() }}</h1><p class="muted">{{ api.mode === 'demo' ? 'Fictional demo data only. Backend actions are not connected to verified RPC contracts.' : 'Administrator access is checked against the signed-in account role. Each deployed operation has its own request and availability state.' }}</p></div></div>
        <div class="notice-card" *ngIf="message()"><span class="notice-icon">i</span><p>{{ message() }}</p></div>
        <ng-container [ngSwitch]="section()">
          <section *ngSwitchCase="'overview'" animate.enter="view-enter">
            <div class="metric-grid">
              <article class="metric-card metric-feature" animate.enter="field-enter"><span>In progress</span><strong>{{ api.mode === 'demo' ? count('IN_PROGRESS') : dashboardSummary()?.applicationsInProgress ?? '—' }}</strong><i class="metric-mark mark-green"></i></article>
              <article class="metric-card" animate.enter="field-enter"><span>Awaiting review</span><strong>{{ api.mode === 'demo' ? count('SUBMITTED') : dashboardSummary()?.applicationsAwaitingReview ?? '—' }}</strong><i class="metric-mark mark-amber"></i></article>
              <article class="metric-card" animate.enter="field-enter"><span>Awaiting disbursement</span><strong>{{ api.mode === 'demo' ? count('APPROVED') : dashboardSummary()?.approvedAwaitingDisbursement ?? '—' }}</strong><i class="metric-mark mark-pink"></i></article>
              <article class="metric-card" animate.enter="field-enter"><span>Active loans</span><strong>{{ api.mode === 'demo' ? api.data().loans.length : dashboardSummary()?.activeLoans ?? '—' }}</strong><i class="metric-mark mark-orange"></i></article>
              <article class="metric-card" animate.enter="field-enter"><span>Documents pending</span><strong>{{ api.mode === 'demo' ? pendingDocuments() : dashboardSummary()?.documentsPendingReview ?? '—' }}</strong><i class="metric-mark mark-yellow"></i></article>
              <article class="metric-card metric-wide" animate.enter="field-enter"><span>Total outstanding</span><strong>{{ api.mode === 'demo' ? money(outstanding()) : dashboardSummary() ? money(dashboardSummary()!.totalOutstandingBalance) : '—' }}</strong><i class="metric-mark mark-amber"></i></article>
            </div>
            <div class="two-columns">
              <article class="surface-card review-queue"><p class="eyebrow">Review queue</p><h2>Submitted applications</h2><p class="loading-state" *ngIf="api.isLoading('admin_submitted_queue')" role="status">Loading submitted applications…</p><div class="error-card" *ngIf="api.featureState('admin_submitted_queue').request === 'error'" role="alert"><p>{{ api.featureState('admin_submitted_queue').error }}</p><button class="button secondary-button" type="button" (click)="reloadSubmitted()">Retry submitted queue</button></div><p class="muted" *ngIf="!api.isLoading('admin_submitted_queue') && api.featureState('admin_submitted_queue').request === 'empty'">No applications are waiting for review.</p><button class="queue-item" type="button" *ngFor="let app of applications('SUBMITTED')" animate.enter="field-enter" (click)="selectApplication(app); section.set('applications')"><strong>{{ app.applicationNumber }}</strong><span>{{ customerName(app.customerId) }} · {{ money(app.requestedAmount) }}</span></button><h2>Needs correction</h2><p class="loading-state" *ngIf="api.isLoading('admin_correction_queue')" role="status">Loading correction applications…</p><div class="error-card" *ngIf="api.featureState('admin_correction_queue').request === 'error'" role="alert"><p>{{ api.featureState('admin_correction_queue').error }}</p><button class="button secondary-button" type="button" (click)="reloadNeedsCorrection()">Retry correction queue</button></div><p class="muted" *ngIf="!api.isLoading('admin_correction_queue') && api.featureState('admin_correction_queue').request === 'empty'">No applications need correction.</p><button class="queue-item" type="button" *ngFor="let app of applications('NEEDS_CORRECTION')" animate.enter="field-enter" (click)="selectApplication(app); section.set('applications')"><strong>{{ app.applicationNumber }}</strong><span>{{ customerName(app.customerId) }} · {{ money(app.requestedAmount) }}</span></button><h2>Approved, awaiting disbursement</h2><p class="loading-state" *ngIf="api.isLoading('admin_approved_queue')" role="status">Loading approved applications…</p><div class="error-card" *ngIf="api.featureState('admin_approved_queue').request === 'error'" role="alert"><p>{{ api.featureState('admin_approved_queue').error }}</p><button class="button secondary-button" type="button" (click)="reloadApproved()">Retry approved queue</button></div><p class="muted" *ngIf="!api.isLoading('admin_approved_queue') && api.featureState('admin_approved_queue').request === 'empty'">No approved applications are awaiting disbursement.</p><button class="queue-item" type="button" *ngFor="let app of applications('APPROVED')" animate.enter="field-enter" (click)="selectApplication(app); section.set('applications')"><strong>{{ app.applicationNumber }}</strong><span>{{ customerName(app.customerId) }} · {{ money(app.approvedAmount ?? app.requestedAmount) }}</span></button></article>
              <article class="surface-card recent-activity"><p class="eyebrow">Recent activity</p><h2>Latest records</h2><p *ngFor="let app of recentApplications()" animate.enter="field-enter"><strong>{{ app.applicationNumber }}</strong> <span class="muted">· {{ app.status }} · {{ app.createdAt | date:'mediumDate' }}</span></p></article>
            </div>
          </section>

          <section *ngSwitchCase="'applications'" class="admin-columns" animate.enter="view-enter">
            <div class="surface-card">
              <div class="filters"><input [(ngModel)]="search" (ngModelChange)="visibleLimit = 10" placeholder="Search reference or borrower" aria-label="Search applications"><select [(ngModel)]="statusFilter" (ngModelChange)="visibleLimit = 10" aria-label="Filter by status"><option value="ALL">All statuses</option><option value="IN_PROGRESS">In progress</option><option value="SUBMITTED">Submitted</option><option value="NEEDS_CORRECTION">Needs correction</option><option value="APPROVED">Approved</option><option value="DISBURSED">Disbursed</option><option value="REJECTED">Rejected</option><option value="CANCELLED">Cancelled</option></select><select [(ngModel)]="categoryFilter" (ngModelChange)="visibleLimit = 10" aria-label="Filter by borrower category"><option value="ALL">All categories</option><option value="STUDENT">Student</option><option value="EMPLOYED">Employed</option><option value="UNEMPLOYED">Unemployed</option></select><select [(ngModel)]="sortBy" (ngModelChange)="visibleLimit = 10" aria-label="Sort applications"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="amount-desc">Requested amount: high to low</option><option value="amount-asc">Requested amount: low to high</option></select></div>
              <p class="loading-state" *ngIf="api.isLoading('admin_in_progress_queue') || api.isLoading('admin_submitted_queue') || api.isLoading('admin_correction_queue') || api.isLoading('admin_approved_queue')" role="status">Loading application queues…</p>
              <div class="error-card" *ngIf="api.featureState('admin_in_progress_queue').request === 'error'" role="alert"><strong>In-progress queue unavailable</strong><p>{{ api.featureState('admin_in_progress_queue').error }}</p><button class="button secondary-button" type="button" (click)="reloadInProgress()">Retry in-progress queue</button></div>
              <div class="error-card" *ngIf="api.featureState('admin_submitted_queue').request === 'error'" role="alert"><strong>Submitted queue unavailable</strong><p>{{ api.featureState('admin_submitted_queue').error }}</p><button class="button secondary-button" type="button" (click)="reloadSubmitted()">Retry submitted queue</button></div>
              <div class="error-card" *ngIf="api.featureState('admin_correction_queue').request === 'error'" role="alert"><strong>Correction queue unavailable</strong><p>{{ api.featureState('admin_correction_queue').error }}</p><button class="button secondary-button" type="button" (click)="reloadNeedsCorrection()">Retry correction queue</button></div>
              <div class="error-card" *ngIf="api.featureState('admin_approved_queue').request === 'error'" role="alert"><strong>Approved queue unavailable</strong><p>{{ api.featureState('admin_approved_queue').error }}</p><button class="button secondary-button" type="button" (click)="reloadApproved()">Retry approved queue</button></div>
              <div class="application-list">
                <button type="button" class="application-row" *ngFor="let app of visibleApplications()" [class.selected]="selected()?.id === app.id" (click)="selectApplication(app)">
                  <span class="row-top"><strong>{{ app.applicationNumber }}</strong><span class="status-chip" [ngClass]="statusClass(app.status)">{{ app.status }}</span></span>
                  <span>{{ customerName(app.customerId) }} · {{ app.borrowerType }}</span><span>{{ money(app.requestedAmount) }} · {{ app.currentStep }}</span>
                </button>
                <p class="empty-card" *ngIf="filteredApplications().length === 0 && (api.mode === 'demo' || ((api.featureState('admin_in_progress_queue').request === 'empty' || api.featureState('admin_in_progress_queue').request === 'success') && (api.featureState('admin_submitted_queue').request === 'empty' || api.featureState('admin_submitted_queue').request === 'success') && (api.featureState('admin_approved_queue').request === 'empty' || api.featureState('admin_approved_queue').request === 'success')))">No matching applications.</p>
              </div>
              <button class="button secondary-button" type="button" *ngIf="visibleLimit < filteredApplications().length" (click)="visibleLimit = visibleLimit + 10">Load more applications</button>
              <p class="muted" *ngIf="filteredApplications().length">Showing {{ visibleApplications().length }} of {{ filteredApplications().length }} applications</p>
            </div>
            <aside class="surface-card detail-drawer" *ngIf="selected() as app; else selectPrompt" animate.enter="drawer-enter">
              <p class="eyebrow">Application details</p><h2>{{ app.applicationNumber }}</h2>
              <dl class="detail-list"><div><dt>Borrower</dt><dd>{{ customerName(app.customerId) }}</dd></div><div><dt>Phone</dt><dd>{{ customerPhone(app.customerId) }}</dd></div><div><dt>Category</dt><dd>{{ app.borrowerType }}</dd></div><div><dt>Requested</dt><dd>{{ money(app.requestedAmount) }}</dd></div><div><dt>Status</dt><dd>{{ app.status }}</dd></div><div><dt>Step</dt><dd>{{ app.currentStep }}</dd></div><div><dt>Receiving</dt><dd>{{ app.receivingMethod }}</dd></div><div><dt>Recipient</dt><dd>{{ app.recipientName }}</dd></div><div><dt>Submitted</dt><dd>{{ app.submittedAt ? (app.submittedAt | date:'mediumDate') : 'Not submitted' }}</dd></div></dl>
              <div class="form-stack" *ngIf="app.status === 'IN_PROGRESS' || app.status === 'SUBMITTED' || app.status === 'NEEDS_CORRECTION' || app.status === 'REJECTED'" animate.enter="drawer-enter">
                <h3>Application documents</h3>
                <div class="document-review-row" *ngFor="let doc of applicationDocuments(app.id)" animate.enter="field-enter">
                  <div>
                    <h4>{{ doc.documentType }}</h4>
                    <p>{{ doc.fileName || 'Filename unavailable' }}</p>
                    <p class="muted">{{ doc.createdAt | date:'mediumDate' }}</p>
                    <p class="rejection-note" *ngIf="doc.reviewNote">{{ doc.reviewNote }}</p>
                    <span class="status-chip" [ngClass]="statusClass(doc.status)">{{ doc.status }}</span>
                  </div>
                  <div class="review-actions">
                    <label>Review note<input [(ngModel)]="reviewNotes[doc.id]" placeholder="Reason / review note"></label>
                    <button class="button primary-button" type="button" [disabled]="doc.status !== 'PENDING' || api.isLoading('document_review')" (click)="review(doc.id, 'VERIFIED')">Verify</button>
                    <button class="button danger-button" type="button" [disabled]="doc.status !== 'PENDING' || api.isLoading('document_review')" (click)="review(doc.id, 'REJECTED')">Reject</button>
                  </div>
                </div>
                <p class="empty-card" *ngIf="applicationDocuments(app.id).length === 0">No documents have been uploaded for this application yet.</p>
              </div>
              <div class="form-stack" *ngIf="app.status === 'SUBMITTED'" animate.enter="drawer-enter"><label>Approved principal (BWP)<input type="text" inputmode="decimal" pattern="^[0-9]+([.][0-9]{1,2})?$" [(ngModel)]="approvedAmount"></label><div class="approval-preview"><div><span>Flat interest addition</span><strong>{{ money(interest(approvedAmount)) }}</strong></div><div><span>Total repayable</span><strong>{{ money(totalWithInterest(approvedAmount)) }}</strong></div></div><p class="muted" *ngIf="compareAmounts(approvedAmount, app.requestedAmount) !== 0">Approved amount differs from the requested {{ money(app.requestedAmount) }}.</p><label class="checkbox-line"><input type="checkbox" [(ngModel)]="approvalConfirmed"><span>I confirm this application and principal amount for approval.</span></label><p class="error-message" *ngIf="api.featureState('admin_approval').request === 'error'" role="alert">{{ api.featureState('admin_approval').error }}</p><button type="button" class="button primary-button" [disabled]="api.isLoading('admin_approval') || !approvalConfirmed || !validPositiveAmount(approvedAmount)" (click)="approve(app)">{{ api.isLoading('admin_approval') ? 'Confirming…' : 'Approve application' }}</button></div>
              <div class="form-stack" *ngIf="app.status === 'APPROVED'" animate.enter="drawer-enter"><p class="inline-warning">Manual transfer only: send funds separately through the approved receiving method first. This action only records the completed transfer; it does not move money.</p><label>Due date<input type="date" [(ngModel)]="dueDate"></label><label>Disbursement reference<input [(ngModel)]="reference" placeholder="Bank transfer reference"></label><label>Transfer proof screenshot<input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" (change)="selectDisbursementProof($event)"></label><p class="muted" *ngIf="disbursementProof">{{ disbursementProof.name }}</p><div class="confirmation-card"><strong>Disbursement confirmation</strong><div class="money-emphasis"><span>Principal to disburse</span><b>{{ money(app.approvedAmount || 0) }}</b></div><p>Flat 30% addition: <strong>{{ money(interest(app.approvedAmount || 0)) }}</strong></p><p>Total repayable: <strong>{{ money(totalWithInterest(app.approvedAmount || 0)) }}</strong></p><p>Receiving: {{ app.receivingMethod }} · {{ app.recipientName }}</p><p>Due date: {{ dueDate || 'Select due date' }}</p><p>Reference: {{ reference || 'Enter reference' }}</p></div><p class="error-message" *ngIf="api.featureState('admin_disbursement').request === 'error'" role="alert">{{ api.featureState('admin_disbursement').error }}</p><button type="button" class="button primary-button" [disabled]="api.isLoading('admin_disbursement') || disbursementProofUploading || !dueDate || !reference || !disbursementProof" (click)="disburse(app)">{{ disbursementProofUploading ? 'Uploading proof…' : api.isLoading('admin_disbursement') ? 'Recording…' : 'Record completed disbursement' }}</button></div>
              <p class="inline-warning" *ngIf="app.status === 'IN_PROGRESS'">This application has not been submitted and is not ready for approval.</p>
              <p class="muted">The Admin reviews the submitted application and its documents together. Any rejected document sends the application back to the borrower with the review note for correction.</p>
            </aside>
            <ng-template #selectPrompt><aside class="surface-card empty-card">Select an application to inspect its details.</aside></ng-template>
          </section>

          <section *ngSwitchCase="'documents'" animate.enter="view-enter">
            <div class="filters"><select [(ngModel)]="documentFilter" aria-label="Filter documents by review status"><option value="ALL">All review states</option><option value="PENDING">Pending</option><option value="VERIFIED">Verified</option><option value="REJECTED">Rejected</option></select><button class="button secondary-button" type="button" (click)="reloadDocuments()" [disabled]="api.isLoading('document_listing')">Refresh documents</button></div>
            <p class="loading-state" *ngIf="api.isLoading('document_listing')" role="status">Loading application documents…</p>
            <div class="error-card" *ngIf="api.featureState('document_listing').request === 'error'" role="alert"><p>{{ api.featureState('document_listing').error }}</p><button class="button secondary-button" type="button" (click)="reloadDocuments()">Retry document listing</button></div>
            <div class="error-card" *ngIf="api.featureState('document_review').request === 'error'" role="alert"><p>{{ api.featureState('document_review').error }}</p></div>
            <p class="inline-warning" *ngIf="api.mode === 'api' && (api.featureState('admin_in_progress_queue').request === 'error' || api.featureState('admin_submitted_queue').request === 'error' || api.featureState('admin_approved_queue').request === 'error')">Some application queues could not be loaded. The document list may cover only applications from queues that are available.</p>
            <article class="surface-card">
              <div class="document-review-row" *ngFor="let doc of filteredDocuments()" animate.enter="field-enter"><div><p class="eyebrow">{{ appNumber(doc.applicationId) }} · {{ customerName(applicationCustomerId(doc.applicationId)) }}</p><h2>{{ doc.documentType }}</h2><p>{{ doc.fileName || (api.mode === 'demo' ? 'Metadata only; no stored file' : 'Filename unavailable') }}</p><p class="muted">{{ doc.createdAt | date:'mediumDate' }}</p><p class="rejection-note" *ngIf="doc.reviewNote">{{ doc.reviewNote }}</p><span class="status-chip" [ngClass]="statusClass(doc.status)">{{ documentStatusLabel(doc.status) }}</span><div class="upload-feedback" *ngIf="documentDownloadStates()[doc.id]?.error" role="alert">{{ documentDownloadStates()[doc.id]?.error }}</div></div><div class="review-actions"><button class="button secondary-button" type="button" *ngIf="api.mode === 'api'" [disabled]="documentDownloadStates()[doc.id]?.loading" (click)="openDocument(doc.id)">{{ documentDownloadStates()[doc.id]?.loading ? 'Preparing secure preview…' : 'Preview document securely' }}</button><span class="muted" *ngIf="api.mode === 'demo'">No stored demo file</span><label>Review note<input [(ngModel)]="reviewNotes[doc.id]" [placeholder]="doc.status === 'PENDING' ? 'Reason required to reject / optional note to accept' : 'Review note'"></label><button class="button primary-button" type="button" [disabled]="doc.status !== 'PENDING' || api.isLoading('document_review')" (click)="review(doc.id, 'VERIFIED')">Accept</button><button class="button danger-button" type="button" [disabled]="doc.status !== 'PENDING' || api.isLoading('document_review')" (click)="review(doc.id, 'REJECTED')">Reject</button></div></div>
              <p class="empty-card" *ngIf="filteredDocuments().length === 0 && (api.mode === 'demo' || api.featureState('document_listing').request === 'empty' || api.featureState('document_listing').request === 'success')">No document records match this filter.</p>
            </article>
            <div class="document-preview-dialog" *ngIf="documentPreview() || documentPreviewLoading() || documentPreviewError()" role="dialog" aria-modal="true" aria-label="Secure document preview">
              <button class="document-preview-backdrop" type="button" aria-label="Close document preview" (click)="closeDocumentPreview()"></button>
              <div class="surface-card document-preview-panel">
                <div class="document-preview-header"><div><p class="eyebrow">Secure preview</p><h2>{{ documentPreview()?.filename || 'Document' }}</h2></div><button class="icon-button" type="button" aria-label="Close preview" (click)="closeDocumentPreview()">×</button></div>
                <p class="loading-state" *ngIf="documentPreviewLoading()">Preparing secure preview…</p>
                <div class="error-card" *ngIf="documentPreviewError()" role="alert"><p>{{ documentPreviewError() }}</p><button class="button secondary-button" type="button" (click)="retryDocumentPreview()">Retry</button></div>
                <iframe *ngIf="documentPreview()?.url" class="document-preview-frame" [src]="safeDocumentPreviewUrl(documentPreview()?.url)" [title]="documentPreview()?.filename || 'Document preview'"></iframe>
              </div>
            </div>
            <form class="form-stack surface-card" *ngIf="api.mode === 'api' && (api.featureState('document_listing').availability !== 'available' || api.featureState('document_listing').request === 'error')" (ngSubmit)="reviewDocumentById()"><h2>Review a known document</h2><p class="muted">Document listing is unavailable. If you have a document ID from a trusted source, the independent review operation can still be used.</p><label>Document ID<input name="documentId" inputmode="numeric" [(ngModel)]="reviewDocumentId" required></label><label>Decision<select name="documentDecision" [(ngModel)]="reviewDecision"><option value="VERIFIED">Verify</option><option value="REJECTED">Reject</option></select></label><label>Review note<input name="manualReviewNote" [(ngModel)]="manualReviewNote"></label><button class="button primary-button" type="submit" [disabled]="api.isLoading('document_review')">{{ api.isLoading('document_review') ? 'Saving review…' : 'Save review decision' }}</button></form>
          </section>

          <section *ngSwitchCase="'loans'" animate.enter="view-enter">
            <article class="surface-card" *ngIf="api.mode === 'demo'; else liveLoans"><div class="responsive-table"><table><thead><tr><th>Loan / application</th><th>Borrower</th><th>Principal</th><th>Interest</th><th>Total due</th><th>Paid</th><th>Outstanding</th><th>Due</th><th>Status</th></tr></thead><tbody><tr *ngFor="let loan of api.data().loans"><td>{{ loan.id }} / {{ appNumber(loan.applicationId) }}</td><td>{{ customerName(applicationCustomerId(loan.applicationId)) }}</td><td>{{ money(loan.principal) }}</td><td>{{ money(loan.interestAmount) }} ({{ loan.interestRate }}%)</td><td>{{ money(loan.totalDue) }}</td><td>{{ money(loan.amountPaid ?? 0) }}</td><td>{{ money(loan.outstandingAmount) }}</td><td>{{ loan.dueDate | date:'mediumDate' }}</td><td>{{ loan.status }}</td></tr></tbody></table></div><p class="empty-card" *ngIf="api.data().loans.length === 0">No demo loan records are available.</p></article>
            <ng-template #liveLoans><article class="surface-card"><button class="button secondary-button" type="button" (click)="reloadLoans()">Refresh loans</button><div class="responsive-table"><table><thead><tr><th>Loan / application</th><th>Borrower</th><th>Principal</th><th>Interest</th><th>Total repayable</th><th>Paid</th><th>Outstanding</th><th>Due</th><th>Status</th><th>Disbursement</th></tr></thead><tbody><tr *ngFor="let loan of adminLoans()"><td>{{ loan.loanId }} / {{ loan.applicationReference }}</td><td>{{ loan.borrowerName }}</td><td>{{ money(loan.approvedPrincipal) }}</td><td>{{ money(loan.interestAmount) }}</td><td>{{ money(loan.totalRepayable) }}</td><td>{{ money(loan.amountPaid) }}</td><td>{{ money(loan.outstandingBalance) }}</td><td>{{ loan.dueDate | date:'mediumDate' }}</td><td>{{ loan.loanStatus }}</td><td><span>{{ loan.disbursementReference }} · {{ loan.disbursedAt | date:'mediumDate' }}</span><button class="button secondary-button" type="button" [disabled]="disbursementProofDownloading" (click)="downloadDisbursementProof(loan.loanId)">View transfer proof</button></td></tr></tbody></table></div><p class="empty-card" *ngIf="!adminLoading() && adminLoans().length === 0">No loan records match the current loan book.</p></article></ng-template>
            <p class="inline-warning">Admin payment listing is {{ api.featureState('admin_payment_queue').availability === 'available' ? 'available' : 'pending backend work' }}. Only server-verified payments may change loan balances.</p>
            <form class="form-stack surface-card" *ngIf="api.mode === 'api'" (ngSubmit)="verifyPayment()"><h2>Verify a known payment</h2><p class="muted">The Admin payment queue is unavailable, but the verification operation remains available when you have a payment ID.</p><label>Payment ID<input name="paymentId" inputmode="numeric" [(ngModel)]="paymentId" required></label><p class="error-message" *ngIf="api.featureState('payment_verification').request === 'error'" role="alert">{{ api.featureState('payment_verification').error }}</p><button class="button primary-button" type="submit" [disabled]="api.isLoading('payment_verification') || !validPaymentId()">{{ api.isLoading('payment_verification') ? 'Verifying…' : 'Verify payment' }}</button><article class="confirmation-card" *ngIf="verifiedPayment() as result"><strong>Payment {{ result.paymentId }} · {{ result.paymentStatus }}</strong><p>Loan: {{ result.loanId }} · {{ result.loanStatus }}</p><p>Verified amount: {{ money(result.amount) }}</p><p>Amount paid: {{ money(result.loanAmountPaid) }} · Outstanding: {{ money(result.outstandingAmount) }}</p><p class="muted">These totals are the backend verification response; no unrelated Admin loan list is assumed.</p></article></form>
          </section>

          <section *ngSwitchCase="'customers'" animate.enter="view-enter">
            <div class="filters" *ngIf="api.mode === 'demo'"><input [(ngModel)]="customerSearch" placeholder="Search name or phone" aria-label="Search customers"></div>
            <article class="surface-card" *ngIf="api.mode === 'demo'; else liveCustomers"><div class="customer-row" *ngFor="let customer of filteredCustomers()"><div><strong>{{ customer.fullName }}</strong><p>{{ customer.phone }} · {{ customer.borrowerType || 'Category not set' }}</p></div><span>National ID {{ customer.nationalId || 'Not supplied' }}</span><span class="muted">Phone is a matching value, not identity verification.</span></div><p class="empty-card" *ngIf="filteredCustomers().length === 0">No demo customers match your search.</p></article>
            <ng-template #liveCustomers><article class="surface-card"><div class="filters"><input [(ngModel)]="customerSearch" (ngModelChange)="reloadCustomers()" placeholder="Search customer name or phone" aria-label="Search customers"><button class="button secondary-button" type="button" (click)="reloadCustomers()">Refresh</button></div><p class="loading-state" *ngIf="adminLoading()">Loading customers…</p><div class="customer-row" *ngFor="let customer of adminCustomers()"><div><strong>{{ customer.fullName || 'Name not supplied' }}</strong><p>{{ customer.phone }} · {{ customer.borrowerType }}</p></div><span>{{ customer.applicationCount ?? 0 }} applications · {{ customer.loanCount ?? 0 }} loans</span><span class="muted">Registered {{ customer.createdAt | date:'mediumDate' }}</span></div><p class="empty-card" *ngIf="!adminLoading() && adminCustomers().length === 0">No customers match your search.</p></article></ng-template>
          </section>
        </ng-container>
        <section class="planned-modules" aria-label="Planned admin modules"><h2>Planned modules</h2><span>Repayments</span><span>Payment verification</span><span>27th reminders</span><span>Sheets mirror</span><span>Audit history</span><span>Settings</span></section>
      </div>
    </main>
  `,
})
export class AdminPortal implements AfterViewInit, OnDestroy {
  private readonly element = inject(ElementRef<HTMLElement>);
  private readonly documentStorage = inject(DocumentStorageService);
  readonly api = inject(LoanOpsApiService);
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly theme = inject(ThemeService);
  readonly section = signal<'overview' | 'applications' | 'documents' | 'loans' | 'customers'>('overview');
  readonly selected = signal<Application | null>(null);
  readonly message = signal('');
  readonly verifiedPayment = signal<PaymentVerificationResult | null>(null);
  readonly documentDownloadStates = signal<Record<number, { loading: boolean; error?: string }>>({});
  readonly dashboardSummary = signal<AdminDashboardSummary | null>(null);
  readonly adminCustomers = signal<AdminCustomer[]>([]);
  readonly adminLoans = signal<AdminLoan[]>([]);
  readonly adminLoading = signal(false);
  readonly adminError = signal('');
  readonly documentPreview = signal<DocumentViewUrl | null>(null);
  readonly documentPreviewLoading = signal(false);
  readonly documentPreviewError = signal('');
  private readonly sanitizer = inject(DomSanitizer);
  private previewDocumentId: number | null = null;
  search = '';
  sortBy: 'newest' | 'oldest' | 'amount-desc' | 'amount-asc' = 'newest';
  visibleLimit = 10;
  customerSearch = '';
  statusFilter: ApplicationStatus | 'ALL' = 'ALL';
  categoryFilter = 'ALL';
  documentFilter = 'ALL';
  readonly reviewNotes: Record<number, string> = {};
  approvalConfirmed = false;
  approvedAmount: DecimalValue = '0';
  dueDate = '';
  reference = '';
  disbursementProof: File | null = null;
  disbursementProofUploading = false;
  disbursementProofDownloading = false;
  paymentId = '';
  reviewDocumentId = '';
  reviewDecision: 'VERIFIED' | 'REJECTED' = 'VERIFIED';
  manualReviewNote = '';
  private cleanupMotion?: () => void;

  constructor() {
    this.reload();
  }

  ngAfterViewInit(): void {
    this.cleanupMotion = animatePortal(this.element.nativeElement, 'admin');
  }

  ngOnDestroy(): void {
    this.cleanupMotion?.();
  }

  reload(): void {
    if (this.api.mode === 'demo') {
      this.api.loadApplications('admin').subscribe();
      return;
    }
    const loadAllApplications: Observable<unknown> = typeof this.api.loadAllAdminApplications === 'function'
      ? this.api.loadAllAdminApplications()
      : of([]);
    loadAllApplications.pipe(
      catchError(() => {
        this.reloadInProgress();
        this.reloadSubmitted();
        this.reloadNeedsCorrection();
        this.reloadApproved();
        return of([]);
      }),
      switchMap(() => this.api.loadAdminDocuments()),
    ).subscribe({ error: () => undefined });
    this.reloadDashboard();
    this.reloadCustomers();
    this.reloadLoans();
  }

  reloadDashboard(): void {
    if (this.api.mode !== 'api') return;
    if (typeof this.api.loadAdminDashboardSummary !== 'function') return;
    this.api.loadAdminDashboardSummary().subscribe({
      next: (summary) => this.dashboardSummary.set(summary),
      error: () => undefined,
    });
  }

  reloadCustomers(): void {
    if (this.api.mode !== 'api') return;
    if (typeof this.api.loadAdminCustomers !== 'function') return;
    this.adminLoading.set(true);
    this.api.loadAdminCustomers(this.customerSearch).subscribe({
      next: (customers) => {
        this.adminCustomers.set(customers);
        this.adminLoading.set(false);
      },
      error: () => this.adminLoading.set(false),
    });
  }

  reloadLoans(): void {
    if (this.api.mode !== 'api') return;
    if (typeof this.api.loadAdminLoans !== 'function') return;
    this.api.loadAdminLoans().subscribe({
      next: (loans) => this.adminLoans.set(loans),
      error: () => undefined,
    });
  }

  reloadInProgress(): void {
    this.api.loadAdminApplications('IN_PROGRESS').subscribe({ error: () => undefined });
  }

  reloadSubmitted(): void {
    this.api.loadAdminApplications('SUBMITTED').subscribe({ error: () => undefined });
  }

  reloadApproved(): void {
    this.api.loadAdminApplications('APPROVED').subscribe({ error: () => undefined });
  }

  reloadNeedsCorrection(): void {
    this.api.loadAdminApplications('NEEDS_CORRECTION').subscribe({ error: () => undefined });
  }

  openDocuments(): void {
    this.section.set('documents');
    this.reloadDocuments();
  }

  reloadDocuments(): void {
    if (this.api.mode === 'demo') {
      this.api.loadAdminDocuments().subscribe({ error: () => undefined });
      return;
    }
    forkJoin([
      this.api.loadAdminApplications('SUBMITTED').pipe(catchError(() => of([]))),
      this.api.loadAdminApplications('APPROVED').pipe(catchError(() => of([]))),
      this.api.loadAdminApplications('IN_PROGRESS').pipe(catchError(() => of([]))),
      this.api.loadAdminApplications('NEEDS_CORRECTION').pipe(catchError(() => of([]))),
    ]).pipe(switchMap(() => this.api.loadAdminDocuments()))
      .subscribe({ error: () => undefined });
  }

  openDocument(documentId: number): void {
    if (this.api.mode !== 'api') {
      this.message.set('Demo documents do not have private files to view.');
      return;
    }
    this.previewDocumentId = documentId;
    this.documentPreview.set(null);
    this.documentPreviewError.set('');
    this.documentPreviewLoading.set(true);
    this.documentDownloadStates.update((current) => ({
      ...current,
      [documentId]: { loading: true },
    }));
    this.documentStorage.getDocumentViewUrl(documentId).subscribe({
      next: (viewing) => {
        this.documentPreviewLoading.set(false);
        this.documentPreview.set(viewing);
        this.documentDownloadStates.update((current) => ({ ...current, [documentId]: { loading: false } }));
      },
      error: (error: unknown) => {
        this.documentPreviewLoading.set(false);
        this.documentPreviewError.set(error instanceof Error ? error.message : 'The document could not be opened.');
        this.documentDownloadStates.update((current) => ({
          ...current,
          [documentId]: {
            loading: false,
            error: error instanceof Error ? error.message : 'The document could not be opened.',
          },
        }));
      },
    });
  }

  retryDocumentPreview(): void {
    if (this.previewDocumentId !== null) this.openDocument(this.previewDocumentId);
  }

  closeDocumentPreview(): void {
    this.documentPreview.set(null);
    this.documentPreviewError.set('');
    this.previewDocumentId = null;
  }

  safeDocumentPreviewUrl(url: string | undefined): SafeResourceUrl | null {
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  }

  documentStatusLabel(status: string): string {
    return ({ PENDING: 'Pending review', VERIFIED: 'Accepted', REJECTED: 'Rejected' } as Record<string, string>)[status] ?? status;
  }

  async logout(): Promise<void> {
    try {
      await this.auth.signOut();
      await this.router.navigateByUrl('/login');
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : 'Unable to sign out.');
    }
  }

  heading(): string {
    return ({ overview: 'Operations overview', applications: 'Application management', documents: 'Document review', loans: 'Active loans', customers: 'Customer directory' } as const)[this.section()];
  }

  count(status: ApplicationStatus): number {
    return this.api.data().applications.filter((application) => application.status === status).length;
  }

  pendingDocuments(): number {
    return this.api.data().documents.filter((document) => document.status === 'PENDING').length;
  }

  outstanding(): string {
    return sumDecimalValues(this.api.data().loans.map((loan) => loan.outstandingAmount));
  }

  applications(status?: ApplicationStatus) {
    return status
      ? this.api.data().applications.filter((application) => application.status === status)
      : this.api.data().applications;
  }

  recentApplications() {
    return [...this.api.data().applications].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
  }

  filteredApplications() {
    const query = this.search.trim().toLowerCase();
    return this.api.data().applications.filter((app) => {
      const customer = this.api.data().customers.find((entry) => entry.id === app.customerId);
      const matchesQuery = !query || app.applicationNumber.toLowerCase().includes(query) || customer?.fullName.toLowerCase().includes(query);
      return matchesQuery && (this.statusFilter === 'ALL' || app.status === this.statusFilter) && (this.categoryFilter === 'ALL' || app.borrowerType === this.categoryFilter);
    }).sort((a, b) => {
      if (this.sortBy === 'oldest') return a.createdAt.localeCompare(b.createdAt);
      if (this.sortBy === 'amount-desc') return compareDecimalValues(b.requestedAmount, a.requestedAmount);
      if (this.sortBy === 'amount-asc') return compareDecimalValues(a.requestedAmount, b.requestedAmount);
      return b.createdAt.localeCompare(a.createdAt);
    });
  }

  visibleApplications() {
    return this.filteredApplications().slice(0, this.visibleLimit);
  }

  applicationDocuments(applicationId: number) {
    return [...this.api.data().documents]
      .filter((document) => document.applicationId === applicationId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  filteredDocuments() {
    return this.api.data().documents.filter((document) => this.documentFilter === 'ALL' || document.status === this.documentFilter);
  }

  filteredCustomers() {
    const query = this.customerSearch.trim().toLowerCase();
    return this.api.data().customers.filter((customer) => !query || customer.fullName.toLowerCase().includes(query) || customer.phone.includes(query));
  }

  selectApplication(app: Application): void {
    this.selected.set(app);
    this.approvedAmount = String(app.approvedAmount ?? app.requestedAmount);
    this.approvalConfirmed = false;
    this.message.set('');
  }

  approve(app: Application): void {
    if (!this.approvalConfirmed) {
      this.message.set('Confirm the approval decision before continuing.');
      return;
    }
    if (!this.validPositiveAmount(this.approvedAmount)) {
      this.message.set('Enter an approved principal greater than zero.');
      return;
    }
    this.api.approveApplication(app.id, this.approvedAmount).subscribe({
      next: (updated) => {
        this.selected.set(updated);
        if (this.api.mode === 'api') {
          this.reloadSubmitted();
          this.reloadApproved();
        }
        this.message.set(this.api.mode === 'demo'
          ? `Demo application ${updated.applicationNumber} approved in memory. No backend was contacted.`
          : `Application ${updated.applicationNumber} approved.`);
      },
      error: () => undefined,
    });
  }

  disburse(app: Application): void {
    if (this.api.mode !== 'demo' && !this.disbursementProof) {
      this.message.set('Attach the transfer proof screenshot before recording the disbursement.');
      return;
    }
    const proof = this.disbursementProof;
    this.disbursementProofUploading = true;
    const upload$ = this.api.mode === 'demo' || !proof
      ? of(0)
      : this.api.uploadDisbursementProof(app.id, proof);
    upload$.pipe(
      switchMap((proofDocumentId) => this.api.disburseLoan(app, this.dueDate, this.reference, proofDocumentId)),
      finalize(() => this.disbursementProofUploading = false),
    ).subscribe({
      next: () => {
        this.message.set(this.api.mode === 'demo'
          ? `Demo disbursement recorded for ${app.applicationNumber} in memory only.`
          : `Disbursement recorded for ${app.applicationNumber}.`);
        if (this.api.mode === 'demo') {
          this.selected.set({ ...app, status: 'DISBURSED', currentStep: 'DISBURSED' });
        } else {
          this.reloadApproved();
        }
      },
      error: () => undefined,
    });
  }

  selectDisbursementProof(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0] ?? null;
    if (file && !['image/png', 'image/jpeg'].includes(file.type)) {
      this.disbursementProof = null;
      input.value = '';
      this.message.set('Choose a PNG or JPEG proof screenshot.');
      return;
    }
    if (file && (file.size === 0 || file.size > 10 * 1024 * 1024)) {
      this.disbursementProof = null;
      input.value = '';
      this.message.set('The proof screenshot must be non-empty and no larger than 10 MiB.');
      return;
    }
    this.disbursementProof = file;
    this.message.set('');
  }

  downloadDisbursementProof(loanId: number): void {
    this.disbursementProofDownloading = true;
    this.api.getDisbursementProof(loanId).pipe(
      finalize(() => this.disbursementProofDownloading = false),
    ).subscribe({
      next: (signedUrl) => window.open(signedUrl, '_blank', 'noopener,noreferrer'),
      error: (error: Error) => this.message.set(error.message),
    });
  }

  review(id: number, decision: 'VERIFIED' | 'REJECTED'): void {
    if (decision === 'REJECTED' && !this.reviewNotes[id]?.trim()) {
      this.message.set('Add a review note before rejecting a document.');
      return;
    }
    this.api.reviewDocument(id, decision, this.reviewNotes[id] || '').subscribe({
      next: () => {
        if (this.api.mode === 'api') this.reloadDocuments();
        const document = this.api.data().documents.find((entry) => entry.id === id);
        const application = document ? this.api.data().applications.find((entry) => entry.id === document.applicationId) : null;
        let nextMessage = this.api.mode === 'demo'
          ? `Demo document ${id} marked ${decision} in memory only.`
          : `Document ${id} marked ${decision}.`;
        if (document && application && this.api.mode === 'demo') {
          const appDocuments = this.api.data().documents.filter((entry) => entry.applicationId === application.id);
          if (appDocuments.some((entry) => entry.status === 'REJECTED')) {
            this.selected.set({ ...application, status: 'REJECTED', currentStep: 'SUBMITTED' });
            nextMessage = 'One or more documents were rejected. The application has been returned to the borrower for correction.';
          } else if (appDocuments.length > 0 && appDocuments.every((entry) => entry.status === 'VERIFIED')) {
            this.selected.set({ ...application, status: 'SUBMITTED', currentStep: 'SUBMITTED' });
            nextMessage = 'All documents for this application are verified. The application is ready for approval.';
          }
        }
        this.message.set(nextMessage);
      },
      error: () => undefined,
    });
  }

  validPaymentId(): boolean {
    const id = Number(this.paymentId);
    return /^\d+$/.test(this.paymentId) && Number.isSafeInteger(id) && id > 0;
  }

  verifyPayment(): void {
    if (!this.validPaymentId()) {
      this.message.set('Enter a valid payment ID.');
      return;
    }
    this.verifiedPayment.set(null);
    this.api.verifyPayment(Number(this.paymentId)).subscribe({
      next: (result) => {
        this.verifiedPayment.set(result);
        this.message.set(`Payment ${result.paymentId} verified. Loan payment totals were updated by the backend.`);
      },
      error: () => undefined,
    });
  }

  reviewDocumentById(): void {
    const id = Number(this.reviewDocumentId);
    if (!/^\d+$/.test(this.reviewDocumentId) || !Number.isSafeInteger(id) || id <= 0) {
      this.message.set('Enter a valid document ID.');
      return;
    }
    if (this.reviewDecision === 'REJECTED' && !this.manualReviewNote.trim()) {
      this.message.set('Add a review note before rejecting a document.');
      return;
    }
    this.reviewNotes[id] = this.manualReviewNote;
    this.review(id, this.reviewDecision);
  }

  customerName(id: string | undefined): string {
    return this.api.data().customers.find((customer) => customer.id === id)?.fullName ?? 'Unknown borrower';
  }

  customerPhone(id: string | undefined): string {
    return this.api.data().customers.find((customer) => customer.id === id)?.phone ?? 'Not provided';
  }

  applicationCustomerId(applicationId: number): string | undefined {
    return this.api.data().applications.find((application) => application.id === applicationId)?.customerId;
  }

  appNumber(id: number): string {
    return this.api.data().applications.find((application) => application.id === id)?.applicationNumber ?? `#${id}`;
  }

  money(value: DecimalValue): string {
    return formatBwp(value);
  }

  interest(value: DecimalValue): string {
    if (!this.validNonNegativeAmount(value)) return '0';
    return multiplyDecimalByRatio(value, 3, 10);
  }

  totalWithInterest(value: DecimalValue): string {
    if (!this.validNonNegativeAmount(value)) return '0';
    return sumDecimalValues([String(value), this.interest(value)]);
  }

  validPositiveAmount(value: DecimalValue): boolean {
    return this.validNonNegativeAmount(value) && compareDecimalValues(value, 0) > 0;
  }

  compareAmounts(left: DecimalValue, right: DecimalValue): number {
    return this.validNonNegativeAmount(left) ? compareDecimalValues(left, right) : 1;
  }

  private validNonNegativeAmount(value: DecimalValue): boolean {
    return /^\d+(?:\.\d{1,2})?$/.test(String(value));
  }

  statusClass(status: string): string {
    return `status-${status.toLowerCase().replaceAll('_', '-')}`;
  }
}
