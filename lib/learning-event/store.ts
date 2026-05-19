'use client';

/**
 * Learning Event Context Store
 * 由外部 iframe 父页通过 postMessage 注入 token / sourceRootId 等
 * 接口地址走 next.config.ts 里硬编码的同源代理 /app/* → 父项目后端，不再由父页传入
 * 未注入时 enabled=false，submit 直接跳过（不报错）
 */

import { create } from 'zustand';

export interface LearningEventContext {
  /** 外部认证 token (会作为 Bearer 注入到请求 Authorization 头) */
  token: string | null;
  /** 课包 / 课程根 ID（对应外部 lesson.id） */
  sourceRootId: string | null;
  /** 当前素材项 ID（对应外部 materialItem.id），可由父页提供，否则用 stage.id */
  sourceId: string | null;
  /** 来源类型，默认 1 = 课包素材学习 */
  sourceType: number;
  /** 是否启用：父页注入过 token + sourceRootId 后变 true */
  enabled: boolean;
}

interface LearningEventStore extends LearningEventContext {
  /**
   * `sceneId:questionSeq` → 后端真实 quiz UUID。
   * 由 fetchLessonInfo() 调 /app/lesson/info 拉取 openmaicQuizKeys 后填充。
   * quiz_answered 上报时用它把 OpenMAIC 内部 quizId 换成真实 uuid（课堂巡检对账用）。
   */
  quizKeyMap: Record<string, string>;
  setContext: (ctx: Partial<LearningEventContext>) => void;
  setQuizKeyMap: (map: Record<string, string>) => void;
  reset: () => void;
}

/** sourceType = 1 课堂素材学习 (对齐外部 LEARNING_SOURCE_TYPE) */
export const LEARNING_SOURCE_TYPE = 1;

const initial: LearningEventContext = {
  token: null,
  sourceRootId: null,
  sourceId: null,
  sourceType: LEARNING_SOURCE_TYPE,
  enabled: false,
};

export const useLearningEventStore = create<LearningEventStore>((set) => ({
  ...initial,
  quizKeyMap: {},
  setContext: (ctx) =>
    set((prev) => {
      const next = { ...prev, ...ctx };
      next.enabled = Boolean(next.token && next.sourceRootId);
      return next;
    }),
  setQuizKeyMap: (map) => set({ quizKeyMap: map }),
  reset: () => set({ ...initial, quizKeyMap: {} }),
}));
