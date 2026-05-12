# OpenMAIC 父页对接文档

本文档描述外部项目（Vue / React / 任意 web 项目）通过 iframe 嵌入 OpenMAIC 课堂时，
父页需要做的事。

---

## 1. iframe 嵌入

```html
<iframe
  id="openmaic"
  src="https://<OPENMAIC_DOMAIN>/classroom/<课堂ID>"
  width="100%"
  height="800"
  frameborder="0"
  allow="microphone; autoplay; clipboard-write"
></iframe>
```

| 属性 | 说明 |
|---|---|
| `src` | OpenMAIC 课堂播放页地址。`<课堂ID>` = 后端返回的 `stage.id` |
| `allow` | **必须**带这三个权限：麦克风（语音输入）、自动播放（TTS）、剪贴板 |

> **协议要求**：父页和 iframe 都必须是 `https://`，混用会被浏览器拦截。
> iframe 内自动隐藏返回按钮、设置按钮和 logo 跳转，不需要父页做特殊处理。

---

## 2. postMessage 协议总览

父页通过 `postMessage` 注入数据。**统一 targetOrigin** 用 OpenMAIC 完整域名，**不要用 `*`**。

```js
const OPENMAIC_ORIGIN = 'https://<OPENMAIC_DOMAIN>';
const iframe = document.getElementById('openmaic');

iframe.contentWindow.postMessage({ type, payload }, OPENMAIC_ORIGIN);
```

| 消息 type | 方向 | 用途 |
|---|---|---|
| `openmaic:user-profile` | 父 → iframe | 注入学生用户信息（头像、昵称） |
| `openmaic:learning-context` | 父 → iframe | 注入学习事件上报所需的 token / API 地址 / sourceRootId |
| `openmaic:auth-expired` | iframe → 父 | OpenMAIC 收到 401/403 时主动告知父页"我没权限了，请刷新 token" |

---

## 3. 注入用户信息 `openmaic:user-profile`

iframe `load` 事件后**立即**发，否则学生看不到自己的头像 / 昵称。

