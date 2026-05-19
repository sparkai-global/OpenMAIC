'use client';

import { useImperativeHandle, forwardRef, useRef, useCallback, useState, useMemo, useEffect } from 'react';
import type { SessionType } from '@/lib/types/chat';
import type { LectureNoteEntry } from '@/lib/types/chat';
import type { DiscussionRequest } from '@/components/roundtable';
import type { Action, SpeechAction, DiscussionAction } from '@/lib/types/action';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useStageStore } from '@/lib/store';
import { BookOpen, MessageSquare, ChevronUp, Send, Square } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useChatSessions } from './use-chat-sessions';
import { ChatSessionComponent } from './chat-session';
import { LectureNotesView } from './lecture-notes-view';
import { ChatText } from './chat-text';
import { useTeacherChat } from '@/lib/hooks/use-teacher-chat';
import { useUserProfileStore } from '@/lib/store/user-profile';
import { useAgentRegistry } from '@/lib/orchestration/registry/store';
import { submitLearningEvent } from '@/lib/learning-event/submit';
import { motion, AnimatePresence } from 'motion/react';

interface ChatAreaProps {
  className?: string;
  width?: number;
  onWidthChange?: (width: number) => void;
  collapsed?: boolean;
  onCollapseChange?: (collapsed: boolean) => void;
  activeBubbleId?: string | null;
  onActiveBubble?: (messageId: string | null) => void;
  onLiveSpeech?: (text: string | null, agentId?: string | null) => void;
  onSpeechProgress?: (ratio: number | null) => void;
  onThinking?: (state: { stage: string; agentId?: string } | null) => void;
  onCueUser?: (fromAgentId?: string, prompt?: string) => void;
  onLiveSessionError?: () => void;
  onStopSession?: () => void;
  onSegmentSealed?: (
    messageId: string,
    partId: string,
    fullText: string,
    agentId: string | null,
  ) => void;
  /** When provided and returns true, StreamBuffer holds on the current text item after reveal. */
  shouldHoldAfterReveal?: () => { holding: boolean; segmentDone: number } | boolean;
  currentSceneId?: string | null;
}

export interface ChatAreaRef {
  createSession: (type: SessionType, title: string) => Promise<string>;
  endSession: (sessionId: string) => Promise<void>;
  endActiveSession: () => Promise<void>;
  softPauseActiveSession: () => Promise<void>;
  resumeActiveSession: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  startDiscussion: (request: DiscussionRequest) => Promise<void>;
  startLecture: (sceneId: string) => Promise<string>;
  addLectureMessage: (sessionId: string, action: Action, actionIndex: number) => void;
  getIsStreaming: () => boolean;
  getActiveSessionType: () => string | null;
  getLectureMessageId: (sessionId: string) => string | null;
  pauseBuffer: (sessionId: string) => void;
  resumeBuffer: (sessionId: string) => void;
  pauseActiveLiveBuffer: () => boolean;
  resumeActiveLiveBuffer: () => void;
  switchToTab: (tab: 'lecture' | 'chat') => void;
  focusInput: () => void;
}

const DEFAULT_WIDTH = 340;
const MIN_WIDTH = 240;
const MAX_WIDTH = 560;

