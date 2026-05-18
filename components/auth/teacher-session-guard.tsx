'use client';

/**
 * 教师会话过期守卫
 *
 * 订阅 useTeacherSessionStore.expired —— 任意带教师 token 的 API（fetchWithTeacherToken）
 * 收到 401 后翻 true，本组件弹 AlertDialog 提示「请从教师端重新进入」，
 * 确认后调 window.close() 关闭页面。
 *
 * 挂在 classroom 页根节点即可，全局共享。
 */

import { useTeacherSessionStore } from '@/lib/auth/teacher-token';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function TeacherSessionGuard() {
  const expired = useTeacherSessionStore((s) => s.expired);

  return (
    <AlertDialog open={expired}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>教师登录已过期</AlertDialogTitle>
          <AlertDialogDescription>
            您的教师身份已失效，请<strong>从教师端重新进入</strong>本课堂。
            点击确认后将关闭此页面。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            className="bg-red-500 hover:bg-red-600 text-white"
            onClick={() => {
              // 优先尝试关闭窗口（浏览器对非 script-opened 窗口可能拒绝）
              try {
                window.close();
              } catch {
                /* ignore */
              }
              // 兜底：close 被浏览器拦截时把页面变空，避免学生看到敏感数据残留
              setTimeout(() => {
                try {
                  window.location.replace('about:blank');
                } catch {
                  /* ignore */
                }
              }, 100);
            }}
          >
            确认
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
