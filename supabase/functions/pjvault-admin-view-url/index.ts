
import { createClient } from 'npm:@supabase/supabase-js@2.49.8';

import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from 'npm:@aws-sdk/client-s3@3.750.0';

import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3.750.0';

import { FetchHttpHandler } from 'npm:@smithy/fetch-http-handler@5.0.1';

// --------------------------------------------------
// 1. Environment configuration
// --------------------------------------------------

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  ?.trim()
  .replace(/\/+$/, '');

const R2_ENDPOINT = Deno.env.get('R2_ENDPOINT')
  ?.trim()
  .replace(/\/+$/, '');

const R2_ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID')?.trim();

const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY')?.trim();

const R2_BUCKET_NAME = Deno.env.get('R2_BUCKET_NAME_2')?.trim();

if (!SUPABASE_URL) {
  throw new Error('SUPABASE_URL is required');
}

if (!R2_ENDPOINT) {
  throw new Error('R2_ENDPOINT is required');
}

if (!R2_ACCESS_KEY_ID) {
  throw new Error('R2_ACCESS_KEY_ID is required');
}

if (!R2_SECRET_ACCESS_KEY) {
  throw new Error('R2_SECRET_ACCESS_KEY is required');
}

if (!R2_BUCKET_NAME) {
  throw new Error('R2_BUCKET_NAME_2 is required');
}

// --------------------------------------------------
// 2. Preview configuration
// --------------------------------------------------

const URL_TTL_SECONDS = 60;
const R2_HEAD_TIMEOUT_MS = 10000;

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);

// --------------------------------------------------
// 3. CORS configuration
// --------------------------------------------------

const ALLOWED_ORIGINS = new Set([
  'http://localhost:4200',
  'http://localhost:4201',
  'http://localhost:4300',
  'http://localhost:4301',
]);

function corsHeaders(origin: string | null): HeadersInit {
  const result: Record<string, string> = {
    'Vary': 'Origin',
    'Cache-Control': 'no-store, private, max-age=0',
    'Pragma': 'no-cache',
    'Content-Type': 'application/json; charset=utf-8',
  };

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    result['Access-Control-Allow-Origin'] = origin;
    result['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    result['Access-Control-Allow-Headers'] =
      'authorization, apikey, content-type, x-client-info';
    result['Access-Control-Max-Age'] = '600';
  }

  return result;
}

function jsonResponse(
  origin: string | null,
  status: number,
  body: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(origin),
  });
}

// --------------------------------------------------
// 4. Cloudflare R2 client
// --------------------------------------------------

const r2 = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,

  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },

  requestHandler: new FetchHttpHandler({
    requestTimeout: R2_HEAD_TIMEOUT_MS,
  }),
});

// --------------------------------------------------
// 5. Utility functions
// --------------------------------------------------

function safeFilename(value: string): string {
  const sanitized = value
    .replace(/[\\/]/g, '_')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .slice(0, 150)
    .trim();

  return sanitized || 'document';
}

type S3ErrorLike = {
  name?: string;
  Code?: string;
  $metadata?: {
    httpStatusCode?: number;
    requestId?: string;
    extendedRequestId?: string;
    cfId?: string;
  };
};

function getS3ErrorDetails(error: unknown) {
  const candidate = (
    error && typeof error === 'object' ? error : {}
  ) as S3ErrorLike;

  return {
    name: candidate.name ?? 'UnknownError',
    code: candidate.Code ?? null,
    httpStatusCode: candidate.$metadata?.httpStatusCode ?? null,
    requestId: candidate.$metadata?.requestId ?? null,
    extendedRequestId: candidate.$metadata?.extendedRequestId ?? null,
    cfId: candidate.$metadata?.cfId ?? null,
  };
}

