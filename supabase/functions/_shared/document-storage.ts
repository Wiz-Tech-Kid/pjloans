import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.118.0';
import { S3Client } from 'npm:@aws-sdk/client-s3@3.1161.0';

export const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;
export const DOCUMENT_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

const localOrigins = [
  'http://localhost:4200',
  'http://localhost:4201',
  'http://localhost:4301',
];

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface AuthenticatedContext {
  user: User;
  role: 'BORROWER' | 'ADMIN';
  userClient: SupabaseClient;
  serviceClient: SupabaseClient;
}

export interface BorrowerProfile {
  customerId: string;
  borrowerType: 'STUDENT' | 'EMPLOYED' | 'UNEMPLOYED';
}

export interface OwnedApplication {
  id: number;
  borrowerType: 'STUDENT' | 'EMPLOYED' | 'UNEMPLOYED';
  status: string;
}

export function serveDocumentEndpoint(handler: (request: Request) => Promise<unknown>): void {
  Deno.serve(async (request) => {
    const origin = request.headers.get('origin');
    let cors: Record<string, string> | null;
    try {
      cors = corsHeaders(origin);
    } catch (error) {
      if (error instanceof HttpError) {
        return Response.json(
          { error: { code: error.code, message: error.message } },
          { status: error.status },
        );
      }
      throw error;
    }
    if (origin && !cors) {
      return Response.json(
        { error: { code: 'ORIGIN_NOT_ALLOWED', message: 'This origin is not allowed.' } },
        { status: 403 },
      );
    }

    const headers = {
      ...(cors ?? {}),
      'Cache-Control': 'no-store',
    };
    if (request.method === 'OPTIONS') {
      if (!origin) return new Response(null, { status: 400 });
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'POST') {
      return Response.json(
        { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for this operation.' } },
        { status: 405, headers },
      );
    }

    try {
      return Response.json(await handler(request), { status: 200, headers });
    } catch (error) {
      if (error instanceof HttpError) {
        return Response.json(
          { error: { code: error.code, message: error.message } },
          { status: error.status, headers },
        );
      }
      console.error('Document storage operation failed.', error);
      return Response.json(
        { error: { code: 'INTERNAL_ERROR', message: 'The document operation could not be completed.' } },
        { status: 500, headers },
      );
    }
  });
}

export function jsonObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'INVALID_REQUEST', `The ${label} request must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

export function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError(400, 'INVALID_REQUEST', `${label} is required.`);
  }
  return value.trim();
}

export function requiredPositiveInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new HttpError(400, 'INVALID_REQUEST', `${label} must be a positive whole number.`);
  }
  return value;
}

export async function readRequestBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return jsonObject(await request.json(), 'request');
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'INVALID_JSON', 'The request body must contain valid JSON.');
  }
}

export function sanitizedFilename(value: string): string {
  const basename = value.replaceAll('\\', '/').split('/').at(-1) ?? '';
  const sanitized = basename
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 255);
  if (!sanitized || sanitized === '.' || sanitized === '..') {
    throw new HttpError(400, 'INVALID_FILENAME', 'Choose a valid document filename.');
  }
  return sanitized;
}

export function isDocumentTypeAllowed(borrowerType: string, documentType: string): boolean {
  const requirements: Record<string, readonly string[]> = {
    STUDENT: ['STUDENT_ID', 'ADMISSION_LETTER', 'IDENTITY_DOCUMENT'],
    EMPLOYED: ['EMPLOYMENT_LETTER', 'IDENTITY_DOCUMENT'],
    UNEMPLOYED: ['IDENTITY_DOCUMENT'],
  };
  return requirements[borrowerType]?.includes(documentType) ?? false;
}

export function hasValidFileSignature(mimeType: string, bytes: Uint8Array): boolean {
  if (mimeType === 'application/pdf') {
    return bytes.length >= 5
      && bytes[0] === 0x25
      && bytes[1] === 0x50
      && bytes[2] === 0x44
      && bytes[3] === 0x46
      && bytes[4] === 0x2d;
  }
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return bytes.length >= 8
      && bytes[0] === 0x89
      && bytes[1] === 0x50
      && bytes[2] === 0x4e
      && bytes[3] === 0x47
      && bytes[4] === 0x0d
      && bytes[5] === 0x0a
      && bytes[6] === 0x1a
      && bytes[7] === 0x0a;
  }
  return false;
}

export function extensionForMimeType(mimeType: string): string {
  const extensions: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
  };
  const extension = extensions[mimeType];
  if (!extension) throw new HttpError(400, 'UNSUPPORTED_FILE_TYPE', 'Choose a PDF, JPEG, or PNG file.');
  return extension;
}

export async function requestContext(
  request: Request,
  requiredRole: 'BORROWER' | 'ADMIN' | 'ANY',
): Promise<AuthenticatedContext> {
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new HttpError(401, 'UNAUTHORIZED', 'Sign in again to continue.');

  const url = requiredEnvironment('SUPABASE_URL');
  const publishableKey = defaultProjectKey('SUPABASE_PUBLISHABLE_KEYS');
  const secretKey = defaultProjectKey('SUPABASE_SECRET_KEYS');
  const authOptions = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
  const userClient = createClient(url, publishableKey, {
    ...authOptions,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const serviceClient = createClient(url, secretKey, authOptions);
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'UNAUTHORIZED', 'Your sign-in session is invalid or expired.');

  const { data: role, error: roleError } = await serviceClient
    .from('user_roles')
    .select('app_role, account_status')
    .eq('user_id', data.user.id)
    .maybeSingle();
  if (roleError) {
    console.error('Could not verify document-operation role.', { code: roleError.code });
    throw new HttpError(503, 'ROLE_CHECK_UNAVAILABLE', 'Account access could not be verified. Try again shortly.');
  }
  if (!role || role.account_status !== 'ACTIVE') {
    throw new HttpError(403, 'ACCOUNT_INACTIVE', 'This account is not active.');
  }
  if (
    (role.app_role !== 'BORROWER' && role.app_role !== 'ADMIN')
    || (requiredRole !== 'ANY' && role.app_role !== requiredRole)
  ) {
    throw new HttpError(403, 'ROLE_REQUIRED', 'This account is not authorized for this document operation.');
  }

  return { user: data.user, role: role.app_role, userClient, serviceClient };
}

export async function borrowerProfile(context: AuthenticatedContext): Promise<BorrowerProfile> {
  const { data, error } = await context.userClient.schema('loanops').rpc('get_my_profile');
  if (error) {
    console.error('Could not read the authenticated borrower profile.', { code: error.code });
    throw new HttpError(403, 'PROFILE_UNAVAILABLE', 'Your borrower profile could not be verified.');
  }
  const row = singleRow(data, 'borrower profile');
  const customerId = requiredText(row['customer_id'], 'customer ID');
  const borrowerType = row['borrower_type'];
  if (
    customerId !== context.user.id
    || (borrowerType !== 'STUDENT' && borrowerType !== 'EMPLOYED' && borrowerType !== 'UNEMPLOYED')
  ) {
    throw new HttpError(403, 'PROFILE_INVALID', 'Your borrower profile does not match your signed-in account.');
  }
  return { customerId, borrowerType };
}

export async function ownedApplication(
  context: AuthenticatedContext,
  applicationId: number,
): Promise<OwnedApplication> {
  const { data, error } = await context.userClient.schema('loanops').rpc('get_my_applications');
  if (error) {
    console.error('Could not verify borrower application ownership.', { code: error.code });
    throw new HttpError(403, 'APPLICATION_UNAVAILABLE', 'Application ownership could not be verified.');
  }
  if (!Array.isArray(data)) throw new HttpError(502, 'INVALID_BACKEND_RESPONSE', 'Application ownership could not be verified.');
  const row = data.map((item) => jsonObject(item, 'application')).find(
    (item) => Number(item['application_id']) === applicationId,
  );
  if (!row) throw new HttpError(404, 'APPLICATION_NOT_FOUND', 'The application was not found for this account.');

  const borrowerType = row['borrower_type'];
  if (borrowerType !== 'STUDENT' && borrowerType !== 'EMPLOYED' && borrowerType !== 'UNEMPLOYED') {
    throw new HttpError(409, 'APPLICATION_INVALID', 'The application does not have a supported borrower category.');
  }
  if (row['status'] !== 'IN_PROGRESS') {
    throw new HttpError(409, 'APPLICATION_CLOSED', 'Documents can only be uploaded to an in-progress application.');
  }
  return { id: applicationId, borrowerType, status: 'IN_PROGRESS' };
}

export function singleRow(value: unknown, label: string): Record<string, unknown> {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new HttpError(502, 'INVALID_BACKEND_RESPONSE', `The ${label} response has an invalid format.`);
  }
  return jsonObject(value[0], label);
}

export function r2Client(): { client: S3Client; bucket: string } {
  const endpoint = requiredEnvironment('R2_ENDPOINT');
  const endpointUrl = new URL(endpoint);
  if (endpointUrl.protocol !== 'https:' || !endpointUrl.hostname.endsWith('.r2.cloudflarestorage.com')) {
    throw new HttpError(503, 'STORAGE_CONFIGURATION_INVALID', 'Private object storage is not configured correctly.');
  }
  const client = new S3Client({
    region: requiredEnvironment('R2_REGION'),
    endpoint: endpointUrl.origin,
    forcePathStyle: true,
    credentials: {
      accessKeyId: requiredEnvironment('R2_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnvironment('R2_SECRET_ACCESS_KEY'),
    },
  });
  return { client, bucket: requiredEnvironment('R2_BUCKET_NAME') };
}

export function documentOriginsForRequest(): void {
  const configured = Deno.env.get('PJLOANS_ALLOWED_ORIGINS') ?? '';
  for (const value of configured.split(',').map((origin) => origin.trim()).filter(Boolean)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new HttpError(503, 'CORS_CONFIGURATION_INVALID', 'Document service origins are not configured correctly.');
    }
    const isLocalhost = url.hostname === 'localhost';
    if ((!isLocalhost && url.protocol !== 'https:') || url.origin !== value) {
      throw new HttpError(503, 'CORS_CONFIGURATION_INVALID', 'Document service origins are not configured correctly.');
    }
  }
}

function corsHeaders(origin: string | null): Record<string, string> | null {
  documentOriginsForRequest();
  const allowed = new Set([
    ...localOrigins,
    ...(Deno.env.get('PJLOANS_ALLOWED_ORIGINS') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ]);
  if (!origin || !allowed.has(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type, x-retry-count, traceparent, tracestate, baggage',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function defaultProjectKey(name: 'SUPABASE_PUBLISHABLE_KEYS' | 'SUPABASE_SECRET_KEYS'): string {
  const raw = requiredEnvironment(name);
  let keys: unknown;
  try {
    keys = JSON.parse(raw);
  } catch {
    throw new HttpError(503, 'SUPABASE_KEY_CONFIGURATION_INVALID', 'Supabase function keys are not configured.');
  }
  if (typeof keys !== 'object' || keys === null || !('default' in keys) || typeof keys.default !== 'string') {
    throw new HttpError(503, 'SUPABASE_KEY_CONFIGURATION_INVALID', 'Supabase function keys are not configured.');
  }
  return keys.default;
}

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(503, 'SERVICE_CONFIGURATION_REQUIRED', 'The document service is not configured.');
  return value;
}
