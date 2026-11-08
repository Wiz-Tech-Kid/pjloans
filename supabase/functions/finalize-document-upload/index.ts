import { S3Client, HeadObjectCommand, CopyObjectCommand, DeleteObjectCommand } from "npm:@aws-sdk/client-s3@3.750.0";
import { FetchHttpHandler } from "npm:@smithy/fetch-http-handler@5.0.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
if (!SUPABASE_URL) throw new Error("SUPABASE_URL is required");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: corsHeaders });
}
function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}
function r2Client(): { client: S3Client; bucket: string } {
  const endpoint = requiredEnv("R2_ENDPOINT");
  const bucket = requiredEnv("R2_BUCKET_NAME");
  const accessKeyId = requiredEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requiredEnv("R2_SECRET_ACCESS_KEY");
  return {
    client: new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      requestHandler: new FetchHttpHandler(),
    }),
    bucket,
  };
}
async function userRpc(req: Request, name: string, payload: Record<string, unknown>): Promise<unknown> {
  const authorization = req.headers.get("authorization");
  const apikey = req.headers.get("apikey");
  if (!authorization?.startsWith("Bearer ") || !apikey) throw new HttpError(401, "Authentication required");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { authorization, apikey, "content-type": "application/json", "content-profile": "loanops", "accept-profile": "loanops" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) {
    const status = response.status === 401 || response.status === 403 ? response.status : 400;
    throw new HttpError(status, status === 400 ? "Upload intent was rejected" : "Not authorized");
  }
  return text ? JSON.parse(text) : null;
}
function firstRow(value: unknown): Record<string, unknown> {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") throw new HttpError(404, "Upload intent not found");
  return row as Record<string, unknown>;
}
function secretApiKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!raw) throw new Error("SUPABASE_SECRET_KEYS is required for private finalization RPC");
  const map = JSON.parse(raw) as Record<string, unknown>;
  if (typeof map.default === "string" && map.default) return map.default;
  const entries = Object.values(map).filter((value): value is string => typeof value === "string" && value.length > 0);
  if (entries.length === 1) return entries[0];
  throw new Error("A named Supabase secret key is ambiguous; configure a default key");
}
async function serviceRpc(name: string, payload: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: secretApiKey(), "content-type": "application/json", "content-profile": "loanops", "accept-profile": "loanops" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) throw new HttpError(502, "Verified upload could not be registered");
  return text ? JSON.parse(text) : null;
}
function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound" || e?.name === "NoSuchKey";
}
function verifyHead(head: { ContentLength?: number; ContentType?: string; ETag?: string }, intent: Record<string, unknown>): string {
  const actualType = (head.ContentType ?? "").split(";")[0].trim().toLowerCase();
  if (head.ContentLength !== Number(intent.expected_size) || actualType !== String(intent.mime_type).toLowerCase() || !head.ETag) throw new HttpError(422, "R2 object size or media type does not match the upload intent");
  return head.ETag;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST required" });
  try {
    const body = await req.json();
    if (typeof body?.intent_id !== "string") throw new HttpError(400, "intent_id is required");
    const intent = firstRow(await userRpc(req, "get_document_upload_intent", { p_intent_id: body.intent_id }));
    const { client, bucket } = r2Client();
    const finalKey = `pjloans/documents/${String(intent.borrower_id)}/${String(intent.application_id)}/${String(intent.intent_id)}`;
    let finalHead: { ContentLength?: number; ContentType?: string; ETag?: string } | undefined;

    if (intent.status === "COMPLETED") {
      try { finalHead = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: finalKey })); }
      catch (error) { if (isNotFound(error)) throw new HttpError(409, "Previously finalized R2 object is missing"); throw error; }
      const etag = verifyHead(finalHead, intent);
      if (etag !== intent.object_etag) throw new HttpError(409, "Finalized R2 object no longer matches the registered version");
    } else {
      if (intent.status !== "PENDING" || new Date(String(intent.expires_at)).getTime() <= Date.now()) throw new HttpError(410, "Upload intent is expired or no longer pending");
      try {
        finalHead = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: finalKey }));
        verifyHead(finalHead, intent);
      } catch (error) {
        if (!isNotFound(error)) throw error;
        const stagingKey = String(intent.storage_key);
        const stageHead = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: stagingKey }));
        verifyHead(stageHead, intent);
        const encodedSource = `/${bucket}/${stagingKey.split("/").map(encodeURIComponent).join("/")}`;
        await client.send(new CopyObjectCommand({ Bucket: bucket, Key: finalKey, CopySource: encodedSource, MetadataDirective: "COPY" }));
        finalHead = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: finalKey }));
        verifyHead(finalHead, intent);
      }
    }

    const objectEtag = verifyHead(finalHead, intent);
    const result = firstRow(await serviceRpc("finalize_document_upload", {
      p_intent_id: intent.intent_id,
      p_actor_id: intent.borrower_id,
      p_actual_size: Number(finalHead.ContentLength),
      p_content_type: String(finalHead.ContentType).split(";")[0].trim().toLowerCase(),
      p_object_etag: objectEtag,
    }));
    const documentId = Number(result.document_id);
    const documentStatus = result.status ?? result.verification_status;
    if (
      !Number.isSafeInteger(documentId)
      || documentId < 1
      || (documentStatus !== "PENDING" && documentStatus !== "VERIFIED" && documentStatus !== "REJECTED")
    ) {
      throw new HttpError(502, "Document finalization returned incomplete metadata");
    }
    const idempotent = typeof result.idempotent === "boolean"
      ? result.idempotent
      : intent.status === "COMPLETED";
    if (intent.status !== "COMPLETED") {
      try { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: String(intent.storage_key) })); } catch { /* best-effort staging cleanup */ }
    }
    return json(200, {
      document_id: documentId,
      intent_id: intent.intent_id,
      status: documentStatus,
      idempotent,
    });
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { error: error.message });
    console.error("finalize-document-upload failed", error instanceof Error ? error.message : "unknown error");
    return json(500, { error: "Finalization failed; verify R2 and server configuration" });
  }
});