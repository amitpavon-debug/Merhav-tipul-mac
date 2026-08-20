const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  auth: {
    hasPassword: () => ipcRenderer.invoke('auth:hasPassword'),
    setPassword: (pass) => ipcRenderer.invoke('auth:setPassword', pass),
    verify: (pass) => ipcRenderer.invoke('auth:verify', pass),
    changePassword: (args) => ipcRenderer.invoke('auth:changePassword', args),
    setBackupPassword: (args) => ipcRenderer.invoke('auth:setBackupPassword', args),
    hasBackup: () => ipcRenderer.invoke('auth:hasBackup'),
    recoverWithBackup: (args) => ipcRenderer.invoke('auth:recoverWithBackup', args),
    getMachineIdForReset: () => ipcRenderer.invoke('auth:getMachineIdForReset'),
    verifyResetCode: (code) => ipcRenderer.invoke('auth:verifyResetCode', code),
    resetWithCode: (args) => ipcRenderer.invoke('auth:resetWithCode', args),
  },
  data: {
    load: () => ipcRenderer.invoke('data:load'),
    save: (payload) => ipcRenderer.invoke('data:save', payload),
    export: () => ipcRenderer.invoke('data:export'),
    exportWithPassword: (args) => ipcRenderer.invoke('data:exportWithPassword', args),
    import: () => ipcRenderer.invoke('data:import'),
    importWithPassword: (args) => ipcRenderer.invoke('data:importWithPassword', args),
    exportExcel: (payload) => ipcRenderer.invoke('data:exportExcel', payload),
    importExcel: () => ipcRenderer.invoke('data:importExcel'),
  },
  license: {
    status: () => ipcRenderer.invoke('license:status'),
    activate: (code) => ipcRenderer.invoke('license:activate', code),
  },
});
