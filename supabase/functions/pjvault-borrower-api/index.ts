import { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "npm:@aws-sdk/client-s3@3.750.0";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.750.0";
import postgres from "npm:postgres@3.4.5";

function requiredEnv(name: string): string {
  // Remove accidental whitespace/newlines from dashboard-entered environment values.
  // Whitespace in a Secret Access Key changes the SigV4 signature.
  const value = (Deno.env.get(name) ?? "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const SUPABASE_DB_URL = requiredEnv("SUPABASE_DB_URL");
const R2_ENDPOINT = requiredEnv("R2_ENDPOINT").replace(/\/+$/, "");
// Keep this exact variable name: PJVault uses the second bucket in this account.
const R2_BUCKET = requiredEnv("R2_BUCKET_NAME_2");
const R2_ACCESS_KEY_ID = requiredEnv("R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = requiredEnv("R2_SECRET_ACCESS_KEY");

const r2EndpointUrl = new URL(R2_ENDPOINT);
if (
  r2EndpointUrl.protocol !== "https:" ||
  (r2EndpointUrl.pathname !== "/" && r2EndpointUrl.pathname !== "") ||
  r2EndpointUrl.search || r2EndpointUrl.hash ||
  r2EndpointUrl.username || r2EndpointUrl.password
) {
  throw new Error("R2_ENDPOINT must be the HTTPS account endpoint without a bucket or object path");
}
if (R2_BUCKET.includes("/")) {
  throw new Error("R2_BUCKET_NAME_2 must contain only the PJVault bucket name");
}
const allowedProductionOrigins = (Deno.env.get("PJVAULT_ALLOWED_ORIGINS") ?? "")
  .split(",").map((value) => value.trim()).filter(Boolean);

const db = postgres(SUPABASE_DB_URL, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 20 });
const s3 = new S3Client({
  // Cloudflare R2's S3-compatible API uses region "auto".
  region: "auto",
  endpoint: R2_ENDPOINT,
  // Keep path-style addressing: /<bucket>/<object-key>.
  forcePathStyle: true,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  // Avoid optional checksum headers in presigned PUT requests.
  requestChecksumCalculation: "WHEN_REQUIRED",
});
const BASE_CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin, Access-Control-Request-Headers",
};

function originAllowed(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin) return false;
    if (parsed.protocol === "http:" && parsed.hostname === "localhost") {
      const port = Number(parsed.port);
      return Number.isInteger(port) && port >= 4000 && port <= 4599;
    }
  } catch { return false; }
  return allowedProductionOrigins.includes(origin);
}
function responseHeaders(req: Request): Headers {
  const headers = new Headers({
    ...BASE_CORS_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
  });
  const origin = req.headers.get("origin");
  if (origin && originAllowed(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}
function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(req) });
}
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}
function randomToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}
function firstRow<T>(value: unknown): T {
  if (Array.isArray(value) && value.length > 0) return value[0] as T;
  if (value && typeof value === "object") return value as T;
  throw new Error("Unexpected database response");
}

// Invoke the vetted public borrower RPCs over the private database connection.
// This avoids relying on PostgREST's schema cache for Edge Function internals.
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  switch (name) {
    case "pjvault_borrower_exchange_token": {
      const rows = await db`
        select * from public.pjvault_borrower_exchange_token(
          ${args.p_token_hash as string}::text,
          ${args.p_session_hash as string}::text
        )
      `;
      return rows as unknown as T;
    }
    case "pjvault_borrower_request_status": {
      const rows = await db<{ value: unknown }[]>`
        select public.pjvault_borrower_request_status(
          ${args.p_session_hash as string}::text
        ) as value
      `;
      return rows[0]?.value as T;
    }
    case "pjvault_borrower_create_upload_intent": {
      const rows = await db`
        select * from public.pjvault_borrower_create_upload_intent(
          ${args.p_session_hash as string}::text,
          ${args.p_document_type as string}::text,
          ${args.p_original_filename as string}::text,
          ${args.p_mime_type as string}::text,
          ${args.p_expected_size as number}::bigint
        )
      `;
      return rows as unknown as T;
    }
    case "pjvault_borrower_finalize_upload_intent": {
      const rows = await db`
        select * from public.pjvault_borrower_finalize_upload_intent(
          ${args.p_intent_id as string}::uuid,
          ${args.p_session_hash as string}::text,
          ${args.p_actual_size as number}::bigint,
          ${args.p_mime_type as string}::text,
          ${args.p_object_etag as string}::text,
          ${args.p_sha256 as string}::text
        )
      `;
      return rows as unknown as T;
    }
    case "pjvault_borrower_submit_details": {
      const rows = await db`
        select * from public.pjvault_borrower_submit_details(
          ${args.p_session_hash as string}::text,
          ${args.p_whatsapp_number as string}::text,
          ${args.p_course_name as string}::text,
          ${args.p_academic_year as string}::text
        )
      `;
      return rows as unknown as T;
    }
    default:
      throw new Error("Unsupported PJVault database operation");
  }
}

