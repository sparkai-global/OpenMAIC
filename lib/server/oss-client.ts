/**
 * Aliyun OSS client for classroom media uploads.
 *
 * Uploads generated images / videos / TTS audio to Aliyun OSS instead of
 * writing to local disk. Public URLs follow the bucket virtual-host format
 * (https://{bucket}.{endpoint}/{key}), matching the convention used by the
 * Go backend so both sides can reference the same resources.
 *
 * Object key layout:
 *   classrooms/{yyyy}/{mm}/{classroomId}/{media|audio}/{filename}
 *
 * The month component is taken from the job start time supplied by the
 * caller, so all files of one generation job land in the same monthly
 * folder even if generation crosses midnight.
 */

import OSS from 'ali-oss';
import { createLogger } from '@/lib/logger';

const log = createLogger('OSSClient');

const UPLOAD_RETRY_ATTEMPTS = 3;
const UPLOAD_RETRY_BASE_DELAY_MS = 500;

/**
 * Content-Type lookup for file extensions used in classroom media.
 * Falls back to application/octet-stream for anything unknown.
 */
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
};

let cachedClient: OSS | null = null;
let cachedConfig: { bucket: string; endpoint: string } | null = null;

interface OSSConfig {
  endpoint: string; // e.g. "oss-cn-chengdu.aliyuncs.com"
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
}

function readConfig(): OSSConfig {
  const endpoint = process.env.OSS_ENDPOINT;
  const bucket = process.env.OSS_BUCKET_NAME;
  const accessKeyId = process.env.OSS_ACCESS_KEY;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;

  if (!endpoint || !bucket || !accessKeyId || !accessKeySecret) {
    throw new Error(
      'OSS not configured: OSS_ENDPOINT, OSS_BUCKET_NAME, OSS_ACCESS_KEY and OSS_ACCESS_KEY_SECRET are all required',
    );
  }

  return { endpoint, bucket, accessKeyId, accessKeySecret };
}

function getClient(): OSS {
  if (cachedClient && cachedConfig) return cachedClient;
  const cfg = readConfig();
  cachedClient = new OSS({
    endpoint: cfg.endpoint,
    bucket: cfg.bucket,
    accessKeyId: cfg.accessKeyId,
    accessKeySecret: cfg.accessKeySecret,
    secure: true,
  });
  cachedConfig = { bucket: cfg.bucket, endpoint: cfg.endpoint };
  return cachedClient;
}

/**
 * Build OSS object key for classroom media.
 *
 * @param classroomId  Generation job's classroom id (also serves as scope key)
 * @param type         "media" for images/videos, "audio" for TTS files
 * @param filename     Final file name including extension (e.g. "img_xxx.png")
 * @param jobStartedAt Used for the yyyy/mm prefix; pass a single Date per job
 *                     so all of a job's files land in the same monthly folder.
 */
export function buildClassroomMediaKey(
  classroomId: string,
  type: 'media' | 'audio',
  filename: string,
  jobStartedAt: Date,
): string {
  const yyyy = jobStartedAt.getFullYear();
  const mm = String(jobStartedAt.getMonth() + 1).padStart(2, '0');
  return `classrooms/${yyyy}/${mm}/${classroomId}/${type}/${filename}`;
}

/**
 * Map a file extension (without dot) to a Content-Type.
 */
export function contentTypeForExt(ext: string): string {
  return CONTENT_TYPE_BY_EXT[ext.toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Upload a buffer to OSS with retry + exponential backoff.
 *
 * Returns the public URL on success. Throws after all retries are exhausted;
 * callers should wrap in their own try/catch and decide whether to fail the
 * whole job or skip the failed media (matching the existing media-generation
 * fault tolerance: warn + continue without writing the URL into the JSON).
 */
export async function uploadToOSS(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const client = getClient();
  let lastErr: unknown;

  for (let attempt = 1; attempt <= UPLOAD_RETRY_ATTEMPTS; attempt++) {
    try {
      await client.put(key, body, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
      return getPublicUrl(key);
    } catch (err) {
      lastErr = err;
      log.warn(
        `Upload failed (attempt ${attempt}/${UPLOAD_RETRY_ATTEMPTS}) [${key}]:`,
        err,
      );
      if (attempt < UPLOAD_RETRY_ATTEMPTS) {
        const delay = UPLOAD_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`OSS upload failed for ${key}`);
}

/**
 * Build the public URL for an OSS object key.
 * Format matches the Go backend's convention.
 */
function getPublicUrl(key: string): string {
  if (!cachedConfig) {
    // getClient() initializes cachedConfig; calling readConfig() here keeps
    // the function safe if used in isolation.
    const cfg = readConfig();
    cachedConfig = { bucket: cfg.bucket, endpoint: cfg.endpoint };
  }
  return `https://${cachedConfig.bucket}.${cachedConfig.endpoint}/${key}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
