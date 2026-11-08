import { Injectable, inject, signal } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';
import { environment } from './environment';
import { BorrowerType, FeatureState } from './models';
import { PUBLIC_RUNTIME_CONFIG } from './public-config';

export interface OperationalCustomerProfile {
  customerId: string;
  phone: string;
  fullName: string | null;
  nationalId: string | null;
  borrowerType: BorrowerType | null;
}

export interface BorrowerRegistrationProfile {
  fullName: string;
  phone: string;
  borrowerType: BorrowerType | null;
  nationalId?: string | null;
}

export interface SignUpResult {
  confirmationRequired: boolean;
  profileInitializationError?: string;
}

interface InitializeCustomerProfileArgs {
  p_phone: string;
  p_full_name: string | null;
  p_national_id: string | null;
  p_borrower_type: BorrowerType | null;
}

function isBorrowerType(value: unknown): value is BorrowerType {
  return value === 'STUDENT' || value === 'EMPLOYED' || value === 'UNEMPLOYED';
}

function profileFromMetadata(metadata: User['user_metadata']): BorrowerRegistrationProfile | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const phone = metadata['phone'];
  const fullName = metadata['full_name'];
  const borrowerType = metadata['borrower_type'];
  if (typeof phone !== 'string' || (borrowerType != null && !isBorrowerType(borrowerType))) return null;
  return {
    phone,
    fullName: typeof fullName === 'string' ? fullName : '',
    borrowerType: isBorrowerType(borrowerType) ? borrowerType : null,
  };
}

function parseOperationalCustomerProfile(value: unknown): OperationalCustomerProfile {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error('The customer setup function did not return exactly one customer profile.');
  }
  const row: unknown = value[0];
  if (typeof row !== 'object' || row === null) {
    throw new Error('The customer setup function returned an invalid customer profile.');
  }
  const result = row as Record<string, unknown>;
  const customerId = result['customer_id'];
  const phone = result['phone'];
  const fullName = result['full_name'];
  const nationalId = result['national_id'];
  const borrowerType = result['borrower_type'];
  if (
    typeof customerId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(customerId)
    || typeof phone !== 'string'
    || (fullName !== null && typeof fullName !== 'string')
    || (nationalId !== null && typeof nationalId !== 'string')
    || (borrowerType !== null && !isBorrowerType(borrowerType))
  ) {
    throw new Error('The customer setup function returned a customer profile with invalid fields.');
  }
  return {
    customerId,
    phone,
    fullName,
    nationalId,
    borrowerType,
  };
}

function parseCustomerProfileRows(value: unknown, authenticatedUserId: string): OperationalCustomerProfile {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error('Your saved borrower profile could not be found. Retry profile retrieval or contact support.');
  }
  const profile = parseOperationalCustomerProfile(value);
  if (profile.customerId !== authenticatedUserId) {
    throw new Error('The saved borrower profile does not match the signed-in account.');
  }
  return profile;
}

function initialProfileFeatureState(): FeatureState {
  return { availability: 'available', request: 'idle', error: null, errorCode: null };
}

function isValidSupabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function isServiceRoleJwt(key: string): boolean {
  const [, payload] = key.split('.');
  if (!payload) return false;
  try {
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role';
  } catch {
    return false;
  }
}

function isInvitedUser(user: User): boolean {
  return 'invited_at' in user && typeof user.invited_at === 'string';
}

const invalidAdminPasswordLinkMessage =
  'This password setup link is invalid, expired, or already used. Return to Admin sign in to request a new email.';
