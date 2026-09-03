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
    cursor: '#f2f2f2',
    cursorAccent: '#1e1e1e',
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
  term.write(prompt)
}

// Clear whatever the user has typed so far on the current line, print an
// out-of-band announcement (a peer joining, an incoming message, ...) above
// it, then restore the prompt and their in-progress input — the same trick
// readline's clearLine/prompt(true) does in the plain-terminal CLI version.
function announce (str) {
  term.write('\r\x1b[K')
  writeln(str)
  term.write(prompt + line)
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
    writeln(`${ANSI.dim}connecting to swarm...${ANSI.reset}`)
    writeln('')
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
      announce(`${ANSI.dim}[peer ${payload.peerId} connected — ${payload.count} peer(s) online]${ANSI.reset}`)
      break
    case 'peer-hello':
      announce(`${ANSI.dim}[${payload.name} joined]${ANSI.reset}`)
      break
    case 'peer-disconnected':
      announce(`${ANSI.dim}[${payload.name} disconnected — ${payload.count} peer(s) online]${ANSI.reset}`)
      break
    case 'chat': {
      const color = payload.self ? ANSI.green : ANSI.cyan
      announce(`${ANSI.dim}[${timestamp()}]${ANSI.reset} ${color}${ANSI.bold}${payload.from}${ANSI.reset} ${payload.text}`)
      break
    }
    case 'error':
      announce(`${ANSI.red}${payload.message}${ANSI.reset}`)
      break
  }
})
