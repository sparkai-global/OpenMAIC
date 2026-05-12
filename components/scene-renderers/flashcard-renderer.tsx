'use client';

/**
 * Flashcard Renderer
 * 卡片式问答 — 翻转 / 自评 / 学习进度统计
 *
 * 数据来源：scene.content.cards[]，字段为 { front, back, hint? }
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight, X, Check, Sparkles, RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FlashcardContent } from '@/lib/types/stage';
import { submitLearningEvent } from '@/lib/learning-event/submit';

interface FlashcardRendererProps {
  readonly content: FlashcardContent;
  readonly sceneId: string;
}

type SelfResult = 'correct' | 'wrong' | null;

export function FlashcardRenderer({ content, sceneId }: FlashcardRendererProps) {
  const cards = content.cards ?? [];

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [results, setResults] = useState<SelfResult[]>(() => new Array(cards.length).fill(null));
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [showStats, setShowStats] = useState(false);

  // 学习事件计时：每张卡进入时刻
  const cardStartTimeRef = useRef<number>(Date.now());

  // 切换 scene 时重置
  useEffect(() => {
    setCurrentIndex(0);
    setIsFlipped(false);
    setResults(new Array(cards.length).fill(null));
    setFeedback(null);
    setShowStats(false);
    cardStartTimeRef.current = Date.now();
  }, [sceneId, cards.length]);

  // 每次卡片索引变化时重置计时（用于下一张的 timeSpent）
  useEffect(() => {
    cardStartTimeRef.current = Date.now();
  }, [currentIndex]);

  const currentCard = cards[currentIndex];

  const correctCount = useMemo(() => results.filter((r) => r === 'correct').length, [results]);
  const wrongCount = useMemo(() => results.filter((r) => r === 'wrong').length, [results]);
  const unmarkedCount = cards.length - correctCount - wrongCount;
  const masteryRate = cards.length === 0 ? 0 : Math.round((correctCount / cards.length) * 100);

  const flipCard = useCallback(() => {
    setIsFlipped((v) => !v);
    // 上报翻卡事件
    const timeSpentSec = Math.round((Date.now() - cardStartTimeRef.current) / 1000);
    submitLearningEvent('card_flip', {
      cardIndex: currentIndex,
      totalCards: cards.length,
      timeSpentSec,
    });
  }, [currentIndex, cards.length]);

  const prevCard = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
      setIsFlipped(false);
    }
  }, [currentIndex]);

  const nextCard = useCallback(() => {
    const timeSpentSec = Math.round((Date.now() - cardStartTimeRef.current) / 1000);
    if (currentIndex >= cards.length - 1) {
      // 完成所有卡片
      submitLearningEvent('finish', {
        cardIndex: currentIndex,
        totalCards: cards.length,
        timeSpentSec,
      });
      setShowStats(true);
    } else {
      // 翻到下一张
      submitLearningEvent('card_flip', {
        cardIndex: currentIndex + 1,
        totalCards: cards.length,
        timeSpentSec,
      });
      setCurrentIndex((i) => i + 1);
      setIsFlipped(false);
    }
  }, [currentIndex, cards.length]);

  const markResult = useCallback(
    (result: 'correct' | 'wrong') => {
      if (feedback) return;
      setResults((prev) => {
        const next = [...prev];
        next[currentIndex] = result;
        return next;
      });
      setFeedback(result);
      window.setTimeout(() => {
        setFeedback(null);
        if (currentIndex >= cards.length - 1) {
          setShowStats(true);
        } else {
          setCurrentIndex((i) => i + 1);
          setIsFlipped(false);
        }
      }, 700);
    },
    [feedback, currentIndex, cards.length],
  );

  const reset = useCallback(() => {
    setCurrentIndex(0);
    setIsFlipped(false);
    setResults(new Array(cards.length).fill(null));
    setFeedback(null);
    setShowStats(false);
  }, [cards.length]);

  const reviewWrong = useCallback(() => {
    const idx = results.findIndex((r) => r !== 'correct');
    if (idx < 0) return;
    setCurrentIndex(idx);
    setIsFlipped(false);
    setShowStats(false);
  }, [results]);

  if (cards.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
        本节没有卡片
      </div>
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center p-6 relative">
      <div className="relative w-full max-w-[600px]">
        {/* 顶部进度提示 */}
        <div className="text-center text-xs text-gray-400 dark:text-gray-500 mb-3 tracking-widest">
          {currentIndex + 1} / {cards.length}
        </div>

        {/* 堆叠卡片 (背景) */}
        <div className="relative">
          {Array.from({ length: Math.min(cards.length - currentIndex - 1, 3) }).map((_, i) => {
            const layer = i + 1;
            return (
              <div
                key={layer}
                className="absolute rounded-2xl bg-gray-200/70 dark:bg-gray-800/70 shadow-sm"
                style={{
                  zIndex: layer,
                  top: -layer * 8,
                  left: layer * 6,
                  right: layer * 6,
                  height: 380,
                  opacity: 1 - layer * 0.2,
                }}
              />
            );
          })}

          {/* 主卡片 */}
          <div
            className="relative w-full h-[380px] z-10"
            style={{ perspective: 1200 }}
            onClick={flipCard}
          >
            <motion.div
              className="relative w-full h-full"
              style={{ transformStyle: 'preserve-3d' }}
              animate={{ rotateY: isFlipped ? 180 : 0 }}
              transition={{ duration: 0.55, ease: [0.23, 1, 0.32, 1] }}
            >
              {/* 正面 (问题) */}
              <div
                className="absolute inset-0 rounded-2xl flex flex-col items-center justify-center p-8 cursor-pointer overflow-hidden bg-gradient-to-br from-purple-600 via-violet-700 to-indigo-800 shadow-[0_8px_32px_rgba(124,58,237,0.18)]"
                style={{ backfaceVisibility: 'hidden' }}
              >
                {/* 装饰光晕 */}
                <div className="absolute -top-20 -right-12 w-72 h-72 rounded-full bg-white/10 blur-3xl pointer-events-none" />
                <div className="absolute -bottom-16 -left-8 w-64 h-64 rounded-full bg-white/5 blur-2xl pointer-events-none" />

                <div className="relative z-10 text-center text-white text-2xl font-bold leading-relaxed">
                  {currentCard.front}
                </div>
                <div className="relative z-10 mt-8 text-[11px] tracking-widest text-white/60 animate-pulse">
                  点击查看答案
                </div>
              </div>

              {/* 背面 (答案) */}
              <div
                className="absolute inset-0 rounded-2xl flex flex-col p-6 cursor-pointer overflow-hidden bg-white dark:bg-gray-900 ring-1 ring-gray-200 dark:ring-gray-800 shadow-[0_8px_32px_rgba(0,0,0,0.06)]"
                style={{
                  backfaceVisibility: 'hidden',
                  transform: 'rotateY(180deg)',
                }}
              >
                {/* 答案内容 */}
                <div className="flex-1 overflow-y-auto scrollbar-hide flex flex-col justify-center">
                  <div className="text-xl font-semibold text-center text-gray-800 dark:text-gray-100 leading-relaxed mb-4">
                    {currentCard.back}
                  </div>
                  {currentCard.hint && (
                    <div className="mt-2 px-4 py-3 rounded-xl bg-purple-50 dark:bg-purple-900/20 border-l-2 border-purple-400 text-[13px] text-gray-600 dark:text-gray-300 leading-relaxed">
                      <span className="font-semibold text-purple-600 dark:text-purple-300 mr-2">
                        提示
                      </span>
                      {currentCard.hint}
                    </div>
                  )}
                </div>

                {/* 底部操作 */}
                <div
                  className="shrink-0 flex items-center justify-between gap-2 pt-3 mt-3 border-t border-gray-100 dark:border-gray-800"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={prevCard}
                    disabled={currentIndex <= 0}
                    className="flex items-center gap-1 px-3 h-9 rounded-lg text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    上一张
                  </button>

                  {/* 自评按钮组 */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => markResult('wrong')}
                      className={cn(
                        'w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-95',
                        results[currentIndex] === 'wrong'
                          ? 'bg-red-500 text-white shadow-md scale-110'
                          : 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 ring-2 ring-red-200 dark:ring-red-700/40 hover:bg-red-100 dark:hover:bg-red-900/30',
                      )}
                      title="没学会"
                    >
                      <X className="w-4 h-4" strokeWidth={3} />
                    </button>
                    <button
                      onClick={() => markResult('correct')}
                      className={cn(
                        'w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-95',
                        results[currentIndex] === 'correct'
                          ? 'bg-green-500 text-white shadow-md scale-110'
                          : 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 ring-2 ring-green-200 dark:ring-green-700/40 hover:bg-green-100 dark:hover:bg-green-900/30',
                      )}
                      title="学会了"
                    >
                      <Check className="w-4 h-4" strokeWidth={3} />
                    </button>
                  </div>

                  <button
                    onClick={nextCard}
                    className="flex items-center gap-1 px-3 h-9 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-purple-600 to-indigo-700 hover:opacity-90 transition-opacity"
                  >
                    {currentIndex >= cards.length - 1 ? '查看结果' : '下一张'}
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      {/* 自评反馈浮窗 */}
      <AnimatePresence>
        {feedback && (
          <motion.div
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.25 }}
            className={cn(
              'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-28 h-28 rounded-3xl backdrop-blur-xl flex flex-col items-center justify-center gap-1 pointer-events-none shadow-2xl',
              feedback === 'correct'
                ? 'bg-green-50/95 dark:bg-green-900/40 ring-1 ring-green-300/40'
                : 'bg-red-50/95 dark:bg-red-900/40 ring-1 ring-red-300/40',
            )}
          >
            {feedback === 'correct' ? (
              <Check className="w-9 h-9 text-green-500" strokeWidth={3} />
            ) : (
              <X className="w-9 h-9 text-red-500" strokeWidth={3} />
            )}
            <span
              className={cn(
                'text-xs font-bold tracking-wide',
                feedback === 'correct'
                  ? 'text-green-600 dark:text-green-300'
                  : 'text-red-500 dark:text-red-300',
              )}
            >
              {feedback === 'correct' ? '掌握了' : '再看看'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 学习统计 */}
      <AnimatePresence>
        {showStats && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-md rounded-2xl"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white dark:bg-gray-900 rounded-2xl p-7 w-80 max-w-[90%] flex flex-col items-center gap-5 shadow-2xl ring-1 ring-gray-200 dark:ring-gray-800"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-500" />
                <span className="text-lg font-bold text-gray-800 dark:text-gray-100">
                  学习统计
                </span>
              </div>

              <div className="relative w-28 h-28">
                <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                  <circle
                    cx="60"
                    cy="60"
                    r="52"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="8"
                    className="text-gray-200 dark:text-gray-700"
                  />
                  <motion.circle
                    cx="60"
                    cy="60"
                    r="52"
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="8"
                    strokeLinecap="round"
                    initial={{ strokeDasharray: '0 326.7' }}
                    animate={{ strokeDasharray: `${masteryRate * 3.267} 326.7` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-2xl font-bold text-green-500">
                  {masteryRate}%
                </div>
              </div>

              <div className="flex gap-4 text-[12px] text-gray-500 dark:text-gray-400">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  学会
                  <span className="font-bold text-gray-800 dark:text-gray-100">{correctCount}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  没会
                  <span className="font-bold text-gray-800 dark:text-gray-100">{wrongCount}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-600" />
                  未标
                  <span className="font-bold text-gray-800 dark:text-gray-100">
                    {unmarkedCount}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2 w-full">
                {wrongCount + unmarkedCount > 0 && (
                  <button
                    onClick={reviewWrong}
                    className="w-full h-10 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-700 text-white text-sm font-semibold hover:opacity-90 transition-opacity"
                  >
                    复习没掌握的
                  </button>
                )}
                <button
                  onClick={reset}
                  className="w-full h-9 rounded-xl text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center justify-center gap-1.5"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  重新开始
                </button>
                <button
                  onClick={() => setShowStats(false)}
                  className="w-full h-8 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  关闭
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
