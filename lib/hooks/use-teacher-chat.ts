'use client';

/**
 * 师生 1对1 私聊 hook（讨论 Tab 用）。
 *
 * - 独立 state，不走课堂 playback / action engine
 * - localStorage 持久化（按 classroomId 隔离）
 * - 直接调 /api/chat (teacherOnly=true)，自己处理 SSE
 * - 不触发 lectureSpeech / liveSpeech，底部圆桌 bubble 完全不受影响
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { useUserProfileStore } from '@/lib/store/user-profile';
import { useAgentRegistry } from '@/lib/orchestration/registry/store';
import { useStageStore } from '@/lib/store/stage';
import { useCanvasStore } from '@/lib/store/canvas';

export interface TeacherChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  agentId?: string;
  agentName?: string;
  agentAvatar?: string;
  agentColor?: string;
  createdAt: number;
}

interface UseTeacherChatOptions {
  /** 用于 localStorage 隔离，建议传 classroomId */
  storageKey?: string | null;
}

const STORAGE_PREFIX = 'teacherChat:';

export function useTeacherChat({ storageKey }: UseTeacherChatOptions = {}) {
  const fullKey = storageKey ? `${STORAGE_PREFIX}${storageKey}` : null;

  const [messages, setMessages] = useState<TeacherChatMessage[]>(() => {
    if (typeof window === 'undefined' || !fullKey) return [];
    try {
      const raw = localStorage.getItem(fullKey);
      return raw ? (JSON.parse(raw) as TeacherChatMessage[]) : [];
    } catch {
      return [];
    }
  });
  const [isStreaming, setIsStreaming] = useState(false);
  const [isThinking, setIsThinking] = useState(false);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const abortRef = useRef<AbortController | null>(null);
  // 切换 classroomId 时重新读 localStorage
  const lastKeyRef = useRef(fullKey);

  useEffect(() => {
    if (lastKeyRef.current === fullKey) return;
    lastKeyRef.current = fullKey;
    if (!fullKey) {
      setMessages([]);
      return;
    }
    try {
      const raw = localStorage.getItem(fullKey);
      setMessages(raw ? (JSON.parse(raw) as TeacherChatMessage[]) : []);
    } catch {
      setMessages([]);
    }
  }, [fullKey]);

  // 持久化（防抖 300ms）
  useEffect(() => {
    if (!fullKey) return;
    const id = setTimeout(() => {
      try {
        localStorage.setItem(fullKey, JSON.stringify(messages));
      } catch {
        /* quota / disabled — ignore */
      }
    }, 300);
    return () => clearTimeout(id);
  }, [messages, fullKey]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      const userMsg: TeacherChatMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        text: trimmed,
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      setIsThinking(true); // 用户发完即显示思考中，agent_start 后清

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const registry = useAgentRegistry.getState();
        // 严格按 teacherOnly 规范：放所有 teacher role 的 agent
        const teacherIds: string[] = [];
        for (const [id, agent] of Object.entries(registry.agents)) {
          if (agent.role === 'teacher') teacherIds.push(id);
        }
        if (teacherIds.length === 0) teacherIds.push('default-1');

        const modelConfig = getCurrentModelConfig();
        const userProfile = useUserProfileStore.getState();

        // 构造给 /api/chat 的 messages（metadata 跟原版聊天对齐）
        const apiMessages = [...messagesRef.current, userMsg].map((m) => ({
          id: m.id,
          role: m.role,
          parts: [{ type: 'text', text: m.text }],
          metadata:
            m.role === 'assistant'
              ? {
                  senderName: m.agentName,
                  senderAvatar: m.agentAvatar,
                  originalRole: 'agent',
                  agentId: m.agentId,
                  createdAt: m.createdAt,
                }
              : {
                  senderName: '你',
                  senderAvatar: '/avatars/user.png',
                  originalRole: 'user',
                  createdAt: m.createdAt,
                },
        }));

        // 只为非 default 的 generated agent 传 agentConfigs（跟原版聊天一致）
        const generatedAgentConfigs = teacherIds
          .filter((id) => !id.startsWith('default-'))
          .map((id) => registry.getAgent(id))
          .filter((a): a is NonNullable<typeof a> => Boolean(a))
          .map((a) => ({
            id: a.id,
            name: a.name,
            role: a.role,
            persona: a.persona,
            avatar: a.avatar,
            color: a.color,
          }));

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            messages: apiMessages,
            config: {
              // 跟 PPT 下方聊天对齐：plain QA + agentIds 限定 teacher
              // 后端 director 单 agent 路径会直接 dispatch 老师
              agentIds: teacherIds,
              sessionType: 'qa',
              ...(generatedAgentConfigs.length > 0 && {
                agentConfigs: generatedAgentConfigs,
              }),
            },
            // 跟原版聊天一致：带上真实的课堂上下文，prompt 才能正常构造
            storeState: {
              stage: useStageStore.getState().stage,
              scenes: useStageStore.getState().scenes,
              currentSceneId: useStageStore.getState().currentSceneId,
              mode: useStageStore.getState().mode,
              whiteboardOpen: useCanvasStore.getState().whiteboardOpen,
            },
            model: modelConfig.modelString,
            providerType: modelConfig.providerType,
            apiKey: modelConfig.apiKey,
            baseUrl: modelConfig.baseUrl,
            userProfile: {
              nickname: userProfile.nickname || undefined,
              bio: userProfile.bio || undefined,
            },
          }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`Chat API ${res.status}: ${errText}`);
        }
        if (!res.body) throw new Error('No response body');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let currentMsgId: string | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const blocks = buf.split('\n\n');
          buf = blocks.pop() ?? '';

          for (const block of blocks) {
            let eventType = '';
            let eventData = '';
            for (const line of block.split('\n')) {
              if (line.startsWith(':')) continue; // SSE comment / heartbeat
              if (line.startsWith('event: ')) eventType = line.slice(7);
              else if (line.startsWith('data: ')) eventData = line.slice(6);
            }
            if (!eventData) continue;

            let parsed: any;
            try {
              parsed = JSON.parse(eventData);
            } catch {
              continue;
            }

            // 兼容两种 SSE 格式：
            //   A. Next.js 风格:  event: <type> + data: <event.data>  → eventType 从 event 行取，data 是事件体
            //   B. Go 后端风格:   data: {"type":"...","data":{...}}    → eventType 从 JSON 里取，data 在 .data 里
            let data: any;
            if (eventType) {
              data = parsed;
            } else if (parsed && typeof parsed === 'object' && parsed.type) {
              eventType = parsed.type;
              data = parsed.data ?? parsed;
            } else {
              continue;
            }

            console.log('[TeacherChat][SSE]', eventType, data);
            if (eventType === 'thinking') {
              setIsThinking(true);
            } else if (eventType === 'agent_start') {
              setIsThinking(false);
              currentMsgId = data.messageId;
              const agent = registry.getAgent(data.agentId);
              setMessages((prev) => {
                // 同 messageId 已存在 → 不重复追加（防 SSE 重发）
                if (prev.some((m) => m.id === data.messageId)) return prev;
                return [
                  ...prev,
                  {
                    id: data.messageId,
                    role: 'assistant',
                    agentId: data.agentId,
                    agentName: data.agentName ?? agent?.name,
                    agentAvatar: data.agentAvatar ?? agent?.avatar,
                    agentColor: data.agentColor ?? agent?.color,
                    text: '',
                    createdAt: Date.now(),
                  },
                ];
              });
            } else if (eventType === 'text_delta') {
              const msgId = data.messageId ?? currentMsgId;
              const content = data.content ?? data.text ?? '';
              if (!msgId) {
                console.warn('[TeacherChat] text_delta no msgId', data);
                continue;
              }
              if (!content) continue;
              setMessages((prev) => {
                const idx = prev.findIndex((m) => m.id === msgId);
                if (idx < 0) {
                  console.warn('[TeacherChat] no msg matches', msgId, prev.map(m => m.id));
                  return prev;
                }
                const next = [...prev];
                next[idx] = { ...next[idx], text: next[idx].text + content };
                return next;
              });
            } else if (eventType === 'error') {
              console.error('[TeacherChat] server error:', data.message);
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('[TeacherChat] failed:', err);
          setMessages((prev) => [
            ...prev,
            {
              id: `err-${Date.now()}`,
              role: 'assistant',
              text: `[请求失败] ${(err as Error).message}`,
              agentName: '系统',
              createdAt: Date.now(),
            },
          ]);
        }
      } finally {
        setIsStreaming(false);
        setIsThinking(false);
        abortRef.current = null;
      }
    },
    [isStreaming],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setIsThinking(false);
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    if (fullKey) {
      try {
        localStorage.removeItem(fullKey);
      } catch {
        /* ignore */
      }
    }
  }, [fullKey]);

  /**
   * 由外部（如 lecture 笔记里的问句）注入一条老师消息作为对话起手。
   * 全局去重：messages 里任何位置有相同文本的 assistant 消息就跳过。
   * 原子性：dedupe 放进 setMessages updater 里，避免同一 tick 重复 push 的竞态。
   */
  const pushAssistant = useCallback(
    (
      text: string,
      agent?: { id?: string; name?: string; avatar?: string; color?: string },
    ) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setMessages((prev) => {
        if (prev.some((m) => m.role === 'assistant' && m.text.trim() === trimmed)) {
          return prev;
        }
        return [
          ...prev,
          {
            id: `seed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role: 'assistant',
            text: trimmed,
            agentId: agent?.id,
            agentName: agent?.name,
            agentAvatar: agent?.avatar,
            agentColor: agent?.color,
            createdAt: Date.now(),
          },
        ];
      });
    },
    [],
  );

  useEffect(() => () => stop(), [stop]);

  return {
    messages,
    isStreaming,
    isThinking,
    sendMessage,
    stop,
    clear,
    pushAssistant,
  };
}
