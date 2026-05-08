# OpenMAIC 接入 Vue3 + Capacitor App 方案对比

## 项目背景

- 主 app: Vue3 + Capacitor，已有项目
- 团队: 1 人前端 + AI 辅助
- 性质: 非商业（AGPL 影响小）
- 需求: 全部 4 种场景（slide / quiz / interactive / pbl），需要加自定义组件、捕获学生数据
- 后端: Go 团队提供 API，镜像 OpenMAIC schema

---

## 方案一：iframe 嵌入

把 OpenMAIC build 产物打包进 app 的 `public/` 目录，用 `<iframe>` 嵌入 Vue 页面。父子通过 postMessage 通信。

| 维度 | 评价 |
|---|---|
| **工期** | 1-2 周 |
| **定制性** | ⭐ 差。无法插入自定义 Vue 组件，只能在 iframe 外围加东西 |
| **数据捕获** | ⭐⭐ 一般。靠 postMessage 上报，需要改 OpenMAIC 源码加埋点 |
| **更新成本** | ⭐⭐⭐⭐ 低。OpenMAIC 升级直接重新 build 替换 |
| **维护成本** | ⭐⭐⭐⭐ 低 |
| **AGPL 风险** | 低（非商业） |

**优势**
- 上线最快
- 跟 OpenMAIC upstream 几乎零成本同步
- 1 人完全 hold 得住

**缺陷**
- UI 完全是 OpenMAIC 风格，无法和 app 设计统一
- 想在课堂中间插入"求助按钮""提示卡"这类组件 → 做不到
- mp3 自动播放 / 跨域 cookie / mixed content 等 web 限制（Capacitor WebView 配置可绕过大部分）

**适用场景**: 快速验证 / MVP / 暂不需要深度定制

---

## 方案二：Monorepo + 部分 Vue 化

拆 packages：纯 TS 逻辑（types / action / playback）独立包，Vue 组件包，主 app 引用。需要的场景用 Vue 重写，其他继续 iframe。

| 维度 | 评价 |
|---|---|
| **工期** | 3-4 周（如果只 Vue 化 1-2 个场景） |
| **定制性** | ⭐⭐⭐ 中。Vue 化的部分可任意定制，iframe 部分仍受限 |
| **数据捕获** | ⭐⭐⭐ 中。Vue 部分原生捕获，iframe 部分仍靠 postMessage |
| **更新成本** | ⭐⭐⭐ 中。core 包能跟 upstream，UI 部分要手动同步 |
| **维护成本** | ⭐⭐ 高。pnpm workspace + 多 package 配置 + 跨包路径 |
| **AGPL 风险** | 低（非商业） |

**优势**
- 渐进式，先做最需要定制的场景
- 纯 TS 逻辑能复用

**缺陷**
- 1 人项目下 monorepo 是负收益（配置成本 > 隔离收益）
- 跨 package 的 TypeScript / IDE / 调试体验都更复杂
- AI 跨包索引不稳定

**适用场景**: 多人团队 / 多 app 共享代码 / 需要发布 npm 包

**对 1 人项目不推荐。**

---

## 方案三：完全重写为 Vue3

单仓 Vue3 项目，把 OpenMAIC 所有 UI / 逻辑翻译成 Vue。

| 维度 | 评价 |
|---|---|
| **工期** | 10-12 周（1 人 + AI，全部场景） |
| **定制性** | ⭐⭐⭐⭐⭐ 完全自由 |
| **数据捕获** | ⭐⭐⭐⭐⭐ 完全自由 |
| **更新成本** | ⭐ 高。OpenMAIC 升级要手动 diff 翻译 |
| **维护成本** | ⭐⭐⭐ 中（代码全在自己项目，调试方便） |
| **AGPL 风险** | 低（非商业） |

**优势**
- 任何组件可加可改，UI 完全跟 app 一致
- 性能可控，可深度接 Capacitor 原生插件（NativeAudio 等修 mp3 闪退）
- 长期维护体验最好

**缺陷**
- 工期长，3 个月起步
- OpenMAIC 升级跟不上
- 1 人需要持续高强度投入

**适用场景**: 长期项目 / 需要完全控制 / 有 3 个月时间窗口

---

## 真实工期拆解（方案三，1 人 + AI）

| 模块 | 工期 |
|---|---|
| 基础层（types / action-engine / playback / stream / audio） | 1.5 周 |
| Slide 渲染（**用 PPTist Vue3 fork 改造**，重要捷径） | 3 周 |
| Quiz | 0.5 周 |
| Interactive（5 种 widget） | 2 周 |
| PBL | 1 周 |
| Whiteboard | 1.5 周 |
| 讨论 / 圆桌 | 1 周 |
| 容器层 + 主题 + 设置 | 0.5 周 |
| Capacitor 适配 + iPad 调试 | 1.5 周 |
| **总计** | **12.5 周 ≈ 3 个月** |

### AI 能加速的边界

- ✅ AI 包打 (省 80%): 类型定义、简单组件、JSX→template、Zustand→Pinia
- 🟡 AI 半助攻 (省 40%): 复杂 stateful 组件、动画时序、StreamBuffer 集成
- ❌ AI 不帮 (人工): iPad 真机调试、Capacitor 原生集成、性能调优、后端对接

**AI 整体压缩约 30% 总工时**，不要期待更多。

---

## 推荐路线（你目前的情况）

```
现在 ─────────► 1-2 周 ─────────► 10-14 周
  │                │                  │
  │ iframe 已跑通    │ iframe 上线版     │ Vue3 完全替换
  │                │ Capacitor 适配    │ 下掉 iframe
  │                │ 数据上报           │
  ▼                ▼                  ▼
Phase 0          Phase 1            Phase 2
```

### 节奏

1. **当下**: iframe 版本完善（postMessage 数据上报、Capacitor WebView 配置）
2. **同步进行**: 单仓 Vue3 重写
   - 不要 monorepo
   - 用 PPTist Vue3 原版做 slide renderer 基础（省 2-3 周）
   - lib/ 纯 TS 直接 cp，改路径就用
   - AI 暴力翻译 React → Vue，人工修边界
3. **逐场景切换**: 每完成一种 Vue scene 渲染器，从 iframe 切到 Vue

### 关键文件直接搬

```bash
cp -r OpenMAIC/lib/types       your-app/src/lib/
cp -r OpenMAIC/lib/action      your-app/src/lib/
cp -r OpenMAIC/lib/playback    your-app/src/lib/
cp -r OpenMAIC/lib/stream      your-app/src/lib/
cp OpenMAIC/lib/utils/audio-player.ts your-app/src/lib/audio.ts
```

---

## 决策摘要

| 你的目标 | 推荐方案 |
|---|---|
| 1 周内上线，先用着 | 方案一 iframe |
| 3 个月内 1.0 完整版 | 方案一 + 方案三并行（推荐） |
| 团队扩展到 2-3 人 | 可考虑方案二 monorepo |
| 短期内不做定制 | 方案一即可 |

**最终建议**: 现状 iframe 持续完善 + 背景慢慢 Vue 化重写，老板报 12 周，争取 10 周。