/** 师生 1对1 私聊气泡列表（讨论 Tab 用） */
function TeacherChatLog({
  messages,
  isStreaming,
  isThinking,
  userAvatar,
  userNickname,
}: {
  messages: import('@/lib/hooks/use-teacher-chat').TeacherChatMessage[];
  isStreaming: boolean;
  isThinking: boolean;
  userAvatar?: string;
  userNickname?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // 自动滚到底
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isThinking]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-2 scrollbar-hide border-t border-gray-100 dark:border-gray-800"
    >
      {messages.length === 0 && !isStreaming ? (
        <div className="h-full flex flex-col items-center justify-center text-center p-4 opacity-50">
          <p className="text-[10px] text-gray-400 dark:text-gray-500">
            在下方输入与老师对话
          </p>
        </div>
      ) : (
        <AnimatePresence initial={false}>
          {messages.map((m) => {
            const isUser = m.role === 'user';
            return (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={cn('flex gap-2', isUser && 'flex-row-reverse')}
              >
                <div
                  className="w-7 h-7 rounded-full overflow-hidden shrink-0 ring-1 ring-gray-200/60 dark:ring-gray-700/60 bg-gray-200 dark:bg-gray-700"
                  style={!isUser && m.agentColor ? { backgroundColor: m.agentColor } : {}}
                >
                  {(isUser ? userAvatar : m.agentAvatar) ? (
                    <img
                      src={isUser ? userAvatar : m.agentAvatar}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white text-[10px] font-bold">
                      {(isUser ? userNickname : m.agentName)?.[0] ?? '?'}
                    </div>
                  )}
                </div>
                <div className={cn('flex flex-col max-w-[80%]', isUser && 'items-end')}>
                  <span className="text-[9px] text-gray-400 dark:text-gray-500 mb-0.5 px-1">
                    {isUser ? userNickname || '我' : m.agentName}
                  </span>
                  <div
                    className={cn(
                      'rounded-2xl px-3 py-2 text-[12px] whitespace-pre-wrap break-words leading-relaxed',
                      isUser
                        ? 'bg-purple-500 text-white rounded-br-sm'
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

      {/* 思考中（仅在 isThinking 且没有刚开始的 assistant 流式消息时） */}
      {isThinking && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex gap-2"
        >
          <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-800 ring-1 ring-gray-200/60 dark:ring-gray-700/60 shrink-0 flex items-center justify-center">
            <span className="text-[10px] text-gray-400">…</span>
          </div>
          <div className="rounded-2xl rounded-bl-sm bg-gray-100 dark:bg-gray-800 px-3 py-2.5">
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
  );
}

export const ChatArea = forwardRef<ChatAreaRef, ChatAreaProps>(
  (
    {
      className,
      width = DEFAULT_WIDTH,
      onWidthChange,
      collapsed = false,
      onCollapseChange,
      activeBubbleId,
      onActiveBubble,
      onLiveSpeech,
      onSpeechProgress,
      onThinking,
      onCueUser,
      onLiveSessionError,
      onStopSession,
      onSegmentSealed,
      shouldHoldAfterReveal,
      currentSceneId,
    },
    ref,
  ) => {
    const { t } = useI18n();
    const scenes = useStageStore((s) => s.scenes);
    const stageId = useStageStore((s) => s.stage?.id);
    const userAvatar = useUserProfileStore((s) => s.avatar);
    const userNickname = useUserProfileStore((s) => s.nickname);

    // 讨论 Tab 的独立师生 1对1 聊天（按 课堂ID + sceneID 隔离，每个 scene 独立历史）
    const teacherChatKey =
      stageId && currentSceneId ? `${stageId}:${currentSceneId}` : null;
    const teacherChat = useTeacherChat({ storageKey: teacherChatKey });
    const {
      sessions,
      activeSessionType,
      expandedSessionIds,
      isStreaming,
      createSession,
      endSession,
      endActiveSession,
      softPauseActiveSession,
      resumeActiveSession,
      sendMessage,
      startDiscussion,
      startLecture,
      addLectureMessage,
      toggleSessionExpand,
      getLectureMessageId,
      pauseBuffer,
      resumeBuffer,
      pauseActiveLiveBuffer,
      resumeActiveLiveBuffer,
    } = useChatSessions({
      onLiveSpeech,
      onSpeechProgress,
      onThinking,
      onCueUser,
      onActiveBubble,
      onLiveSessionError,
      onStopSession,
      onSegmentSealed,
      shouldHoldAfterReveal,
    });

    const [activeTab, setActiveTab] = useState<'lecture' | 'chat'>('lecture');
    // 默认收起：固定高度 + 渐隐遮罩，只看到最后一段
    const [notesCollapsed, setNotesCollapsed] = useState(true);
    const [inputValue, setInputValue] = useState('');

    // 学习事件计时：讨论 Tab 跟着 scene 切换重置；拓展 Tab 跟着 stage 重置（多 agent 跨 scene 持续）
    const teacherChatStartRef = useRef<number>(Date.now());
    const teacherMsgCountRef = useRef<number>(0);
    const groupChatStartRef = useRef<number>(Date.now());
    const groupMsgCountRef = useRef<number>(0);
    useEffect(() => {
      teacherChatStartRef.current = Date.now();
      teacherMsgCountRef.current = 0;
    }, [currentSceneId]);
    useEffect(() => {
      groupChatStartRef.current = Date.now();
      groupMsgCountRef.current = 0;
    }, [stageId]);
    const notesScrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const isDraggingRef = useRef(false);
    const [isDragging, setIsDragging] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);

    // Derive lecture notes directly from scenes — updates reactively as scenes stream in
    // Preserves action order so spotlight/laser badges appear inline between speech texts
    const lectureNotes: LectureNoteEntry[] = useMemo(
      () =>
        scenes
          .filter((scene) => scene.actions && scene.actions.length > 0)
          .map((scene) => ({
            sceneId: scene.id,
            sceneTitle: scene.title,
            sceneOrder: scene.order,
            items: scene
              .actions!.filter(
                (a) =>
                  a.type === 'speech' ||
                  a.type === 'spotlight' ||
                  a.type === 'laser' ||
                  a.type === 'play_video' ||
                  a.type === 'discussion',
              )
              .map((a) => {
                if (a.type === 'speech') {
                  return {
                    kind: 'speech' as const,
                    text: (a as SpeechAction).text,
                  };
                }
                return {
                  kind: 'action' as const,
                  type: a.type,
                  label: a.type === 'discussion' ? (a as DiscussionAction).topic : undefined,
                };
              }),
            completedAt: scene.updatedAt || scene.createdAt || 0,
          }))
          .sort((a, b) => a.sceneOrder - b.sceneOrder),
      [scenes],
    );

    // 排除 lecture（已在笔记区渲染）
    const nonLectureSessions = useMemo(
      () => sessions.filter((s) => s.type !== 'lecture'),
      [sessions],
    );

    // 讨论 Tab 下方：老师对话 = QA 会话 + teacher-only discussion 会话
    const teacherSessions = useMemo(
      () =>
        nonLectureSessions.filter(
          (s) => s.type === 'qa' || s.config.teacherOnly === true,
        ),
      [nonLectureSessions],
    );

    // 拓展 Tab：所有引擎触发的多 agent 讨论 + 学生在拓展 Tab 主动发起的 QA
    // 学生主动 1v1 私聊（讨论 Tab）走 useTeacherChat 独立 hook，不在 sessions 里
    const groupSessions = useMemo(() => nonLectureSessions, [nonLectureSessions]);

    // 兼容旧名（其他地方可能引用）
    const chatSessions = nonLectureSessions;

    // 拓展 Tab 红点（有多人讨论进行中且当前不在拓展 Tab）
    const hasActiveChatSession = useMemo(
      () => groupSessions.some((s) => s.status === 'active'),
      [groupSessions],
    );

    // 当前 scene 的笔记（只显示这一条）
    const currentSceneNotes = useMemo(
      () => (currentSceneId ? lectureNotes.filter((n) => n.sceneId === currentSceneId) : []),
      [lectureNotes, currentSceneId],
    );

    // 收起 / 当前 scene 变化时，自动滚到底部，让最后一段进入可见区
    useEffect(() => {
      if (!notesCollapsed) return;
      const el = notesScrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, [notesCollapsed, currentSceneNotes, currentSceneId]);

    // 当前 scene 最后一句若以问号结尾，自动作为老师的"开场"塞进讨论 Tab
    useEffect(() => {
      const items = currentSceneNotes[0]?.items ?? [];
      let lastSpeech = '';
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].kind === 'speech') {
          lastSpeech = (items[i] as { kind: 'speech'; text: string }).text.trim();
          break;
        }
      }
      if (!lastSpeech || !/[?？]$/.test(lastSpeech)) return;

      // 找一个 teacher role agent 提供身份信息（头像、名字、颜色）
      const registry = useAgentRegistry.getState();
      let teacher: { id: string; name?: string; avatar?: string; color?: string } | undefined;
      for (const [id, a] of Object.entries(registry.agents)) {
        if (a.role === 'teacher') {
          teacher = { id, name: a.name, avatar: a.avatar, color: a.color };
          break;
        }
      }
      teacherChat.pushAssistant(lastSpeech, teacher);
    }, [currentSceneId, currentSceneNotes, teacherChat]);

    // Wrap endSession for QA/Discussion: also notify parent for engine cleanup
    const handleEndSession = useCallback(
      async (sessionId: string) => {
        await endSession(sessionId);
        onStopSession?.();
      },
      [endSession, onStopSession],
    );

    const switchToTab = useCallback((tab: 'lecture' | 'chat') => {
      setActiveTab(tab);
    }, []);

    const handleSend = useCallback(() => {
      const text = inputValue.trim();
      if (!text) return;
      // 讨论 Tab → 师生独立聊天（流式中禁止重发）
      // 注意：讨论 / 拓展 Tab 都不上报 message_sent 学习事件（只 chat 场景上报）
      if (activeTab === 'lecture') {
        if (teacherChat.isStreaming) return;
        setInputValue('');
        teacherChat.sendMessage(text);
        teacherMsgCountRef.current += 1;
        submitLearningEvent('message_sent', {
          timeSpentSec: Math.round((Date.now() - teacherChatStartRef.current) / 1000),
          messageIndex: teacherMsgCountRef.current,
          sceneId: currentSceneId ?? null,
          surface: 'teacher-chat',
        });
        return;
      }
      // 拓展 Tab → sendMessage（active discussion 自动复用，否则新开 qa）
      setInputValue('');
      sendMessage(text);
      groupMsgCountRef.current += 1;
      submitLearningEvent('message_sent', {
        timeSpentSec: Math.round((Date.now() - groupChatStartRef.current) / 1000),
        messageIndex: groupMsgCountRef.current,
        sceneId: currentSceneId ?? null,
        surface: 'group-discussion',
      });
    }, [inputValue, sendMessage, activeTab, teacherChat, currentSceneId]);

    useImperativeHandle(ref, () => ({
      createSession,
      endSession,
      endActiveSession,
      softPauseActiveSession,
      resumeActiveSession,
      sendMessage,
      startDiscussion,
      startLecture,
      addLectureMessage,
      getIsStreaming: () => isStreaming,
      getActiveSessionType: () => activeSessionType,
      getLectureMessageId,
      pauseBuffer,
      resumeBuffer,
      pauseActiveLiveBuffer,
      resumeActiveLiveBuffer,
      switchToTab,
      focusInput: () => {
        // 切到 chat tab 并聚焦输入框
        setActiveTab('chat');
        // 等 tab 渲染完再聚焦
        requestAnimationFrame(() => {
          inputRef.current?.focus();
        });
      },
    }));

    // Drag-to-resize (Pointer Events — works for mouse, touch, pen)
    const handleDragStart = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        isDraggingRef.current = true;
        setIsDragging(true);
        const startX = e.clientX;
        const startWidth = width;
        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);

        const handlePointerMove = (pe: PointerEvent) => {
          const delta = startX - pe.clientX;
          const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
          onWidthChange?.(newWidth);
        };

        const handlePointerUp = (pe: PointerEvent) => {
          isDraggingRef.current = false;
          setIsDragging(false);
          if (target.hasPointerCapture(pe.pointerId)) {
            target.releasePointerCapture(pe.pointerId);
          }
          target.removeEventListener('pointermove', handlePointerMove);
          target.removeEventListener('pointerup', handlePointerUp);
          target.removeEventListener('pointercancel', handlePointerUp);
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
        };

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        target.addEventListener('pointermove', handlePointerMove);
        target.addEventListener('pointerup', handlePointerUp);
        target.addEventListener('pointercancel', handlePointerUp);
      },
      [width, onWidthChange],
    );

    const displayWidth = collapsed ? 0 : width;

    return (
      <div
        style={{
          width: displayWidth,
          transition: isDragging ? 'none' : 'width 0.3s ease',
        }}
        className={cn(
          'bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-l border-gray-100 dark:border-gray-800 shadow-[-2px_0_24px_rgba(0,0,0,0.02)] flex flex-col shrink-0 z-20 relative overflow-visible',
          className,
        )}
      >
        {/* Drag handle */}
        {!collapsed && (
          <div
            onPointerDown={handleDragStart}
            style={{ touchAction: 'none' }}
            className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-50 group hover:bg-purple-400/30 dark:hover:bg-purple-600/30 active:bg-purple-500/40 dark:active:bg-purple-500/40 transition-colors"
          >
            <div className="absolute left-0.5 top-1/2 -translate-y-1/2 w-0.5 h-8 rounded-full bg-gray-300 dark:bg-gray-600 group-hover:bg-purple-400 dark:group-hover:bg-purple-500 transition-colors" />
          </div>
        )}

        <div className={cn('flex flex-col w-full h-full overflow-hidden', collapsed && 'hidden')}>
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as 'lecture' | 'chat')}
            className="flex flex-col h-full gap-0"
          >
            {/* Tab 头 */}
            <div className="h-10 flex items-center gap-1 shrink-0 mt-3 mb-1 px-3">
              <TabsList variant="line" className="h-full flex-1 w-0">
                <TabsTrigger value="lecture" className="text-xs gap-1 flex-1">
                  <BookOpen className="w-3.5 h-3.5" />
                  讨论
                </TabsTrigger>
                <TabsTrigger value="chat" className="text-xs gap-1 flex-1 relative">
                  <MessageSquare className="w-3.5 h-3.5" />
                  拓展
                  {hasActiveChatSession && activeTab === 'lecture' && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>

            {/* 讨论 Tab —— 上方笔记卡片，下方聊天历史 */}
            <TabsContent value="lecture" className="flex-1 overflow-hidden flex flex-col">
              {/* 顶部：笔记卡片，可收起 */}
              <div
                className={cn(
                  'relative shrink-0 transition-[height,max-height] duration-300',
                  notesCollapsed ? 'h-[200px]' : 'max-h-[60vh] h-auto',
                )}
                onClick={() => {
                  if (notesCollapsed) setNotesCollapsed(false);
                }}
              >
                <div
                  ref={notesScrollRef}
                  className={cn(
                    'h-full max-h-full overflow-y-auto overflow-x-hidden',
                    notesCollapsed && 'cursor-pointer',
                  )}
                >
                  {currentSceneNotes.length > 0 ? (
                    <LectureNotesView
                      notes={currentSceneNotes}
                      currentSceneId={currentSceneId}
                      boldLastSpeech
                      footerSlot={
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setNotesCollapsed(!notesCollapsed);
                          }}
                          className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400 hover:text-purple-500 dark:hover:text-purple-400 transition-colors"
                        >
                          <ChevronUp
                            className={cn(
                              'w-3.5 h-3.5 transition-transform duration-200',
                              notesCollapsed && 'rotate-180',
                            )}
                          />
                          <span>{notesCollapsed ? '展开' : '收起'}</span>
                        </button>
                      }
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center px-3 py-4 opacity-60 h-full">
                      <p className="text-[11px] text-gray-400 dark:text-gray-500">
                        {t('chat.lectureNotes.empty')}
                      </p>
                    </div>
                  )}
                </div>

                {/* 收起时渐隐 mask */}
                {notesCollapsed && (
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white via-white/40 to-transparent dark:from-gray-900 dark:via-gray-900/40 dark:to-transparent" />
                )}
              </div>

              {/* 下方：师生 1对1 私聊历史（独立 state，不走课堂引擎） */}
              <TeacherChatLog
                messages={teacherChat.messages}
                isStreaming={teacherChat.isStreaming}
                isThinking={teacherChat.isThinking}
                userAvatar={userAvatar}
                userNickname={userNickname}
              />
            </TabsContent>

            {/* 拓展 Tab —— 多人讨论（teacherOnly !== true 的 discussion 会话） */}
            <TabsContent value="chat" className="flex-1 overflow-hidden flex flex-col">
              <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-1 scrollbar-hide">
                {groupSessions.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 opacity-50">
                    <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-3 text-gray-300 dark:text-gray-600">
                      <MessageSquare className="w-6 h-6" />
                    </div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                      多人讨论
                    </p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                      课堂触发讨论时会显示在这里
                    </p>
                  </div>
                ) : (
                  <>
                    {groupSessions.map((session) => (
                      <ChatSessionComponent
                        key={session.id}
                        session={session}
                        isActive={session.status === 'active'}
                        isStreaming={isStreaming && session.status === 'active'}
                        activeBubbleId={activeBubbleId}
                        onEndSession={handleEndSession}
                      />
                    ))}
                  </>
                )}
              </div>
            </TabsContent>

            {/* 底部输入框 —— 两个 Tab 下都显示 */}
            <div className="shrink-0 border-t border-gray-100 dark:border-gray-800 p-2 flex items-end gap-1.5">
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
                placeholder={activeTab === 'lecture' ? '向老师提问...' : '加入讨论...'}
                rows={1}
                className="flex-1 resize-none rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-purple-400 dark:focus:ring-purple-500/50 max-h-32"
                style={{ minHeight: 36 }}
              />
              {/* 讨论 Tab：流式中显示停止；拓展 Tab：始终允许发送（让用户随时插话） */}
              {activeTab === 'lecture' && teacherChat.isStreaming ? (
                <button
                  onClick={() => teacherChat.stop()}
                  className="w-9 h-9 shrink-0 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center active:scale-95 transition-all"
                  title="停止"
                >
                  <Square className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!inputValue.trim()}
                  className="w-9 h-9 shrink-0 rounded-full bg-purple-500 hover:bg-purple-600 disabled:bg-gray-200 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white flex items-center justify-center active:scale-95 transition-all"
                  title="发送"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </Tabs>
        </div>
      </div>
    );
  },
);

ChatArea.displayName = 'ChatArea';
