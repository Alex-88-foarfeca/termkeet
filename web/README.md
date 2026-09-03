# termkeet — web

A phone-friendly, browser-based version of termkeet. Same values as the
desktop app (no accounts, no chat history, direct/encrypted peer
connection), but a different transport and a different signaling model,
for reasons below.

**Live page:** https://alex-88-foarfeca.github.io/termkeet/web/

> **Do not host this as a Claude Artifact.** The Artifact sandbox strips
> `RTCPeerConnection` and every other WebRTC global at load time (its CSP
> also carries `webrtc 'block'`), so the page dies immediately with
> "acest browser nu suportă WebRTC". It needs a plain static host with
> HTTPS — GitHub Pages (above), Netlify, Cloudflare Pages, etc. `localhost`
> also works for a single-machine test; a phone needs the HTTPS URL.

## Why this isn't just Hyperswarm in a browser

Hyperswarm needs raw UDP sockets and a DHT client, which browsers don't
expose to web pages. So the web version uses **WebRTC** instead
(`RTCDataChannel`) — the browser-native way to get a direct, encrypted
P2P connection between two tabs/phones. The message transport is
different; the privacy properties are the same (direct connection,
DTLS-encrypted, nothing stored).

## Why the connection setup is a manual link/code exchange

WebRTC still needs a one-time handshake (an "offer" and "answer",
essentially "here's how to reach me") before two browsers can talk
directly — normally a small signaling server relays that handshake.
I looked at using Claude Artifacts' own realtime capabilities
(`room`/`db`) for that relay instead of standing up separate
infrastructure, but both are scoped to signed-in members of the
**same Claude organization** — they can't reach an outside friend on
their own account, which is exactly the case here. Rather than stand up
a separate always-on signaling server (a new piece of infrastructure,
and a new thing that could see connection metadata), the handshake is
just exchanged as a link/code the two of you send each other over
whatever you already use (WhatsApp, SMS, in person). Genuinely nothing
in the middle — not even Anthropic's servers touch the handshake, let
alone the chat.

## How to test it with a friend

1. Open the [page](https://alex-88-foarfeca.github.io/termkeet/web/)
   on your phone, tap **"Creează o cameră nouă"**, enter your name.
2. Tap **"Trimite invitația"** — it opens your share sheet with a link.
   Send it to your friend any way you like.
3. Your friend taps the link, enters their name, and the page hands them
   a short **response code** with a **"Trimite codul de răspuns"**
   button — they send that back to you the same way.
4. Paste that code into the box still open on your screen (from step 2)
   and tap **"Conectează"**. Once it connects, you're both in the chat
   screen — messages go directly between your two phones from here.

That's a one-time, ~3-step setup per conversation (there's no
"session" to resume — reopening the page starts a fresh room). It's the
trade-off for having zero server in the loop.

## NAT / connectivity note

Direct phone-to-phone WebRTC connections usually just work, but not
always — some mobile carrier networks (especially aggressive CGNAT) can
block a direct path. The page includes a public STUN server plus a
free public TURN relay ([openrelay.metered.ca](https://www.metered.ca/tools/openrelayproject/))
as a fallback for that case. Even when traffic goes through that relay,
it only ever sees encrypted bytes — TURN relays packets, it isn't part
of the encryption handshake and can't read message content. If a
connection still fails for you two, that's the known limitation of a
serverless setup on some networks, not a bug in the page itself.

## Limits (by design, for now)

- **Two people at a time.** The manual handshake is pairwise; a group
  chat would need every pair to exchange codes, which isn't built.
- **No reconnect.** If either of you closes the tab, that room is gone —
  reload and set up a new one.
- English is used in the desktop/CLI app; this page's copy is in
  Romanian since that's who it's for. Easy to change if needed.