const adminPasswordSetupStorageKey = 'pjloans.admin.password-setup.pending';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly publicConfig = inject(PUBLIC_RUNTIME_CONFIG);
  private rememberSession = true;
  private mockAuthenticated = false;
  private readonly storage = {
    getItem: (key: string): string | null => {
      if (typeof window === 'undefined') return null;
      return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
    },
    setItem: (key: string, value: string): void => {
      if (typeof window === 'undefined') return;
      const selectedStorage = this.rememberSession ? window.localStorage : window.sessionStorage;
      const otherStorage = this.rememberSession ? window.sessionStorage : window.localStorage;
      selectedStorage.setItem(key, value);
      otherStorage.removeItem(key);
    },
    removeItem: (key: string): void => {
      if (typeof window === 'undefined') return;
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    },
  };
  private readonly initialAuthCallbackUrl = typeof window === 'undefined'
    ? null
    : new URL(window.location.href);

  readonly session = signal<Session | null>(null);
  readonly user = signal<User | null>(null);
  readonly loading = signal(false);
  readonly ready = signal(false);
  readonly authError = signal<string | null>(null);
  readonly passwordRecovery = signal(false);
  readonly customerProfile = signal<OperationalCustomerProfile | null>(null);
  readonly profileInitializationState = signal<FeatureState>(initialProfileFeatureState());
  readonly profileRetrievalState = signal<FeatureState>(initialProfileFeatureState());
  readonly mode = this.publicConfig.authMode;
  readonly configured = Boolean(
    isValidSupabaseUrl(this.publicConfig.supabaseUrl)
    && this.publicConfig.supabaseAnonKey
    && !this.publicConfig.supabaseAnonKey.startsWith('sb_secret_')
    && !isServiceRoleJwt(this.publicConfig.supabaseAnonKey),
  );

  private readonly client: SupabaseClient | null = this.mode === 'supabase' && this.configured
    ? createClient(this.publicConfig.supabaseUrl, this.publicConfig.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: this.storage,
      },
    })
    : null;

  private readonly sessionReady: Promise<void>;
  private initializedProfileUserId: string | null = null;
  private profileInitialization: Promise<void> | null = null;
  private profileRetrieval: Promise<OperationalCustomerProfile> | null = null;

  constructor() {
    if (environment.production && this.mode === 'mock') {
      throw new Error('Mock authentication is not allowed in production.');
    }

    this.client?.auth.onAuthStateChange((event, nextSession) => {
      this.session.set(nextSession);
      this.user.set(nextSession?.user ?? null);
      if (nextSession?.user.id !== this.initializedProfileUserId) {
        this.customerProfile.set(null);
        this.initializedProfileUserId = null;
        this.profileInitialization = null;
        this.profileRetrieval = null;
        this.profileInitializationState.set(initialProfileFeatureState());
        this.profileRetrievalState.set(initialProfileFeatureState());
      }
      if (event === 'PASSWORD_RECOVERY') {
        this.passwordRecovery.set(true);
      }
    });
    this.sessionReady = this.restoreSession();
  }

  async whenReady(): Promise<void> {
    await this.sessionReady;
  }

  getSupabaseClient(): SupabaseClient {
    if (this.mode !== 'supabase') {
      throw new Error('Supabase account services are unavailable in mock mode.');
    }
    return this.requireClient();
  }

  async restoreSession(): Promise<void> {
    try {
      if (this.mode === 'mock' || !this.configured) return;
      const { data, error } = await this.requireClient().auth.getSession();
      if (error) {
        this.authError.set('Your previous sign-in could not be restored. Please sign in again.');
        return;
      }
      this.session.set(data.session);
      this.user.set(data.session?.user ?? null);
      this.passwordRecovery.set(
        Boolean(data.session && typeof window !== 'undefined' && window.location.hash.includes('type=recovery')),
      );
    } finally {
      this.ready.set(true);
    }
  }

  async signIn(email: string, password: string, rememberMe = true): Promise<User | null> {
    if (this.mode === 'mock') {
      this.mockAuthenticated = true;
      return null;
    }
    this.requireConfigured();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      throw new Error('Enter your email address and password.');
    }

    this.loading.set(true);
    this.authError.set(null);
    this.rememberSession = rememberMe;
    try {
      const { data, error } = await this.requireClient().auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });
      if (error) {
        const message = error.code === 'email_not_confirmed'
          ? 'Check your inbox and confirm your email before signing in.'
          : error.code === 'invalid_credentials'
            ? 'Your email or password is incorrect.'
            : 'We could not sign you in. Check your connection and try again.';
        this.authError.set(message);
        throw new Error(message);
      }
      if (!data.user) throw new Error('We could not complete sign-in. Please try again.');
      this.session.set(data.session);
      this.user.set(data.user);
      await this.initializeOperationalCustomerProfile();
      return data.user;
    } finally {
      this.loading.set(false);
    }
  }

  async signInAsAdmin(email: string, password: string, rememberMe = true): Promise<User> {
    this.requireConfigured();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      throw new Error('Enter your email address and password.');
    }

    this.loading.set(true);
    this.authError.set(null);
    this.rememberSession = rememberMe;
    try {
      const { data, error } = await this.requireClient().auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });
      if (error || !data.user || !data.session) {
        const message = error?.code === 'email_not_confirmed'
          ? 'Check your inbox and confirm your email before signing in.'
          : error?.code === 'invalid_credentials'
            ? 'Your email or password is incorrect.'
            : 'We could not sign you in. Check your connection and try again.';
        this.authError.set(message);
        throw new Error(message);
      }

      this.session.set(data.session);
      this.user.set(data.user);
      try {
        await this.requireActiveAdmin();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Administrator access could not be verified.';
        this.authError.set(message);
        const { error: signOutError } = await this.requireClient().auth.signOut();
        if (signOutError) {
          console.error('Could not clear a rejected Admin session.', {
            code: signOutError.code,
            message: signOutError.message,
          });
        }
        this.session.set(null);
        this.user.set(null);
        throw new Error(message);
      }
      return data.user;
    } finally {
      this.loading.set(false);
    }
  }

  async acceptAdminPasswordLink(): Promise<void> {
    await this.whenReady();
    this.requireConfigured();
    const callbackUrl = this.initialAuthCallbackUrl;
    if (!callbackUrl) throw new Error(invalidAdminPasswordLinkMessage);

    const hashParams = new URLSearchParams(callbackUrl.hash.replace(/^#/, ''));
    const type = callbackUrl.searchParams.get('type') ?? hashParams.get('type');
    const flow = callbackUrl.searchParams.get('flow');
    const isAdminRecovery = type === 'recovery' && flow === 'admin-password-setup';
    if (
      callbackUrl.searchParams.has('error')
      || hashParams.has('error')
      || (type !== null && type !== 'invite' && !isAdminRecovery)
    ) {
      throw new Error(invalidAdminPasswordLinkMessage);
    }

    const tokenHash = callbackUrl.searchParams.get('token_hash') ?? hashParams.get('token_hash');
    const code = callbackUrl.searchParams.get('code') ?? hashParams.get('code');
    let acceptedSession: Session | null = null;
    let acceptedUser: User | null = null;

    if (tokenHash) {
      if (type !== 'invite' && !isAdminRecovery) throw new Error(invalidAdminPasswordLinkMessage);
      const { data, error } = await this.requireClient().auth.verifyOtp({
        token_hash: tokenHash,
        type: isAdminRecovery ? 'recovery' : 'invite',
      });
      if (error || !data.session || !data.user) {
        throw new Error(invalidAdminPasswordLinkMessage);
      }
      acceptedSession = data.session;
      acceptedUser = data.user;
      if (isAdminRecovery) this.passwordRecovery.set(true);
    } else if (code) {
      const currentSession = this.session();
      const currentUser = this.user();
      if (
        currentSession
        && currentUser
        && (isAdminRecovery ? this.passwordRecovery() : isInvitedUser(currentUser))
      ) {
        acceptedSession = currentSession;
        acceptedUser = currentUser;
      } else {
        const { data, error } = await this.requireClient().auth.exchangeCodeForSession(code);
        if (error || !data.session || !data.user) {
          throw new Error(invalidAdminPasswordLinkMessage);
        }
        acceptedSession = data.session;
        acceptedUser = data.user;
      }
      if (!isAdminRecovery && !isInvitedUser(acceptedUser)) {
        throw new Error(invalidAdminPasswordLinkMessage);
      }
    } else {
      const accessToken = hashParams.get('access_token');
      if ((!isAdminRecovery && type !== 'invite') || !accessToken) {
        throw new Error(invalidAdminPasswordLinkMessage);
      }
      const { data, error } = await this.requireClient().auth.getSession();
      if (
        error
        || !data.session
        || data.session.access_token !== accessToken
        || (isAdminRecovery && !this.passwordRecovery())
      ) {
        throw new Error(invalidAdminPasswordLinkMessage);
      }
      acceptedSession = data.session;
      acceptedUser = data.session.user;
    }

    this.session.set(acceptedSession);
    this.user.set(acceptedUser);
    try {
      await this.requireActiveAdmin();
    } catch (error) {
      this.clearPendingAdminPasswordSetup();
      try {
        const { error: signOutError } = await this.requireClient().auth.signOut();
        if (signOutError) {
          console.error('Could not clear a rejected Admin invitation session.', {
            code: signOutError.code,
            message: signOutError.message,
          });
        }
      } catch (signOutError) {
        console.error('Could not clear a rejected Admin invitation session.', {
          message: signOutError instanceof Error ? signOutError.message : 'Unknown sign-out error.',
        });
      }
      this.session.set(null);
      this.user.set(null);
      throw error;
    }

    const userId = this.user()?.id;
    if (!userId || !acceptedSession.access_token) {
      throw new Error('Your password setup link could not be verified. Request a new email link and open it in this browser.');
    }
    window.sessionStorage.setItem(adminPasswordSetupStorageKey, userId);
  }

  hasAdminInvitationCallback(): boolean {
    const callbackUrl = this.initialAuthCallbackUrl;
    if (!callbackUrl) return false;
    const hashParams = new URLSearchParams(callbackUrl.hash.replace(/^#/, ''));
    const type = callbackUrl.searchParams.get('type') ?? hashParams.get('type');
    const hasCallbackError = ['error', 'error_code', 'error_description'].some((key) =>
      callbackUrl.searchParams.has(key) || hashParams.has(key),
    );
    const hasAuthToken = ['token_hash', 'code', 'access_token'].some((key) =>
      callbackUrl.searchParams.has(key) || hashParams.has(key),
    );
    const isPasswordSetupLink = callbackUrl.searchParams.get('flow') === 'admin-password-setup';
    return hasCallbackError || (
      hasAuthToken
      && (type === null || type === 'invite' || (type === 'recovery' && isPasswordSetupLink))
    );
  }

  clearAdminAuthCallbackUrl(): void {
    if (typeof window !== 'undefined' && window.location.pathname === '/auth/callback') {
      window.history.replaceState(window.history.state, document.title, window.location.pathname);
    }
  }

  async requireAdminPasswordSetupSession(): Promise<void> {
    await this.whenReady();
    const pendingUserId = typeof window === 'undefined'
      ? null
      : window.sessionStorage.getItem(adminPasswordSetupStorageKey);
    if (!pendingUserId || !this.isAuthenticated() || pendingUserId !== this.user()?.id) {
      throw new Error('Open the secure password setup link sent to your Admin email before setting a password.');
    }
    await this.requireActiveAdmin();
  }

  async refreshAdminSession(): Promise<void> {
    this.requireConfigured();
    const { data, error } = await this.requireClient().auth.refreshSession();
    if (error || !data.session || !data.user) {
      throw new Error('Your invitation session could not be refreshed. Sign in again or request a fresh invitation.');
    }
    this.session.set(data.session);
    this.user.set(data.user);
    await this.requireActiveAdmin();
  }

  async completeAdminPasswordSetup(): Promise<void> {
    await this.requireAdminPasswordSetupSession();
    this.clearPendingAdminPasswordSetup();
  }

  private clearPendingAdminPasswordSetup(): void {
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(adminPasswordSetupStorageKey);
    }
  }

  async requireActiveAdmin(): Promise<void> {
    if (!this.isAuthenticated()) {
      throw new Error('Sign in with an active administrator account.');
    }

    const client = this.requireClient();
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) {
      throw new Error('Your sign-in session has expired. Sign in again.');
    }

    const { data, error } = await client
      .from('user_roles')
      .select('app_role, account_status')
      .eq('user_id', userData.user.id)
      .maybeSingle();
    if (error) {
      console.error('Could not verify the signed-in account role.', {
        code: error.code,
        message: error.message,
      });
      if (error.code === '42501') {
        throw new Error(
          'Supabase denied access to your Admin role record. The public.user_roles table must allow authenticated users to read only their own row; check its SELECT grant and row-level security policy.',
        );
      }
      throw new Error('Administrator access could not be verified. Please try again or contact support.');
    }

    const roleData: unknown = data;
    const role = typeof roleData === 'object'
      && roleData !== null
      && 'app_role' in roleData
      && typeof roleData.app_role === 'string'
      && 'account_status' in roleData
      && typeof roleData.account_status === 'string'
      ? { appRole: roleData.app_role, accountStatus: roleData.account_status }
      : null;
    if (!role || role.appRole !== 'ADMIN') {
      throw new Error('This account is not authorized to use the Admin Portal.');
    }
    if (role.accountStatus !== 'ACTIVE') {
      throw new Error('This administrator account is not active. Contact a system administrator.');
    }
  }

  async signUp(
    email: string,
    password: string,
    profile: BorrowerRegistrationProfile,
  ): Promise<SignUpResult> {
    if (this.mode === 'mock') {
      this.mockAuthenticated = true;
      return { confirmationRequired: false };
    }
    this.requireConfigured();
    this.loading.set(true);
    this.authError.set(null);
    try {
      const { data, error } = await this.requireClient().auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: typeof window === 'undefined' ? undefined : `${window.location.origin}/login`,
          data: {
            full_name: profile.fullName.trim(),
            phone: profile.phone.trim(),
            borrower_type: profile.borrowerType,
          },
        },
      });
      if (error) {
        const message = error.message.includes('fetch')
          ? 'We could not connect. Check your connection and try again.'
          : 'We could not create your account. Check your details and try again.';
        this.authError.set(message);
        throw new Error(message);
      }
      if (!data.user) throw new Error('We could not complete registration. Please try again.');
      this.user.set(data.user);
      this.session.set(data.session);
      if (!data.session) {
        return { confirmationRequired: true };
      }
      try {
        await this.initializeOperationalCustomerProfile(profile);
        return { confirmationRequired: false };
      } catch (error) {
        return {
          confirmationRequired: false,
          profileInitializationError: error instanceof Error
            ? error.message
            : 'Your account was created, but customer setup did not finish.',
        };
      }
    } finally {
      this.loading.set(false);
    }
  }

  async resendConfirmation(email: string): Promise<void> {
    this.requireConfigured();
    this.loading.set(true);
    try {
      const { error } = await this.requireClient().auth.resend({ type: 'signup', email: email.trim() });
      if (error) throw new Error('We could not resend the email right now. Please try again later.');
    } finally {
      this.loading.set(false);
    }
  }

  async requestPasswordReset(email: string): Promise<void> {
    this.requireConfigured();
    this.loading.set(true);
    try {
      const { error } = await this.requireClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: typeof window === 'undefined' ? undefined : `${window.location.origin}/reset-password`,
      });
      if (error) throw new Error('We could not send a reset link right now. Check your connection and try again.');
    } finally {
      this.loading.set(false);
    }
  }

  async requestAdminPasswordSetup(email: string): Promise<void> {
    this.requireConfigured();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      throw new Error('Enter your Admin email address.');
    }

    this.loading.set(true);
    try {
      const { error } = await this.requireClient().auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: typeof window === 'undefined'
          ? undefined
          : `${window.location.origin}/auth/callback?flow=admin-password-setup`,
      });
      if (error) {
        console.error('Could not request an Admin password setup email.', {
          code: error.code,
        });
        throw new Error('We could not process that request right now. Check your connection and try again.');
      }
    } finally {
      this.loading.set(false);
    }
  }

  async updatePassword(password: string): Promise<void> {
    this.requireConfigured();
    this.loading.set(true);
    try {
      const { data, error } = await this.requireClient().auth.updateUser({ password });
      if (error) {
        const message = error.code === 'session_not_found'
          ? 'Your sign-in session has expired. Sign in again before changing your password.'
          : error.code === 'reauthentication_needed' || error.code === 'reauthentication_required'
            ? 'For your security, sign in again before changing your password.'
            : error.code === 'weak_password'
              ? 'Choose a stronger password that meets the account security requirements.'
              : error.message.toLowerCase().includes('fetch')
                ? 'We could not connect to the account service. Check your connection and try again.'
                : 'We could not update your password. Please try again.';
        throw new Error(message);
      }
      this.user.set(data.user);
      this.passwordRecovery.set(false);
    } finally {
      this.loading.set(false);
    }
  }

  async initializeOperationalCustomerProfile(
    registrationProfile?: BorrowerRegistrationProfile,
  ): Promise<OperationalCustomerProfile> {
    this.requireConfigured();
    const user = this.user();
    if (!user || !this.session()?.access_token) {
      throw new Error('Confirm your email and sign in before setting up your borrower profile.');
    }
    if (this.customerProfile() && this.initializedProfileUserId === user.id) {
      return this.customerProfile()!;
    }

    if (this.initializedProfileUserId !== user.id) {
      if (!this.profileInitialization) {
        const profile = registrationProfile ?? profileFromMetadata(user.user_metadata);
        if (!profile) {
          throw new Error('Your saved sign-up details are incomplete. Contact support to finish customer setup.');
        }
        const phone = profile.phone.trim();
        if (!/^\+?[0-9 ()-]{7,24}$/.test(phone)) {
          throw new Error('A valid phone number is required to set up your customer profile.');
        }
        const fullName = profile.fullName.trim();
        const nationalId = profile.nationalId?.trim() || null;
        const borrowerType = profile.borrowerType;
        if (borrowerType !== null && !isBorrowerType(borrowerType)) {
          throw new Error('Your saved borrower category is invalid. Contact support to finish customer setup.');
        }

        const args: InitializeCustomerProfileArgs = {
          p_phone: phone,
          p_full_name: fullName || null,
          p_national_id: nationalId,
          p_borrower_type: borrowerType,
        };
        this.profileInitializationState.set({ ...this.profileInitializationState(), request: 'loading', error: null, errorCode: null });
        this.profileInitialization = this.callInitializeCustomerProfile(args)
          .then(() => {
            this.initializedProfileUserId = user.id;
            this.profileInitializationState.set({ availability: 'available', request: 'success', error: null, errorCode: null });
          })
          .catch((error: unknown) => {
            this.profileInitializationState.set(this.profileFailureState(error));
            throw error;
          })
          .finally(() => {
            this.profileInitialization = null;
          });
      }
      await this.profileInitialization;
    }

    if (!this.profileRetrieval) {
      this.profileRetrievalState.set({ ...this.profileRetrievalState(), request: 'loading', error: null, errorCode: null });
      this.profileRetrieval = this.callGetMyProfile(user.id)
        .then((customer) => {
          this.customerProfile.set(customer);
          this.profileRetrievalState.set({ availability: 'available', request: 'success', error: null, errorCode: null });
          return customer;
        })
        .catch((error: unknown) => {
          this.profileRetrievalState.set(this.profileFailureState(error));
          throw error;
        })
        .finally(() => {
          this.profileRetrieval = null;
        });
    }
    return this.profileRetrieval;
  }

  private async callGetMyProfile(authenticatedUserId: string): Promise<OperationalCustomerProfile> {
    const { data, error } = await this.requireClient().schema('loanops').rpc('get_my_profile');
    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883') {
        throw new Error('Your saved borrower profile cannot be retrieved because the profile operation is not deployed.');
      }
      if (error.code === '42501') {
        throw new Error('Your saved borrower profile could not be retrieved for this account.');
      }
      throw new Error('Your saved borrower profile could not be retrieved. Retry profile retrieval.');
    }
    return parseCustomerProfileRows(data, authenticatedUserId);
  }

  private async callInitializeCustomerProfile(
    args: InitializeCustomerProfileArgs,
  ): Promise<void> {
    try {
      const { data, error } = await this.requireClient()
        .schema('loanops')
        .rpc('initialize_customer_profile', args);
      if (error) {
        const code = error.code;
        if (code === 'PGRST106') {
          throw new Error('Customer setup is unavailable because the loanops schema is not exposed by Supabase.');
        }
        if (code === 'PGRST202') {
          throw new Error('Customer setup is unavailable because Supabase cannot find the initialize_customer_profile function.');
        }
        if (code === '42501') {
          throw new Error('Customer setup was denied. Confirm that your account has an active BORROWER role.');
        }
        throw new Error('Your account was created, but the LoanOps customer profile could not be initialized. Please retry.');
      }
      const profile = parseOperationalCustomerProfile(data);
      const authenticatedUserId = this.user()?.id;
      if (!authenticatedUserId || profile.customerId !== authenticatedUserId) {
        throw new Error('The initialized customer profile does not match the signed-in account.');
      }
      return;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Customer setup')) throw error;
      if (error instanceof Error && error.message.startsWith('The customer setup')) throw error;
      if (error instanceof Error && error.message.includes('fetch')) {
        throw new Error('Your account was created, but the customer service could not be reached. Check your connection and retry.');
      }
      if (error instanceof Error && error.message.startsWith('Your account was created')) throw error;
      throw new Error('Your account was created, but the LoanOps customer profile could not be initialized. Please retry.');
    }
  }

  private profileFailureState(error: unknown): FeatureState {
    const message = error instanceof Error ? error.message : 'The borrower profile operation failed.';
    const availability = message.includes('not deployed')
      ? 'pending_backend'
      : message.includes('not authorized') || message.includes('denied')
        ? 'unauthorized'
        : message.includes('connect')
          ? 'temporarily_unavailable'
          : 'available';
    return {
      availability,
      request: 'error',
      error: message,
      errorCode: null,
    };
  }

  async signOut(): Promise<void> {
    this.loading.set(true);
    try {
      if (this.mode === 'supabase' && this.configured) {
        const { error } = await this.requireClient().auth.signOut();
        if (error) throw new Error('We could not sign you out. Please try again.');
      }
      this.mockAuthenticated = false;
      this.session.set(null);
      this.user.set(null);
      this.customerProfile.set(null);
      this.initializedProfileUserId = null;
      this.profileInitialization = null;
      this.profileRetrieval = null;
      this.profileInitializationState.set(initialProfileFeatureState());
      this.profileRetrievalState.set(initialProfileFeatureState());
      this.passwordRecovery.set(false);
      this.clearPendingAdminPasswordSetup();
    } finally {
      this.loading.set(false);
    }
  }

  isAuthenticated(): boolean {
    return this.mode === 'mock' ? this.mockAuthenticated : !!this.session()?.user;
  }

  private requireConfigured(): void {
    if (this.mode === 'mock') {
      throw new Error('Account creation is temporarily unavailable. Please try again later.');
    }
    if (!this.configured) {
      throw new Error('Account access is not available yet. Please try again later.');
    }
  }

  private requireClient(): SupabaseClient {
    this.requireConfigured();
    if (!this.client) {
      throw new Error('Account access is not available yet. Please try again later.');
    }
    return this.client;
  }
}

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.whenReady();
  if (auth.mode === 'mock') return true;
  if (!auth.isAuthenticated()) return router.createUrlTree(['/login']);
  try {
    await auth.initializeOperationalCustomerProfile();
    return true;
  } catch {
    return router.createUrlTree(['/sign-in']);
  }
};

export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.whenReady();
  if (!auth.isAuthenticated()) return router.createUrlTree(['/login']);
  try {
    await auth.requireActiveAdmin();
    return true;
  } catch (error) {
    auth.authError.set(error instanceof Error ? error.message : 'Administrator access could not be verified.');
    return router.createUrlTree(['/login']);
  }
};

export const adminPasswordSetupGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  try {
    await auth.requireAdminPasswordSetupSession();
    return true;
  } catch {
    return router.createUrlTree(['/login'], {
      queryParams: { passwordSetup: 'true' },
    });
  }
};
