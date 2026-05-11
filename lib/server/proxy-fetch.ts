/**
 * Proxy-aware fetch for server-side use.
 *
 * Automatically routes requests through HTTP/HTTPS proxy when
 * the standard environment variables are set:
 *   - https_proxy / HTTPS_PROXY
 *   - http_proxy / HTTP_PROXY
 *
 * Node.js's built-in fetch does NOT respect these env vars,
 * so we use undici's ProxyAgent when a proxy is configured.
 *
 * Usage: import { proxyFetch } from '@/lib/server/proxy-fetch';
 *        const res = await proxyFetch('https://api.openai.com/v1/...', { ... });
 */

import { createLogger } from '@/lib/logger';

const log = createLogger('ProxyFetch');

function getProxyUrl(): string | undefined {
  return (
    process.env.https_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy ||
    process.env.HTTP_PROXY ||
    undefined
  );
}

// Cache the undici module so we only load it once per process. Loaded lazily
// via require() inside loadUndici() to keep undici (and its node:net usage)
// out of any client bundle that transitively imports this file.
type UndiciModule = {
  ProxyAgent: new (url: string) => unknown;
  fetch: (input: string, init?: Record<string, unknown>) => Promise<unknown>;
};
let cachedUndici: UndiciModule | null = null;
let cachedAgent: unknown = null;
let cachedProxyUrl: string | undefined;

function loadUndici(): UndiciModule {
  if (cachedUndici) return cachedUndici;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cachedUndici = require('undici') as UndiciModule;
  return cachedUndici;
}

function getProxyAgent(): unknown | undefined {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) return undefined;

  if (cachedAgent && cachedProxyUrl === proxyUrl) {
    return cachedAgent;
  }

  const { ProxyAgent } = loadUndici();
  cachedAgent = new ProxyAgent(proxyUrl);
  cachedProxyUrl = proxyUrl;
  return cachedAgent;
}

/**
 * Drop-in replacement for fetch() that respects proxy env vars.
 * Falls back to global fetch when no proxy is configured.
 */
export async function proxyFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const agent = getProxyAgent();
  const url = typeof input === 'string' ? input : input.toString();

  if (!agent) {
    log.info('No proxy configured, using direct fetch for:', url.slice(0, 80));
    return fetch(input, init);
  }

  log.info('Using proxy', cachedProxyUrl, 'for:', url.slice(0, 80));
  const { fetch: undiciFetch } = loadUndici();
  const res = await undiciFetch(url, {
    ...(init as Record<string, unknown>),
    dispatcher: agent,
  });

  return res as unknown as Response;
}
