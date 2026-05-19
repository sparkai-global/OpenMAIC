/**
 * Learning Event Types
 * 对齐外部项目 (Vue) 的 SubmitLearningEventReq 协议
 */

export type LearningEventState =
  | 'start' // 开始学习
  | 'pause' // 暂停
  | 'resume' // 恢复
  | 'finish' // 完成
  | 'page_turn' // 翻页 (PPT / 卡片式微课)
  | 'card_flip' // 翻卡 (闪卡)
  | 'message_sent' // AI 陪聊
  | 'quiz_answered'; // 答题

export interface FlashcardPayload {
  cardIndex: number;
  totalCards: number;
  timeSpentSec: number;
}

export interface QuizPayload {
  quizId: string;
  isCorrect: boolean;
  timeSpentSec: number;
  answer: string;
}

export interface ChatPayload {
  timeSpentSec: number;
}

export interface PagePayload {
  currentPage: number;
  totalPages: number;
}

export interface MediaPayload {
  positionSec: number;
  durationSec: number;
}

export type LearningEventPayload =
  | FlashcardPayload
  | QuizPayload
  | ChatPayload
  | PagePayload
  | MediaPayload
  | Record<string, unknown>;

export interface SubmitLearningEventReq {
  eventState: LearningEventState;
  payload: LearningEventPayload;
  sourceId: string;
  sourceRootId: string;
  sourceType: number;
}
