/**
 * Server-side media and TTS generation for classrooms.
 *
 * Generates image/video files and TTS audio for a classroom, uploads them
 * to Aliyun OSS, and returns the public-URL mappings used by scenes.
 *
 * The legacy `/api/classroom-media/<id>/<path>` route is kept untouched
 * so classrooms generated before this change can still serve their media
 * from local disk. New classrooms only have OSS URLs in their JSON.
 */

import path from 'path';
import { createLogger } from '@/lib/logger';
import {
  buildClassroomMediaKey,
  contentTypeForExt,
  uploadToOSS,
} from '@/lib/server/oss-client';
import { generateImage } from '@/lib/media/image-providers';
import { generateVideo, normalizeVideoOptions } from '@/lib/media/video-providers';
import { generateTTS } from '@/lib/audio/tts-providers';
import { DEFAULT_TTS_VOICES, DEFAULT_TTS_MODELS, TTS_PROVIDERS } from '@/lib/audio/constants';
import { IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import { VIDEO_PROVIDERS } from '@/lib/media/video-providers';
import { isMediaPlaceholder } from '@/lib/store/media-generation';
import {
  getServerImageProviders,
  getServerVideoProviders,
  getServerTTSProviders,
  resolveImageApiKey,
  resolveImageBaseUrl,
  resolveVideoApiKey,
  resolveVideoBaseUrl,
  resolveTTSApiKey,
  resolveTTSBaseUrl,
} from '@/lib/server/provider-config';
import type { SceneOutline } from '@/lib/types/generation';
import type { Scene } from '@/lib/types/stage';
import type { SpeechAction } from '@/lib/types/action';
import type { ImageProviderId } from '@/lib/media/types';
import type { VideoProviderId } from '@/lib/media/types';
import type { TTSProviderId } from '@/lib/audio/types';

const log = createLogger('ClassroomMedia');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DOWNLOAD_TIMEOUT_MS = 120_000; // 2 minutes
const TTS_MAX_RETRIES = 3;
const TTS_RETRY_DELAY_MS = 3_000; // 3 seconds between TTS retry attempts
const DOWNLOAD_MAX_SIZE = 100 * 1024 * 1024; // 100 MB

async function downloadToBuffer(url: string): Promise<Buffer> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);
  const contentLength = Number(resp.headers.get('content-length') || 0);
  if (contentLength > DOWNLOAD_MAX_SIZE) {
    throw new Error(`File too large: ${contentLength} bytes (max ${DOWNLOAD_MAX_SIZE})`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Image / Video generation
// ---------------------------------------------------------------------------

export async function generateMediaForClassroom(
    outlines: SceneOutline[],
    classroomId: string,
    _baseUrl: string, // retained for call-site compatibility; URLs now come from OSS
): Promise<Record<string, string>> {
  // All media files of this generation job share the same yyyy/mm prefix.
  const jobStartedAt = new Date();

  // Collect all media generation requests from outlines
  const requests = outlines.flatMap((o) => o.mediaGenerations ?? []);
  if (requests.length === 0) return {};

  // Resolve providers
  const imageProviderIds = Object.keys(getServerImageProviders());
  const videoProviderIds = Object.keys(getServerVideoProviders());

  const mediaMap: Record<string, string> = {};

  // Separate image and video requests, generate each type sequentially
  // but run the two types in parallel (providers often have limited concurrency).
  const imageRequests = requests.filter((r) => r.type === 'image' && imageProviderIds.length > 0);
  const videoRequests = requests.filter((r) => r.type === 'video' && videoProviderIds.length > 0);

  const generateImages = async () => {
    for (const req of imageRequests) {
      let generated = false;
      for (const providerId of imageProviderIds as ImageProviderId[]) {
        try {
          const apiKey = resolveImageApiKey(providerId);
          if (!apiKey) {
            log.warn(`No API key for image provider "${providerId}", skipping`);
            continue;
          }
          const providerConfig = IMAGE_PROVIDERS[providerId];
          const model = providerConfig?.models?.[0]?.id;

          const result = await generateImage(
              { providerId, apiKey, baseUrl: resolveImageBaseUrl(providerId), model },
              { prompt: req.prompt, aspectRatio: req.aspectRatio || '16:9' },
          );

          let buf: Buffer;
          let ext: string;
          if (result.base64) {
            buf = Buffer.from(result.base64, 'base64');
            ext = 'png';
          } else if (result.url) {
            buf = await downloadToBuffer(result.url);
            const urlExt = path.extname(new URL(result.url).pathname).replace('.', '');
            ext = ['png', 'jpg', 'jpeg', 'webp'].includes(urlExt) ? urlExt : 'png';
          } else {
            log.warn(`Image generation returned no data for ${req.elementId}`);
            continue;
          }

          const filename = `${req.elementId}.${ext}`;
          // Image was generated successfully — try to upload. If upload fails
          // after retries, drop this image (don't write into mediaMap) and
          // stop trying other providers: regenerating from a different
          // provider only wastes quota since the original output was fine.
          try {
            const key = buildClassroomMediaKey(classroomId, 'media', filename, jobStartedAt);
            mediaMap[req.elementId] = await uploadToOSS(key, buf, contentTypeForExt(ext));
            log.info(`Generated image: ${filename} [provider=${providerId}]`);
          } catch (uploadErr) {
            log.warn(
              `OSS upload failed for image ${req.elementId} (skipping):`,
              uploadErr,
            );
          }
          generated = true;
          break;
        } catch (err) {
          log.warn(`[ClassroomMedia] Image generation failed for ${req.elementId} [${providerId}]:`, err);
        }
      }
      if (!generated) {
        log.warn(`All image providers failed for ${req.elementId}`);
      }
    }
  };

  const generateVideos = async () => {
    for (const req of videoRequests) {
      try {
        const providerId = videoProviderIds[0] as VideoProviderId;
        const apiKey = resolveVideoApiKey(providerId);
        if (!apiKey) {
          log.warn(`No API key for video provider "${providerId}", skipping ${req.elementId}`);
          continue;
        }
        const providerConfig = VIDEO_PROVIDERS[providerId];
        const model = providerConfig?.models?.[0]?.id;

        const normalized = normalizeVideoOptions(providerId, {
          prompt: req.prompt,
          aspectRatio: (req.aspectRatio as '16:9' | '4:3' | '1:1' | '9:16') || '16:9',
        });

        const result = await generateVideo(
            { providerId, apiKey, baseUrl: resolveVideoBaseUrl(providerId), model },
            normalized,
        );

        const buf = await downloadToBuffer(result.url);
        const filename = `${req.elementId}.mp4`;
        try {
          const key = buildClassroomMediaKey(classroomId, 'media', filename, jobStartedAt);
          mediaMap[req.elementId] = await uploadToOSS(key, buf, contentTypeForExt('mp4'));
          log.info(`Generated video: ${filename}`);
        } catch (uploadErr) {
          log.warn(
            `OSS upload failed for video ${req.elementId} (skipping):`,
            uploadErr,
          );
        }
      } catch (err) {
        log.warn(`Video generation failed for ${req.elementId}:`, err);
      }
    }
  };

  await Promise.all([generateImages(), generateVideos()]);

  return mediaMap;
}

// ---------------------------------------------------------------------------
// Placeholder replacement in scene content
// ---------------------------------------------------------------------------

export function replaceMediaPlaceholders(scenes: Scene[], mediaMap: Record<string, string>): void {
  if (Object.keys(mediaMap).length === 0) return;

  for (const scene of scenes) {
    if (scene.type !== 'slide') continue;
    const canvas = (
        scene.content as {
          canvas?: { elements?: Array<{ id: string; src?: string; type?: string }> };
        }
    )?.canvas;
    if (!canvas?.elements) continue;

    for (const el of canvas.elements) {
      if (
          (el.type === 'image' || el.type === 'video') &&
          typeof el.src === 'string' &&
          isMediaPlaceholder(el.src) &&
          mediaMap[el.src]
      ) {
        el.src = mediaMap[el.src];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// TTS generation
// ---------------------------------------------------------------------------

/**
 * A single TTS segment plan: which text to synthesize with which provider.
 *
 * Currently {@link planTTSForText} always returns a single-plan list per
 * speech action. The list shape is a future-extension point: when we later
 * support mid-sentence Chinese/English splitting, this function returns
 * multiple plans, and the main loop concatenates the resulting audio
 * before upload. The rest of the pipeline (per-action API key resolution,
 * retry, OSS upload) stays the same.
 */
interface TTSPlan {
  text: string;
  providerId: TTSProviderId;
}

/** Default fallback order when env-var preference is missing or unconfigured. */
const ZH_FALLBACK_ORDER: TTSProviderId[] = ['doubao-tts', 'qwen-tts', 'glm-tts', 'minimax-tts'];
const EN_FALLBACK_ORDER: TTSProviderId[] = ['elevenlabs-tts', 'openai-tts', 'azure-tts'];

/** Detect dominant language of a text — Chinese if it contains any CJK char. */
function detectTextLanguage(text: string): 'zh' | 'en' {
  return /[一-龥]/.test(text) ? 'zh' : 'en';
}

/**
 * Pick the best TTS provider for a given language.
 *
 * Priority:
 *   1. Env var TTS_PROVIDER_ZH / TTS_PROVIDER_EN if its provider has an API key
 *   2. First matching-language provider in the fallback order (zh: doubao→qwen→…, en: elevenlabs→…)
 *   3. Cross-language fallback (e.g. only Chinese TTS configured → use it for English too, with a warn)
 *   4. Any available provider (last resort)
 */
function resolveTTSProviderForLanguage(
  lang: 'zh' | 'en',
  available: Set<TTSProviderId>,
): TTSProviderId | null {
  const envKey = lang === 'zh' ? 'TTS_PROVIDER_ZH' : 'TTS_PROVIDER_EN';
  const envPref = process.env[envKey] as TTSProviderId | undefined;
  if (envPref && available.has(envPref)) return envPref;

  const primaryOrder = lang === 'zh' ? ZH_FALLBACK_ORDER : EN_FALLBACK_ORDER;
  for (const p of primaryOrder) {
    if (available.has(p)) return p;
  }

  const crossOrder = lang === 'zh' ? EN_FALLBACK_ORDER : ZH_FALLBACK_ORDER;
  for (const p of crossOrder) {
    if (available.has(p)) {
      log.warn(
        `No ${lang === 'zh' ? 'Chinese' : 'English'} TTS provider configured; using "${p}" as cross-language fallback`,
      );
      return p;
    }
  }

  return Array.from(available)[0] || null;
}

/**
 * Plan how to synthesize a speech text. See {@link TTSPlan} for the
 * extension contract — today this always returns a single plan covering
 * the whole text.
 */
function planTTSForText(text: string, available: Set<TTSProviderId>): TTSPlan[] {
  const providerId = resolveTTSProviderForLanguage(detectTextLanguage(text), available);
  if (!providerId) return [];
  return [{ text, providerId }];
}

/** Cached per-provider config used during a generation job. */
interface ProviderRuntime {
  providerId: TTSProviderId;
  apiKey: string;
  baseUrl: string | undefined;
  voice: string;
  modelId: string;
  format: string;
}

function loadProviderRuntime(providerId: TTSProviderId): ProviderRuntime | null {
  const apiKey = resolveTTSApiKey(providerId);
  if (!apiKey) return null;
  const baseUrl =
    resolveTTSBaseUrl(providerId) ||
    TTS_PROVIDERS[providerId as keyof typeof TTS_PROVIDERS]?.defaultBaseUrl;
  const voice = DEFAULT_TTS_VOICES[providerId as keyof typeof DEFAULT_TTS_VOICES] || 'default';
  const modelId = DEFAULT_TTS_MODELS[providerId as keyof typeof DEFAULT_TTS_MODELS] || '';
  const format =
    TTS_PROVIDERS[providerId as keyof typeof TTS_PROVIDERS]?.supportedFormats?.[0] || 'mp3';
  return { providerId, apiKey, baseUrl, voice, modelId, format };
}

export async function generateTTSForClassroom(
    scenes: Scene[],
    classroomId: string,
    _baseUrl: string, // retained for call-site compatibility; URLs now come from OSS
): Promise<void> {
  // All TTS files of this generation job share the same yyyy/mm prefix.
  const jobStartedAt = new Date();

  // Build the set of available TTS providers (have API key + not browser-native).
  const availableProviders = new Set<TTSProviderId>();
  for (const id of Object.keys(getServerTTSProviders())) {
    if (id === 'browser-native-tts') continue;
    availableProviders.add(id as TTSProviderId);
  }
  if (availableProviders.size === 0) {
    log.warn('No server TTS provider configured, skipping TTS generation');
    return;
  }

  // Resolve & cache config per provider (apiKey, baseUrl, voice, model, format).
  const runtimeCache = new Map<TTSProviderId, ProviderRuntime | null>();
  const getRuntime = (providerId: TTSProviderId): ProviderRuntime | null => {
    if (!runtimeCache.has(providerId)) {
      runtimeCache.set(providerId, loadProviderRuntime(providerId));
    }
    return runtimeCache.get(providerId) ?? null;
  };

  log.info(
    `TTS routing: providers=[${Array.from(availableProviders).join(', ')}], ` +
      `zhPref=${process.env.TTS_PROVIDER_ZH || '(auto)'}, enPref=${process.env.TTS_PROVIDER_EN || '(auto)'}`,
  );

  for (const scene of scenes) {
    if (!scene.actions) continue;

    // NOTE: splitLongSpeechActions used to run here with a single global
    // providerId. With per-action routing the maxLength varies — we now
    // split inside the plan loop only if the resolved provider has a limit.
    // For typical providers (doubao/qwen/elevenlabs) maxLength is undefined,
    // so the splitter is effectively a no-op and we skip the call entirely.

    const sceneOrder = scene.order;

    for (const action of scene.actions) {
      if (action.type !== 'speech' || !(action as SpeechAction).text) continue;
      const speechAction = action as SpeechAction;

      // Skip TTS for pause-cue texts that contain no speakable characters
      // (e.g. "…", "......", "——"). TTS providers reject pure-punctuation input.
      const speakable = speechAction.text.replace(/[\s…。，、！？。，、！？.…,!?;；:：\-—_]/g, '');
      if (!speakable) {
        log.debug(`Skipping TTS for pause-cue action ${action.id}: "${speechAction.text}"`);
        continue;
      }

      const plans = planTTSForText(speechAction.text, availableProviders);
      if (plans.length === 0) {
        log.warn(`No TTS provider available for action ${action.id}, skipping`);
        continue;
      }

      // Currently always 1 plan per action. When mid-sentence splitting is
      // added (returning N plans), concatenate the N audio buffers here
      // before uploading a single mp3 to OSS. Audio shape on disk and the
      // SpeechAction.audioUrl contract stay unchanged.
      if (plans.length > 1) {
        log.warn(
          `Multi-plan TTS not yet implemented (action ${action.id}): falling back to first plan only`,
        );
      }
      const plan = plans[0];
      const runtime = getRuntime(plan.providerId);
      if (!runtime) {
        log.warn(
          `No API key for resolved TTS provider "${plan.providerId}" (action ${action.id}), skipping`,
        );
        continue;
      }

      const audioId = `tts_s${sceneOrder}_${action.id}`;
      log.debug(
        `TTS route: action=${action.id} lang=${detectTextLanguage(plan.text)} → ${plan.providerId}`,
      );

      let succeeded = false;
      for (let attempt = 1; attempt <= TTS_MAX_RETRIES; attempt++) {
        try {
          const result = await generateTTS(
            {
              providerId: runtime.providerId,
              modelId: runtime.modelId,
              apiKey: runtime.apiKey,
              baseUrl: runtime.baseUrl,
              voice: runtime.voice,
              speed: speechAction.speed,
            },
            plan.text,
          );

          const filename = `${audioId}.${runtime.format}`;
          try {
            const key = buildClassroomMediaKey(classroomId, 'audio', filename, jobStartedAt);
            speechAction.audioUrl = await uploadToOSS(
              key,
              Buffer.from(result.audio),
              contentTypeForExt(runtime.format),
            );
            speechAction.audioId = audioId;
            log.info(
              `Generated TTS: ${filename} (${result.audio.length} bytes) [${runtime.providerId}]`,
            );
          } catch (uploadErr) {
            log.warn(`OSS upload failed for TTS ${audioId} (skipping):`, uploadErr);
          }
          succeeded = true;
          break;
        } catch (err) {
          // InvalidParameter means the text itself is rejected — retrying won't help.
          const isParamError =
            err instanceof Error && err.message.includes('InvalidParameter');
          if (isParamError || attempt >= TTS_MAX_RETRIES) {
            log.warn(
              isParamError
                ? `TTS skipped (InvalidParameter) for action ${action.id} — text rejected by ${runtime.providerId}:`
                : `TTS generation failed after ${TTS_MAX_RETRIES} attempts for action ${action.id} [${runtime.providerId}], skipping:`,
              err,
            );
            break;
          }
          log.warn(
            `TTS attempt ${attempt}/${TTS_MAX_RETRIES} failed for action ${action.id} [${runtime.providerId}], retrying in ${TTS_RETRY_DELAY_MS}ms...`,
            err,
          );
          await new Promise((r) => setTimeout(r, TTS_RETRY_DELAY_MS));
        }
      }
      if (!succeeded) {
        log.warn(
          `Skipped TTS for action ${action.id} — no audio will be available for this segment`,
        );
      }
    }
  }
}