// --------------------------------------------------
// 6. Main Edge Function
// --------------------------------------------------

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin');

  // Handle browser preflight requests
  if (req.method === 'OPTIONS') {
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return jsonResponse(origin, 403, {
        error: 'origin_not_allowed',
      });
    }

    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse(origin, 403, {
      error: 'origin_not_allowed',
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse(origin, 405, {
      error: 'method_not_allowed',
    });
  }

  // ------------------------------------------------
  // 7. Validate authentication headers
  // ------------------------------------------------

  const authorization = req.headers.get('Authorization');
  const apiKey = req.headers.get('apikey');

  if (!authorization?.startsWith('Bearer ') || !apiKey) {
    return jsonResponse(origin, 401, {
      error: 'unauthorized',
    });
  }

  const accessToken = authorization.slice('Bearer '.length).trim();

  if (!accessToken) {
    return jsonResponse(origin, 401, {
      error: 'unauthorized',
    });
  }

  // ------------------------------------------------
  // 8. Parse request
  // ------------------------------------------------

  let body: unknown;

  try {
    const raw = await req.text();

    if (raw.length > 8000) {
      return jsonResponse(origin, 413, {
        error: 'request_body_too_large',
      });
    }

    body = JSON.parse(raw);
  } catch {
    return jsonResponse(origin, 400, {
      error: 'invalid_json',
    });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonResponse(origin, 400, {
      error: 'invalid_request',
    });
  }

  const requestBody = body as Record<string, unknown>;

  const documentId = requestBody.document_id;

  if (
    Object.keys(requestBody).some((key) => key !== 'document_id') ||
    typeof documentId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(documentId)
  ) {
    return jsonResponse(origin, 400, {
      error: 'invalid_document_id',
    });
  }

  try {
    // ----------------------------------------------
    // 9. Authenticate administrator
    // ----------------------------------------------

    const userClient = createClient(
      SUPABASE_URL,
      apiKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
        global: {
          headers: {
            Authorization: authorization,
          },
        },
        db: {
          schema: 'pjvault',
        },
      },
    );

    const { data: userResult, error: userError } =
      await userClient.auth.getUser(accessToken);

    if (userError || !userResult.user) {
      return jsonResponse(origin, 401, {
        error: 'unauthorized',
      });
    }

    // ----------------------------------------------
    // 10. Retrieve authorized document metadata
    // ----------------------------------------------

    const { data, error } = await userClient.rpc(
      'admin_get_document_storage_metadata',
      {
        p_document_id: documentId,
      },
    );

    if (error) {
      console.error('PJVault metadata RPC failed', {
        code: error.code,
        message: error.message,
      });

      if (error.code === 'P0002') {
        return jsonResponse(origin, 404, {
          error: 'document_not_found',
        });
      }

      if (error.code === '42501') {
        return jsonResponse(origin, 403, {
          error: 'not_authorized',
        });
      }

      return jsonResponse(origin, 500, {
        error: 'metadata_lookup_failed',
      });
    }

    const metadata = Array.isArray(data) ? data[0] : data;

    if (
      !metadata ||
      typeof metadata.storage_key !== 'string' ||
      metadata.storage_key.length === 0
    ) {
      return jsonResponse(origin, 404, {
        error: 'document_not_found',
      });
    }

    // ----------------------------------------------
    // 11. Validate MIME type
    // ----------------------------------------------

    const mimeType = typeof metadata.mime_type === 'string'
      ? metadata.mime_type.split(';')[0].trim().toLowerCase()
      : '';

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return jsonResponse(origin, 415, {
        error: 'unsupported_preview_format',
      });
    }

    // ----------------------------------------------
    // 12. Verify object exists in R2
    // ----------------------------------------------

    let headResult;

    try {
      headResult = await r2.send(
        new HeadObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: metadata.storage_key,
        }),
        {
          abortSignal: AbortSignal.timeout(R2_HEAD_TIMEOUT_MS),
        },
      );
    } catch (error) {
      const details = getS3ErrorDetails(error);

      console.error('PJVault R2 HEAD failed', details);

      if (
        details.httpStatusCode === 404 ||
        details.name === 'NotFound' ||
        details.name === 'NoSuchKey'
      ) {
        return jsonResponse(origin, 404, {
          error: 'document_object_not_found',
        });
      }

      return jsonResponse(origin, 502, {
        error: 'storage_check_failed',
      });
    }

    // Verify stored content type
    const storedContentType = (headResult.ContentType ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();

    if (storedContentType && storedContentType !== mimeType) {
      console.error('PJVault R2 content type mismatch', {
        expected: mimeType,
        received: storedContentType,
      });

      return jsonResponse(origin, 409, {
        error: 'stored_content_type_mismatch',
      });
    }

    // ----------------------------------------------
    // 13. Generate temporary signed GET URL
    // ----------------------------------------------

    const filename = safeFilename(
      String(metadata.original_filename ?? 'document'),
    );

    const signedUrl = await getSignedUrl(
      r2,
      new GetObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: metadata.storage_key,
        ResponseContentType: mimeType,
        ResponseContentDisposition: `inline; filename="${filename}"`,
        ResponseCacheControl: 'private, no-store, max-age=0',
      }),
      {
        expiresIn: URL_TTL_SECONDS,
      },
    );

    // ----------------------------------------------
    // 14. Record document access
    // ----------------------------------------------

    const { error: auditError } = await userClient.rpc(
      'admin_record_document_view',
      {
        p_document_id: documentId,
      },
    );

    if (auditError) {
      console.error('PJVault document view audit failed', {
        code: auditError.code,
        message: auditError.message,
      });

      return jsonResponse(origin, 500, {
        error: 'view_audit_failed',
      });
    }

    // ----------------------------------------------
    // 15. Return signed URL
    // ----------------------------------------------

    return jsonResponse(origin, 200, {
      url: signedUrl,
      expires_in_seconds: URL_TTL_SECONDS,
      review_status: metadata.review_status,
    });

  } catch (error) {
    console.error('PJVault document view failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : 'Unknown error',
    });

    return jsonResponse(origin, 500, {
      error: 'internal_error',
    });
  }
});
