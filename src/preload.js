const { contextBridge, ipcRenderer } = require('electron');

// 响应式通道白名单（主进程主动发送）
const VALID_CHANNELS = [
  // 进度事件
  'processing:start',
  'processing:progress',
  'processing:complete',
  // 应用错误
  'app:error'
];

// 请求式通道白名单（渲染进程发起请求）
const VALID_INVOKE_CHANNELS = [
  // 对话框
  'dialog:openFiles',
  'dialog:openDirectory',
  'dialog:saveFile',
  // 文件操作
  'file:getInfo',
  'file:validate',
  // 处理
  'process:file',
  'process:files',
  'process:pause',
  'process:resume',
  'process:cancel',
  // 配置
  'config:getDefault',
  'config:save',
  'config:load',
  // 系统
  'shell:openPath',
  'shell:showItemInFolder',
  // 应用信息
  'app:getInfo'
];

// Map<channel, Map<originalCallback, wrappedListener>>
const listenerMap = new Map();

function isValidChannel(channel) {
  return VALID_CHANNELS.includes(channel);
}

function isValidInvokeChannel(channel) {
  return VALID_INVOKE_CHANNELS.includes(channel);
}

function getChannelListenerMap(channel) {
  let map = listenerMap.get(channel);
  if (!map) {
    map = new Map();
    listenerMap.set(channel, map);
  }
  return map;
}

// 安全地暴露 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 对话框相关
  dialog: {
    openFiles: () => {
      if (!isValidInvokeChannel('dialog:openFiles')) return Promise.reject(new Error('Invalid channel'));
      return ipcRenderer.invoke('dialog:openFiles');
    },
    openDirectory: () => {
      if (!isValidInvokeChannel('dialog:openDirectory')) return Promise.reject(new Error('Invalid channel'));
      return ipcRenderer.invoke('dialog:openDirectory');
    },
    saveFile: (defaultPath) => {
      if (!isValidInvokeChannel('dialog:saveFile')) return Promise.reject(new Error('Invalid channel'));
      return ipcRenderer.invoke('dialog:saveFile', defaultPath);
    }
  },

  // 文件操作相关
  file: {
    getInfo: (filePath) => {
      if (!isValidInvokeChannel('file:getInfo')) return Promise.reject(new Error('Invalid channel'));
      return ipcRenderer.invoke('file:getInfo', filePath);
    },
    validate: (filePath) => {
      if (!isValidInvokeChannel('file:validate')) return Promise.reject(new Error('Invalid channel'));
      return ipcRenderer.invoke('file:validate', filePath);
    }
  },

  // 处理相关
  process: {
    file: (filePath, options) => {
      if (!isValidInvokeChannel('process:file')) return Promise.reject(new Error('Invalid channel'));
      return ipcRenderer.invoke('process:file', filePath, options);
    },
    files: (filePaths, options) => {
      if (!isValidInvokeChannel('process:files')) return Promise.reject(new Error('Invalid channel'));
      return ipcRenderer.invoke('process:files', filePaths, options);
    },
    pause: () => {
      if (!isValidInvokeChannel('process:pause')) return Promise.reject(new Error('Invalid channel'));
      return ipcRenderer.invoke('process:pause');
    },
    resume: () => {
      if (!isValidInvokeChannel('process:resume')) return Promise.reject(new Error('Invalid channel'));
      return ipcRenderer.invoke('process:resume');
    },
    cancel: () => {
      if (!isValidInvokeChannel('process:cancel')) return Promise.reject(new Error('Invalid channel'));
      return ipcRenderer.invoke('process:cancel');
    }
  },

  // 配置相关
  config: {
    getDefault: () => {
      if (!isValidInvokeChannel('config:getDefault')) return Promise.reject(new Error('Invalid channel'));
      return ipcRenderer.invoke('config:getDefault');
    },
    save: (config) => {
      if (!isValidInvokeChannel('config:save')) return Promise.reject(new Error('Invalid channel'));
      return ipcRenderer.invoke('config:save', config);
    },
    load: () => {
      if (!isValidInvokeChannel('config:load')) return Promise.reject(new Error('Invalid channel'));
      return ipcRenderer.invoke('config:load');
    }
  },

  // 系统相关
  shell: {
    openPath: (filePath) => {
      if (!isValidInvokeChannel('shell:openPath')) return Promise.reject(new Error('Invalid channel'));
      return ipcRenderer.invoke('shell:openPath', filePath);
    },
    showItemInFolder: (filePath) => {
      if (!isValidInvokeChannel('shell:showItemInFolder')) return Promise.reject(new Error('Invalid channel'));
      return ipcRenderer.invoke('shell:showItemInFolder', filePath);
    }
  },

  // 应用信息
  app: {
    getInfo: () => {
      if (!isValidInvokeChannel('app:getInfo')) return Promise.reject(new Error('Invalid channel'));
      return ipcRenderer.invoke('app:getInfo');
    }
  },

  // 事件监听
  on: (channel, callback) => {
    if (!isValidChannel(channel) || typeof callback !== 'function') return;

    const channelMap = getChannelListenerMap(channel);
    if (channelMap.has(callback)) return;

    const wrapped = (event, ...args) => callback(...args);
    channelMap.set(callback, wrapped);
    ipcRenderer.on(channel, wrapped);
  },

  // 移除事件监听
  removeListener: (channel, callback) => {
    if (!isValidChannel(channel) || typeof callback !== 'function') return;

    const channelMap = listenerMap.get(channel);
    if (!channelMap) return;

    const wrapped = channelMap.get(callback);
    if (!wrapped) return;

    ipcRenderer.removeListener(channel, wrapped);
    channelMap.delete(callback);
    if (channelMap.size === 0) listenerMap.delete(channel);
  },

  // 移除所有监听器
  removeAllListeners: (channel) => {
    if (!isValidChannel(channel)) return;
    ipcRenderer.removeAllListeners(channel);
    listenerMap.delete(channel);
  }
});