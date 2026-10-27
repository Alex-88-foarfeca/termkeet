'use strict'

/*
 * Poiana lui Iocan — mIRC-skin GUI, Electron main process.
 *
 * Same Hyperswarm P2P core as gui/main.js (all networking + Node access
 * lives only here; the renderer is sandboxed and reaches it only through
 * preload.js's whitelisted bridge) — just a different visual skin
 * (classic mIRC-style window instead of a macOS-Terminal look) plus a
 * frameless window with custom title-bar controls, a "kick" action and
 * an idle/keepalive mechanism for the connection.
 */

const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const crypto = require('crypto')
const Hyperswarm = require('hyperswarm')

let win = null
let swarm = null
let username = 'anon'
const peers = new Map() // conn -> { name, peerId, lastSeen, idle, keepalive, idleCheck }

const KEEPALIVE_MS = 15000 // app-level ping, keeps NAT/firewall mappings warm
const IDLE_GRACE_MS = 45000 // no traffic at all for this long -> flagged idle

function send (payload) {
  if (win && !win.isDestroyed()) win.webContents.send('termkeet-event', payload)
}

// Strip control characters / ANSI escapes from anything a peer sends before
// it ever reaches the renderer, so a peer can't inject escape sequences.
function sanitize (text) {
  return String(text).replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '').slice(0, 4000)
}

async function destroySwarm () {
  if (!swarm) return
  const s = swarm
  swarm = null
  for (const [conn, state] of peers) {
    clearInterval(state.keepalive)
    clearInterval(state.idleCheck)
    try { conn.destroy() } catch (_) {}
  }
  peers.clear()
  try { await s.destroy() } catch (_) {}
}

function getSwarm () {
  if (swarm) return swarm
  swarm = new Hyperswarm()

  swarm.on('connection', (conn, info) => {
    const peerId = info.publicKey.toString('hex').slice(0, 8)
    const state = { name: null, peerId, lastSeen: Date.now(), idle: false, keepalive: null, idleCheck: null }
    peers.set(conn, state)
    send({ type: 'peer-connected', peerId, count: peers.size })

    conn.write(JSON.stringify({ type: 'hello', name: username }) + '\n')

    state.keepalive = setInterval(() => {
      try { conn.write(JSON.stringify({ type: 'ping' }) + '\n') } catch (_) {}
    }, KEEPALIVE_MS)

    function bumpSeen () {
      state.lastSeen = Date.now()
      if (state.idle) {
        state.idle = false
        send({ type: 'peer-active', peerId, name: state.name || peerId })
      }
    }

    state.idleCheck = setInterval(() => {
      if (!state.idle && Date.now() - state.lastSeen > IDLE_GRACE_MS) {
        state.idle = true
        send({ type: 'peer-idle', peerId, name: state.name || peerId })
      }
    }, 5000)

    let buffer = ''
    conn.on('data', (chunk) => {
      bumpSeen()
      buffer += chunk.toString('utf8')
      let idx
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        if (!line) continue
        let msg
        try {
          msg = JSON.parse(line)
        } catch (_) {
          continue
        }
        if (msg && msg.type === 'hello') {
          const name = sanitize(String(msg.name || peerId)).slice(0, 40) || peerId
          state.name = name
          send({ type: 'peer-hello', peerId, name })
        } else if (msg && msg.type === 'chat') {
          const who = state.name || peerId
          send({ type: 'chat', from: who, text: sanitize(msg.text || ''), self: false })
        }
        // msg.type === 'ping' needs no handling beyond the bumpSeen() above
      }
    })

    conn.on('close', () => {
      clearInterval(state.keepalive)
      clearInterval(state.idleCheck)
      const who = state.name || peerId
      peers.delete(conn)
      send({ type: 'peer-disconnected', name: who, count: peers.size })
    })

    conn.on('error', () => {}) // transient P2P connection errors are expected; ignore
  })

  swarm.on('error', (err) => {
    send({ type: 'error', message: 'swarm error: ' + err.message })
  })

  return swarm
}

ipcMain.handle('create-room', () => {
  const topic = crypto.randomBytes(32)
  getSwarm().join(topic, { server: true, client: true })
  return topic.toString('hex')
})

ipcMain.handle('join-room', (_event, topicHex) => {
  if (!/^[0-9a-fA-F]{64}$/.test(String(topicHex || ''))) {
    throw new Error('Invalid invite code — expected a 64-character hex string.')
  }
  const hex = String(topicHex).toLowerCase()
  getSwarm().join(Buffer.from(hex, 'hex'), { server: true, client: true })
  return hex
})

ipcMain.handle('set-username', (_event, name) => {
  username = sanitize(String(name || 'anon')).trim().slice(0, 40) || 'anon'
  return username
})

ipcMain.handle('send-message', (_event, text) => {
  const clean = sanitize(String(text || '')).trim()
  if (!clean) return
  const payload = JSON.stringify({ type: 'chat', text: clean }) + '\n'
  for (const conn of peers.keys()) conn.write(payload)
  send({ type: 'chat', from: username, text: clean, self: true })
})

// Two-person room: "kick" just drops the current peer connection, it
// doesn't need a target — there's only ever one other person to drop.
ipcMain.handle('kick-user', () => {
  for (const conn of peers.keys()) { try { conn.destroy() } catch (_) {} }
})

ipcMain.handle('close-chat', async () => {
  await destroySwarm()
})

ipcMain.handle('quit', async () => {
  await destroySwarm()
  app.quit()
})

ipcMain.on('win-minimize', () => { if (win) win.minimize() })
ipcMain.on('win-maximize', () => {
  if (!win) return
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
})
ipcMain.on('win-close', () => { if (win) win.close() })

function createWindow () {
  win = new BrowserWindow({
    width: 760,
    height: 480,
    minWidth: 480,
    minHeight: 320,
    title: 'Poiana lui Iocan',
    backgroundColor: '#c0c0c0',
    frame: false, // custom mIRC-style title bar drawn in index.html
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.setMenuBarVisibility(false)
  win.loadFile(path.join(__dirname, 'index.html'))
}

app.whenReady().then(createWindow)

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('window-all-closed', async () => {
  await destroySwarm()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  await destroySwarm()
})
