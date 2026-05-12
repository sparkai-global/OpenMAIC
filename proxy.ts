import { NextRequest, NextResponse } from 'next/server';

/** Convert string to Uint8Array */
function encode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/** Convert ArrayBuffer to hex string */
function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Verify an HMAC-signed token using Web Crypto API (Edge-compatible) */
async function verifyToken(token: string, accessCode: string): Promise<boolean> {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return false;

  const timestamp = token.substring(0, dotIndex);
  const signature = token.substring(dotIndex + 1);

  const keyData = encode(accessCode);
  const key = await crypto.subtle.importKey(
    'raw',
    keyData.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const data = encode(timestamp);
  const expected = bufToHex(await crypto.subtle.sign('HMAC', key, data.buffer as ArrayBuffer));

  // Constant-length comparison (not truly constant-time in JS, but sufficient here)
  if (signature.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < signature.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /api/* 通过 next.config.ts 的 rewrites 代理到同事的 Go 后端。
  // 自动注入 X-Internal-Token（硬编码，不读 env），并跳过下方对入站 token 的校验。
  const INTERNAL_API_TOKEN = '85070159fab3a2d7caec5a1245619e3c';
  if (pathname.startsWith('/api/')) {
    const headers = new Headers(request.headers);
    headers.set('x-internal-token', INTERNAL_API_TOKEN);
    return NextResponse.next({ request: { headers } });
  }

  // === 内部 API token 校验（保护只应由同事 Go 后端调用的本地接口，防止外部滥用）===
  const INTERNAL_PROTECTED_PREFIXES = [
    '/api/generate-classroom',
    '/api/parse-pdf',
    '/api/generate/image',
    '/api/generate/video',
    '/api/generate/scene-content',
    '/api/generate/scene-actions',
    '/api/generate/scene-outlines-stream',
    '/api/generate/agent-profiles',
  ];
  if (INTERNAL_PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    const internalToken = request.headers.get('x-internal-token');
    if (internalToken !== INTERNAL_API_TOKEN) {
      return NextResponse.json(
        { success: false, errorCode: 'UNAUTHORIZED', error: 'Invalid internal token' },
        { status: 401 },
      );
    }
    return NextResponse.next();
  }

  const accessCode = process.env.ACCESS_CODE;
  if (!accessCode) {
    return NextResponse.next();
  }

  // Whitelist: access-code endpoints, health check
  if (pathname.startsWith('/api/access-code/') || pathname === '/api/health') {
    return NextResponse.next();
  }

  // Check cookie — validate HMAC signature, not just existence
  const cookie = request.cookies.get('openmaic_access');
  if (cookie?.value && (await verifyToken(cookie.value, accessCode))) {
    return NextResponse.next();
  }

  // API requests without valid cookie → 401
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { success: false, errorCode: 'INVALID_REQUEST', error: 'Access code required' },
      { status: 401 },
    );
  }

  // Page requests → let through, frontend shows modal
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logos/).*)'],
};
