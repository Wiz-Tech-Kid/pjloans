import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from './auth.service';
import { BorrowerType } from './models';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <main class="auth-page">
      <section class="auth-card" aria-labelledby="sign-in-heading">
        <a class="brand-mark auth-brand" routerLink="/login"><span class="brand-glyph">PJ</span><span>loans</span><small>MOVE FORWARD</small></a>
        <p class="eyebrow">Borrower portal</p>
        <h1 id="sign-in-heading">Welcome back</h1>
        <p class="auth-intro">Sign in to continue to your borrower portal.</p>
        <p class="auth-intro" *ngIf="!auth.ready()" role="status" aria-live="polite">Checking your session…</p>
        <p class="auth-error" *ngIf="auth.mode === 'supabase' && !auth.configured" role="alert">Sign-in is temporarily unavailable. Please try again later.</p>
        <ng-container *ngIf="auth.mode === 'supabase'; else developmentSignIn">
          <form class="auth-form" (ngSubmit)="signIn()" #signInForm="ngForm" novalidate>
            <label>
              <span>Email address</span>
              <input type="email" name="email" [(ngModel)]="email" required email autocomplete="email" inputmode="email" placeholder="you@example.com" />
            </label>
            <label>
              <span>Password</span>
              <span class="password-control">
                <input [type]="showPassword() ? 'text' : 'password'" name="password" [(ngModel)]="password" required autocomplete="current-password" />
                <button type="button" class="password-toggle" (click)="showPassword.update(value => !value)" [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'">{{ showPassword() ? 'Hide' : 'Show' }}</button>
              </span>
            </label>
            <label class="remember-option"><input type="checkbox" name="rememberMe" [(ngModel)]="rememberMe" /><span>Remember me</span></label>
            <p class="auth-error" *ngIf="error()" role="alert">{{ error() }}</p>
            <button class="button primary-button auth-submit" type="submit" [disabled]="!auth.ready() || !auth.configured || auth.loading() || !signInForm.form.valid">
              {{ auth.loading() ? 'Signing in…' : 'Sign in' }}
            </button>
          </form>
          <button class="button secondary-button auth-submit" type="button" *ngIf="auth.isAuthenticated() && error()" [disabled]="auth.loading()" (click)="retryCustomerSetup()">
            Retry borrower profile setup
          </button>
        </ng-container>
        <ng-template #developmentSignIn>
          <button class="button primary-button auth-submit" type="button" [disabled]="!auth.ready() || auth.loading()" (click)="signIn()">
            {{ auth.loading() ? 'Opening…' : 'Continue' }}
          </button>
        </ng-template>
        <a class="auth-link" routerLink="/forgot-password">Forgot your password?</a>
        <p class="auth-switch">New to PJloans? <a routerLink="/register">Create account</a></p>
      </section>
    </main>
  `,
})
export class BorrowerSignIn implements OnInit {
  readonly auth = inject(AuthService);
  readonly router = inject(Router);
  readonly showPassword = signal(false);
  readonly error = signal<string | null>(null);
  email = '';
  password = '';
  rememberMe = true;

  async ngOnInit(): Promise<void> {
    await this.auth.whenReady();
    if (this.auth.isAuthenticated()) {
      try {
        await this.auth.initializeOperationalCustomerProfile();
        await this.router.navigateByUrl('/dashboard');
      } catch (error) {
        this.error.set(error instanceof Error ? error.message : 'Your borrower profile setup could not be completed.');
      }
    } else if (this.auth.authError()) {
      this.error.set(this.auth.authError());
    }
  }

  async signIn(): Promise<void> {
    this.error.set(null);
    try {
      await this.auth.signIn(this.email, this.password, this.rememberMe);
      await this.router.navigateByUrl('/dashboard');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'We could not sign you in. Please try again.');
    }
  }

  async retryCustomerSetup(): Promise<void> {
    this.error.set(null);
    try {
      await this.auth.initializeOperationalCustomerProfile();
      await this.router.navigateByUrl('/dashboard');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Your borrower profile setup could not be completed.');
    }
  }
}

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <main class="auth-page">
      <section class="auth-card" aria-labelledby="register-heading">
        <a class="brand-mark auth-brand" routerLink="/login"><span class="brand-glyph">PJ</span><span>loans</span><small>MOVE FORWARD</small></a>
        <p class="eyebrow">Borrower account</p>
        <h1 id="register-heading">Create your account</h1>
        <p class="auth-intro">Your details help us set up your borrower profile.</p>
        <p class="auth-error" *ngIf="auth.mode === 'supabase' && !auth.configured" role="alert">Account creation is temporarily unavailable. Please try again later.</p>

        <ng-container *ngIf="profileInitializationError(); else registrationOrConfirmation">
          <section class="auth-confirmation" aria-live="polite">
            <span class="confirmation-mark" aria-hidden="true">!</span>
            <h2>Account created; setup needs another try</h2>
            <p>Your sign-in was created, but the operational customer profile could not be initialized. You are not being sent into the portal until that step succeeds.</p>
            <p class="auth-error" role="alert">{{ profileInitializationError() }}</p>
            <button class="button primary-button auth-submit" type="button" (click)="retryCustomerSetup()" [disabled]="auth.loading() || profileInitializing()">
              {{ profileInitializing() ? 'Setting up profile…' : 'Retry customer setup' }}
            </button>
            <a class="auth-link" routerLink="/sign-in">Continue to sign in</a>
          </section>
        </ng-container>
        <ng-template #registrationOrConfirmation>
        <ng-container *ngIf="!confirmationEmail(); else confirmation">
          <form class="auth-form" (ngSubmit)="register()" #registerForm="ngForm" novalidate>
            <label>
              <span>Full name</span>
              <input name="fullName" [(ngModel)]="fullName" required autocomplete="name" maxlength="120" placeholder="Your full name" />
            </label>
            <label>
              <span>Email address</span>
              <input type="email" name="email" [(ngModel)]="email" required email autocomplete="email" inputmode="email" placeholder="you@example.com" />
            </label>
            <label>
              <span>Mobile number</span>
              <input type="tel" name="phone" [(ngModel)]="phone" required autocomplete="tel" inputmode="tel" pattern="^[+]?[0-9 ()-]{7,24}$" placeholder="+267 71 234 567" />
            </label>
            <label>
              <span>User type</span>
              <select name="borrowerType" [(ngModel)]="borrowerType" required>
                <option value="STUDENT">Student</option>
                <option value="EMPLOYED">Employed</option>
                <option value="UNEMPLOYED">Unemployed</option>
              </select>
            </label>
            <label>
              <span>Password</span>
              <span class="password-control">
                <input [type]="showPassword() ? 'text' : 'password'" name="password" [(ngModel)]="password" required minlength="10" autocomplete="new-password" />
                <button type="button" class="password-toggle" (click)="showPassword.update(value => !value)" [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'">{{ showPassword() ? 'Hide' : 'Show' }}</button>
              </span>
            </label>
            <p class="password-hint" aria-live="polite">Use at least 10 characters, with a number and a symbol. Strength: {{ passwordStrength() }}.</p>
            <label>
              <span>Confirm password</span>
              <span class="password-control">
                <input [type]="showConfirmPassword() ? 'text' : 'password'" name="confirmPassword" [(ngModel)]="confirmPassword" required autocomplete="new-password" />
                <button type="button" class="password-toggle" (click)="showConfirmPassword.update(value => !value)" [attr.aria-label]="showConfirmPassword() ? 'Hide password' : 'Show password'">{{ showConfirmPassword() ? 'Hide' : 'Show' }}</button>
              </span>
            </label>
            <p class="auth-error" *ngIf="error()" role="alert">{{ error() }}</p>
            <button class="button primary-button auth-submit" type="submit" [disabled]="auth.loading() || (auth.mode === 'supabase' && !auth.configured) || !registerForm.form.valid">
              {{ auth.loading() ? 'Creating account…' : 'Create account' }}
            </button>
          </form>
          <p class="auth-error" *ngIf="confirmPassword && password !== confirmPassword" aria-live="polite">Your passwords do not match.</p>
          <p class="auth-switch">Already have an account? <a routerLink="/sign-in">Sign in</a></p>
        </ng-container>

        <ng-template #confirmation>
          <section class="auth-confirmation" aria-live="polite">
            <span class="confirmation-mark" aria-hidden="true">✓</span>
            <h2>Check your inbox</h2>
            <p>We sent an email confirmation link to <strong>{{ maskedEmail() }}</strong>. Open it to confirm your email, then return here to sign in.</p>
            <button class="button secondary-button auth-submit" type="button" (click)="resendConfirmation()" [disabled]="auth.loading() || resendCooldown() > 0">
              {{ auth.loading() ? 'Sending…' : resendCooldown() > 0 ? 'Resend in ' + resendCooldown() + 's' : 'Resend confirmation email' }}
            </button>
            <p class="auth-error" *ngIf="error()" role="alert">{{ error() }}</p>
            <a class="auth-link" routerLink="/sign-in">Return to sign in</a>
          </section>
        </ng-template>
        </ng-template>
      </section>
    </main>
  `,
})
export class BorrowerRegister implements OnDestroy {
  readonly auth = inject(AuthService);
  readonly router = inject(Router);
  readonly showPassword = signal(false);
  readonly showConfirmPassword = signal(false);
  readonly error = signal<string | null>(null);
  readonly confirmationEmail = signal('');
  readonly profileInitializationError = signal<string | null>(null);
  readonly profileInitializing = signal(false);
  readonly resendCooldown = signal(0);
  fullName = '';
  email = '';
  phone = '+267 ';
  borrowerType: BorrowerType = 'STUDENT';
  password = '';
  confirmPassword = '';
  private resendTimer?: ReturnType<typeof setInterval>;