type SafeError = { status: number; code: string; message: string };
function safeError(error: unknown): SafeError {
  const upper = (error instanceof Error ? error.message : "").toUpperCase();
  if (upper.includes("R2_PRESIGN_CONFIGURATION_INVALID")) {
    return { status: 500, code: "R2_PRESIGN_CONFIGURATION_INVALID", message: "The private upload service is incorrectly configured. Contact the administrator." };
  }
  if (upper.includes("UPLOAD_INTENT_EXPIRED")) {
    return { status: 410, code: "UPLOAD_INTENT_EXPIRED", message: "This upload attempt expired; retry this file." };
  }
  if (upper.includes("LINK_REVOKED")) {
    return { status: 410, code: "LINK_REVOKED", message: "This PJVault link was revoked." };
  }
  if (upper.includes("SESSION_INVALID")) {
    return { status: 410, code: "SESSION_INVALID", message: "This PJVault upload session is invalid." };
  }
  if (upper.includes("SESSION_EXPIRED")) {
    return { status: 410, code: "SESSION_EXPIRED", message: "This PJVault upload session has expired." };
  }
  if (upper.includes("LINK_EXPIRED")) {
    return { status: 410, code: "LINK_EXPIRED", message: "This PJVault link has expired." };
  }
  if (upper.includes("REQUEST_EXPIRED")) {
    return { status: 410, code: "REQUEST_EXPIRED", message: "This PJVault request has expired." };
  }
  if (upper.includes("REQUEST_CLOSED")) {
    return { status: 410, code: "REQUEST_CLOSED", message: "This PJVault request is closed." };
  }
  if (upper.includes("DOCUMENT_NOT_REQUIRED")) {
    return { status: 409, code: "DOCUMENT_NOT_REQUIRED", message: "This document is not required for the request." };
  }
  if (upper.includes("DOCUMENT_NOT_REJECTED")) {
    return { status: 409, code: "DOCUMENT_NOT_REJECTED", message: "Only a rejected document can be replaced." };
  }
  if (upper.includes("SUBMISSION_INCOMPLETE")) {
    return { status: 409, code: "SUBMISSION_INCOMPLETE", message: "The submission is incomplete." };
  }
  if (upper.includes("CLEANUP_DEADLINE")) {
    return { status: 410, code: "CLEANUP_DEADLINE", message: "The incomplete PJVault submission window has expired." };
  }
  if (upper.includes("INVALID_JSON") || upper.includes("INVALID_REQUEST")) {
    return { status: 400, code: "INVALID_REQUEST", message: "The PJVault request is invalid." };
  }
  if (upper.includes("R2_OBJECT") || upper.includes("UPLOAD_OBJECT")) {
    return { status: 422, code: "UPLOAD_OBJECT_INVALID", message: "The uploaded file could not be verified. Please retry the upload." };
  }
  return { status: 400, code: "UNCLASSIFIED", message: "The PJVault request could not be completed. Check the link or upload session and try again." };
}
async function statusForSession(sessionHash: string): Promise<Record<string, unknown>> {
  const result = await rpc<unknown>("pjvault_borrower_request_status", { p_session_hash: sessionHash });
  const status = firstRow<Record<string, unknown>>(result);
  const deadline = typeof status.cleanup_deadline === "string" ? Date.parse(status.cleanup_deadline) : NaN;
  if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new Error("CLEANUP_DEADLINE");
  return status;
}
function bearerSession(req: Request): string {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  const token = match?.[1]?.trim() ?? "";
  if (token.length < 32 || token.length > 512) throw new Error("SESSION_EXPIRED");
  return token;
}
function requiredString(value: unknown, maxLength = 4096): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) throw new Error("INVALID_REQUEST");
  return value.trim();
}
async function readJson(req: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > 32_768) throw new Error("INVALID_REQUEST");
  const text = await req.text();
  if (text.length > 32_768) throw new Error("INVALID_REQUEST");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("INVALID_JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_JSON");
  return value as Record<string, unknown>;
}

