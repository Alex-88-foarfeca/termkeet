'use strict'

/*
 * Poiana lui Iocan — mIRC-skin GUI, renderer.
 *
 * Same flow as gui/renderer.js (invite code or create -> name -> chat),
 * driven through the one input line at the bottom, mIRC-style — just
 * rendered as a classic chat log + nicklist instead of a terminal. No
 * Node or network access here, only what preload.js explicitly exposed.
 */

const log = document.getElementById('log')
const msgInput = document.getElementById('msgInput')
const nicksEl = document.getElementById('nicks')
const nickhead = document.getElementById('nickhead')
const statusbar = document.getElementById('statusbar')
const titleText = document.getElementById('titleText')
const chanBox = document.getElementById('chanBox')

let myName = 'anon'
let connected = false
const users = new Map() // peerId -> name

function timestamp () {
  return new Date().toTimeString().slice(0, 5)
}

function esc (s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

const MAX_HISTORY = 20

function addLine (cls, html) {
  const div = document.createElement('div')
  div.className = 'line ' + cls
  div.innerHTML = html
  log.appendChild(div)

  const lines = log.querySelectorAll('.line')
  for (let i = 0; i < lines.length - MAX_HISTORY; i++) lines[i].remove()

  log.scrollTop = log.scrollHeight
}

function notice (text) {
  addLine('notice', `<span class="ts">[${timestamp()}]</span> * ${esc(text)}`)
}

function errLine (text) {
  addLine('err', `<span class="ts">[${timestamp()}]</span> * ${esc(text)}`)
}

function chatLine (name, text, self) {
  addLine('chat ' + (self ? 'self' : 'peer'),
    `<span class="ts">[${timestamp()}]</span> <span class="nick">&lt;${esc(name)}&gt;</span> ${esc(text)}`)
}

function renderNicks () {
  nicksEl.innerHTML = ''
  const mine = document.createElement('div')
  mine.className = 'nick self'
  mine.textContent = '@' + myName
  nicksEl.appendChild(mine)
  for (const name of users.values()) {
    const d = document.createElement('div')
    d.className = 'nick'
    d.textContent = '@' + name
    nicksEl.appendChild(d)
  }
  nickhead.textContent = 'Useri — ' + (1 + users.size)
}

// ---- single input-line state machine, mIRC-style ----
let onSubmit = null

function ask (placeholder, handler) {
  msgInput.value = ''
  msgInput.placeholder = placeholder
  msgInput.disabled = false
  onSubmit = handler
  msgInput.focus()
}

msgInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !onSubmit) return
  const val = msgInput.value
  msgInput.value = ''
  const handler = onSubmit
  Promise.resolve(handler(val)).catch((err) => errLine((err && err.message) || String(err)))
})

// ---- boot flow: create/join -> name -> chat ----

notice('Poiana lui Iocan — chat P2P direct, fără cont, fără server, fără istoric.')
askForRoom()

function askForRoom () {
  ask('cod invitație (gol = cameră nouă) — Enter', async (input) => {
    const code = input.trim()
    try {
      if (!code) {
        notice('creez camera...')
        const topic = await window.termkeet.createRoom()
        notice('cameră creată — trimite codul ăsta prietenului tău:')
        addLine('code', esc(topic))
        chanBox.value = '#' + topic.slice(0, 16)
      } else {
        notice('mă alătur camerei...')
        const topic = await window.termkeet.joinRoom(code)
        chanBox.value = '#' + topic.slice(0, 16)
      }
      askForName()
    } catch (err) {
      errLine((err && err.message) || String(err))
      askForRoom()
    }
  })
}

function askForName () {
  ask('numele tău — Enter', async (input) => {
    myName = await window.termkeet.setUsername(input.trim())
    notice('te conectezi...')
    titleText.textContent = 'Poiana lui Iocan - [' + chanBox.value + ']'
    renderNicks()
    connected = true
    startChat()
  })
}

function startChat () {
  ask('scrie un mesaj și apasă Enter...', async (input) => {
    const text = input.trim()
    if (text) await window.termkeet.sendMessage(text)
    startChat()
  })
}

function showClosedOverlay () {
  connected = false
  ask('conversația s-a încheiat — Enter pentru o cameră nouă', async () => {
    location.reload()
  })
}

window.termkeet.onEvent((payload) => {
  switch (payload.type) {
    case 'peer-connected':
      statusbar.textContent = payload.count + ' peer(s) online'
      break
    case 'peer-hello':
      users.set(payload.peerId, payload.name)
      notice(payload.name + ' a intrat în chat')
      renderNicks()
      statusbar.textContent = 'conectat cu ' + payload.name
      break
    case 'peer-idle':
      notice(payload.name + ' pare inactiv — s-ar putea să se piardă conexiunea')
      statusbar.textContent = payload.name + ' e idle...'
      break
    case 'peer-active':
      statusbar.textContent = 'conectat cu ' + payload.name
      break
    case 'peer-disconnected':
      users.delete(payload.peerId)
      renderNicks()
      notice(payload.name + ' a plecat — conversația s-a încheiat')
      statusbar.textContent = 'deconectat'
      if (connected) showClosedOverlay()
      break
    case 'chat':
      chatLine(payload.from, payload.text, payload.self)
      break
    case 'error':
      errLine(payload.message)
      break
  }
})

// ---- window chrome ----
document.getElementById('btnMin').onclick = () => window.termkeet.minimize()
document.getElementById('btnMax').onclick = () => window.termkeet.maximize()
document.getElementById('btnClose').onclick = () => window.termkeet.quit()

// ---- File menu ----
const menuFile = document.getElementById('menuFile')
const menuFileDrop = document.getElementById('menuFileDrop')
menuFile.addEventListener('click', (e) => {
  e.stopPropagation()
  menuFileDrop.hidden = !menuFileDrop.hidden
  menuFile.classList.toggle('open', !menuFileDrop.hidden)
})
document.addEventListener('click', () => {
  menuFileDrop.hidden = true
  menuFile.classList.remove('open')
})

document.getElementById('optKick').onclick = async () => {
  if (connected) {
    await window.termkeet.kickUser()
    notice('ai dat kick celuilalt participant.')
  }
}
document.getElementById('optTrivia').onclick = () => {
  notice('Trivia — în lucru, revenim curând 🙂')
}
document.getElementById('optClose').onclick = async () => {
  await window.termkeet.closeChat()
  location.reload()
}