  async register(): Promise<void> {
    this.error.set(null);
    if (!this.fullName.trim()) {
      this.error.set('Enter your full name.');
      return;
    }
    if (this.password !== this.confirmPassword) {
      this.error.set('Your passwords do not match.');
      return;
    }
    if (this.password.length < 10 || !/\d/.test(this.password) || !/[^A-Za-z0-9]/.test(this.password)) {
      this.error.set('Use at least 10 characters, including a number and a symbol.');
      return;
    }
    if (!/^\+?[0-9 ()-]{7,24}$/.test(this.phone.trim())) {
      this.error.set('Enter a valid mobile number, including its country code.');
      return;
    }

    try {
      const result = await this.auth.signUp(this.email, this.password, {
        fullName: this.fullName.trim(),
        phone: this.phone.trim(),
        borrowerType: this.borrowerType,
      });
      this.password = '';
      this.confirmPassword = '';
      if (result.confirmationRequired) {
        this.confirmationEmail.set(this.email.trim());
      } else if (result.profileInitializationError) {
        this.profileInitializationError.set(result.profileInitializationError);
      } else {
        await this.router.navigateByUrl('/dashboard');
      }
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'We could not create your account. Please try again.');
    }
  }

  async retryCustomerSetup(): Promise<void> {
    this.profileInitializing.set(true);
    this.profileInitializationError.set(null);
    try {
      await this.auth.initializeOperationalCustomerProfile();
      await this.router.navigateByUrl('/dashboard');
    } catch (error) {
      this.profileInitializationError.set(error instanceof Error
        ? error.message
        : 'Your borrower profile setup could not be completed.');
    } finally {
      this.profileInitializing.set(false);
    }
  }

  async resendConfirmation(): Promise<void> {
    this.error.set(null);
    try {
      await this.auth.resendConfirmation(this.confirmationEmail());
      this.resendCooldown.set(60);
      this.resendTimer = setInterval(() => {
        const remaining = this.resendCooldown() - 1;
        this.resendCooldown.set(remaining);
        if (remaining <= 0 && this.resendTimer) {
          clearInterval(this.resendTimer);
          this.resendTimer = undefined;
        }
      }, 1000);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'We could not resend the email right now.');
    }
  }

  passwordStrength(): string {
    if (!this.password) return 'not set';
    const score = Number(this.password.length >= 10)
      + Number(/\d/.test(this.password))
      + Number(/[^A-Za-z0-9]/.test(this.password))
      + Number(/[A-Z]/.test(this.password) && /[a-z]/.test(this.password));
    return score >= 4 ? 'strong' : score >= 2 ? 'fair' : 'needs work';
  }

  maskedEmail(): string {
    const [name, domain] = this.confirmationEmail().split('@');
    if (!name || !domain) return 'your email address';
    return `${name.slice(0, 1)}${name.length > 1 ? '•••' : ''}@${domain}`;
  }

  ngOnDestroy(): void {
    if (this.resendTimer) clearInterval(this.resendTimer);
  }
}

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <main class="auth-page">
      <section class="auth-card" aria-labelledby="recovery-heading">
        <a class="brand-mark auth-brand" routerLink="/login"><span class="brand-glyph">PJ</span><span>loans</span><small>MOVE FORWARD</small></a>
        <ng-container *ngIf="!requested(); else requestedState">
          <p class="eyebrow">Account recovery</p>
          <h1 id="recovery-heading">Forgot your password?</h1>
          <p class="auth-intro">Enter your email address and, if an account can receive a reset link, we’ll send instructions.</p>
          <form class="auth-form" (ngSubmit)="requestReset()" #resetForm="ngForm" novalidate>
            <label>
              <span>Email address</span>
              <input type="email" name="email" [(ngModel)]="email" required email autocomplete="email" inputmode="email" placeholder="you@example.com" />
            </label>
            <p class="auth-error" *ngIf="error()" role="alert">{{ error() }}</p>
            <button class="button primary-button auth-submit" type="submit" [disabled]="auth.loading() || !resetForm.form.valid">
              {{ auth.loading() ? 'Sending…' : 'Send reset link' }}
            </button>
          </form>
          <a class="auth-link" routerLink="/sign-in">Return to sign in</a>
        </ng-container>
        <ng-template #requestedState>
          <section class="auth-confirmation" aria-live="polite">
            <span class="confirmation-mark" aria-hidden="true">✓</span>
            <h2>Check your inbox</h2>
            <p>If an account can receive a reset link, instructions will be sent to <strong>{{ maskedEmail() }}</strong>.</p>
            <a class="button primary-button auth-submit" routerLink="/sign-in">Return to sign in</a>
          </section>
        </ng-template>
      </section>
    </main>
  `,
})
export class BorrowerPasswordRecovery {
  readonly auth = inject(AuthService);
  readonly requested = signal(false);
  readonly error = signal<string | null>(null);
  email = '';

  async requestReset(): Promise<void> {
    this.error.set(null);
    try {
      await this.auth.requestPasswordReset(this.email);
      this.requested.set(true);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'We could not send a reset link right now.');
    }
  }

  maskedEmail(): string {
    const [name, domain] = this.email.trim().split('@');
    return name && domain ? `${name.slice(0, 1)}${name.length > 1 ? '•••' : ''}@${domain}` : 'your email address';
  }
}

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <main class="auth-page">
      <section class="auth-card" aria-labelledby="new-password-heading">
        <a class="brand-mark auth-brand" routerLink="/login"><span class="brand-glyph">PJ</span><span>loans</span><small>MOVE FORWARD</small></a>
        <ng-container *ngIf="!updated(); else success">
          <p class="eyebrow">Secure your account</p>
          <h1 id="new-password-heading">{{ validLink() ? 'Choose a new password' : 'Password link unavailable' }}</h1>
          <p class="auth-intro" *ngIf="validLink()">Use at least 10 characters, including a number and a symbol.</p>
          <form class="auth-form" *ngIf="validLink()" (ngSubmit)="updatePassword()" #passwordForm="ngForm" novalidate>
            <label>
              <span>New password</span>
              <span class="password-control"><input [type]="showPassword() ? 'text' : 'password'" name="password" [(ngModel)]="password" required minlength="10" autocomplete="new-password" /><button type="button" class="password-toggle" (click)="showPassword.update(value => !value)" [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'">{{ showPassword() ? 'Hide' : 'Show' }}</button></span>
            </label>
            <label>
              <span>Confirm new password</span>
              <input type="password" name="confirmPassword" [(ngModel)]="confirmPassword" required autocomplete="new-password" />
            </label>
            <p class="auth-error" *ngIf="error()" role="alert">{{ error() }}</p>
            <button class="button primary-button auth-submit" type="submit" [disabled]="auth.loading() || !passwordForm.form.valid">{{ auth.loading() ? 'Saving…' : 'Save new password' }}</button>
          </form>
          <p class="auth-error" *ngIf="!validLink()" role="alert">This link may have expired or already been used. Request a new password reset email.</p>
          <a class="auth-link" routerLink="/forgot-password">Request a new reset link</a>
        </ng-container>
        <ng-template #success>
          <section class="auth-confirmation" aria-live="polite">
            <span class="confirmation-mark" aria-hidden="true">✓</span>
            <h2>Password updated</h2>
            <p>You can now sign in with your new password.</p>
            <a class="button primary-button auth-submit" routerLink="/sign-in">Return to sign in</a>
          </section>
        </ng-template>
      </section>
    </main>
  `,
})
export class BorrowerPasswordReset implements OnInit {
  readonly auth = inject(AuthService);
  readonly showPassword = signal(false);
  readonly updated = signal(false);
  readonly error = signal<string | null>(null);
  password = '';
  confirmPassword = '';

  async ngOnInit(): Promise<void> {
    await this.auth.whenReady();
  }

  validLink(): boolean {
    return this.auth.passwordRecovery() && this.auth.isAuthenticated();
  }

  async updatePassword(): Promise<void> {
    this.error.set(null);
    if (this.password !== this.confirmPassword) {
      this.error.set('Your passwords do not match.');
      return;
    }
    if (this.password.length < 10 || !/\d/.test(this.password) || !/[^A-Za-z0-9]/.test(this.password)) {
      this.error.set('Use at least 10 characters, including a number and a symbol.');
      return;
    }
    try {
      await this.auth.updatePassword(this.password);
      this.updated.set(true);
      this.password = '';
      this.confirmPassword = '';
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'We could not update your password.');
    }
  }
}
