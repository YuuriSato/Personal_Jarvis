import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('jarvis', Object.freeze({
  action: (action: unknown) => ipcRenderer.invoke('jarvis:action', action),
  onEvent: (listener: (event: unknown) => void) => {
    const handler = (_: unknown, event: unknown) => listener(event);
    ipcRenderer.on('jarvis:event', handler);
    return () => ipcRenderer.removeListener('jarvis:event', handler);
  },
  saveKey: (provider: string, key: string) => ipcRenderer.invoke('jarvis:key', { provider, key }),
  removeKey: (provider: string) => ipcRenderer.invoke('jarvis:key', { provider, key: '' }),
  chooseFolder: () => ipcRenderer.invoke('jarvis:folder'),
  chooseApp: () => ipcRenderer.invoke('jarvis:app'),
  exportData: () => ipcRenderer.invoke('jarvis:export'),
}));
