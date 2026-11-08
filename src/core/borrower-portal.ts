import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { finalize, of, Subscription, switchMap } from 'rxjs';
import { AuthService } from './auth.service';
import { LoanOpsApiService } from './loanops-api.service';
import { formatBwp } from './money';
import { animatePortal } from './portal-motion';
import { ThemeService } from './theme.service';
import { DocumentStorageService, DocumentUploadStage, DocumentUploadUpdate, DocumentViewUrl, validateApplicationDocument } from './document-storage.service';
import { Application, ApplicationDraft, BorrowerDocumentType, BorrowerRequirements, BorrowerType, DecimalValue, DocumentRecord, DocumentStatus, ReceivingMethod } from './models';

interface BorrowerUploadState {
  stage: DocumentUploadStage;
  progress: number;
  fileName: string;
  fileSize: number;
  documentStatus?: Exclude<DocumentStatus, 'MISSING'>;
  selectedFile?: File;
  error?: string;
}

const activeUploadStages = new Set<DocumentUploadStage>(['REQUESTING_UPLOAD', 'UPLOADING', 'VERIFYING']);

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <main class="auth-page">
      <section class="auth-card auth-welcome" aria-labelledby="welcome-heading">
        <a class="brand-mark auth-brand" routerLink="/login"><span class="brand-glyph">PJ</span><span>loans</span><small>MOVE FORWARD</small></a>
        <p class="eyebrow">Borrower portal</p>
        <h1 id="welcome-heading">Make your next move count.</h1>
        <p class="auth-intro">A clearer way to apply for support and follow each step with confidence.</p>
        <div class="auth-actions">
          <a *ngIf="auth.mode === 'mock'" class="button primary-button auth-submit" routerLink="/dashboard">Continue to Borrower Portal</a>
          <a class="button primary-button auth-submit" routerLink="/register">Create account</a>
          <a class="button secondary-button auth-submit" routerLink="/sign-in">Sign in</a>
        </div>
        <button class="icon-button auth-theme-toggle" type="button" (click)="theme.toggle()" aria-label="Toggle theme">{{ theme.theme() === 'dark' ? '☼' : '◐' }}</button>
      </section>
    </main>
  `,
})
export class BorrowerLogin {
  readonly auth = inject(AuthService);
  readonly theme = inject(ThemeService);
}

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink],
  template: `
    <main class="portal-page borrower-portal">
      <div class="portal-atmosphere" aria-hidden="true"><span class="atmosphere-glow glow-amber"></span><span class="atmosphere-glow glow-green" data-ambient-float></span><svg class="atmosphere-orbit" viewBox="0 0 480 480" data-ambient-orbit><circle cx="240" cy="240" r="210"/><circle cx="240" cy="240" r="160"/></svg></div>
      <header class="topbar">
        <a class="brand-mark compact" href="/dashboard"><span class="brand-glyph">PJ</span><span>loans</span></a>
        <nav class="portal-nav" aria-label="Borrower navigation">
          <button type="button" [class.current]="page() === 'home'" (click)="page.set('home')">Overview</button>
          <button type="button" [class.current]="page() === 'application'" (click)="continueApplication()">Application</button>
          <button type="button" [class.current]="page() === 'loan'" (click)="page.set('loan')">Loan details</button>
          <button type="button" [class.current]="page() === 'documents'" (click)="openDocuments()">Documents</button>
          <a class="button secondary-button" routerLink="/settings">Settings</a>
        </nav>
        <div class="topbar-actions">
          <span class="demo-badge">{{ api.mode === 'demo' ? 'DEMO DATA' : 'LIVE DATA' }}</span>
          <button class="button secondary-button" type="button" (click)="logout()">Sign out</button>
          <button class="icon-button" type="button" (click)="theme.toggle()" aria-label="Toggle theme">{{ theme.theme() === 'dark' ? '☼' : '◐' }}</button>
        </div>
      </header>
      <div class="demo-banner" *ngIf="api.mode === 'demo'">DEMO DATA — Not connected to the live backend</div>
      <div class="page-content">
        <p class="error-message" *ngIf="message()">{{ message() }}</p>
        <ng-container [ngSwitch]="page()">
          <section *ngSwitchCase="'home'" class="borrower-dashboard" animate.enter="view-enter">
            <div class="page-heading borrower-hero"><div><p class="eyebrow">A little more room to move</p><h1>Welcome back<span class="hero-period">.</span><br><span class="hero-name">{{ customerName() || 'Borrower' }}</span></h1><p class="muted">{{ api.mode === 'demo' ? 'Your demo profile is for preview only. Do not enter real personal or financial information.' : 'Your profile and lending data load independently through your authenticated account.' }}</p><button class="button primary-button" type="button" (click)="canContinueApplication() ? continueApplication() : startNewApplication()" [disabled]="api.isLoading('application_create') || !canCreateOrContinueApplication()">{{ activeApplication() && !canCreateOrContinueApplication() ? 'Application awaiting review' : activeApplication() ? 'Continue application' : 'Start application' }} <span aria-hidden="true">→</span></button></div><div class="hero-stamp" aria-hidden="true"><span>YOUR<br>NEXT<br>CHAPTER</span><i></i></div></div>
            <div class="notice-card"><span class="notice-icon">i</span><p>{{ api.mode === 'demo' ? 'This portal is in demo mode. Applications and documents are not sent to a lender or stored in the live system.' : 'A missing requirements or document operation does not disable application drafts or loan details.' }}</p></div>
            <div class="error-card" *ngIf="api.featureState('borrower_applications').request === 'error'" role="alert"><strong>Applications could not be loaded</strong><p>{{ api.featureState('borrower_applications').error }}</p><button class="button secondary-button" type="button" (click)="reloadApplications()">Retry applications</button></div>
            <p class="loading-state" *ngIf="api.isLoading('borrower_applications')" role="status">Loading your applications…</p>
            <div class="error-card" *ngIf="api.featureState('borrower_loans').request === 'error'" role="alert"><strong>Loan details could not be loaded</strong><p>{{ api.featureState('borrower_loans').error }}</p><button class="button secondary-button" type="button" (click)="reloadLoans()">Retry loan details</button></div>
            <article class="application-card" *ngIf="activeApplication() as app; else noApplication">
              <div class="card-top"><div><p class="eyebrow">Your application</p><h2>{{ app.applicationNumber }}</h2></div><span class="status-chip" [ngClass]="statusClass(app.status)">{{ app.status }}</span></div>
              <div class="detail-grid"><div><span>Requested</span><strong>{{ money(app.requestedAmount) }}</strong></div><div><span>Category</span><strong>{{ app.borrowerType }}</strong></div><div><span>Current step</span><strong>{{ app.currentStep }}</strong></div></div>
              <div class="progress-track" role="progressbar" [attr.aria-valuenow]="progress(app.status)" aria-valuemin="0" aria-valuemax="100" [attr.aria-label]="'Application progress: ' + statusDescription(app.status)"><span [style.width.%]="progress(app.status)"></span></div><p class="progress-caption">{{ statusDescription(app.status) }}</p>
              <p class="support-line" *ngIf="requirementsState()?.requirementsConfirmed && missingRequirements(app).length">Still needed: {{ missingRequirements(app).join(', ') }}</p>
              <button class="button secondary-button" type="button" *ngIf="canContinueApplication()" (click)="continueApplication()">Continue application <span aria-hidden="true">→</span></button>
              <button class="button secondary-button danger-button" type="button" *ngIf="canCancelApplication(app)" [disabled]="cancellingApplication()" (click)="cancelApplication(app)">{{ cancellingApplication() ? 'Cancelling…' : 'Cancel application' }}</button>
              <span class="muted" *ngIf="!canContinueApplication() && applicationStatusLocked(app)">Application awaiting review. Editing is disabled until the administrator requests corrections.</span>
            </article>
            <ng-template #noApplication><article class="empty-card"><h2>{{ api.featureState('borrower_applications').request === 'empty' ? 'No application yet' : 'No application in progress' }}</h2><p>{{ api.mode === 'demo' ? 'Start a demo application to explore the guided process. Nothing will be sent to a lender.' : api.featureState('borrower_applications').request === 'error' ? 'Retry the application list to distinguish a loading error from an empty account.' : 'Start an application when you are ready; submission requirements remain a separate feature.' }}</p><button class="button primary-button" type="button" (click)="startNewApplication()" [disabled]="api.isLoading('application_create')">Start an application</button></article></ng-template>
            <div class="two-columns">
              <article class="surface-card"><p class="eyebrow">How it works</p><h2>One clear step at a time.</h2><ol class="number-list"><li>Share your application details</li><li>Provide the requested evidence</li><li>Wait for the lender to review your submission</li></ol></article>
              <article class="surface-card"><p class="eyebrow">Need to know</p><h2>Requirements depend on your category.</h2><p class="muted">Unemployed borrower requirements are still awaiting lender confirmation. Student registration proof and the precise employed evidence policy are also unconfirmed.</p></article>
            </div>
          </section>

          <section *ngSwitchCase="'application'" animate.enter="view-enter">
            <div class="page-heading"><div><p class="eyebrow">Application journey</p><h1>{{ savedApplication() ? 'Continue your application' : 'New application' }}</h1><p class="muted">{{ api.mode === 'demo' ? 'Complete the steps below. Your demo data stays in memory only.' : 'Application drafts are saved through LoanOps; final submission remains separately gated on backend readiness.' }}</p></div></div>
            <div class="stepper" aria-label="Application steps"><span *ngFor="let label of wizardSteps; let i = index" [class.selected]="wizardStep() === i" [class.completed]="wizardStep() > i"><b>{{ i + 1 }}</b>{{ label }}</span></div>
            <form [formGroup]="form" (ngSubmit)="nextStep()" class="wizard-card">
              <div *ngIf="wizardStep() === 0" class="wizard-section" animate.enter="step-enter"><p class="eyebrow">Step 1 of 5</p><h2>Which category describes you?</h2><div class="choice-grid"><label *ngFor="let type of borrowerTypes" class="choice-card" [class.chosen]="form.controls.borrowerType.value === type"><input type="radio" formControlName="borrowerType" [value]="type" (change)="refreshRequirements()"><strong>{{ type }}</strong><span>{{ categoryLabel(type) }}</span><span class="choice-arrow" aria-hidden="true">↗</span></label></div><p class="inline-warning" *ngIf="requirementsState()?.pendingConfirmation">These document types are preliminary and have not been confirmed as lender policy.</p></div>
              <div *ngIf="wizardStep() === 1" class="wizard-section" animate.enter="step-enter"><p class="eyebrow">Step 2 of 5</p><h2>Your personal information</h2><div class="field-grid"><label><span>Full name</span><input formControlName="fullName" autocomplete="name" (input)="syncRecipientName()"></label><label><span>Phone number</span><input formControlName="phone" autocomplete="tel" placeholder="+267..."></label><label><span>National ID / passport number</span><input formControlName="nationalId"></label></div><p class="inline-warning">Phone number is a matching value only and does not verify identity. Passport acceptance needs backend policy confirmation.</p></div>
              <div *ngIf="wizardStep() === 2" class="wizard-section" animate.enter="step-enter"><p class="eyebrow">Step 3 of 5</p><h2>Application and receiving details</h2><div class="field-grid"><ng-container *ngIf="form.controls.borrowerType.value === 'STUDENT'"><label><span>Institution</span><select [value]="institutionChoice()" (change)="onInstitutionChange($event)"><option value="">Choose your institution</option><option *ngFor="let institution of institutions" [value]="institution">{{ institution }}</option><option value="OTHER">Other institution</option></select></label><label *ngIf="institutionChoice() === bcetInstitution"><span>BCET location</span><select [value]="institutionLocation()" (change)="onInstitutionLocationChange($event)"><option value="">Choose campus/location</option><option *ngFor="let location of bcetLocations" [value]="location">{{ location }}</option></select></label><label *ngIf="institutionChoice() === 'OTHER'"><span>Enter institution name</span><input formControlName="institution" autocomplete="organization"></label><label><span>Student ID</span><input formControlName="studentId"></label></ng-container><label *ngIf="form.controls.borrowerType.value === 'EMPLOYED'" animate.enter="field-enter"><span>Employer</span><input formControlName="employer"></label><label *ngIf="form.controls.borrowerType.value === 'EMPLOYED'" animate.enter="field-enter"><span>Employment status</span><input formControlName="employmentStatus"></label><label><span>Amount requested (BWP)</span><input type="text" inputmode="decimal" pattern="^[0-9]+([.][0-9]{1,2})?$" formControlName="requestedAmount"></label><label><span>Receiving method</span><select formControlName="receivingMethod"><option *ngFor="let method of receivingMethods" [value]="method">{{ methodLabels[method] }}</option></select></label><label class="recipient-field" [class.linked-field]="form.controls.sameAsId.value"><span>Recipient name <small *ngIf="form.controls.sameAsId.value">Linked to borrower name</small></span><input formControlName="recipientName" [readonly]="form.controls.sameAsId.value" [attr.aria-readonly]="form.controls.sameAsId.value"></label><label class="checkbox-line"><input type="checkbox" formControlName="sameAsId" (change)="syncRecipientName()"><span>Recipient name is the same as my ID</span></label><label *ngIf="form.controls.receivingMethod.value !== 'CASH'" animate.enter="field-enter"><span>Bank / wallet / phone identifier</span><input formControlName="recipientIdentifier"></label></div></div>
              <div *ngIf="wizardStep() === 3" class="wizard-section" animate.enter="step-enter">
                <p class="eyebrow">Step 4 of 5</p>
                <h2>Preliminary document checklist</h2>
                <p class="muted">These known document types are not confirmed borrower policy. Private uploads are available only when the upload backend is deployed and the application is still in progress.</p>
                <p class="loading-state" *ngIf="api.isLoading('document_listing')" role="status">Loading application documents…</p>
                <div class="error-card" *ngIf="api.featureState('document_listing').request === 'error'" role="alert">
                  <p>{{ api.featureState('document_listing').error }}</p>
                  <button class="button secondary-button" type="button" (click)="reloadApplicationDocuments()">Retry documents</button>
                </div>
                <div class="checklist-row" *ngFor="let requirement of requirements()" animate.enter="field-enter">
                  <div>
                    <strong>{{ requirement }}</strong>
                    <p>{{ requirementDescription(requirement) }}</p>
                    <ng-container *ngIf="activeApplication() as app">
                      <p class="muted" *ngIf="latestDocument(app.id, requirement) as doc">{{ doc.fileName }} · {{ doc.createdAt | date:'mediumDate' }}</p>
                      <p class="rejection-note" *ngIf="latestDocument(app.id, requirement)?.reviewNote">{{ latestDocument(app.id, requirement)?.reviewNote }}</p>
                      <div class="upload-feedback" *ngIf="uploadState(app.id, requirement) as state">
                        <span>{{ state.fileName }} · {{ formatFileSize(state.fileSize) }} · {{ uploadStageLabel(state.stage) }}</span>
                        <progress *ngIf="state.stage === 'UPLOADING'" [value]="state.progress" max="100" [attr.aria-label]="'Upload progress for ' + state.fileName"></progress>
                        <span class="rejection-note" *ngIf="state.error" role="alert">{{ state.error }}</span>
                      </div>
                    </ng-container>
                  </div>
                  <div *ngIf="activeApplication() as app; else noSavedApplication">
                    <span class="status-chip" [ngClass]="statusClass(documentStatusFor(app.id, requirement))">{{ documentStatusFor(app.id, requirement) }}</span>
                    <button class="button secondary-button" type="button" *ngIf="latestDocument(app.id, requirement) as document" (click)="previewDocument(document.id)">View document</button>
                    <label class="file-button" [class.is-disabled]="!canUploadRequirement(app, requirement)">
                      {{ selectButtonLabel(app.id, requirement) }}
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                        [disabled]="!canUploadRequirement(app, requirement)"
                        (change)="selectDocumentFile($event, app.id, requirement)">
                    </label>
                    <p class="muted" *ngIf="documentStatusFor(app.id, requirement) === 'PENDING'">This file is awaiting review. You can upload a replacement if it is rejected.</p>
                    <button class="button primary-button" type="button" *ngIf="uploadState(app.id, requirement)?.selectedFile"
                      [disabled]="!canUploadRequirement(app, requirement)"
                      (click)="startUpload(app.id, requirement)">{{ uploadButtonLabel(app.id, requirement) }}</button>
                  </div>
                  <ng-template #noSavedApplication><div><span class="status-chip status-missing">MISSING</span><p class="muted">Save an application draft before uploading.</p></div></ng-template>
                </div>
                <p class="inline-warning" *ngIf="api.featureState('document_upload').availability !== 'available'">Private document upload is unavailable because the upload function is not configured or accessible.</p>
                <p class="inline-warning">Uploads are stored privately and registered only after server-side file verification. The preliminary checklist is not confirmed lender policy.</p>
              </div>
              <div *ngIf="wizardStep() === 4" class="wizard-section" animate.enter="step-enter"><p class="eyebrow">Step 5 of 5</p><h2>Review before saving</h2><div class="review-grid"><p><span>Borrower category</span><strong>{{ form.controls.borrowerType.value }}</strong></p><p><span>Requested amount</span><strong>{{ money(form.controls.requestedAmount.value) }}</strong></p><p><span>Recipient method</span><strong>{{ methodLabels[form.controls.receivingMethod.value] }}</strong></p><p><span>Recipient name</span><strong>{{ form.controls.sameAsId.value ? form.controls.fullName.value : form.controls.recipientName.value }}</strong></p></div><p class="inline-warning" *ngIf="api.mode === 'demo'">Saving in demo mode creates only an in-memory demonstration record.</p><p class="inline-warning" *ngIf="api.mode === 'api'">Saving creates or updates an application draft only; it does not confirm eligibility or submit the application.</p><p class="error-message" *ngIf="api.featureState(savedApplication() ? 'application_update' : 'application_create').request === 'error'" role="alert">{{ api.featureState(savedApplication() ? 'application_update' : 'application_create').error }}</p></div>
              <div class="wizard-actions"><button class="button secondary-button" type="button" *ngIf="wizardStep() > 0" (click)="goToPreviousStep()">Back</button><span class="spacer"></span><button class="button primary-button" type="submit" *ngIf="wizardStep() < wizardSteps.length - 1 && canContinueApplication()" [disabled]="savingApplication()">{{ savingApplication() ? 'Saving…' : 'Continue' }}</button><button class="button primary-button" type="button" *ngIf="wizardStep() === wizardSteps.length - 1 && canContinueApplication()" [disabled]="savingApplication()" (click)="saveApplication()">{{ savingApplication() ? 'Saving…' : api.mode === 'demo' ? 'Save demo application' : 'Save application' }}</button><button class="button primary-button" type="button" *ngIf="wizardStep() === wizardSteps.length - 1 && canSubmitSelectedApplication()" [disabled]="savingApplication()" (click)="submitSelectedApplication()">{{ savingApplication() ? 'Submitting…' : 'Submit for review' }}</button><span class="muted" *ngIf="wizardStep() === wizardSteps.length - 1 && !canSubmitSelectedApplication() && activeApplication()">Application is already submitted. Editing and resubmission are disabled until the administrator requests corrections.</span></div>
              <p class="error-message" *ngIf="message()">{{ message() }}</p>
            </form>
          </section>

          <section *ngSwitchCase="'documents'" animate.enter="view-enter">
            <div class="page-heading">
              <div><p class="eyebrow">Evidence</p><h1>Preliminary document checklist</h1><p class="muted">The listed document types are not confirmed as lender policy. Application review documents and account verification are separate.</p></div>
              <button class="button secondary-button" type="button" *ngIf="activeApplication()" (click)="reloadApplicationDocuments()">Refresh documents</button>
            </div>
            <p class="loading-state" *ngIf="api.isLoading('document_listing')" role="status">Loading application documents…</p>
            <div class="error-card" *ngIf="api.featureState('document_listing').request === 'error'" role="alert">
              <p>{{ api.featureState('document_listing').error }}</p>
              <button class="button secondary-button" type="button" (click)="reloadApplicationDocuments()">Retry documents</button>
            </div>
            <article class="surface-card" *ngIf="activeApplication() as app; else noAppDocuments">
              <div class="checklist-row" *ngFor="let requirement of requirementsFor(app.borrowerType)" animate.enter="field-enter">
                <div>
                  <strong>{{ requirement }}</strong>
                  <p>{{ requirementDescription(requirement) }}</p>
                  <p class="muted" *ngIf="latestDocument(app.id, requirement) as doc">{{ doc.fileName || 'Uploaded document' }} · {{ doc.createdAt | date:'mediumDate' }}</p>
                  <p class="rejection-note" *ngIf="latestDocument(app.id, requirement)?.reviewNote">{{ latestDocument(app.id, requirement)?.reviewNote }}</p>
                  <div class="upload-feedback" *ngIf="uploadState(app.id, requirement) as state">
                    <span>{{ state.fileName }} · {{ formatFileSize(state.fileSize) }} · {{ uploadStageLabel(state.stage) }}</span>
                    <progress *ngIf="state.stage === 'UPLOADING'" [value]="state.progress" max="100" [attr.aria-label]="'Upload progress for ' + state.fileName"></progress>
                    <span class="rejection-note" *ngIf="state.error" role="alert">{{ state.error }}</span>
                  </div>
                </div>
                <div>
                  <span class="status-chip" [ngClass]="statusClass(documentStatusFor(app.id, requirement))">{{ documentStatusFor(app.id, requirement) }}</span>
                  <label class="file-button" [class.is-disabled]="!canUploadRequirement(app, requirement)">
                    {{ selectButtonLabel(app.id, requirement) }}
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                      [disabled]="!canUploadRequirement(app, requirement)"
                      (change)="selectDocumentFile($event, app.id, requirement)">
                  </label>
                  <p class="muted" *ngIf="documentStatusFor(app.id, requirement) === 'PENDING'">This file is awaiting review. You can upload a replacement if it is rejected.</p>
                  <button class="button primary-button" type="button" *ngIf="uploadState(app.id, requirement)?.selectedFile"
                    [disabled]="!canUploadRequirement(app, requirement)"
                    (click)="startUpload(app.id, requirement)">{{ uploadButtonLabel(app.id, requirement) }}</button>
                </div>
              </div>
              <p class="inline-warning" *ngIf="api.featureState('document_upload').availability !== 'available'">Private document upload is unavailable because the upload function is not configured or accessible.</p>
              <p class="inline-warning">The preliminary checklist is not confirmed lender policy. Uploaded files are private and separate from account verification.</p>
            </article>
            <ng-template #noAppDocuments><article class="empty-card"><h2>No application available</h2><p>Start an application to see its preliminary document list.</p></article></ng-template>
          </section>

          <section *ngSwitchCase="'loan'" animate.enter="view-enter"><div class="page-heading"><div><p class="eyebrow">Loan account</p><h1>Loan details</h1><p class="muted">{{ api.mode === 'demo' ? 'Only loan records present in demo data are shown.' : 'Only loan records linked to your private account are shown.' }}</p></div></div><p class="loading-state" *ngIf="api.isLoading('borrower_loans')" role="status">Loading your loan details…</p><article class="surface-card" *ngIf="activeLoan() as loan; else noLoan"><div class="card-top"><h2>Loan · {{ applicationForLoan(loan.applicationId)?.applicationNumber }}</h2><span class="status-chip status-approved">{{ loan.status }}</span></div><div class="detail-grid"><div><span>Principal</span><strong>{{ money(loan.principal) }}</strong></div><div><span>Flat interest (30%)</span><strong>{{ money(loan.interestAmount) }}</strong></div><div><span>Total repayable</span><strong>{{ money(loan.totalDue) }}</strong></div><div><span>Amount paid</span><strong>{{ money(loan.amountPaid ?? 0) }}</strong></div><div><span>Outstanding</span><strong>{{ money(loan.outstandingAmount) }}</strong></div><div><span>Due date</span><strong>{{ loan.dueDate | date:'mediumDate' }}</strong></div><div><span>Disbursement reference</span><strong>{{ loan.disbursementReference || 'Not supplied' }}</strong></div></div><form class="form-stack" *ngIf="api.mode === 'api' && loan.status === 'ACTIVE'" (ngSubmit)="submitPayment(loan.id)"><h3>Record a repayment</h3><p class="muted">A submitted payment stays pending until verified. It does not update your loan balance.</p><label>Amount (BWP)<input name="paymentAmount" type="text" inputmode="decimal" pattern="^[0-9]+([.][0-9]{1,2})?$" [(ngModel)]="paymentAmount" required></label><label>Payment method<input name="paymentMethod" [(ngModel)]="paymentMethod" required></label><label>Payment reference<input name="paymentReference" [(ngModel)]="paymentReference" required></label><p class="error-message" *ngIf="api.featureState('payment_submission').request === 'error'" role="alert">{{ api.featureState('payment_submission').error }}</p><button class="button primary-button" type="submit" [disabled]="api.isLoading('payment_submission')">{{ api.isLoading('payment_submission') ? 'Submitting…' : 'Submit payment for verification' }}</button></form><div class="surface-card" *ngFor="let payment of loanPayments(loan.id)"><div class="card-top"><strong>{{ money(payment.amount) }}</strong><span class="status-chip" [ngClass]="statusClass(payment.status)">{{ payment.status }}</span></div><p>{{ payment.paymentMethod || 'Method not supplied' }} · {{ payment.paymentReference || 'Reference not supplied' }}</p><p class="muted">Submitted {{ payment.submittedAt | date:'mediumDate' }}. A pending payment has not changed your balance.</p></div><p class="inline-warning" *ngIf="api.mode === 'api' && api.featureState('borrower_payment_history').availability !== 'available'">Payment history is unavailable; only payments submitted during this session are listed.</p><p class="inline-warning" *ngIf="api.mode === 'demo'">Payment submission is disabled in demo mode. No payment or balance is recorded.</p></article><ng-template #noLoan><article class="empty-card"><h2>{{ api.featureState('borrower_loans').request === 'empty' ? 'No loan record yet' : 'No active loan record' }}</h2><p>A submitted or approved application is not a disbursed loan.</p></article></ng-template></section>
        </ng-container>
      </div>
      <dialog class="document-preview-dialog" [open]="preview() !== null" (close)="closePreview()">
        <div class="document-preview-header">
          <div><p class="eyebrow">Private document preview</p><h2>{{ preview()?.filename || 'Document' }}</h2></div>
          <button class="icon-button" type="button" (click)="closePreview()" aria-label="Close document preview">×</button>
        </div>
        <p class="loading-state" *ngIf="previewLoading()" role="status">Opening secure preview…</p>
        <div class="error-card" *ngIf="previewError()" role="alert">
          <p>{{ previewError() }}</p>
          <button class="button secondary-button" type="button" (click)="retryPreview()">Retry preview</button>
        </div>
        <img *ngIf="preview()?.contentType !== 'application/pdf' && preview()?.url" [src]="preview()?.url" alt="Uploaded document preview">
        <iframe *ngIf="preview()?.contentType === 'application/pdf' && preview()?.url" [src]="safePreviewUrl(preview()?.url)" title="PDF document preview"></iframe>
      </dialog>
    </main>
  `,
})
export class BorrowerPortal implements AfterViewInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly element = inject(ElementRef<HTMLElement>);
  private readonly documentStorage = inject(DocumentStorageService);
  readonly api = inject(LoanOpsApiService);
  readonly auth = inject(AuthService);
  readonly router = inject(Router);
  readonly theme = inject(ThemeService);
  readonly page = signal<'home' | 'application' | 'documents' | 'loan'>('home');
  readonly selectedCustomerId = signal('DEMO-CUSTOMER-001');
  readonly wizardStep = signal(0);
  readonly savingApplication = signal(false);
  readonly message = signal('');
  readonly requirementsState = signal<BorrowerRequirements | null>(null);
  readonly documentUploads = signal<Record<string, BorrowerUploadState>>({});
  readonly preview = signal<DocumentViewUrl | null>(null);
  readonly previewLoading = signal(false);
  readonly previewError = signal('');
  readonly cancellingApplication = signal(false);
  private previewDocumentId: number | null = null;
  readonly borrowerTypes: BorrowerType[] = ['STUDENT', 'EMPLOYED', 'UNEMPLOYED'];
  readonly wizardSteps = ['Category', 'Personal', 'Details', 'Documents', 'Review'];
  readonly receivingMethods: ReceivingMethod[] = ['CASH', 'FNB_PAY_TO_CELL', 'EFT', 'ORANGE_MONEY', 'MYZAKA', 'SMEGA'];
  readonly methodLabels: Record<ReceivingMethod, string> = {
    CASH: 'Cash',
    FNB_PAY_TO_CELL: 'FNB Pay to Cell',
    EFT: 'EFT',
    ORANGE_MONEY: 'Orange Money',
    MYZAKA: 'MyZaka',
    SMEGA: 'Smega',
  };
  readonly institutions = [
    'ABM University College',
    'BA ISAGO University',
    'Boitekanelo College',
    'Botho University',
    'Botswana Accountancy College (BAC)',
    'Botswana College of Engineering and Technology (BCET)',
    'Botswana International University of Science and Technology (BIUST)',
    'Botswana Open University (BOU)',
    'Botswana University of Agriculture and Natural Resources (BUAN)',
    'Gaborone University College of Law and Professional Studies (GUC)',
    'Institute of Development Management (IDM)',
    'Kanye Seventh-day Adventist (SDA) College of Nursing',
    'Limkokwing University of Creative Technology',
    'New Era College of Arts, Science and Technology',
    'University of Botswana (UB)',
  ];
  readonly bcetInstitution = 'Botswana College of Engineering and Technology (BCET)';
  readonly bcetLocations = ['Gaborone', 'Francistown', 'Lobatse', 'Serowe', 'Ramotswa'];
  readonly institutionChoice = signal('');
  readonly institutionLocation = signal('');
  paymentAmount = '';
  paymentMethod = '';
  paymentReference = '';
  readonly form = this.fb.nonNullable.group({
    borrowerType: 'STUDENT' as BorrowerType,
    fullName: ['Naledi Demo', Validators.required],
    phone: ['+26771000001', [Validators.required, Validators.pattern(/^\+?[0-9\s()-]{8,20}$/)]],
    nationalId: [''],
    institution: [''],
    studentId: [''],
    employer: [''],
    employmentStatus: [''],
    requestedAmount: ['1000', [Validators.required, Validators.pattern(/^\d+(?:\.\d{1,2})?$/), Validators.min(1)]],
    receivingMethod: 'FNB_PAY_TO_CELL' as ReceivingMethod,
    recipientName: [''],
    sameAsId: false,
    recipientIdentifier: [''],
  });
  private cleanupMotion?: () => void;
  private readonly uploadSubscriptions = new Map<string, Subscription>();

  constructor() {
    const profile = this.auth.customerProfile();
    if (profile) {
      this.selectedCustomerId.set(profile.customerId);
      this.api.data.update((current) => ({
        ...current,
        customers: current.customers.some((customer) => customer.id === profile.customerId)
          ? current.customers
          : [...current.customers, {
            id: profile.customerId,
            phone: profile.phone,
            fullName: profile.fullName ?? '',
            nationalId: profile.nationalId,
            borrowerType: profile.borrowerType,
          }],
      }));
    }
    this.reload();
    const current = this.activeApplication();
    if (current) this.fillDraft(current);
    this.refreshRequirements();
  }

  async logout(): Promise<void> {
    try {
      await this.auth.signOut();
      await this.router.navigateByUrl('/login');
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : 'Unable to sign out.');
    }
  }

  ngAfterViewInit(): void {
    this.cleanupMotion = animatePortal(this.element.nativeElement, 'borrower');
  }

  ngOnDestroy(): void {
    this.cleanupMotion?.();
    for (const subscription of this.uploadSubscriptions.values()) subscription.unsubscribe();
    this.uploadSubscriptions.clear();
  }

  activeApplication() {
    const priority: Record<string, number> = {
      NEEDS_CORRECTION: 0,
      IN_PROGRESS: 1,
      SUBMITTED: 2,
      APPROVED: 3,
      REJECTED: 4,
      CANCELLED: 5,
    };
    return this.api.data().applications
      .filter((application) =>
      (this.api.mode === 'api' || application.customerId === this.selectedCustomerId())
      && application.status !== 'DISBURSED',
      )
      .sort((a, b) => {
        const statusDifference = (priority[a.status] ?? 99) - (priority[b.status] ?? 99);
        return statusDifference !== 0 ? statusDifference : b.createdAt.localeCompare(a.createdAt);
      })[0];
  }

  private isEditableApplicationStatus(status: string): boolean {
    return status === 'IN_PROGRESS' || status === 'NEEDS_CORRECTION';
  }

  canContinueApplication(): boolean {
    const application = this.activeApplication();
    return !application || this.isEditableApplicationStatus(application.status);
  }

  canCreateOrContinueApplication(): boolean {
    const application = this.activeApplication();
    return !application || this.isEditableApplicationStatus(application.status);
  }

  canSubmitSelectedApplication(): boolean {
    const application = this.activeApplication();
    return !!application && this.isEditableApplicationStatus(application.status) && application.status === 'IN_PROGRESS';
  }

  applicationStatusLocked(application: { status: string }): boolean {
    return !this.isEditableApplicationStatus(application.status);
  }

  savedApplication() {
    return this.activeApplication();
  }

  activeLoan() {
    const customerId = this.api.mode === 'api' ? undefined : this.selectedCustomerId();
    const customerApplications = this.api.data().applications.filter((entry) =>
      customerId === undefined || entry.customerId === customerId,
    );
    const ids = new Set(customerApplications.map((application) => application.id));
    return this.api.data().loans.find((loan) => ids.has(loan.applicationId));
  }

  applicationForLoan(id: number) {
    return this.api.data().applications.find((application) => application.id === id);
  }

  syncRecipientName(): void {
    if (this.form.controls.sameAsId.value) {
      this.form.controls.recipientName.setValue(this.form.controls.fullName.value);
    }
  }

  onInstitutionChange(event: Event): void {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;
    const choice = select.value;
    this.institutionChoice.set(choice);
    this.institutionLocation.set('');
    this.form.controls.institution.setValue(choice === 'OTHER' || choice === this.bcetInstitution ? '' : choice);
  }

  onInstitutionLocationChange(event: Event): void {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;
    this.institutionLocation.set(select.value);
    this.form.controls.institution.setValue(select.value
      ? `${this.bcetInstitution} - ${select.value}`
      : '');
  }

  startNewApplication(): void {
    const existing = this.activeApplication();
    if (existing) {
      if (this.isEditableApplicationStatus(existing.status)) {
        this.continueApplication();
        return;
      }
      this.message.set('This application is already submitted and awaiting review. Editing and resubmission stay locked until the administrator requests corrections.');
      return;
    }
    if (this.api.mode === 'api' && this.api.isLoading('application_create')) {
      this.message.set('An application draft is already being created.');
      return;
    }
    const customer = this.api.data().customers.find((entry) => entry.id === this.selectedCustomerId());
    if (!customer && this.api.mode === 'api') {
      this.message.set('Your borrower profile is not available yet. Review Account settings and retry profile setup.');
      return;
    }
    this.form.reset({
      borrowerType: customer?.borrowerType ?? 'STUDENT',
      fullName: customer?.fullName ?? 'Naledi Demo',
      phone: customer?.phone ?? '+26771000001',
      nationalId: '',
      institution: '',
      studentId: '',
      employer: '',
      employmentStatus: '',
      requestedAmount: '1000',
      receivingMethod: 'FNB_PAY_TO_CELL',
      recipientName: customer?.fullName ?? 'Naledi Demo',
      sameAsId: true,
      recipientIdentifier: customer?.phone ?? '+26771000001',
    });
    this.institutionChoice.set('');
    this.institutionLocation.set('');
    this.form.controls.borrowerType.setValue(customer?.borrowerType ?? 'STUDENT');
    this.form.controls.requestedAmount.setValue('1000');
    this.form.controls.receivingMethod.setValue('FNB_PAY_TO_CELL');
    this.wizardStep.set(0);
    this.page.set('application');
  }

  continueApplication(): void {
    const application = this.activeApplication();
    if (application && !this.isEditableApplicationStatus(application.status)) {
      this.message.set('This application is already submitted and awaiting review. Editing is disabled until the administrator requests corrections.');
      return;
    }
    if (this.page() === 'application') return;
    this.message.set('');
    if (application) {
      this.selectedCustomerId.set(application.customerId);
      this.fillDraft(application);
      this.wizardStep.set(this.resumeWizardStep(application));
    } else {
      this.wizardStep.set(0);
    }
    this.page.set('application');
  }

  goToPreviousStep(): void {
    const previousStep = Math.max(0, this.wizardStep() - 1);
    this.wizardStep.set(previousStep);
    const application = this.activeApplication();
    if (application) this.persistWizardStep(application, previousStep);
  }

  nextStep(): void {
    if (this.wizardStep() === 1 && (this.form.controls.fullName.invalid || this.form.controls.phone.invalid)) {
      this.form.controls.fullName.markAsTouched();
      this.form.controls.phone.markAsTouched();
      this.message.set('Add your name and a valid phone number to continue.');
      return;
    }
    if (this.wizardStep() === 2) {
      const raw = this.form.getRawValue();
      const categoryDetailsMissing = raw.borrowerType === 'STUDENT'
        ? !raw.institution.trim() || !raw.studentId.trim()
        : raw.borrowerType === 'EMPLOYED'
          ? !raw.employer.trim() || !raw.employmentStatus.trim()
          : false;
      const recipientMissing = (!raw.sameAsId && !raw.recipientName.trim())
        || (raw.receivingMethod !== 'CASH' && !raw.recipientIdentifier.trim());
      if (categoryDetailsMissing || Number(raw.requestedAmount) < 1 || recipientMissing) {
        this.message.set('Complete the category, amount, and receiving details required for this application.');
        return;
      }
    }
    this.message.set('');
    const currentStep = this.wizardStep();
    const nextStep = Math.min(currentStep + 1, this.wizardSteps.length - 1);
    const raw = this.form.getRawValue();
    const draft: ApplicationDraft = {
      ...raw,
      recipientName: raw.sameAsId ? raw.fullName : raw.recipientName,
    };
    const application = this.activeApplication();
    const save = !application
      ? this.api.startApplication(draft)
      : currentStep === 0
        ? this.api.updateApplication(application.id, draft)
        : currentStep >= 2
          ? this.api.updateApplication(application.id, draft)
          : of(application);

    this.savingApplication.set(true);
    save.pipe(finalize(() => this.savingApplication.set(false))).subscribe({
      next: (savedApplication) => {
        if (savedApplication) {
          this.selectedCustomerId.set(savedApplication.customerId);
          this.persistWizardStep(savedApplication, nextStep);
          if (currentStep >= 2) this.reloadApplicationDocuments(savedApplication.id);
        }
        this.wizardStep.set(nextStep);
      },
      error: (error: Error) => this.message.set(error.message),
    });
  }

  saveApplication(): void {
    const current = this.activeApplication();
    if (current && !this.isEditableApplicationStatus(current.status)) {
      this.message.set('This application is already submitted and awaiting review. Editing is disabled until the administrator requests corrections.');
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.message.set('Complete the required details before saving.');
      return;
    }
    const raw = this.form.getRawValue();
    const draft: ApplicationDraft = { ...raw, recipientName: raw.sameAsId ? raw.fullName : raw.recipientName };
    const save = current
      ? this.api.updateApplication(current.id, draft)
      : this.api.startApplication(draft).pipe(
        switchMap((application) => this.api.updateApplication(application.id, draft)),
      );
    this.savingApplication.set(true);
    save.pipe(finalize(() => this.savingApplication.set(false))).subscribe({
      next: (application) => {
        this.selectedCustomerId.set(application.customerId);
        this.persistWizardStep(application, this.wizardStep());
        this.reloadApplicationDocuments(application.id);
        this.message.set(this.api.mode === 'demo'
          ? `Demo application ${application.applicationNumber} saved in memory only.`
          : `Application ${application.applicationNumber} draft saved.`);
        this.page.set('home');
      },
      error: (error: Error) => this.message.set(error.message),
    });
  }

  customerName(): string {
    const customer = this.api.data().customers.find((entry) => entry.id === this.selectedCustomerId());
    return customer?.fullName ?? this.auth.customerProfile()?.fullName ?? '';
  }

  submitSelectedApplication(): void {
    const app = this.activeApplication();
    if (!app) {
      this.message.set('There is no active application to submit.');
      return;
    }
    if (!this.isEditableApplicationStatus(app.status) || app.status !== 'IN_PROGRESS') {
      this.message.set('This application is already submitted and awaiting review. Editing and resubmission are disabled until the administrator requests corrections.');
      return;
    }
    this.api.checkSubmissionReadiness(app.id).subscribe({
      next: (readiness) => {
        console.log('submission readiness payload', { appId: app.id, readiness });
        if (!readiness.ready || !readiness.requirementsConfirmed) {
          const missing = [...readiness.missingFields, ...readiness.missingDocuments].join(', ');
          this.message.set(`Application is not ready for review. ${missing || readiness.decision}`);
          return;
        }
        this.api.submitApplication(app.id).subscribe({
          next: () => {
            this.message.set('Application submitted for review. The administrator can now review the application and its documents together.');
            this.reload();
          },
          error: (error: Error) => this.message.set(error.message),
        });
      },
      error: (error: Error) => this.message.set(error.message),
    });
  }

  reload(): void {
    this.reloadApplications();
    this.reloadLoans();
  }

  reloadApplications(): void {
    this.api.loadMyApplications().subscribe({
      next: (applications) => {
        this.api.data.update((current) => ({ ...current, applications }));
        const current = this.activeApplication();
        if (current) {
          this.selectedCustomerId.set(current.customerId);
          this.fillDraft(current);
          if (current.status === 'IN_PROGRESS') {
            this.wizardStep.set(this.resumeWizardStep(current));
          }
        }
        this.refreshRequirements();
        this.reloadApplicationDocuments();
        this.message.set('');
      },
      error: () => undefined,
    });
  }

  reloadLoans(): void {
    this.api.loadMyLoans().subscribe({
      error: () => undefined,
    });
  }

  openDocuments(): void {
    this.page.set('documents');
    this.reloadApplicationDocuments();
  }

  reloadApplicationDocuments(applicationId = this.activeApplication()?.id): void {
    if (!applicationId) return;
    this.api.loadMyApplicationDocuments(applicationId).subscribe({ error: () => undefined });
  }

  latestDocument(applicationId: number, type: string): DocumentRecord | undefined {
    return this.api.data().documents
      .filter((document) => document.applicationId === applicationId && document.documentType === type)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  }

  documentStatusFor(applicationId: number, type: string): string {
    return this.latestDocument(applicationId, type)?.status ?? 'MISSING';
  }

  uploadState(applicationId: number, type: string): BorrowerUploadState | undefined {
    return this.documentUploads()[this.uploadKey(applicationId, type)];
  }

  canUploadRequirement(
    application: { id: number; status: string },
    type: string,
  ): boolean {
    if (
      this.api.mode !== 'api'
      || !this.isEditableApplicationStatus(application.status)
      || this.api.featureState('document_upload').availability !== 'available'
    ) return false;
    const currentStatus = this.documentStatusFor(application.id, type);
    if (currentStatus !== 'MISSING' && currentStatus !== 'REJECTED') return false;
    const state = this.uploadState(application.id, type);
    if (!state) return true;
    return !activeUploadStages.has(state.stage)
      && state.stage !== 'PENDING_REVIEW'
      && state.stage !== 'VERIFIED';
  }

  selectButtonLabel(applicationId: number, type: string): string {
    const status = this.documentStatusFor(applicationId, type);
    if (status === 'REJECTED') return 'Choose replacement';
    if (status === 'PENDING') return 'Pending review';
    if (status === 'VERIFIED') return 'Verified';
    return 'Choose file';
  }

  uploadButtonLabel(applicationId: number, type: string): string {
    const state = this.uploadState(applicationId, type);
    if (state?.stage === 'REQUESTING_UPLOAD') return 'Preparing upload…';
    if (state?.stage === 'UPLOADING') return `Uploading ${state.progress}%`;
    if (state?.stage === 'VERIFYING') return 'Verifying file…';
    return state?.stage === 'FAILED' ? 'Retry upload' : 'Upload selected file';
  }

  uploadStageLabel(stage: DocumentUploadStage): string {
    return ({
      NOT_UPLOADED: 'Not uploaded',
      REQUESTING_UPLOAD: 'Preparing secure upload',
      UPLOADING: 'Uploading',
      VERIFYING: 'Verifying file',
      PENDING_REVIEW: 'Uploaded · pending review',
      VERIFIED: 'Uploaded · verified',
      REJECTED: 'Upload rejected',
      FAILED: 'Upload failed',
    } as const)[stage];
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  selectDocumentFile(event: Event, applicationId: number, type: string): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!this.isBorrowerDocumentType(type)) {
      this.message.set('This document type is not available for upload.');
      return;
    }

    const key = this.uploadKey(applicationId, type);
    const validationError = validateApplicationDocument(file);
    if (validationError) {
      this.documentUploads.update((current) => ({
        ...current,
        [key]: { stage: 'FAILED', progress: 0, fileName: file.name, fileSize: file.size, error: validationError },
      }));
      return;
    }
    if (!this.canUploadRequirement(
      { id: applicationId, status: this.activeApplication()?.status ?? '' },
      type,
    )) {
      this.documentUploads.update((current) => ({
        ...current,
        [key]: {
          stage: 'FAILED',
          progress: 0,
          fileName: file.name,
          fileSize: file.size,
          error: 'This application is not currently able to accept this document.',
        },
      }));
      return;
    }
    this.documentUploads.update((current) => ({
      ...current,
      [key]: { stage: 'NOT_UPLOADED', progress: 0, fileName: file.name, fileSize: file.size, selectedFile: file },
    }));

  }

  startUpload(applicationId: number, type: string): void {
    if (!this.isBorrowerDocumentType(type)) return;
    const key = this.uploadKey(applicationId, type);
    const state = this.uploadState(applicationId, type);
    const file = state?.selectedFile;
    const application = this.activeApplication();
    if (!file || !application || application.id !== applicationId || !this.canUploadRequirement(application, type)) {
      return;
    }

    this.documentUploads.update((current) => ({
      ...current,
      [key]: { ...state, stage: 'REQUESTING_UPLOAD', progress: 0, error: undefined },
    }));
    const subscription = this.documentStorage.uploadApplicationDocument(
      applicationId,
      type,
      file,
    ).subscribe({
      next: (update) => {
        this.documentUploads.update((current) => ({
          ...current,
          [key]: {
            ...current[key],
            ...update,
            fileName: file.name,
            fileSize: file.size,
            selectedFile: update.documentId ? undefined : file,
          },
        }));
        if (update.documentId) {
          this.refreshFinalizedDocument(applicationId, key, file, update);
        }
      },
      error: (error: unknown) => {
        const message = error instanceof Error ? error.message : 'The document could not be uploaded.';
        this.documentUploads.update((current) => ({
          ...current,
          [key]: {
            ...current[key],
            stage: 'FAILED',
            error: message,
            fileName: file.name,
            fileSize: file.size,
            selectedFile: file,
          },
        }));
      },
      complete: () => {
        this.uploadSubscriptions.delete(key);
      },
    });
    this.uploadSubscriptions.set(key, subscription);
  }

  private refreshFinalizedDocument(
    applicationId: number,
    key: string,
    file: File,
    update: DocumentUploadUpdate,
  ): void {
    const refreshFailed = (detail: string) => {
      this.documentUploads.update((current) => ({
        ...current,
        [key]: {
          ...current[key],
          ...update,
          fileName: file.name,
          fileSize: file.size,
          selectedFile: undefined,
          error: detail,
        },
      }));
      this.message.set(`Upload finalized with backend status ${update.documentStatus}. ${detail}`);
    };
    this.api.loadMyApplicationDocuments(applicationId).subscribe({
      next: (documents) => {
        const document = documents.find((entry) => entry.id === update.documentId);
        if (!document) {
          refreshFailed('The refreshed document list did not include this file. Retry refreshing documents to confirm its current status.');
          return;
        }
        const stage = document.status === 'PENDING' ? 'PENDING_REVIEW' : document.status;
        this.documentUploads.update((current) => ({
          ...current,
          [key]: {
            ...current[key],
            ...update,
            stage,
            documentStatus: document.status,
            fileName: file.name,
            fileSize: file.size,
            selectedFile: undefined,
            error: undefined,
          },
        }));
        this.message.set(`Document upload finalized. Backend status: ${document.status}.`);
      },
      error: () => refreshFailed('The upload was finalized, but the document status could not be refreshed. Retry refreshing documents.'),
    });
  }

  loanPayments(loanId: number) {
    return this.api.data().payments.filter((payment) => payment.loanId === loanId);
  }

  submitPayment(loanId: number): void {
    if (!/^\d+(?:\.\d{1,2})?$/.test(this.paymentAmount) || Number(this.paymentAmount) <= 0
      || !this.paymentMethod.trim() || !this.paymentReference.trim()) {
      this.message.set('Enter a positive payment amount, method, and reference.');
      return;
    }
    this.message.set('');
    this.api.submitPayment(loanId, this.paymentAmount, this.paymentMethod.trim(), this.paymentReference.trim()).subscribe({
      next: (payment) => {
        this.message.set(`Payment ${payment.id} submitted with status ${payment.status}. It has not changed your balance.`);
        this.paymentAmount = '';
        this.paymentReference = '';
      },
      error: () => undefined,
    });
  }

  private fillDraft(app: NonNullable<ReturnType<BorrowerPortal['activeApplication']>>): void {
    const customer = this.api.data().customers.find((entry) => entry.id === app.customerId);
    const institution = app.institution ?? '';
    this.form.patchValue({
      borrowerType: app.borrowerType,
      fullName: app.fullName ?? customer?.fullName ?? '',
      phone: app.phone ?? customer?.phone ?? '',
      nationalId: app.nationalId ?? customer?.nationalId ?? '',
      institution,
      studentId: app.studentId ?? '',
      employer: app.employer ?? '',
      employmentStatus: app.employmentStatus ?? '',
      requestedAmount: String(app.requestedAmount),
      receivingMethod: app.receivingMethod ?? 'CASH',
      recipientName: app.recipientName ?? '',
      sameAsId: app.recipientName === customer?.fullName,
      recipientIdentifier: app.recipientIdentifier ?? '',
    });
    this.restoreInstitutionSelection(institution);
  }

  private resumeWizardStep(app: NonNullable<ReturnType<BorrowerPortal['activeApplication']>>): number {
    const savedStep = this.readSavedWizardStep(app);
    if (savedStep !== null) return savedStep;

    const customer = this.api.data().customers.find((entry) => entry.id === app.customerId);
    if (!(app.fullName || customer?.fullName) || !(app.phone || customer?.phone)) return 1;
    const categoryDetailsComplete = app.borrowerType === 'STUDENT'
      ? Boolean(app.institution?.trim() && app.studentId?.trim())
      : app.borrowerType === 'EMPLOYED'
        ? Boolean(app.employer?.trim() && app.employmentStatus?.trim())
        : true;
    return categoryDetailsComplete && app.receivingMethod ? 3 : 2;
  }

  private readSavedWizardStep(app: NonNullable<ReturnType<BorrowerPortal['activeApplication']>>): number | null {
    if (typeof window === 'undefined') return null;
    try {
      const saved = window.sessionStorage.getItem(this.wizardStepStorageKey(app));
      if (saved === null) return null;
      const step = Number(saved);
      return Number.isInteger(step) && step >= 0 && step < this.wizardSteps.length ? step : null;
    } catch {
      this.message.set('Your saved application is available, but this browser could not restore its last wizard step.');
      return null;
    }
  }

  private persistWizardStep(
    app: NonNullable<ReturnType<BorrowerPortal['activeApplication']>>,
    step: number,
  ): void {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(this.wizardStepStorageKey(app), String(step));
    } catch {
      this.message.set('Your application details were saved, but this browser could not save the last wizard step.');
    }
  }

  private wizardStepStorageKey(app: NonNullable<ReturnType<BorrowerPortal['activeApplication']>>): string {
    return `pjloans.application-step:${app.customerId}:${app.id}`;
  }

  private restoreInstitutionSelection(institution: string): void {
    if (!institution) {
      this.institutionChoice.set('');
      this.institutionLocation.set('');
      return;
    }
    const bcetLocation = this.bcetLocations.find((location) => institution === `${this.bcetInstitution} - ${location}`);
    if (bcetLocation) {
      this.institutionChoice.set(this.bcetInstitution);
      this.institutionLocation.set(bcetLocation);
      return;
    }
    if (this.institutions.includes(institution)) {
      this.institutionChoice.set(institution);
      this.institutionLocation.set('');
      return;
    }
    this.institutionChoice.set('OTHER');
    this.institutionLocation.set('');
  }

  refreshRequirements(): void {
    this.api.loadBorrowerRequirements(this.form.controls.borrowerType.value).subscribe({
      next: (requirements) => this.requirementsState.set(requirements),
      error: () => this.requirementsState.set(null),
    });
  }

  requirements() {
    const application = this.activeApplication();
    if (application && application.borrowerType !== this.form.controls.borrowerType.value) {
      return this.api.getRequirements(application.borrowerType);
    }
    return this.requirementsState()?.requiredDocuments ?? this.api.getRequirements(this.form.controls.borrowerType.value);
  }

  requirementsFor(type: string) {
    return this.api.getRequirements(type);
  }

  documentStatus(type: string): string {
    const app = this.activeApplication();
    return app ? this.documentStatusFor(app.id, type) : 'MISSING';
  }

  documentNote(type: string): string | undefined {
    const app = this.activeApplication();
    return app ? this.latestDocument(app.id, type)?.reviewNote : undefined;
  }

  missingRequirements(app: { id: number; borrowerType: string }): string[] {
    return this.requirementsFor(app.borrowerType).filter((type) => {
      const document = this.api.data().documents.find((entry) => entry.applicationId === app.id && entry.documentType === type);
      return document?.status !== 'VERIFIED';
    });
  }

  categoryLabel(type: BorrowerType): string {
    return type === 'STUDENT' ? 'Studying at an institution' : type === 'EMPLOYED' ? 'Currently employed' : 'Currently unemployed';
  }

  requirementDescription(type: string): string {
    const descriptions: Record<string, string> = {
      STUDENT_ID: 'Student identification · image or PDF',
      ADMISSION_LETTER: 'Admission letter · image or PDF',
      IDENTITY_DOCUMENT: 'Omang or passport · image or PDF',
      EMPLOYMENT_LETTER: 'Employment or contract letter · image or PDF',
    };
    return descriptions[type] ?? 'Accepted formats: image or PDF';
  }

  progress(status: string): number {
    return ({ IN_PROGRESS: 24, SUBMITTED: 55, APPROVED: 78, DISBURSED: 100 } as Record<string, number>)[status] ?? 12;
  }

  statusDescription(status: string): string {
    return ({ IN_PROGRESS: 'Application in progress', SUBMITTED: 'Awaiting review', APPROVED: 'Approved, awaiting disbursement', DISBURSED: 'Loan disbursed' } as Record<string, string>)[status] ?? status;
  }

  statusClass(status: string): string {
    return `status-${status.toLowerCase().replaceAll('_', '-')}`;
  }

  private uploadKey(applicationId: number, type: string): string {
    return `${applicationId}:${type}`;
  }

  private isBorrowerDocumentType(type: string): type is BorrowerDocumentType {
    return type === 'STUDENT_ID'
      || type === 'ADMISSION_LETTER'
      || type === 'IDENTITY_DOCUMENT'
      || type === 'EMPLOYMENT_LETTER';
  }

  money(value: DecimalValue): string {
    return formatBwp(value);
  }

  canCancelApplication(app: Application): boolean {
    return app.status === 'IN_PROGRESS' || app.status === 'SUBMITTED';
  }

  cancelApplication(app: Application): void {
    if (!this.canCancelApplication(app) || this.cancellingApplication()) return;
    if (!window.confirm('Cancel this application? It will be marked as cancelled. Your customer and KYC documents will be preserved.')) return;
    this.cancellingApplication.set(true);
    this.api.cancelApplication(app.id).subscribe({
      next: () => {
        this.cancellingApplication.set(false);
        this.message.set('Application cancelled successfully.');
        this.api.loadMyApplications().subscribe();
        this.reloadApplicationDocuments();
      },
      error: () => this.cancellingApplication.set(false),
    });
  }

  previewDocument(documentId: number): void {
    this.previewDocumentId = documentId;
    this.previewError.set('');
    this.previewLoading.set(true);
    this.preview.set(null);
    this.documentStorage.getDocumentViewUrl(documentId).subscribe({
      next: (preview) => {
        this.previewLoading.set(false);
        this.preview.set(preview);
      },
      error: (error: Error) => {
        this.previewLoading.set(false);
        this.previewError.set(error.message);
      },
    });
  }

  retryPreview(): void {
    if (this.previewDocumentId !== null) this.previewDocument(this.previewDocumentId);
  }

  closePreview(): void {
    this.preview.set(null);
    this.previewError.set('');
    this.previewDocumentId = null;
  }

  safePreviewUrl(url: string | undefined): SafeResourceUrl | null {
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  }
}
