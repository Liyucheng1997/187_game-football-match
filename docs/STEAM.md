# Steam 上架指南

本项目是纯网页技术（Three.js + Vite）游戏，通过 `desktop/` 目录中的 **Electron 外壳**打包成 Windows / macOS / Linux 桌面程序上架 Steam。所有模型、贴图、音效均为程序化生成，没有第三方素材版权问题。

## 1. 构建桌面版

```bash
npm install                 # 根目录：安装 three / vite
cd desktop
npm install                 # 安装 electron / electron-builder（steamworks.js 为可选依赖）
npm start                   # 本地以桌面窗口运行（--windowed 参数可窗口化）
npm run dist:win            # 输出到 desktop/release/win-unpacked
```

`prepare-web` 会先在根目录执行 `vite build`，再把 `dist/` 复制到 `desktop/app/`。`vite.config.js` 已设置 `base: './'`，打包产物可以直接以 `file://` 加载。

## 2. 接入 Steamworks

1. 在 Steamworks 后台创建 App，把 AppID 写进 `desktop/steam_appid.txt`（默认 480 为 Valve 的测试 App Spacewar）。
2. `steamworks.js` 已作为可选依赖接入：`main.cjs` 启动时初始化 Steam，并开启 Steam 覆盖层；Steam 未运行时游戏照常运行。
3. **成就**：游戏内 `Save.unlock(id)` 会调用 `window.steam.activateAchievement(id)`。在 Steamworks 后台按下表创建同名 API 名称的成就即可自动同步：

| API 名称 | 名称 | 描述 |
|----------|------|------|
| first_goal | 首开纪录 | 打进你的第一个进球 |
| first_win | 初尝胜果 | 赢下第一场比赛 |
| hat_trick | 帽子戏法 | 单场比赛个人进 3 球 |
| super_goal | 热血之魂 | 用热血必杀射门破门 |
| header_goal | 头球大师 | 头球或凌空破门 |
| long_goal | 世界波 | 在 25 米外远射破门 |
| fk_goal | 任意球专家 | 直接任意球破门 |
| clean_sheet | 铜墙铁壁 | 零封对手取胜 |
| comeback | 王者归来 | 落后情况下逆转取胜 |
| thrash | 大屠杀 | 净胜 5 球以上 |
| shootout | 点球英雄 | 赢得一次点球大战 |
| tackles | 铲断机器 | 累计成功抢断 50 次 |
| cup_rookie | 新秀冠军 | 赢得新秀杯 |
| cup_elite | 精英冠军 | 赢得精英杯 |
| cup_champ | 冠军之冠 | 赢得冠军杯 |
| cup_legend | 绿茵传奇 | 赢得传奇杯 |
| max_club | 豪门崛起 | 俱乐部所有属性升到满级 |
| veteran | 身经百战 | 累计完成 25 场比赛 |

4. **云存档**：存档位于 Electron 的 localStorage（`%APPDATA%/Blazing Pitch/Local Storage`）。在 Steamworks「Steam Cloud → Auto-Cloud」中添加该目录即可，无需改代码。
5. **Steam Input**：游戏使用浏览器 Gamepad API 的标准映射，Xbox / PlayStation / Switch Pro 手柄开箱即用；在商店页勾选「完全支持控制器」。

## 3. 上传

使用 SteamPipe（`steamcmd` + `app_build.vdf`）上传 `desktop/release/<平台>-unpacked` 目录，启动项分别指向 `Blazing Pitch.exe` / `Blazing Pitch.app` / `blazing-pitch-desktop`。

## 4. 商店页素材清单

| 素材 | 尺寸 | 建议内容 |
|------|------|----------|
| 头部胶囊图 | 920×430 | 夜场 + 必杀火焰射门 + LOGO |
| 小胶囊图 | 462×174 | LOGO + 足球 |
| 主胶囊图 | 1232×706 | 进球庆祝 + 观众 + LOGO |
| 库存封面 | 600×900 | 竖版：前锋凌空抽射 |
| 库存主视图 | 3840×1240 | 全景球场夜景 |
| 截图 ×5+ | 1920×1080 | 转播视角对抗、雪天比赛、点球大战、杯赛对阵图、俱乐部编辑 |
| 预告片 | 30~60 秒 | 必杀射门 → 头球 → 神扑 → 滑跪庆祝 → 杯赛夺冠 |

截图可以直接在游戏里按 F12 打开开发者工具后用 `__game.renderer.domElement.toDataURL()` 导出，或使用 Steam 自带截图（F12）。

## 5. 商店页文案（草稿）

> **热血绿茵** 是一款节奏火爆的街机 5v5 足球。蓄力射门、弧线任意球、凌空头球、飞身扑救——一局 4 分钟，每分钟都有高光。攒满「热血槽」释放燃烧的必杀射门，把门将连人带球轰进网窝！
>
> - 🔥 必杀射门、花式过人、完美时机射门
> - 🏆 四项杯赛生涯，打造属于你的豪门俱乐部
> - 🎮 最多 4 人本地同屏：对战或合作打电脑
> - 🌧️ 白天 / 黄昏 / 夜场，晴 / 雨 / 雪，天气影响足球物理
> - 🎬 进球即时回放、万人球场、实时解说
> - 🎖️ 18 项 Steam 成就，完整手柄支持

标签建议：体育、足球、街机、本地多人、同屏多人、休闲、竞技、控制器支持。

## 6. 上架前检查

- [ ] 在 Steam Deck（1280×800）上测试：`画质 = 中`，UI 已做小屏适配。
- [ ] 不同手柄的按键提示（当前为 Xbox 布局）。
- [ ] 替换 `steam_appid.txt` 为正式 AppID，**不要**把该文件放进 Steam 仓库的根目录以外的位置。
- [ ] 隐私：本游戏不联网、不收集任何数据。
