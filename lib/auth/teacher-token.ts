/**
 * Teacher token (standalone / non-iframe only)
 *
 * 独立访问 OpenMAIC 时，教师端通过 URL `?token=xxx` 传入；写到 localStorage 后由
 * 教师端专属接口（如 DELETE /api/classroom）用 `Authorization: Bearer <token>` 带上。
 *
 * iframe 嵌入场景下学生端 token 走 postMessage + zustand 内存 store，不动这里。
 *
 * 401 处理：fetchWithTeacherToken 检测到 token 被服务端拒绝 → 标记 expired，
 * 全局的 TeacherSessionGuard 弹窗提示「请从教师端重新进入」，确认后关闭页面。
 */

import { create } from 'zustand';

const KEY = 'openmaic:teacher-token';

export function setTeacherToken(token: string): void {
  try {
    window.localStorage.setItem(KEY, token);
  } catch {
    /* localStorage unavailable (SSR / private mode) — ignore */
  }
}

export function getTeacherToken(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearTeacherToken(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

interface TeacherSessionStore {
  expired: boolean;
  markExpired: () => void;
  clearExpired: () => void;
}

/** 会话过期状态（401 触发，TeacherSessionGuard 订阅并弹窗） */
export const useTeacherSessionStore = create<TeacherSessionStore>((set) => ({
  expired: false,
  markExpired: () => set({ expired: true }),
  clearExpired: () => set({ expired: false }),
}));

/**
 * 带教师 token 的 fetch 封装。
 * - 有 token 自动带上 Authorization: Bearer
 * - 没 token 不报错（独立测试场景），照常请求
 * - 服务端 401 **且原本带了 token** → 清掉本地 token + 标记 expired（触发全局弹窗）
 *   没 token 拿到 401 不视为会话过期（标准 401，业务自处理）
 */
export async function fetchWithTeacherToken(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = getTeacherToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && token) {
    clearTeacherToken();
    useTeacherSessionStore.getState().markExpired();
  }
  return res;
}
