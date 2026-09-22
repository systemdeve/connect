[README.md](https://github.com/user-attachments/files/32494272/README.md)
# Random Connect

Real-time random text/video chat. No database — matchmaking state, chat pairs,
and reports are held **in memory only** in `server.js` and vanish when the
process restarts.

## Run it locally

```bash
npm install
npm start
```

Then open **http://localhost:3001** in two different browser tabs/windows
(or two devices on the same network, using your machine's LAN IP instead of
localhost) to simulate two strangers meeting.

## What's actually implemented

- Age gate: users must enter a DOB and the computed age must be 18+ before
  the client is allowed to join the matchmaking queue. This is enforced
  **both** client-side (blocks the UI) and server-side (`age-verify` /
  `join-queue` handlers in `server.js` reject unverified sockets). It is
  still self-attested — there's no ID check — so treat it as a first layer,
  not a guarantee.
- In-memory country-filtered matchmaking queue (`server.js`), separate for
  video and text.
- WebRTC video handshake relayed through Socket.io signaling events (the
  server never touches media content).
- Text chat overlay, works standalone or alongside video.
- "Next" (drop + requeue), "Stop" (leave entirely), and "Report" — Report
  is wired to a real server-side log (`reportLog` array, viewable at
  `GET /__reports` while the server is running), not just a UI element.

## What this is *not*

This is a local-dev / educational scaffold, not a production-ready public
app. Before putting anything like this in front of real users you'd want,
at minimum:
- Real ID/age verification (e.g. Persona, Stripe Identity, Veriff) instead
  of a self-attested checkbox
- A real moderation pipeline behind the report log (human review, auto
  content flags, rate limiting, bans)
- TURN servers in `RTC_CONFIG` (the current STUN-only config will fail to
  connect some users behind strict NATs/firewalls)
- HTTPS (browsers block camera/mic access on non-secure origins except
  localhost)
- Abuse protections: rate limiting on queue joins, IP-based throttling,
  CAPTCHA on entry, etc.

## Files

- `server.js` — Express + Socket.io signaling server, in-memory matchmaking
- `public/index.html` — entire frontend in one file (landing, age gate,
  queue, video/text chat UI)
- `package.json` — dependencies
