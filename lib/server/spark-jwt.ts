/**
 * Spark JWT verification helper.
 *
 * Verifies HS256-signed JWTs issued by the upstream spark (sparkai-go)
 * platform, sharing the secret via the `SPARK_JWT_SECRET` env var.
 *
 * Edge Runtime compatible — uses the `jose` library (Web Crypto under
 * the hood) so it works inside Next.js middleware.
 *
 * Reusable: import and call from any middleware / handler that needs
 * spark user identity verification. The helper deliberately returns
 * `null` on any failure (invalid signature, expired, malformed,
 * missing secret) instead of throwing, so callers can decide the
 * exact 401 response shape they want to return.
 */

import { jwtVerify } from 'jose';
import { createLogger } from '@/lib/logger';

const log = createLogger('SparkJwt');

/**
 * Decoded payload of a spark-issued JWT.
 *
 * Spark's payload shape (HS256):
 * ```
 * { userId, username, exp, iat, nbf, sub }
 * ```
 * Only `userId` is required for our authentication purposes; everything
 * else is optional and surfaced for completeness.
 */
export interface SparkJwtPayload {
  userId: string;
  username?: string;
  exp: number;
  iat?: number;
  nbf?: number;
  sub?: string;
}

/**
 * Verify a bearer JWT issued by spark.
 *
 * Returns the decoded payload on success, or `null` on any failure
 * (bad signature, expired, malformed, missing/empty token, server not
 * configured with SPARK_JWT_SECRET).
 *
 * Configuration:
 * - `SPARK_JWT_SECRET` env var holds the shared HS256 secret. Spark
 *   uses `[]byte(secret)` — i.e. the raw UTF-8 bytes of the secret
 *   string — so we MUST encode the same way here via TextEncoder.
 *   Do NOT hex-decode the secret, even if it looks hex-ish.
 *
 * Clock skew: a 30-second `clockTolerance` is applied to handle the
 * small drift between the spark server (in China) and OpenMAIC
 * (overseas). Observed drift is well under 4 seconds; 30s is comfortable
 * headroom without compromising security.
 */
export async function verifySparkJwt(token: string): Promise<SparkJwtPayload | null> {
  if (!token) return null;

  const secret = process.env.SPARK_JWT_SECRET;
  if (!secret) {
    log.warn('SPARK_JWT_SECRET is not configured; all JWT verifications will fail');
    return null;
  }

  // Spark side: []byte(secret) — raw UTF-8 bytes of the string, no hex decoding.
  // We must mirror that exactly, otherwise HMAC signatures will never match.
  const secretBytes = new TextEncoder().encode(secret);

  try {
    const { payload } = await jwtVerify(token, secretBytes, {
      algorithms: ['HS256'],
      clockTolerance: 30, // seconds — covers cross-region clock drift
    });

    const userId = typeof payload.userId === 'string' ? payload.userId : undefined;
    if (!userId) {
      log.warn('Spark JWT verified but payload.userId is missing or not a string');
      return null;
    }

    return {
      userId,
      username: typeof payload.username === 'string' ? payload.username : undefined,
      exp: typeof payload.exp === 'number' ? payload.exp : 0,
      iat: typeof payload.iat === 'number' ? payload.iat : undefined,
      nbf: typeof payload.nbf === 'number' ? payload.nbf : undefined,
      sub: typeof payload.sub === 'string' ? payload.sub : undefined,
    };
  } catch (err) {
    // jose throws on bad signature / expired / malformed — treat all as auth failure.
    // We log at debug level to avoid leaking token contents in production logs.
    log.debug('Spark JWT verification failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}