interface IntentRow {
  intent_id: string;
  request_id: string;
  storage_key: string;
  mime_type: string;
  expected_size_bytes: string | number | bigint;
  expires_at: Date | string;
}
async function findOwnedPendingIntent(intentId: string, sessionHash: string): Promise<IntentRow> {
  const rows = await db<IntentRow[]>`
    select i.id::text as intent_id, i.request_id::text as request_id,
           i.storage_key, i.mime_type, i.expected_size_bytes, i.expires_at
    from pjvault.upload_intents i
    join pjvault.upload_sessions s on s.id = i.upload_session_id and s.request_id = i.request_id
    join pjvault.request_tokens t on t.id = s.request_token_id and t.request_id = s.request_id
    join pjvault.upload_requests r on r.id = i.request_id
    where i.id = ${intentId}::uuid
      and s.session_hash = ${sessionHash}
      and s.revoked_at is null and s.expires_at > pg_catalog.now()
      and t.revoked_at is null and t.redeemed_at is not null and t.expires_at > pg_catalog.now()
      and r.status in ('OPEN', 'NEEDS_REUPLOAD') and r.expires_at > pg_catalog.now()
      and greatest(r.first_session_created_at + interval '2 hours', r.expires_at) > pg_catalog.now()
      and i.status = 'PENDING' and i.expires_at > pg_catalog.now()
    limit 1
  `;
  if (!rows.length) throw new Error("UPLOAD_INTENT_EXPIRED");
  return rows[0];
}
async function handleFinalize(req: Request, body: Record<string, unknown>, sessionHash: string): Promise<Response> {
  const intent = await findOwnedPendingIntent(requiredString(body.intent_id, 64), sessionHash);
  const expectedSize = Number(intent.expected_size_bytes);
  const expiresAt = intent.expires_at instanceof Date
    ? intent.expires_at.getTime()
    : typeof intent.expires_at === "string" ? Date.parse(intent.expires_at) : NaN;
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > 20 * 1024 * 1024 || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("UPLOAD_INTENT_EXPIRED");
  let head;
  try { head = await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: intent.storage_key })); }
  catch { throw new Error("R2_OBJECT_NOT_FOUND"); }
  if (head.ContentLength !== expectedSize || head.ContentType !== intent.mime_type || !head.ETag) {
    try { await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: intent.storage_key })); } catch { /* best effort */ }
    throw new Error("R2_OBJECT_METADATA_MISMATCH");
  }
  let object;
  try { object = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: intent.storage_key })); }
  catch { throw new Error("R2_OBJECT_NOT_FOUND"); }
  if (!object.Body) throw new Error("R2_OBJECT_NOT_FOUND");
  const bytes = await object.Body.transformToByteArray();
  if (bytes.byteLength !== expectedSize || bytes.byteLength > 20 * 1024 * 1024) {
    try { await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: intent.storage_key })); } catch { /* best effort */ }
    throw new Error("R2_OBJECT_SIZE_MISMATCH");
  }
  const finalized = await rpc<unknown[]>("pjvault_borrower_finalize_upload_intent", {
    p_intent_id: intent.intent_id, p_session_hash: sessionHash,
    p_actual_size: bytes.byteLength, p_mime_type: intent.mime_type,
    p_object_etag: head.ETag, p_sha256: await sha256(bytes),
  });
  return json(req, 200, { document: firstRow(finalized) });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");
  if (origin && !originAllowed(origin)) return json(req, 403, { error: "Origin is not allowed." });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders(req) });
  if (req.method === "GET") return json(req, 200, { ok: true });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed." });
  let action = "unknown";
  try {
    const body = await readJson(req);
    action = requiredString(body.action, 64);
    if (action === "exchange_token") {
      const token = requiredString(body.token, 512);
      const sessionToken = randomToken();
      const exchangeRaw = await rpc<unknown[]>("pjvault_borrower_exchange_token", {
        p_token_hash: await sha256(token), p_session_hash: await sha256(sessionToken),
      });
      const exchange = firstRow<Record<string, unknown>>(exchangeRaw);
      const status = await statusForSession(await sha256(sessionToken));
      return json(req, 200, { exchange, session_token: sessionToken, status });
    }
    const sessionToken = bearerSession(req);
    const sessionHash = await sha256(sessionToken);
    const status = await statusForSession(sessionHash);
    if (action === "request_status") return json(req, 200, status);
    if (action === "create_upload_intent") {
      const size = Number(body.expected_size);
      if (!Number.isSafeInteger(size) || size < 1 || size > 20 * 1024 * 1024) throw new Error("INVALID_REQUEST");
      const mimeType = requiredString(body.mime_type, 128);
      const intentRaw = await rpc<unknown[]>("pjvault_borrower_create_upload_intent", {
        p_session_hash: sessionHash,
        p_document_type: requiredString(body.document_type, 64),
        p_original_filename: requiredString(body.original_filename, 255),
        p_mime_type: mimeType, p_expected_size: size,
      });
      const intent = firstRow<Record<string, unknown>>(intentRaw);
      const intentId = requiredString(intent.intent_id, 64);
      const key = requiredString(intent.storage_key, 1024);
      const expiryValue = intent.expires_at;
      const expiry = expiryValue instanceof Date
        ? expiryValue.getTime()
        : typeof expiryValue === "string" ? Date.parse(expiryValue) : NaN;
      // The R2 URL must never outlive the database upload intent.
      // SigV4 presigned URLs also have a maximum lifetime of seven days.
      const remainingSeconds = Math.floor((expiry - Date.now()) / 1000);
      const expiresIn = Math.min(604_800, remainingSeconds);
      if (!Number.isFinite(expiry) || !Number.isFinite(remainingSeconds) || expiresIn < 1) {
        throw new Error("UPLOAD_INTENT_EXPIRED");
      }

      const uploadUrl = await getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          ContentType: mimeType,
        }),
        {
          expiresIn,
          // Angular must send this exact Content-Type value on its PUT request.
          signableHeaders: new Set(["content-type"]),
        },
      );

      // Validate non-secret URL attributes before returning the temporary URL.
      // Never write the full presigned URL or its signature into application logs.
      const signedUrl = new URL(uploadUrl);
      const signedCredential = signedUrl.searchParams.get("X-Amz-Credential") ?? "";
      const signedAccessKeyId = signedCredential.split("/")[0] ?? "";
      const signedHeaders = (signedUrl.searchParams.get("X-Amz-SignedHeaders") ?? "").toLowerCase();
      const endpointHostMatches = signedUrl.host === r2EndpointUrl.host;
      const bucketPathMatches = signedUrl.pathname.startsWith(`/${R2_BUCKET}/`);
      const accessKeyIdMatches = signedAccessKeyId === R2_ACCESS_KEY_ID;

      if (
        signedUrl.protocol !== "https:" ||
        !endpointHostMatches ||
        !bucketPathMatches ||
        !accessKeyIdMatches ||
        signedHeaders !== "content-type;host"
      ) {
        console.error("PJVault generated an unexpected R2 presigned URL", {
          request_id: intent.request_id,
          intent_id: intentId,
          endpoint_host_matches: endpointHostMatches,
          bucket_path_matches: bucketPathMatches,
          access_key_id_matches: accessKeyIdMatches,
          signed_headers: signedHeaders,
        });
        throw new Error("R2_PRESIGN_CONFIGURATION_INVALID");
      }

      console.info("PJVault R2 upload intent signed", {
        request_id: intent.request_id,
        intent_id: intentId,
        bucket: R2_BUCKET,
        expires_in_seconds: expiresIn,
        mime_type: mimeType,
        signed_headers: signedHeaders,
      });

      return json(req, 200, {
        intent_id: intentId,
        request_id: intent.request_id,
        upload_url: uploadUrl,
        required_headers: { "Content-Type": mimeType },
      });
    }
    if (action === "finalize_upload") return await handleFinalize(req, body, sessionHash);
    if (action === "submit_details") {
      await rpc<unknown>("pjvault_borrower_submit_details", {
        p_session_hash: sessionHash,
        p_whatsapp_number: requiredString(body.whatsapp_number, 32),
        p_course_name: requiredString(body.course_name, 160),
        p_academic_year: requiredString(body.academic_year, 32),
      });
      return json(req, 200, { status: await statusForSession(sessionHash) });
    }
    return json(req, 400, { code: "INVALID_REQUEST", error: "Unsupported borrower action." });
  } catch (error) {
    const result = safeError(error);
    console.error("PJVault borrower request failed", { action, status: result.status, reason: result.code });
    return json(req, result.status, { code: result.code, error: result.message });
  }
});
