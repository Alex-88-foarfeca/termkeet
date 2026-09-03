# termkeet

A minimalist, private peer-to-peer chat for friends and family. Built on
**Hyperswarm** — the same DHT-based P2P networking library that powers
Keet / the Holepunch stack — so there is no central server, no account,
and no chat history stored anywhere: peers find and talk to each other
directly, over an encrypted connection (Noise protocol), and nothing is
kept once the app closes.

Three ways to run it:

- **GUI** (`npm start`) — a real desktop window, styled to look and behave
  exactly like macOS Terminal: native title bar, dark theme, monospace
  font, and a genuine blinking block cursor (the terminal emulator is
  [xterm.js](https://xtermjs.org), not a fake). This is what most people
  should use on a Mac/PC.
- **CLI** (`npm run cli`) — the same chat, run directly inside your actual
  terminal (Terminal.app, iTerm, etc.), no window of its own.
- **Web** ([web/index.html](web/index.html)) — a phone-friendly browser
  version, for when there's no Node/Electron install involved (e.g.
  testing with someone on their phone). See [web/README.md](web/README.md)
  — it's a different transport (WebRTC, not Hyperswarm), for reasons
  explained there.

The GUI and CLI talk the same protocol over Hyperswarm and can chat with
each other freely —
the GUI is just a nicer front end on the same P2P core.

## Setup

Requires Node.js 18+.

```bash
npm install
```

## Usage — GUI

```bash
npm start
```

A window opens. It will ask you two questions, right there in the
terminal:

1. **Invite code to join** — leave empty to create a new room (you'll get
   a 64-character invite code to share), or paste one someone sent you.
2. **Your name** — whatever you want to be called in the chat.

Then just type and hit Enter to send. `Ctrl+C` leaves.

## Usage — CLI

```bash
node cli.js                 # create a new room, prints an invite code
node cli.js <invite-code>   # join an existing room
```

## How it works / privacy

- `swarm.join(topic)` announces you on the Hyperswarm DHT under a topic
  (32 random bytes — the invite code) and connects you directly to any
  other peer announcing the same topic. That's real peer discovery and
  NAT traversal, not a simulation, and there's no server in the middle of
  your messages.
- Connections are encrypted by default (Noise protocol, built into
  Hyperswarm) — traffic isn't readable by anyone snooping the network.
- Nothing is written to disk: no logs, no history, no accounts. Closing
  the app loses the conversation. That's the deliberate "minimalistic"
  trade-off — see below for how to add optional persistence.
- The invite code **is** the shared secret for the room — treat it like a
  door key. Anyone who has it can join. Send it over a channel you trust
  (Signal, in person, etc.).
- In the GUI, the chat window (renderer) has **no Node.js or network
  access at all** — it's a plain sandboxed web page. All Hyperswarm
  networking happens in the separate Electron main process, reachable
  only through a handful of specific, whitelisted functions (create room,
  join room, send message). A malicious peer's chat text can't do
  anything but be displayed as text — control characters and ANSI escape
  sequences from peers are stripped before they ever reach the terminal.

## A note on corporate/restrictive networks

Hyperswarm relies on UDP for DHT lookups and hole-punching. Firewalls or
proxies that block outbound UDP, or force all traffic through an HTTP
proxy, can prevent peers from finding or reaching each other. If two
peers can't connect, try from an unrestricted network first (e.g. a
mobile hotspot) before assuming it's a bug.

## Compatibility note

`devDependencies.electron` is pinned to a version tested to run on macOS
12 (Monterey) and up. Electron majors newer than ~43 raise their minimum
macOS version to 13 (Ventura) and will crash on launch on older systems —
if you're on Ventura+ and want to track the latest Electron, that's a
safe upgrade.

## Where to go from here

- **Persistent history** — replace the raw socket protocol with a
  [Hypercore](https://github.com/holepunchto/hypercore) append-only log
  per peer, merged with [Autobase](https://github.com/holepunchto/autobase),
  the way Keet does it for real.
- **Multiple rooms / a room list** — wrap invite-code management in a
  small local config file.
- **A double-click .app for non-technical family members** — package with
  [electron-builder](https://www.electron.build/); note the app would be
  unsigned unless you have an Apple Developer account, so first launch
  needs a right-click → Open to bypass Gatekeeper.
