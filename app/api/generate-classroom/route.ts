import { NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { promises as fs } from 'fs';
import path from 'path';
import { callLLM } from '@/lib/ai/llm';
import type { UserRequirements } from '@/lib/types/generation';
import type { Stage, Scene } from '@/lib/types/stage';
import type { StageStore } from '@/lib/api/stage-api-types';
import type { AICallFn } from '@/lib/generation/pipeline-types';
import {
  generateSceneOutlinesFromRequirements,
  applyOutlineFallbacks,
} from '@/lib/generation/outline-generator';
import { generateSceneContent, generateSceneActions, createSceneWithActions } from '@/lib/generation/scene-generator';
import { createStageAPI } from '@/lib/api/stage-api';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModel } from '@/lib/server/resolve-model';

const log = createLogger('Classroom');

export const maxDuration = 300; // 5 minutes for full pipeline

const DATA_DIR = path.join(process.cwd(), 'data', 'classrooms');

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

/**
 * Create an in-memory StageStore compatible with the stage API.
 * This lets us reuse createSceneWithActions server-side without a real Zustand store.
 */
function createInMemoryStore(stage: Stage): StageStore {
  let state = {
    stage: stage as Stage | null,
    scenes: [] as Scene[],
    currentSceneId: null as string | null,
    mode: 'playback' as const,
  };

  const listeners: Array<(s: typeof state, prev: typeof state) => void> = [];

  return {
    getState: () => state,
    setState: (partial: Partial<typeof state>) => {
      const prev = state;
      state = { ...state, ...partial };
      listeners.forEach((fn) => fn(state, prev));
    },
    subscribe: (listener: (s: typeof state, prev: typeof state) => void) => {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      requirement,
      pdfContent,
      language,
      model,
      apiKey,
      baseUrl,
      providerType,
      requiresApiKey,
    } = body as {
      requirement: string;
      pdfContent?: { text: string; images: string[] };
      language?: string;
      model?: string;
      apiKey?: string;
      baseUrl?: string;
      providerType?: string;
      requiresApiKey?: boolean;
    };

    if (!requirement) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: requirement');
    }

    const { model: languageModel, modelInfo } = resolveModel({
      modelString: model,
      apiKey: apiKey || '',
      baseUrl,
      providerType,
      requiresApiKey,
    });
    log.info(`Using model: ${model || 'gpt-4o-mini'}`);

    // Build AICallFn from callLLM
    const aiCall: AICallFn = async (systemPrompt, userPrompt, _images) => {
      const result = await callLLM(
        {
          model: languageModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          maxOutputTokens: modelInfo?.outputWindow,
        },
        'generate-classroom',
      );
      return result.text;
    };

    // 1. Build UserRequirements
    const lang = (language || 'zh-CN') as 'zh-CN' | 'en-US';

    const requirements: UserRequirements = {
      requirement,
      language: lang,
    };

    const pdfText = pdfContent?.text || undefined;

    // 2. Generate scene outlines
    log.info('Stage 1: Generating scene outlines...');
    const outlinesResult = await generateSceneOutlinesFromRequirements(
      requirements,
      pdfText,
      undefined, // no pdfImages metadata
      aiCall,
    );

    if (!outlinesResult.success || !outlinesResult.data) {
      log.error('Failed to generate outlines:', outlinesResult.error);
      return apiError('GENERATION_FAILED', 500, 'Failed to generate scene outlines', outlinesResult.error);
    }

    const outlines = outlinesResult.data;
    log.info(`Generated ${outlines.length} scene outlines`);

    // 3. Create in-memory stage + store
    const stageId = nanoid(10);
    const stage: Stage = {
      id: stageId,
      name: outlines[0]?.title || requirement.slice(0, 50),
      description: undefined,
      language: lang,
      style: 'interactive',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const store = createInMemoryStore(stage);
    const api = createStageAPI(store);

    // 4. Process each outline sequentially: fallback → content → actions → scene
    log.info('Stage 2: Generating scene content and actions...');
    for (const outline of outlines) {
      const safeOutline = applyOutlineFallbacks(outline, true);

      const content = await generateSceneContent(safeOutline, aiCall);
      if (!content) {
        log.warn(`Skipping scene "${safeOutline.title}" — content generation failed`);
        continue;
      }

      const actions = await generateSceneActions(safeOutline, content, aiCall);
      log.info(`Scene "${safeOutline.title}": ${actions.length} actions`);

      const sceneId = createSceneWithActions(safeOutline, content, actions, api);
      if (!sceneId) {
        log.warn(`Skipping scene "${safeOutline.title}" — scene creation failed`);
      }
    }

    const scenes = store.getState().scenes;
    log.info(`Pipeline complete: ${scenes.length} scenes generated`);

    if (scenes.length === 0) {
      return apiError('GENERATION_FAILED', 500, 'No scenes were generated');
    }

    // 5. Persist to data/classrooms/{id}.json
    const id = stageId;
    const classroomData = {
      id,
      stage,
      scenes,
      createdAt: new Date().toISOString(),
    };

    await ensureDataDir();
    const filePath = path.join(DATA_DIR, `${id}.json`);
    await fs.writeFile(filePath, JSON.stringify(classroomData, null, 2), 'utf-8');

    const baseUrl2 = req.headers.get('x-forwarded-host')
      ? `${req.headers.get('x-forwarded-proto') || 'http'}://${req.headers.get('x-forwarded-host')}`
      : req.nextUrl.origin;

    const url = `${baseUrl2}/classroom/${id}`;

    log.info(`Classroom persisted: ${id}, URL: ${url}`);

    return apiSuccess({ id, url, stage, scenes, scenesCount: scenes.length });
  } catch (error) {
    log.error('Error generating classroom:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to generate classroom',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
