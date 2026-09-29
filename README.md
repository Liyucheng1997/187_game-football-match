# ⚽ 热血绿茵 · Blazing Pitch

街机风格 **5v5 3D 足球**。蓄力射门、弧线任意球、凌空头球、飞身扑救、热血必杀射门；四项杯赛生涯、自建俱乐部、最多 4 人本地同屏。基于 **Three.js**，所有模型、贴图、动画、音效全部程序化生成，零外部素材。

- 设计文档：[docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)
- Steam 上架指南（Electron 打包、Steamworks 成就、商店页素材）：[docs/STEAM.md](docs/STEAM.md)

## 运行

```bash
npm install
npm run dev        # 打开 http://localhost:5173
npm run build      # 网页版产物在 dist/
```

桌面版（Steam）：

```bash
cd desktop && npm install && npm start
```

## 操作

| 动作 | 键盘 1 | 键盘 2 | 手柄 |
|------|--------|--------|------|
| 移动 | W A S D | 方向键 | 左摇杆 |
| 冲刺 | Shift | 右 Shift / 小键盘 0 | RT |
| 短传 / 抢断 | J | , / 小键盘 1 | A |
| 射门（按住蓄力）/ 铲球 | K | . / 小键盘 2 | B |
| 直塞 | L | / / 小键盘 3 | Y |
| 高球 / 传中 | I | ; / 小键盘 5 | X |
| 切换球员 | Q | M / 小键盘 4 | LB |
| 花式过人 | 空格 | ' / 小键盘 6 | RB |
| 热血必杀射门 | E | ] / 小键盘 9 | RB + B |
| 弧线射门（按住） | U | N / 小键盘 7 | LT |
| 暂停 | Esc / P | 小键盘 Enter | Start |

小技巧：在蓄力条的**绿色区间**松开射门键 = 完美射门；传球/射门键可以在来球前按下，实现一脚出球；从背后铲球会吃牌。

## 模式

- **快速比赛**：13 支球队（含自建俱乐部）、4 档难度、白天/黄昏/夜场、晴/雨/雪、标准规则或笼式足球；控制器分配界面支持 1v1、2v2、合作打电脑。
- **冠军杯赛**：新秀杯 → 精英杯 → 冠军杯 → 传奇杯，8 队淘汰赛，平局点球决胜。
- **点球大战**、**我的俱乐部**（队名/球衣/训练升级/足球商店）、**成就**（18 项）、**设置**。

## 代码结构

```
src/
├── main.js            # 渲染器与后期（泛光）、菜单展示、应用流程、主循环
├── config.js          # 场地尺寸、物理参数、难度参数
├── style.css          # 全部 UI 样式
├── core/
│   ├── input.js       # 键盘×2 + 手柄×4 统一输入、菜单导航、手柄震动
│   ├── audio.js       # WebAudio 程序化音效 / 人群 / 音乐
│   ├── save.js        # 本地存档、成就（Steam 同步钩子）
│   └── career.js      # 杯赛对阵、模拟、晋级
├── data/teams.js      # 球队、阵型、杯赛、足球
├── gfx/
│   ├── stadium.js     # 球场、看台、万人观众着色器、灯光天气预设、可形变球网
│   ├── player-model.js# 13 关节程序化球员模型
│   ├── textures.js    # 球衣 / 草坪 / LED / 观众贴图生成
│   ├── particles.js   # 粒子与雨雪
│   └── effects.js     # 草屑、彩带、火焰、火花、瞄准箭头、控制光圈
├── game/
│   ├── match.js       # 比赛状态机、规则、定位球、犯规、点球大战、统计
│   ├── ball.js        # 足球物理（马格努斯/阻力/碰撞）、弹道求解
│   ├── player.js      # 球员状态机与程序化动画
│   ├── actions.js     # 传球 / 射门 / 抢断 / 铲球 / 花式
│   ├── ai.js          # 球队 AI 与门将 AI
│   ├── human.js       # 真人控制、预输入、自动换人
│   ├── camera.js      # 转播/近景/高空/点球/庆祝/回放镜头
│   ├── replay.js      # 进球回放录制与播放
│   └── commentary.js  # 文字解说
└── ui/
    ├── menus.js       # 所有菜单界面（手柄可导航）与结算
    └── hud.js         # 比赛 HUD
desktop/               # Electron 外壳（Steam 桌面版）
```

调试：控制台 `window.__game`；`?autotest=1` 直接开一场电脑对电脑（可加 `&human=1&dur=120&time=day&weather=snow&cage=1`）。
