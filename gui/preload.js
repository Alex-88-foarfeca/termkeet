'use strict'

// Runs with Node access but in an isolated context from the page (renderer).
// Only these specific methods are exposed to the chat window's JS — no raw
// ipcRenderer, no require(), no filesystem/network access of any kind.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('termkeet', {
  createRoom: () => ipcRenderer.invoke('create-room'),
  joinRoom: (topicHex) => ipcRenderer.invoke('join-room', topicHex),
  setUsername: (name) => ipcRenderer.invoke('set-username', name),
  sendMessage: (text) => ipcRenderer.invoke('send-message', text),
  quit: () => ipcRenderer.invoke('quit'),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('termkeet-event', listener)
    return () => ipcRenderer.removeListener('termkeet-event', listener)
  }
})
