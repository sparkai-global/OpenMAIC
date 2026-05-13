'use client';

/**
 * Chat Renderer
 * 单 agent 自由对话场景 —— 围绕 scene.content.topic 学生与指定 agent 聊天。
 *
 * 走项目自带的 /api/chat 接口（与讨论 Tab 相同的 useTeacherChat hook）。
 * 按 sceneId 独立 localStorage 持久化，切换 scene 互不干扰。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Square, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTeacherChat } from '@/lib/hooks/use-teacher-chat';
import { useUserProfileStore } from '@/lib/store/user-profile';
import { useStageStore } from '@/lib/store/stage';
import { useAgentRegistry } from '@/lib/orchestration/registry/store';
import { submitLearningEvent } from '@/lib/learning-event/submit';
import { ChatText } from '@/components/chat/chat-text';
import type { ChatContent } from '@/lib/types/stage';

interface ChatRendererProps {
  readonly content: ChatContent;
  readonly sceneId: string;
}

export function ChatRenderer({ content, sceneId }: ChatRendererProps) {
  const stageId = useStageStore((s) => s.stage?.id);
  const userAvatar = useUserProfileStore((s) => s.avatar);
  const userNickname = useUserProfileStore((s) => s.nickname);

  // 每个 chat 场景独立的会话存储
  const storageKey = stageId ? `chatScene:${stageId}:${sceneId}` : null;
  const chat = useTeacherChat({ storageKey });

  // 获取指定 agent 的信息
  const targetAgent = useMemo(() => {
    const id = content.agentId || 'default-1';
    const a = useAgentRegistry.getState().getAgent(id);
    return a
      ? { id: a.id, name: a.name, avatar: a.avatar, color: a.color }
      : { id, name: 'AI 老师', avatar: '/avatars/teacher.png', color: '#3b82f6' };
  }, [content.agentId]);

  // 首次进入：把 openingPrompt 作为 agent 的开场白
  useEffect(() => {
    if (!content.openingPrompt) return;
    chat.pushAssistant(content.openingPrompt, targetAgent);
    // 仅依赖 sceneId 触发一次（pushAssistant 内部全局去重）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId, content.openingPrompt]);

  // 学习事件：进入 chat 场景的起始时间，切 scene 时重置
  const chatStartTimeRef = useRef<number>(Date.now());
  const userMsgCountRef = useRef<number>(0);
  useEffect(() => {
    chatStartTimeRef.current = Date.now();
    userMsgCountRef.current = 0;
  }, [sceneId]);

  const [inputValue, setInputValue] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 自动滚到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat.messages, chat.isThinking]);

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text || chat.isStreaming) return;
    setInputValue('');
    chat.sendMessage(text);
    userMsgCountRef.current += 1;
    const timeSpentSec = Math.round((Date.now() - chatStartTimeRef.current) / 1000);
    submitLearningEvent('message_sent', {
      timeSpentSec,
      messageIndex: userMsgCountRef.current,
      agentId: targetAgent.id,
      sceneId,
      surface: 'chat-scene',
    });
  }, [inputValue, chat, targetAgent.id, sceneId]);

  return (
    <div className="w-full h-full flex items-center justify-center p-6">
      <div className="w-full max-w-3xl h-full flex flex-col bg-white dark:bg-gray-900 rounded-2xl ring-1 ring-gray-200 dark:ring-gray-800 shadow-[0_4px_24px_rgba(0,0,0,0.04)] overflow-hidden">
        {/* 顶部主题条 */}
        <div className="shrink-0 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3 bg-gradient-to-r from-purple-50/50 to-transparent dark:from-purple-900/10">
          <div
            className="w-10 h-10 rounded-full ring-2 ring-white dark:ring-gray-800 shadow-sm overflow-hidden shrink-0 flex items-center justify-center text-white font-bold"
            style={{ backgroundColor: targetAgent.color }}
          >
            {targetAgent.avatar ? (
              <img
                src={targetAgent.avatar}
                alt={targetAgent.name}
                className="w-full h-full object-cover"
              />
            ) : (
              targetAgent.name?.[0] ?? 'A'
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-400 dark:text-gray-500 font-semibold tracking-wide uppercase">
              讨论话题
            </div>
            <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
              {content.topic || '与 AI 老师对话'}
            </div>
          </div>
        </div>

        {/* 消息列表 */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto overflow-x-hidden p-5 space-y-3 scrollbar-hide"
        >
          {chat.messages.length === 0 && !chat.isThinking ? (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
              <div className="w-14 h-14 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-3 text-gray-400">
                <MessageSquare className="w-7 h-7" />
              </div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                开始与 {targetAgent.name} 对话
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                在下方输入你的想法
              </p>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {chat.messages.map((m) => {
                const isUser = m.role === 'user';
                return (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22 }}
                    className={cn('flex gap-2.5', isUser && 'flex-row-reverse')}
                  >
                    <div
                      className="w-8 h-8 rounded-full overflow-hidden shrink-0 ring-1 ring-gray-200/60 dark:ring-gray-700/60 bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-white text-[11px] font-bold"
                      style={!isUser && m.agentColor ? { backgroundColor: m.agentColor } : {}}
                    >
                      {(isUser ? userAvatar : m.agentAvatar) ? (
                        <img
                          src={isUser ? userAvatar : m.agentAvatar}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        ((isUser ? userNickname : m.agentName)?.[0] ?? '?')
                      )}
                    </div>
                    <div
                      className={cn(
                        'flex flex-col max-w-[78%] gap-1',
                        isUser && 'items-end',
                      )}
                    >
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 px-1 font-medium">
                        {isUser ? (userNickname || '我') : m.agentName}
                      </span>
                      <div
                        className={cn(
                          'rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words',
                          isUser
                            ? 'bg-gradient-to-br from-purple-500 to-violet-600 text-white rounded-br-sm shadow-sm'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100 rounded-bl-sm',
                        )}
                      >
                        {m.text ? (
                          <ChatText text={m.text} />
                        ) : (
                          <span className="inline-flex gap-0.5 items-center">
                            <span
                              className="w-1 h-1 rounded-full bg-current animate-bounce"
                              style={{ animationDelay: '0ms' }}
                            />
                            <span
                              className="w-1 h-1 rounded-full bg-current animate-bounce"
                              style={{ animationDelay: '150ms' }}
                            />
                            <span
                              className="w-1 h-1 rounded-full bg-current animate-bounce"
                              style={{ animationDelay: '300ms' }}
                            />
                          </span>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}

          {/* 思考中 */}
          {chat.isThinking && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-2.5"
            >
              <div
                className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-white text-[11px] font-bold"
                style={{ backgroundColor: targetAgent.color }}
              >
                {targetAgent.avatar ? (
                  <img
                    src={targetAgent.avatar}
                    alt=""
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  (targetAgent.name?.[0] ?? '?')
                )}
              </div>
              <div className="rounded-2xl rounded-bl-sm bg-gray-100 dark:bg-gray-800 px-3.5 py-3">
                <span className="inline-flex gap-1 items-center">
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce"
                    style={{ animationDelay: '0ms' }}
                  />
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce"
                    style={{ animationDelay: '150ms' }}
                  />
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce"
                    style={{ animationDelay: '300ms' }}
                  />
                </span>
              </div>
            </motion.div>
          )}
        </div>

        {/* 底部输入 */}
        <div className="shrink-0 border-t border-gray-100 dark:border-gray-800 p-3 flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={`和 ${targetAgent.name} 聊聊...`}
            rows={1}
            className="flex-1 resize-none rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3.5 py-2.5 text-[13px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-purple-400 dark:focus:ring-purple-500/50 max-h-32"
            style={{ minHeight: 40 }}
          />
          {chat.isStreaming ? (
            <button
              onClick={() => chat.stop()}
              className="w-10 h-10 shrink-0 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center active:scale-95 transition-all shadow-sm"
              title="停止"
            >
              <Square className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!inputValue.trim()}
              className="w-10 h-10 shrink-0 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 hover:opacity-90 disabled:bg-gray-200 dark:disabled:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-white flex items-center justify-center active:scale-95 transition-all shadow-sm"
              title="发送"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
