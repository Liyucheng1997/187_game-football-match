// 向网页暴露极小的桌面 API：成就同步、退出游戏
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', { quit: () => ipcRenderer.invoke('app:quit') });
contextBridge.exposeInMainWorld('steam', { activateAchievement: id => ipcRenderer.invoke('steam:achievement', id) });
