'use strict'

/*
 * Poiana lui Iocan GUI — renderer.
 *
 * Draws a real terminal emulator (xterm.js) styled like macOS Terminal.app,
 * with a genuine blinking block cursor, and implements just enough of a
 * line editor (Enter / Backspace / Ctrl+C) to drive a tiny chat REPL over
 * the sandboxed `window.termkeet` bridge from preload.js. No Node or
 * network access exists in this file — only what preload explicitly exposed.
 */

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m'
}

const term = new Terminal({
  cursorBlink: true,
  cursorStyle: 'block',
  cursorInactiveStyle: 'block', // stay a solid block even when unfocused, not a hollow outline
  fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
  fontSize: 13,
  scrollback: 5000,
  theme: {
    background: '#1e1e1e',
    foreground: '#f2f2f2',
    cursor: '#5ff967',        // green block cursor, like a classic terminal
    cursorAccent: '#1e1e1e',  // text under the block cursor
    selectionBackground: 'rgba(255,255,255,0.3)',
    black: '#000000', red: '#c91b00', green: '#00c200', yellow: '#c7c400',
    blue: '#0225c7', magenta: '#c930c7', cyan: '#00c5c7', white: '#c7c7c7',
    brightBlack: '#676767', brightRed: '#ff6d67', brightGreen: '#5ff967',
    brightYellow: '#fefb67', brightBlue: '#6871ff', brightMagenta: '#ff77ff',
    brightCyan: '#5ffdff', brightWhite: '#feffff'
  }
})

const fitAddon = new FitAddon.FitAddon()
term.loadAddon(fitAddon)
term.open(document.getElementById('terminal'))
fitAddon.fit()
term.focus()
window.addEventListener('resize', () => fitAddon.fit())

// xterm only blinks the cursor while the terminal holds focus. In a plain
// chat window it's easy to lose focus (a click on the padding, the window
// coming back from the background) and then the cursor just sits there
// frozen — not very "terminal". Grab focus back whenever the window is
// active and the user isn't mid-selection, so the block keeps blinking.
window.addEventListener('focus', () => term.focus())
document.addEventListener('mouseup', () => {
  if (!term.hasSelection()) term.focus()
})

function writeln (str) {
  term.write(str + '\r\n')
}

function timestamp () {
  return new Date().toTimeString().slice(0, 8)
}

// ---- a minimal line editor over xterm's raw input stream ----
let line = ''
let prompt = ''
let onSubmit = null

function ask (p, handler) {
  line = ''
  prompt = p
  onSubmit = handler
  if (chatActive) redraw()
  else term.write(prompt)
}

// Chat scrollback is capped: only the last HISTORY_MAX lines (messages from
// both sides, plus join/leave/error notices) are kept, so the window never
// fills up. Once the chat starts, every new line clears and redraws that
// window (name/room prompts before that use plain writes).
const HISTORY_MAX = 20
const history = []
let chatActive = false
let headerExtra = '' // e.g. the invite code, kept visible in the redraw header

function record (str) {
  history.push(str)
  if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX)
  if (chatActive) redraw()
}

function redraw () {
  term.write('\r\x1b[2K')  // wipe the current input line
  term.clear()             // drop the scrollback above it
  term.write('\x1b[H\x1b[2J') // home the cursor + clear the screen
  term.write(`${ANSI.dim}Poiana lui Iocan — ultimele ${HISTORY_MAX} mesaje${ANSI.reset}\r\n`)
  if (headerExtra) term.write(headerExtra + '\r\n')
  for (const h of history) term.write(h + '\r\n')
  term.write(prompt + line) // restore prompt + whatever was being typed
}

term.onData((data) => {
  if (!onSubmit) return
  for (const ch of data) {
    const code = ch.charCodeAt(0)
    if (ch === '\r') {
      term.write('\r\n')
      const submitted = line
      const handler = onSubmit
      line = ''
      onSubmit = null
      handler(submitted)
    } else if (ch === '') { // backspace
      if (line.length > 0) {
        line = line.slice(0, -1)
        term.write('\b \b')
      }
    } else if (ch === '') { // Ctrl+C
      term.write('^C\r\n')
      window.termkeet.quit()
    } else if (code >= 32) {
      line += ch
      term.write(ch)
    }
  }
})

// ---- app flow: create/join -> name -> chat ----

writeln(`${ANSI.bold}Poiana lui Iocan${ANSI.reset} — minimal P2P terminal chat`)
writeln(`${ANSI.dim}no servers, no accounts, no history — just Hyperswarm's P2P DHT${ANSI.reset}`)
writeln('')
askForRoom()

function askForRoom () {
  ask(`${ANSI.dim}invite code to join (leave empty to create a new room): ${ANSI.reset}`, async (input) => {
    const code = input.trim()
    try {
      if (!code) {
        const topic = await window.termkeet.createRoom()
        writeln(`${ANSI.dim}room created. share this invite code:${ANSI.reset}`)
        writeln(`${ANSI.yellow}${topic}${ANSI.reset}`)
        // keep the code in the chat header so it's still reachable after
        // the screen is first redrawn
        headerExtra = `${ANSI.dim}invite: ${ANSI.reset}${ANSI.yellow}${topic}${ANSI.reset}`
      } else {
        const topic = await window.termkeet.joinRoom(code)
        writeln(`${ANSI.dim}joining room ${topic.slice(0, 8)}...${ANSI.reset}`)
      }
      askForName()
    } catch (err) {
      writeln(`${ANSI.red}${(err && err.message) || err}${ANSI.reset}`)
      askForRoom()
    }
  })
}

function askForName () {
  ask(`${ANSI.dim}your name: ${ANSI.reset}`, async (input) => {
    const name = await window.termkeet.setUsername(input.trim())
    record(`${ANSI.dim}connecting to swarm...${ANSI.reset}`)
    chatActive = true
    chatLoop(name)
  })
}

function chatLoop (username) {
  ask(`${ANSI.dim}> ${ANSI.reset}`, async (input) => {
    const text = input.trim()
    if (text) await window.termkeet.sendMessage(text)
    chatLoop(username)
  })
}

window.termkeet.onEvent((payload) => {
  switch (payload.type) {
    case 'peer-connected':
      record(`${ANSI.dim}[peer ${payload.peerId} connected — ${payload.count} peer(s) online]${ANSI.reset}`)
      break
    case 'peer-hello':
      record(`${ANSI.dim}[${payload.name} joined]${ANSI.reset}`)
      break
    case 'peer-disconnected':
      record(`${ANSI.dim}[${payload.name} disconnected — ${payload.count} peer(s) online]${ANSI.reset}`)
      break
    case 'chat': {
      const color = payload.self ? ANSI.green : ANSI.cyan
      record(`${ANSI.dim}[${timestamp()}]${ANSI.reset} ${color}${ANSI.bold}${payload.from}${ANSI.reset} ${payload.text}`)
      break
    }
    case 'error':
      record(`${ANSI.red}${payload.message}${ANSI.reset}`)
      break
  }
})
