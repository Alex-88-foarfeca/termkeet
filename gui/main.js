'use strict'

/*
 * Poiana lui Iocan GUI — Electron main process.
 *
 * All P2P networking (Hyperswarm) lives here, with full Node access.
 * The renderer window has none: nodeIntegration is off and contextIsolation
 * is on, so it can only reach the network through the small, explicit IPC
 * surface exposed by preload.js. That keeps a malicious or buggy peer's
 * chat text from ever touching anything but the terminal display.
 */

const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const crypto = require('crypto')
const Hyperswarm = require('hyperswarm')

let win = null
let swarm = null
let username = 'anon'
const peers = new Map() // conn -> { name, peerId }

function send (payload) {
  if (win && !win.isDestroyed()) win.webContents.send('termkeet-event', payload)
}

// Strip control characters / ANSI escapes from anything a peer sends before
// it ever reaches the terminal renderer, so a peer can't inject escape
// sequences into your terminal. Plain text (incl. unicode) passes through.
function sanitize (text) {
  return String(text).replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '').slice(0, 4000)
}

async function destroySwarm () {
  if (!swarm) return
  const s = swarm
  swarm = null
  peers.clear()
  try { await s.destroy() } catch (_) {}
}

function getSwarm () {
  if (swarm) return swarm
  swarm = new Hyperswarm()

  swarm.on('connection', (conn, info) => {
    const peerId = info.publicKey.toString('hex').slice(0, 8)
    peers.set(conn, { name: null, peerId })
    send({ type: 'peer-connected', peerId, count: peers.size })

    conn.write(JSON.stringify({ type: 'hello', name: username }) + '\n')

    let buffer = ''
    conn.on('data', (chunk) => {
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
          peers.set(conn, { name, peerId })
          send({ type: 'peer-hello', peerId, name })
        } else if (msg && msg.type === 'chat') {
          const who = (peers.get(conn) && peers.get(conn).name) || peerId
          send({ type: 'chat', from: who, text: sanitize(msg.text || ''), self: false })
        }
      }
    })

    conn.on('close', () => {
      const who = (peers.get(conn) && peers.get(conn).name) || peerId
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

ipcMain.handle('quit', async () => {
  await destroySwarm()
  app.quit()
})

function createWindow () {
  win = new BrowserWindow({
    width: 760,
    height: 460,
    minWidth: 420,
    minHeight: 260,
    title: 'Poiana lui Iocan',
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'default', // native window chrome — real macOS traffic lights, just like Terminal.app
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
