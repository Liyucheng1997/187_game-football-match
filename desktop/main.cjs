// Steam 桌面版：Electron 外壳。加载打包后的网页版（desktop/app），全屏运行，并可选接入 Steamworks。
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let steam = null;
try {
  // 需要在 steam_appid.txt 中填入你的 AppID；未安装 steamworks.js 或 Steam 未运行时自动跳过
  const fs = require('fs');
  const file = [path.join(process.resourcesPath || '', '..', 'steam_appid.txt'), path.join(__dirname, 'steam_appid.txt')].find(f => fs.existsSync(f));
  const appId = file ? Number(fs.readFileSync(file, 'utf8').trim()) || 480 : 480;
  steam = require('steamworks.js').init(appId);
} catch (e) {
  steam = null;
}

// 游戏手柄与音频：不要求用户手势即可播放音乐
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    fullscreen: !process.argv.includes('--windowed'),
    backgroundColor: '#07100c',
    autoHideMenuBar: true,
    title: 'Blazing Pitch',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.webContents.on('before-input-event', (e, input) => {
    if (input.key === 'F11' && input.type === 'keyDown') win.setFullScreen(!win.isFullScreen());
  });
}

ipcMain.handle('steam:achievement', (_e, id) => {
  if (!steam) return false;
  try { return steam.achievement.activate(id); } catch (e) { return false; }
});
ipcMain.handle('app:quit', () => app.quit());

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

if (steam) {
  try { require('steamworks.js').electronEnableSteamOverlay(); } catch (e) { /* ignore */ }
}
