/**
 * Lesson Info Fetcher
 *
 * 用父层注入的 token 调 GET /app/lesson/info?lessonId=<sourceRootId>，
 * 把返回的 openmaicQuizKeys（itemId=sceneId, questionSeq, id=后端真实 uuid）
 * 整理成 `sceneId:questionSeq → uuid` 映射存进 store。
 *
 * quiz_answered 上报时据此把 OpenMAIC 内部 quizId 换成真实 uuid，
 * 课堂巡检（SignalCollector）按 uuid 对账。
 *
 * 走 next.config.ts 的同源代理 /app/* → 父项目后端，未注入 token 时静默跳过。
 */

import { useLearningEventStore } from './store';

interface QuizAnswerKeyVo {
  /** 后端真实 quiz UUID */
  id: string;
  /** 关联素材项 ID —— OpenMAIC 场景为 sceneId */
  itemId: string;
  /** 题目序号（1-based） */
  questionSeq: number;
}

interface LessonInfoResponse {
  code: number;
  message?: string;
  data?: {
    openmaicQuizKeys?: QuizAnswerKeyVo[] | null;
  };
}

/** 防止并发重复请求 */
let inFlight: Promise<void> | null = null;

export function fetchLessonInfo(): Promise<void> {
  const ctx = useLearningEventStore.getState();

  // 已有映射 / 缺 token / 缺 lessonId → 跳过
  if (Object.keys(ctx.quizKeyMap).length > 0) return Promise.resolve();
  if (!ctx.token || !ctx.sourceRootId) return Promise.resolve();
  if (inFlight) return inFlight;

  const { token, sourceRootId } = ctx;

  inFlight = (async () => {
    try {
      const url = `/app/lesson/info?lessonId=${encodeURIComponent(sourceRootId)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        console.warn(`[LearningEvent] lesson/info failed: HTTP ${res.status}`);
        return;
      }

      const json: LessonInfoResponse = await res.json();
      const keys = json.data?.openmaicQuizKeys ?? [];
      const map: Record<string, string> = {};
      for (const k of keys) {
        if (k.itemId && typeof k.questionSeq === 'number' && k.id) {
          map[`${k.itemId}:${k.questionSeq}`] = k.id;
        }
      }

      if (Object.keys(map).length > 0) {
        useLearningEventStore.getState().setQuizKeyMap(map);
      }

      if (
        typeof window !== 'undefined' &&
        window.localStorage?.getItem('le:debug') === '1'
      ) {
        console.log('[LearningEvent] quizKeyMap loaded:', map);
      }
    } catch (err) {
      console.error('[LearningEvent] lesson/info error:', err);
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
