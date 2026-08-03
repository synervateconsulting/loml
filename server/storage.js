// Object storage on Cloudflare R2 (S3-compatible). Feature-flagged: if the R2_*
// env vars aren't set, r2Enabled() is false and callers fall back to the legacy
// Postgres-BYTEA path, so this is inert until R2 is configured.

import { randomUUID } from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET;

export const r2Enabled = () => Boolean(ACCOUNT_ID && ACCESS_KEY_ID && SECRET_ACCESS_KEY && BUCKET);

const SIGNED_TTL = 3600; // 1 hour, matches our download cache window

let _client = null;
function client() {
  if (!_client) {
    _client = new S3Client({
      region: 'auto',
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
    });
  }
  return _client;
}

// A fresh object key for an original upload.
export const newOriginalKey = () => `att/${randomUUID()}/original`;

// Presigned PUT for a direct browser upload. Content-Type is intentionally not
// signed, so the browser can send the file without a signature mismatch; the
// stored content-type is overridden at serve time instead.
export function presignPut(key) {
  return getSignedUrl(client(), new PutObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: SIGNED_TTL });
}

// Presigned GET for the 302 redirect, forcing the right inline content-type and
// filename regardless of what got stored.
export function presignGet(key, { mime, fileName } = {}) {
  return getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ...(mime ? { ResponseContentType: mime } : {}),
      ...(fileName ? { ResponseContentDisposition: `inline; filename="${fileName.replace(/"/g, '')}"` } : {}),
    }),
    { expiresIn: SIGNED_TTL }
  );
}

// Confirm an object exists (used to verify a direct upload actually landed).
export async function headObject(key) {
  try {
    const out = await client().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return { size: out.ContentLength };
  } catch {
    return null;
  }
}

// Server-side put (used by the backfill to move existing bytea into R2).
export async function putObject(key, body, contentType) {
  await client().send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType || 'application/octet-stream' })
  );
}

export async function deleteObject(key) {
  try {
    await client().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch {
    /* best-effort */
  }
}

/* -------- resumable multipart (large files) -------- */

// Start a multipart upload; returns the uploadId.
export async function createMultipart(key, contentType) {
  const out = await client().send(
    new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: contentType || 'application/octet-stream' })
  );
  return out.UploadId;
}

// Presigned PUT for one part. The browser uploads the chunk straight to R2 and
// reads back the part's ETag (needs CORS ExposeHeaders: ["ETag"]).
export function presignUploadPart(key, uploadId, partNumber) {
  return getSignedUrl(
    client(),
    new UploadPartCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumber: partNumber }),
    { expiresIn: SIGNED_TTL }
  );
}

// Assemble the parts into the final object. parts: [{ PartNumber, ETag }].
export async function completeMultipart(key, uploadId, parts) {
  await client().send(
    new CompleteMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    })
  );
}

// Discard an abandoned/cancelled multipart so R2 doesn't keep orphan parts.
export async function abortMultipart(key, uploadId) {
  try {
    await client().send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId }));
  } catch {
    /* best-effort */
  }
}
