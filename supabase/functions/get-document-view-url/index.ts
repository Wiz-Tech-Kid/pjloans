
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "npm:@aws-sdk/client-s3@3.750.0";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.750.0";
import { FetchHttpHandler } from "npm:@smithy/fetch-http-handler@5.0.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")?.trim().replace(/\/+$/, "");
const R2_ENDPOINT = Deno.env.get("R2_ENDPOINT")?.trim().replace(/\/+$/, "");
const R2_BUCKET_NAME = Deno.env.get("R2_BUCKET_NAME")?.trim();
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID")?.trim();
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY")?.trim();

if (!SUPABASE_URL) throw new Error("SUPABASE_URL is required");
if (!R2_ENDPOINT) throw new Error("R2_ENDPOINT is required");
if (!R2_BUCKET_NAME) throw new Error("R2_BUCKET_NAME is required");
if (!R2_ACCESS_KEY_ID) throw new Error("R2_ACCESS_KEY_ID is required");
if (!R2_SECRET_ACCESS_KEY) throw new Error("R2_SECRET_ACCESS_KEY is required");

const ALLOWED_ORIGINS = new Set([
  "http://localhost:4200",
  "http://localhost:4301",
  "http://localhost:4201",
  "http://localhost:4300",
]);

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

const URL_TTL_SECONDS = 90;
const R2_HEAD_TIMEOUT_MS = 10_000;

function resolveSupabaseSecretKey(): string | null {
  const rawNamedKeys = Deno.env.get("SUPABASE_SECRET_KEYS");

  if (rawNamedKeys) {
    try {
      const namedKeys = JSON.parse(rawNamedKeys) as Record<string, unknown>;

      const configuredKey = namedKeys["SUPABASE_SECRET_KEY"];
      if (typeof configuredKey === "string" && configuredKey.length > 0) {
        return configuredKey;
      }

      const defaultKey = namedKeys["default"];
      if (typeof defaultKey === "string" && defaultKey.length > 0) {
        return defaultKey;
      }
    } catch {
      // Fall through to the singular environment variable.
    }
  }

  const singularKey = Deno.env.get("SUPABASE_SECRET_KEY")?.trim();
  return singularKey || null;
}

function corsHeaders(origin: string | null): HeadersInit {
  const headers: Record<string, string> = {
    "Vary": "Origin",
    "Cache-Control": "no-store, private, max-age=0",
    "Pragma": "no-cache",
    "Content-Type": "application/json; charset=utf-8",
  };

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] =
      "authorization, apikey, content-type, x-client-info";
    headers["Access-Control-Max-Age"] = "600";
  }

  return headers;
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

const r2 = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  requestHandler: new FetchHttpHandler({
    requestTimeout: R2_HEAD_TIMEOUT_MS,
  }),
});

function safeFilename(value: string): string {
  const sanitized = value
    .replace(/[\\/]/g, "_")
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .slice(0, 150)
    .trim();

  return sanitized || "document";
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
    error && typeof error === "object" ? error : {}
  ) as S3ErrorLike;

  return {
    name: candidate.name ?? "UnknownError",
    code: candidate.Code ?? null,
    httpStatusCode: candidate.$metadata?.httpStatusCode ?? null,
    requestId: candidate.$metadata?.requestId ?? null,
    extendedRequestId: candidate.$metadata?.extendedRequestId ?? null,
    cfId: candidate.$metadata?.cfId ?? null,
  };
}

