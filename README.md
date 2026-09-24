# UNiaoer · 鸟语识别

开源 · 非商业的观鸟学习与识别练习项目。用真实的鸟类照片与鸟鸣，练习「看图找鸟」与「听音找鸟」。

## 技术栈

- Vue 3 + TypeScript + Vite
- Vue Router（路由级 code-split）
- Pinia（状态管理）
- Vitest + Vue Test Utils
- ESLint + oxlint + Prettier

## 数据来源与许可

| 来源 | 用途 | 许可 |
|---|---|---|
| [iNaturalist](https://api.inaturalist.org/v1/docs/) | 鸟类照片 | 逐条 CC，仅取开放许可（可配置为含 NC） |
| [Xeno-canto](https://xeno-canto.org/explore/api) | 鸟鸣音频 | 逐条 CC，仅取开放许可（可配置为含 NC） |

- 代码以开源许可发布；**媒体素材仍遵循各自原始 CC 许可，均保留署名**。
- 许可策略可在「设置」中切换：宽松（含 CC-BY-NC，非商业可用）/ 严格（仅 CC0/BY/BY-SA）。
- 许可过滤与署名逻辑见 `src/core/licenseGuard.ts`。

## 开发

```bash
npm install
npm run dev          # 开发服务器
npm run build        # 类型检查 + 构建
npm run test:unit    # 单元测试
npm run lint         # 代码检查
npm run format       # 格式化
```

> 若 npm 安装缓慢，可配置国内镜像：`npm config set registry https://registry.npmmirror.com`

## 分阶段路线图

- **P0 脚手架**（当前）：工程化基建 + 核心类型 + 许可过滤器
- P1 静态题库：构建期抓取 iNat/XC → 许可过滤 → manifest
- P2 核心玩法：看图找鸟 / 听音找鸟
- P3 体验优化：缓存 / 预加载 / 懒加载 / Service Worker
- P4 难度梯度：L1~L4
- P5 音频自动播放（第 2 题起、延迟 2s）
- P6 边缘后端：Cloudflare Workers + D1 + R2
- P7 自适应与扩展
