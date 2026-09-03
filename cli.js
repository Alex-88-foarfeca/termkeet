#!/usr/bin/env node
'use strict'

/*
 * termkeet — a minimalist terminal-based P2P chat.
 *
 * Uses Hyperswarm (the same DHT-based P2P networking library that Keet /
 * the Holepunch stack is built on) to find and connect peers directly,
 * with no central server. The UI is just your terminal's own prompt and
 * cursor — nothing simulated.
 *
 * Usage:
 *   node cli.js                 -> create a new room, prints an invite code
 *   node cli.js <invite-code>   -> join an existing room
 */

const readline = require('readline')
const crypto = require('crypto')
const Hyperswarm = require('hyperswarm')

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m'
}

function timestamp () {
  const d = new Date()
  return d.toTimeString().slice(0, 8)
}

async function main () {
  const arg = process.argv[2]

  const swarm = new Hyperswarm()
  const peers = new Map() // socket -> { name }
  let topic

  if (arg) {
    if (!/^[0-9a-fA-F]{64}$/.test(arg)) {
      console.error('Invalid invite code. It must be a 64-character hex string.')
      process.exit(1)
    }
    topic = Buffer.from(arg, 'hex')
  } else {
    topic = crypto.randomBytes(32)
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${ANSI.dim}> ${ANSI.reset}`
  })

  function printLine (str) {
    readline.clearLine(process.stdout, 0)
    readline.cursorTo(process.stdout, 0)
    console.log(str)
    rl.prompt(true)
  }

  console.log(`${ANSI.bold}termkeet${ANSI.reset} — minimal P2P terminal chat`)
  console.log(`${ANSI.dim}room topic:${ANSI.reset} ${topic.toString('hex')}`)
  if (!arg) {
    console.log(`${ANSI.dim}share this invite code with others to let them join:${ANSI.reset}`)
    console.log(`${ANSI.yellow}${topic.toString('hex')}${ANSI.reset}`)
  }
  console.log(`${ANSI.dim}connecting to swarm...${ANSI.reset}`)
  console.log('')

  rl.question(`${ANSI.dim}your name: ${ANSI.reset}`, (name) => {
    const username = (name || 'anon').trim() || 'anon'

    swarm.join(topic, { server: true, client: true })

    swarm.on('connection', (conn, info) => {
      const peerId = info.publicKey.toString('hex').slice(0, 8)
      peers.set(conn, { name: null })
      printLine(`${ANSI.dim}[peer ${peerId} connected — ${peers.size} peer(s) online]${ANSI.reset}`)

      // announce ourselves to the new peer
      conn.write(JSON.stringify({ type: 'hello', name: username }) + '\n')

      const connRl = readline.createInterface({ input: conn })
      connRl.on('line', (line) => {
        let msg
        try {
          msg = JSON.parse(line)
        } catch (e) {
          return
        }
        if (msg.type === 'hello') {
          peers.set(conn, { name: msg.name })
          printLine(`${ANSI.dim}[${msg.name} joined]${ANSI.reset}`)
          return
        }
        if (msg.type === 'chat') {
          const who = peers.get(conn)?.name || peerId
          printLine(`${ANSI.dim}[${timestamp()}]${ANSI.reset} ${ANSI.cyan}${ANSI.bold}${who}${ANSI.reset} ${msg.text}`)
        }
      })

      conn.on('close', () => {
        const who = peers.get(conn)?.name || peerId
        peers.delete(conn)
        printLine(`${ANSI.dim}[${who} disconnected — ${peers.size} peer(s) online]${ANSI.reset}`)
      })

      conn.on('error', () => {}) // swallow transient P2P connection errors
    })

    rl.prompt()

    rl.on('line', (line) => {
      const text = line.trim()
      if (text.length > 0) {
        const payload = JSON.stringify({ type: 'chat', text }) + '\n'
        for (const conn of peers.keys()) conn.write(payload)
        printLine(`${ANSI.dim}[${timestamp()}]${ANSI.reset} ${ANSI.green}${ANSI.bold}${username}${ANSI.reset} ${text}`)
      } else {
        rl.prompt()
      }
    })

    rl.on('close', () => {
      console.log(`\n${ANSI.dim}leaving...${ANSI.reset}`)
      swarm.destroy().then(() => process.exit(0))
    })
  })
}

main().catch((err) => {
  console.error(`${ANSI.red}fatal error:${ANSI.reset}`, err)
  process.exit(1)
})