async function privilegedRpc(
  secretKey: string,
  name: string,
  args: Record<string, unknown>,
) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "apikey": secretKey,
      "Content-Type": "application/json",
      "Content-Profile": "loanops",
    },
    body: JSON.stringify(args),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = data && typeof data === "object"
      ? data as Record<string, unknown>
      : {};

    return {
      data: null,
      error: {
        code: String(error.code ?? ""),
        message: String(error.message ?? ""),
      },
    };
  }

  return {
    data,
    error: null,
  };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return jsonResponse(origin, 403, {
        error: "origin_not_allowed",
      });
    }

    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse(origin, 403, {
      error: "origin_not_allowed",
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(origin, 405, {
      error: "method_not_allowed",
    });
  }

  const authorization = req.headers.get("Authorization");
  const apiKey = req.headers.get("apikey");

  if (!authorization?.startsWith("Bearer ") || !apiKey) {
    return jsonResponse(origin, 401, {
      error: "unauthorized",
    });
  }

  const accessToken = authorization.slice("Bearer ".length).trim();

  if (!accessToken) {
    return jsonResponse(origin, 401, {
      error: "unauthorized",
    });
  }

  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return jsonResponse(origin, 400, {
      error: "invalid_json",
    });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse(origin, 400, {
      error: "invalid_request",
    });
  }

  const requestBody = body as Record<string, unknown>;
  const documentId = requestBody.document_id;

  if (
    Object.keys(requestBody).some((key) => key !== "document_id") ||
    typeof documentId !== "number" ||
    !Number.isSafeInteger(documentId) ||
    documentId <= 0
  ) {
    return jsonResponse(origin, 400, {
      error: "invalid_document_id",
    });
  }

  try {
    const userClient = createClient(SUPABASE_URL, apiKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          Authorization: authorization,
        },
      },
    });

    const { data: userResult, error: userError } =
      await userClient.auth.getUser(accessToken);

    if (userError || !userResult.user) {
      return jsonResponse(origin, 401, {
        error: "unauthorized",
      });
    }

    const actorId = userResult.user.id;
    const secretKey = resolveSupabaseSecretKey();

    if (!secretKey) {
      console.error("Document view configuration error: Supabase secret key missing");

      return jsonResponse(origin, 500, {
        error: "server_misconfigured",
      });
    }

    const { data: metadataResult, error: metadataError } =
      await privilegedRpc(
        secretKey,
        "get_document_view_metadata",
        {
          p_document_id: documentId,
          p_actor_id: actorId,
        },
      );

    if (metadataError) {
      if (metadataError.code === "42501") {
        return jsonResponse(origin, 403, {
          error: "not_authorized_or_not_found",
        });
      }

      if (metadataError.code === "22023") {
        return jsonResponse(origin, 415, {
          error: "unsupported_preview_format",
        });
      }

      if (metadataError.code === "P0002") {
        return jsonResponse(origin, 409, {
          error: "storage_metadata_unavailable",
        });
      }

      console.error(
        "Document view metadata RPC failed",
        JSON.stringify({
          code: metadataError.code,
          message: metadataError.message,
        }),
      );

      return jsonResponse(origin, 500, {
        error: "metadata_lookup_failed",
      });
    }

    const metadata = Array.isArray(metadataResult)
      ? metadataResult[0]
      : metadataResult;

    if (
      !metadata ||
      metadata.storage_provider !== "CLOUDFLARE_R2" ||
      typeof metadata.storage_key !== "string" ||
      metadata.storage_key.length === 0
    ) {
      return jsonResponse(origin, 409, {
        error: "storage_metadata_unavailable",
      });
    }

    const mimeType = typeof metadata.mime_type === "string"
      ? metadata.mime_type.split(";")[0].trim().toLowerCase()
      : "";

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return jsonResponse(origin, 415, {
        error: "unsupported_preview_format",
      });
    }

    // Verify the private R2 object directly through the AWS SDK.
    // This mirrors the HeadObject approach used by finalize-document-upload.
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

      console.error(
        "R2 HEAD request failed",
        JSON.stringify(details),
      );

      if (
        details.httpStatusCode === 404 ||
        details.name === "NotFound" ||
        details.name === "NoSuchKey"
      ) {
        return jsonResponse(origin, 404, {
          error: "document_object_not_found",
        });
      }

      return jsonResponse(origin, 502, {
        error: "storage_check_failed",
      });
    }

    const storedContentType = (headResult.ContentType ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();

    if (!storedContentType || storedContentType !== mimeType) {
      console.error(
        "R2 HEAD content type mismatch",
        JSON.stringify({
          expected: mimeType,
          received: storedContentType || null,
          requestId: headResult.$metadata?.requestId ?? null,
          cfId: headResult.$metadata?.cfId ?? null,
        }),
      );

      return jsonResponse(origin, 409, {
        error: "stored_content_type_mismatch",
      });
    }

    const filename = safeFilename(
      String(metadata.original_filename ?? "document"),
    );

    let signedUrl: string;

    try {
      signedUrl = await getSignedUrl(
        r2,
        new GetObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: metadata.storage_key,
          ResponseContentType: mimeType,
          ResponseContentDisposition: `inline; filename="${filename}"`,
          ResponseCacheControl: "private, no-store, max-age=0",
        }),
        {
          expiresIn: URL_TTL_SECONDS,
        },
      );
    } catch (error) {
      const details = getS3ErrorDetails(error);

      console.error(
        "R2 GET URL signing failed",
        JSON.stringify(details),
      );

      return jsonResponse(origin, 500, {
        error: "view_url_signing_failed",
      });
    }

    const { error: auditError } = await privilegedRpc(
      secretKey,
      "record_document_view_url_issued",
      {
        p_document_id: documentId,
        p_actor_id: actorId,
      },
    );

    if (auditError) {
      console.error(
        "Document view audit RPC failed",
        JSON.stringify({
          code: auditError.code,
          message: auditError.message,
        }),
      );

      return jsonResponse(origin, 500, {
        error: "view_audit_failed",
      });
    }

    return jsonResponse(origin, 200, {
      url: signedUrl,
      expires_in: URL_TTL_SECONDS,
      expires_at: new Date(
        Date.now() + URL_TTL_SECONDS * 1000,
      ).toISOString(),
      content_type: mimeType,
      filename,
    });
  } catch (error) {
    console.error(
      "get-document-view-url failed",
      error instanceof Error ? error.name : "unknown_error",
    );

    return jsonResponse(origin, 500, {
      error: "internal_error",
    });
  }
});
