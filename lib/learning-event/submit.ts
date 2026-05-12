/**
 * Learning Event Submitter
 *
 * 发起 POST /learning/event/submit 请求，带上外部 token。
 * 未注入 context（独立访问 / 测试模式）时静默跳过，不抛错。
 */

import { useLearningEventStore } from './store';
import { useStageStore } from '@/lib/store/stage';
import type { LearningEventState, LearningEventPayload } from './types';

/** sourceType = 1 课堂素材学习 (对齐外部 LEARNING_SOURCE_TYPE) */
const LEARNING_SOURCE_TYPE = 1;

interface SubmitOptions {
  /** 覆盖默认 sourceId（默认 = OpenMAIC classroom 的 stage.id） */
  sourceId?: string;
  /** 覆盖默认 sourceType（默认 = LEARNING_SOURCE_TYPE = 1） */
  sourceType?: number;
}

export async function submitLearningEvent(
  eventState: LearningEventState,
  payload: LearningEventPayload,
  options: SubmitOptions = {},
): Promise<boolean> {
  const ctx = useLearningEventStore.getState();

  if (!ctx.enabled || !ctx.token || !ctx.sourceRootId) {
    // 父页未注入 token —— 当前可能是开发模式 / 独立访问 / 还没收到 bootstrap
    if (typeof window !== 'undefined' && window.localStorage?.getItem('le:debug') === '1') {
      console.log('[LearningEvent] context not ready, skip:', eventState, payload);
    }
    return false;
  }

  // sourceId 优先级：调用方覆盖 > 父页注入 > OpenMAIC 课堂 stage.id > sourceRootId 兜底
  const stageId = useStageStore.getState().stage?.id ?? null;
  const sourceId = options.sourceId ?? ctx.sourceId ?? stageId ?? ctx.sourceRootId;
  const sourceType = options.sourceType ?? ctx.sourceType ?? LEARNING_SOURCE_TYPE;

  // 兜底：payload 不能为空对象，至少带个时间戳
  const finalPayload =
    payload && Object.keys(payload).length > 0
      ? payload
      : { date: new Date().toISOString() };

  try {
    // 走 Next.js rewrite 同源代理：/app/* → PARENT_APP_BASE/*（在 next.config.ts 里硬编码）
    // /api/* 是主后端（同事 Go），/app/* 才是父项目（学习事件）后端
    const url = '/app/learning/event/submit';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.token}`,
      },
      body: JSON.stringify({
        eventState,
        payload: finalPayload,
        sourceId,
        sourceRootId: ctx.sourceRootId,
        sourceType,
      }),
    });

    if (!res.ok) {
      console.warn(`[LearningEvent] submit ${eventState} failed: HTTP ${res.status}`);
      // 401 / 403：token 失效，反向通知父页刷新
      if ((res.status === 401 || res.status === 403) && typeof window !== 'undefined') {
        try {
          window.parent?.postMessage(
            { type: 'openmaic:auth-expired', payload: { status: res.status } },
            '*',
          );
        } catch {
          /* ignore — postMessage 失败说明没父页或跨域受限，无影响 */
        }
      }
      return false;
    }
    return true;
  } catch (err) {
    console.error('[LearningEvent] submit error:', err);
    return false;
  }
}
