// Random Connect — signaling server
// In-memory only. No database, no persistence, no chat/video logs stored.
// Requires: npm install express socket.io

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// In-memory state only. Nothing here is written to disk or a database.
// Everything is wiped whenever the process restarts.
// ---------------------------------------------------------------------------

// Waiting queues, separated by mode ("video" | "text"), each entry:
// { socketId, country, wantsCountry, joinedAt }
const queues = {
  video: [],
  text: [],
};

// Active pairs: socketId -> partnerSocketId
const partners = new Map();

// Very lightweight in-memory report log (for local dev / demo only).
// In production this should go to a real moderation pipeline, not console.log.
const reportLog = [];

// Minimal per-connection session info (age-gate result, chosen country).
// Cleared on disconnect. Never persisted.
const sessions = new Map();

function removeFromQueues(socketId) {
  queues.video = queues.video.filter((u) => u.socketId !== socketId);
  queues.text = queues.text.filter((u) => u.socketId !== socketId);
}

function findMatch(mode, user) {
  const queue = queues[mode];

  // 1st pass: try to honor both users' country preferences if possible.
  for (let i = 0; i < queue.length; i++) {
    const candidate = queue[i];
    const candidateWantsUser =
      candidate.wantsCountry === "ANY" || candidate.wantsCountry === user.country;
    const userWantsCandidate =
      user.wantsCountry === "ANY" || user.wantsCountry === candidate.country;

    if (candidateWantsUser && userWantsCandidate) {
      queue.splice(i, 1);
      return candidate;
    }
  }
  return null;
}

function pairUsers(mode, socketA, userA) {
  const match = findMatch(mode, userA);
  if (!match) {
    queues[mode].push(userA);
    return;
  }

  partners.set(socketA.id, match.socketId);
  partners.set(match.socketId, socketA.id);

  const socketB = io.sockets.sockets.get(match.socketId);
  if (!socketB) {
    // Stale entry, retry with a fresh queue.
    pairUsers(mode, socketA, userA);
    return;
  }

  // Tell both sides they're matched. One side is designated the WebRTC
  // "initiator" to keep the offer/answer handshake deterministic.
  socketA.emit("matched", {
    mode,
    initiator: true,
    partnerCountry: match.country,
  });
  socketB.emit("matched", {
    mode,
    initiator: false,
    partnerCountry: userA.country,
  });
}

io.on("connection", (socket) => {
  sessions.set(socket.id, { verifiedAdult: false });

  socket.on("age-verify", (payload) => {
    // Self-attested locally, but we still require an explicit affirmative
    // flag from the client before allowing entry to the queue.
    if (payload && payload.confirmedAdult === true) {
      sessions.set(socket.id, { verifiedAdult: true });
    }
  });

  socket.on("join-queue", ({ mode, country, wantsCountry }) => {
    const session = sessions.get(socket.id);
    if (!session || !session.verifiedAdult) {
      socket.emit("error-message", "Age verification required before matching.");
      return;
    }
    if (mode !== "video" && mode !== "text") return;

    removeFromQueues(socket.id);
    const user = {
      socketId: socket.id,
      country: country || "UNKNOWN",
      wantsCountry: wantsCountry || "ANY",
      joinedAt: Date.now(),
    };
    pairUsers(mode, socket, user);
  });

  socket.on("leave-queue", () => {
    removeFromQueues(socket.id);
  });

  // --- WebRTC signaling relay (server never inspects media/text content) ---
  socket.on("webrtc-offer", (data) => {
    const partnerId = partners.get(socket.id);
    if (partnerId) io.to(partnerId).emit("webrtc-offer", data);
  });

  socket.on("webrtc-answer", (data) => {
    const partnerId = partners.get(socket.id);
    if (partnerId) io.to(partnerId).emit("webrtc-answer", data);
  });

  socket.on("webrtc-ice-candidate", (data) => {
    const partnerId = partners.get(socket.id);
    if (partnerId) io.to(partnerId).emit("webrtc-ice-candidate", data);
  });

  // --- Text chat relay ---
  socket.on("chat-message", (data) => {
    const partnerId = partners.get(socket.id);
    if (partnerId) io.to(partnerId).emit("chat-message", data);
  });

  // --- Next / disconnect current partner, return to queue ---
  socket.on("next", () => {
    disconnectPartner(socket.id, "partner-left");
  });

  // --- Reporting: this is a REAL server-side log, not a decorative button ---
  socket.on("report-user", ({ reason }) => {
    const partnerId = partners.get(socket.id);
    const entry = {
      id: crypto.randomUUID(),
      reporterSocketId: socket.id,
      reportedSocketId: partnerId || null,
      reason: (reason || "unspecified").slice(0, 500),
      timestamp: new Date().toISOString(),
    };
    reportLog.push(entry);
    // In production: forward to a moderation queue / trust & safety system,
    // and consider immediately ending the session server-side.
    console.log("[REPORT]", entry);
    disconnectPartner(socket.id, "reported");
    socket.emit("report-received");
  });

  socket.on("disconnect", () => {
    disconnectPartner(socket.id, "partner-left");
    removeFromQueues(socket.id);
    sessions.delete(socket.id);
  });

  function disconnectPartner(socketId, reasonForPartner) {
    const partnerId = partners.get(socketId);
    if (partnerId) {
      partners.delete(socketId);
      partners.delete(partnerId);
      io.to(partnerId).emit("partner-disconnected", { reason: reasonForPartner });
    }
  }
});

// Simple local-only endpoint to eyeball the report log during development.
app.get("/__reports", (req, res) => {
  res.json(reportLog);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Random Connect signaling server running on http://localhost:${PORT}`);
});
