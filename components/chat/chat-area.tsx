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
}

const DEFAULT_WIDTH = 340;
const MIN_WIDTH = 240;
const MAX_WIDTH = 560;

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
    const notesScrollRef = useRef<HTMLDivElement>(null);
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

    // 对话 tab 不显示 lecture（lecture 已经渲染在笔记里）
    const chatSessions = useMemo(() => sessions.filter((s) => s.type !== 'lecture'), [sessions]);

    // 有进行中的讨论 / QA → 笔记 tab 上显示提示小红点
    const hasActiveChatSession = useMemo(
      () => chatSessions.some((s) => s.status === 'active'),
      [chatSessions],
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
      if (!text || isStreaming) return;
      setInputValue('');
      sendMessage(text);
    }, [inputValue, isStreaming, sendMessage]);

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
                  {t('chat.tabs.lecture')}
                </TabsTrigger>
                <TabsTrigger value="chat" className="text-xs gap-1 flex-1 relative">
                  <MessageSquare className="w-3.5 h-3.5" />
                  {t('chat.tabs.chat')}
                  {hasActiveChatSession && activeTab === 'lecture' && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>

            {/* 笔记 Tab —— 收起按钮直接做在笔记卡片内部 */}
            <TabsContent value="lecture" className="flex-1 overflow-hidden flex flex-col">
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
                          <span>{notesCollapsed ? '展开笔记' : '收起笔记'}</span>
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
            </TabsContent>

            {/* 对话 Tab —— 扁平化连续聊天记录（学生消息 + AI 回复） */}
            <TabsContent value="chat" className="flex-1 overflow-hidden flex flex-col">
              <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-1 scrollbar-hide">
                {chatSessions.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 opacity-50">
                    <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-3 text-gray-300 dark:text-gray-600">
                      <MessageSquare className="w-6 h-6" />
                    </div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                      {t('chat.noConversations')}
                    </p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                      {t('chat.startConversation')}
                    </p>
                  </div>
                ) : (
                  <>
                    {chatSessions.map((session) => (
                      <ChatSessionComponent
                        key={session.id}
                        session={session}
                        isActive={session.status === 'active'}
                        isStreaming={isStreaming && session.status === 'active'}
                        activeBubbleId={activeBubbleId}
                        onEndSession={handleEndSession}
                      />
                    ))}
                    <div ref={bottomRef} />
                  </>
                )}
              </div>
            </TabsContent>

            {/* 底部输入框 —— 两个 Tab 下都显示 */}
            <div className="shrink-0 border-t border-gray-100 dark:border-gray-800 p-2 flex items-end gap-1.5">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={t('chat.inputPlaceholder') || '提问或参与讨论...'}
                rows={1}
                className="flex-1 resize-none rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-purple-400 dark:focus:ring-purple-500/50 max-h-32 disabled:opacity-50"
                style={{ minHeight: 36 }}
              />
              {isStreaming ? (
                <button
                  onClick={() => endActiveSession?.()}
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