```js
iframe.addEventListener('load', () => {
  iframe.contentWindow.postMessage({
    type: 'openmaic:user-profile',
    payload: {
      nickname: '张三',                            // 学生昵称
      avatar: 'https://your-cdn.com/avatar.png',   // 头像 URL 或 data URL
      bio: '高一(3)班',                            // 可选，简介
    },
  }, OPENMAIC_ORIGIN);
});
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `nickname` | string | 可选 | 学生名字 |
| `avatar` | string | 可选 | 头像 URL（http(s)）或 data URL |
| `bio` | string | 可选 | 个人简介 |

**字段全可选**，只传 `nickname` 也 OK，缺的保留原值。

**动态更新**：换账号 / 改头像后再 `postMessage` 一次，立即生效，无需刷新 iframe。

---

## 4. 注入学习事件上报 context `openmaic:learning-context`

OpenMAIC 会上报学生学习行为事件（翻卡、答题、聊天等）。**父页必须注入 token + lesson ID**，否则所有事件**静默跳过**（不报错，但后端收不到）。

> **后端地址不再由父页传**：OpenMAIC 通过 Next.js 同源代理 `/app/*` → 父项目真后端（地址硬编码在 [next.config.ts](next.config.ts)）。切换 test/prod 改那一行重新部署，父页对接逻辑不变。

```js
iframe.addEventListener('load', () => {
  iframe.contentWindow.postMessage({
    type: 'openmaic:learning-context',
    payload: {
      // 必填两项
      token: authStore.accessToken,                // 学生当前 Bearer token
      sourceRootId: currentLesson.id,              // 当前 lesson.id（父项目的课包 ID）

      // 可选 —— 不传走默认
      // sourceId: 'material-item-id',             // 默认 = OpenMAIC 的 stage.id
      // sourceType: 1,                            // 默认 1 = 课堂素材学习
    },
  }, OPENMAIC_ORIGIN);
});
```

### 必填字段

| 字段 | 说明 |
|---|---|
| `token` | 学生当前的 access token，用作 `Authorization: Bearer <token>` |
| `sourceRootId` | 父项目的 `lesson.id` |

### 可选字段

| 字段 | 默认值 | 说明 |
|---|---|---|
| `sourceId` | OpenMAIC 的 `stage.id`（自动取） | 素材项 ID |
| `sourceType` | `1` | 来源类型（1 = 课堂素材学习） |

> **任意字段缺失** → store 的 `enabled` 字段为 `false` → 所有事件静默跳过，不会报错。

---

## 5. Token 失效自动刷新 `openmaic:auth-expired`

当 OpenMAIC 调 `/learning/event/submit` 收到 **401 / 403** 时，会主动 postMessage 通知父页。

**OpenMAIC 自己不做 token 刷新**（避免和父页的 refresh 逻辑冲突），由父页统一处理。

### 父页监听 + 刷新 + 回推

```js
window.addEventListener('message', async (e) => {
  // 安全校验：只接受来自 OpenMAIC 的消息
  if (e.origin !== OPENMAIC_ORIGIN) return;
  if (e.data?.type !== 'openmaic:auth-expired') return;

  try {
    // 1. 走你现有的 refresh 逻辑（http.ts: handleTokenExpired）
    const newToken = await refreshAccessToken();

    // 2. 推新 token 回 iframe（其他字段不用重传，store 用 partial 合并）
    iframe.contentWindow.postMessage({
      type: 'openmaic:learning-context',
      payload: { token: newToken },
    }, OPENMAIC_ORIGIN);
  } catch (err) {
    // refresh 失败 → 跳登录页
    console.error('Refresh failed:', err);
    router.push('/login');
  }
});
```

### Token 生命周期

```
父页加载 iframe
   ↓ load 事件
父页 postMessage(openmaic:learning-context: token + sourceRootId)
   ↓
学生在 OpenMAIC 内学习 → 触发学习事件
   ↓
OpenMAIC 调 POST /learning/event/submit (Authorization: Bearer <token>)
   ↓
   ├── 200 OK   → 上报成功 ✓
   ├── 401/403  → OpenMAIC postMessage(openmaic:auth-expired) → 父页
   │              父页 refreshToken → postMessage(openmaic:learning-context: { token: 新 })
   │              下一条事件自动用新 token ✓
   └── 网络错误  → 静默重试 / 跳过（不影响学生体验）
```

---

## 6. 学生学习事件清单

OpenMAIC 当前会上报以下事件：

| 触发场景 | `eventState` | `payload` |
|---|---|---|
| 翻卡场景：翻卡或切下一张 | `card_flip` | `{ cardIndex, totalCards, timeSpentSec }` |
| 翻卡场景：完成最后一张 | `finish` | `{ cardIndex, totalCards, timeSpentSec }` |
| 答题场景：提交后逐题上报 | `quiz_answered` | `{ quizId, isCorrect, timeSpentSec, answer }` |
| AI 陪聊：学生在 chat 场景发言 | `message_sent` | `{ timeSpentSec, messageIndex, agentId, sceneId, surface: 'chat-scene' }` |
| AI 陪聊：学生在右侧 **讨论 Tab**（1v1 师生私聊）发言 | `message_sent` | `{ timeSpentSec, messageIndex, sceneId, surface: 'teacher-chat' }` |
| AI 陪聊：学生在右侧 **拓展 Tab**（多 agent 讨论 / QA）发言 | `message_sent` | `{ timeSpentSec, messageIndex, sceneId, surface: 'group-discussion' }` |

`surface` 字段可用来区分三个聊天面板；`messageIndex` 是本会话内学生发言累计第 N 条（chat 场景按 scene 重置、讨论 Tab 按 scene 重置、拓展 Tab 按 stage 重置）。

未来还会扩展：`page_turn`（翻 PPT）等，协议兼容。

每条请求体格式：

```json
{
  "eventState": "card_flip",
  "payload": { "cardIndex": 2, "totalCards": 10, "timeSpentSec": 8 },
  "sourceId": "<OpenMAIC stage.id>",
  "sourceRootId": "<父项目 lesson.id>",
  "sourceType": 1
}
```

接口规范见父项目 `learnevent.md`。

---

## 7. 完整对接示例

```html
<!DOCTYPE html>
<html>
<body>
  <iframe
    id="openmaic"
    src="https://maic.example.com/classroom/demo1"
    width="100%"
    height="800"
    frameborder="0"
    allow="microphone; autoplay; clipboard-write"
  ></iframe>

  <script>
    const OPENMAIC_ORIGIN = 'https://maic.example.com';
    const iframe = document.getElementById('openmaic');

    // ============== 初始化：注入用户信息 + 学习事件 context ==============
    iframe.addEventListener('load', () => {
      const user = currentUser();          // 你的用户对象
      const lesson = currentLesson();      // 你的当前 lesson

      // 1. 注入学生信息
      iframe.contentWindow.postMessage({
        type: 'openmaic:user-profile',
        payload: {
          nickname: user.nickname,
          avatar: user.avatarUrl,
        },
      }, OPENMAIC_ORIGIN);

      // 2. 注入学习事件 context（后端地址走 OpenMAIC 内的 LEARNING_API_BASE，父页不用传）
      iframe.contentWindow.postMessage({
        type: 'openmaic:learning-context',
        payload: {
          token: authStore.accessToken,
          sourceRootId: lesson.id,
        },
      }, OPENMAIC_ORIGIN);
    });

    // ============== 监听 OpenMAIC 反向通知：token 失效 ==============
    window.addEventListener('message', async (e) => {
      if (e.origin !== OPENMAIC_ORIGIN) return;

      if (e.data?.type === 'openmaic:auth-expired') {
        try {
          const newToken = await refreshAccessToken();
          iframe.contentWindow.postMessage({
            type: 'openmaic:learning-context',
            payload: { token: newToken },
          }, OPENMAIC_ORIGIN);
        } catch (err) {
          // refresh 失败 → 跳登录
          location.href = '/login';
        }
      }
    });

    // ============== 用户切换账号时重新注入 ==============
    function onUserChange(newUser) {
      iframe.contentWindow.postMessage({
        type: 'openmaic:user-profile',
        payload: {
          nickname: newUser.nickname,
          avatar: newUser.avatarUrl,
        },
      }, OPENMAIC_ORIGIN);

      iframe.contentWindow.postMessage({
        type: 'openmaic:learning-context',
        payload: {
          token: authStore.accessToken,
          // sourceRootId 已注入过，不用重传
        },
      }, OPENMAIC_ORIGIN);
    }
  </script>
</body>
</html>
```

---

## 7.5. OpenMAIC 后端地址（运维 / 部署同事看）

OpenMAIC 不读 `.env.local`，所有后端地址硬编码在 [next.config.ts](next.config.ts) 里。

| 浏览器路径 | 转发目标 | 用途 |
|---|---|---|
| `/api/<本地存在的路由>` | 走 OpenMAIC 自己的 Next.js 路由 | 比如 `/api/chat`、`/api/generate/*`、`/api/classroom`（filesystem 匹配优先，rewrite 不接管；[proxy.ts](proxy.ts) 注入 `x-internal-token`） |
| `/api/<本地不存在的路由>` | `BACKEND_BASE/api/<path>` | 主后端（同事 Go 后端，OpenMAIC classroom 业务） |
| `/app/*` | `PARENT_APP_BASE/*` | 父项目真后端，目前只走学习事件上报 `/app/learning/event/submit` |

**切换 test/prod 改 [next.config.ts](next.config.ts) 里的常量**：

```ts
const BACKEND_BASE = 'http://192.168.2.79:3000';     // 同事 Go 后端
const PARENT_APP_BASE = 'http://8.156.87.115:8081';  // 测试: 8.156.87.115:8081 / 正式: 8.137.101.85:8081
```

- 浏览器看到的学习事件请求是 `/app/learning/event/submit`（同源），父页 origin 不会因此放宽 CORS。
- 没有 `.env.local`，部署只要 `npm run build && npm start` 即可。

---

## 8. 注意事项

### 时序
- `postMessage` **必须在 iframe `load` 事件后**发，否则 OpenMAIC 还没挂监听器，消息会丢。
- 第一次注入 `learning-context` **前**学生若已经做了操作，那些事件会因为 `enabled=false` 跳过。**所以注入要尽量早**。

### 安全
- `postMessage` 的 `targetOrigin` 一定指定具体 origin（如 `https://maic.example.com`），**不要用 `*`**，否则 token 会被其他被嵌入站点截获。
- 父页监听 `message` 事件时要校验 `e.origin === OPENMAIC_ORIGIN`，防伪造消息。

### Token 持久化
- OpenMAIC 内部只把 token 放**内存**（zustand store），**不写 localStorage**，更安全。
- iframe 刷新 / 重载 → token 丢失。父页需要在 `iframe.load` 时重新注入。
- 同一域下 OpenMAIC 多个 iframe 不共享 token（每个 iframe 独立）。

### 跨域 Cookie / Storage
- OpenMAIC 不依赖父页的 Cookie 或 localStorage（跨源访问不到）。
- 唯一通信通道就是 postMessage。

### 协议兼容
- 父页传了未知字段 → 被忽略，不报错。
- OpenMAIC 后续新增 postMessage 类型时会沿用 `openmaic:*` 命名空间，父页只需对感兴趣的 type 做处理，其他自动忽略。

---

## 9. 调试

### 看 OpenMAIC 收到了什么
在 iframe 内 Console 跑：

```js
// 看学习事件 store 当前状态
const store = (await import('/_next/static/...')); // 通过 React DevTools 更方便

// 或者：浏览器 Application → Storage → IndexedDB 看 OpenMAIC 缓存
```

更直接的方式：让 OpenMAIC 团队在 iframe 内开调试日志：
```js
localStorage.setItem('le:debug', '1');
```
之后所有未发出去的事件都会在 Console 打 `[LearningEvent] context not ready, skip:` 帮你定位是不是 token 没注入。

### 看请求有没有发
父页打开 OpenMAIC iframe → 右键 Inspect iframe → Network 过滤 `learning/event/submit`，能看到完整的请求/响应。

### 看 401 是不是正确被通知
父页 Console 加：

```js
window.addEventListener('message', (e) => {
  if (e.data?.type?.startsWith('openmaic:')) {
    console.log('[OpenMAIC]', e.data);
  }
});
```

---

## 10. FAQ

**Q: token 没注入会怎样？**
A: 所有学习事件 fetch **静默跳过**，OpenMAIC 课堂体验正常运行（翻卡、答题都可以用），只是后台收不到数据。

**Q: refresh token 要不要给 OpenMAIC？**
A: **不要**。OpenMAIC 只持有 accessToken，refresh 由父页统一管理。

**Q: 多个学生同时打开同一个 OpenMAIC 课堂会冲突吗？**
A: 不会。每个 iframe 实例独立 store。学生身份完全由父页注入决定。

**Q: 用户在 iframe 内点了某个按钮跳到外部，怎么办？**
A: iframe 内的链接默认在 iframe 内打开。需要跳父页可以加 `target="_top"`，或 OpenMAIC 内部主动 `postMessage` 让父页处理路由（如有需求另开协议）。

**Q: OpenMAIC 升级后协议变了怎么办？**
A: 协议向后兼容。新字段都是可选，旧客户端不传也行。OpenMAIC 不会破坏已有的 `openmaic:user-profile` / `openmaic:learning-context` / `openmaic:auth-expired` 三个消息类型。

---

## 11. 联系

技术对接：OpenMAIC 团队
协议版本：v1.0（2026-05）
