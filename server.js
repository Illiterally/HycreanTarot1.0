const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "Hycrean Tarot 1.0.html"));
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = new Map();

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function makeRoomCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function sanitizeRoomCode(value = "") {
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function normalizeSide(side = "") {
  return side === "red" ? "red" : "blue";
}

function oppositeSide(side = "") {
  return normalizeSide(side) === "red" ? "blue" : "red";
}

function createUniqueRoomCode(preferredCode = "") {
  const desired = sanitizeRoomCode(preferredCode);
  if (desired && !rooms.has(desired)) return desired;

  let code;
  do {
    code = makeRoomCode();
  } while (rooms.has(code));
  return code;
}

function createEmptyTurnContract() {
  return {
    staged: { blue: false, red: false },
    ready: { blue: false, red: false },
    canResolve: false
  };
}

function recomputeTurnContract(room) {
  const stagedBlue = !!room.match.turn.staged.blue;
  const stagedRed = !!room.match.turn.staged.red;
  const readyBlue = !!room.match.turn.ready.blue;
  const readyRed = !!room.match.turn.ready.red;

  room.match.turn.canResolve = stagedBlue && stagedRed && readyBlue && readyRed;
  room.match.phase = room.match.turn.canResolve ? "resolving" : "staging";
}

function resetTurnContract(room) {
  room.match.turn = createEmptyTurnContract();
  room.match.phase = "staging";
}

function normalizeSettings(settings = {}) {
  const laneMode = settings.laneMode === "narrows" ? "narrows" : "normal";
  const hostSide = normalizeSide(settings.hostSide);

  return {
    rulesMode: settings.rulesMode === "ht54" ? "ht54" : "ht52",
    aiMode: ["spring", "summer", "autumn", "winter"].includes(settings.aiMode)
      ? settings.aiMode
      : "spring",
    laneMode,
    laneCount: laneMode === "narrows" ? 3 : 6,
    hostSide
  };
}

function buildRoomState(room) {
  return {
    code: room.code,
    status: room.match.status,
    turnNumber: room.match.turnNumber,
    phase: room.match.phase,
    settings: clone(room.match.settings),
    snapshot: clone(room.match.snapshot),
    players: {
      host: room.players.host ? { side: room.players.host.side } : null,
      guest: room.players.guest ? { side: room.players.guest.side } : null
    },
    turn: {
      staged: {
        blue: !!room.match.turn.staged.blue,
        red: !!room.match.turn.staged.red
      },
      ready: {
        blue: !!room.match.turn.ready.blue,
        red: !!room.match.turn.ready.red
      },
      canResolve: !!room.match.turn.canResolve
    }
  };
}

function emitRoomStateToSocket(socketId, role, room) {
  if (!socketId || !room) return;
  io.to(socketId).emit("room:state", {
    ok: true,
    role,
    room: buildRoomState(room)
  });
}

function emitRoomState(code) {
  const room = rooms.get(code);
  if (!room) return;

  emitRoomStateToSocket(room.hostSocketId, "host", room);
  emitRoomStateToSocket(room.guestSocketId, "client", room);
}

function emitRoomErrorToSocket(socketId, error) {
  if (!socketId) return;
  io.to(socketId).emit("room:state", {
    ok: false,
    error
  });
}

function getRoomBySocketId(socketId) {
  for (const room of rooms.values()) {
    if (room.hostSocketId === socketId || room.guestSocketId === socketId) {
      return room;
    }
  }
  return null;
}

function getSideForSocket(room, socketId) {
  if (!room) return null;
  if (room.hostSocketId === socketId) return room.players.host?.side || null;
  if (room.guestSocketId === socketId) return room.players.guest?.side || null;
  return null;
}

function mergeSnapshotPreservingTurnNumber(room, snapshot, reason = "") {
  if (!room || !snapshot) return false;
  const incoming = clone(snapshot);
  if (typeof incoming !== "object") return false;

  if (!Number.isInteger(incoming.turnNumber)) {
    incoming.turnNumber = room.match.turnNumber;
  }

  room.match.snapshot = incoming;

  if (reason) {
    console.log("snapshot updated:", room.code, reason);
  }
  return true;
}

function setRoomSnapshot(room, snapshot, reason = "") {
  return mergeSnapshotPreservingTurnNumber(room, snapshot, reason);
}

function isStaleTurnPayload(room, payload = {}) {
  if (!room) return true;
  if (!Number.isInteger(payload.turnNumber)) return false;
  return payload.turnNumber !== room.match.turnNumber;
}

io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  socket.on("room:create", (payload = {}) => {
    const code = createUniqueRoomCode(payload.code);
    const settings = normalizeSettings(payload.settings || {});
    const hostSide = settings.hostSide;
    const guestSide = oppositeSide(hostSide);

    const room = {
      code,
      hostSocketId: socket.id,
      guestSocketId: null,
      players: {
        host: { socketId: socket.id, side: hostSide },
        guest: null
      },
      match: {
        roomCode: code,
        status: "waiting",
        turnNumber: 1,
        phase: "staging",
        settings,
        turn: createEmptyTurnContract(),
        actions: [],
        snapshot: clone(payload.snapshot || null)
      }
    };

    rooms.set(code, room);
    socket.join(code);

    console.log("room created:", code, {
      rulesMode: settings.rulesMode,
      aiMode: settings.aiMode,
      laneMode: settings.laneMode,
      laneCount: settings.laneCount,
      hostSide,
      guestSide
    });

    emitRoomStateToSocket(socket.id, "host", room);
  });

  socket.on("room:join", ({ code }) => {
    const room = rooms.get(sanitizeRoomCode(code));

    if (!room) {
      emitRoomErrorToSocket(socket.id, "Room not found");
      return;
    }

    if (room.players.guest) {
      emitRoomErrorToSocket(socket.id, "Room is full");
      return;
    }

    const guestSide = oppositeSide(
      room.match.settings?.hostSide || room.players.host?.side || "blue"
    );

    room.guestSocketId = socket.id;
    room.players.guest = { socketId: socket.id, side: guestSide };
    room.match.status = "ready";

    socket.join(room.code);

    console.log("room joined:", room.code, {
      hostSide: room.players.host?.side,
      guestSide: room.players.guest?.side
    });

    emitRoomState(room.code);
  });

  socket.on("match:snapshot", (payload = {}) => {
    const room = getRoomBySocketId(socket.id);
    if (!room) return;
    if (!payload.snapshot) return;

    if (isStaleTurnPayload(room, payload)) {
      console.log("ignored stale match:snapshot", room.code, payload.turnNumber, room.match.turnNumber);
      emitRoomState(room.code);
      return;
    }

    setRoomSnapshot(room, payload.snapshot, "match:snapshot");
    emitRoomState(room.code);
  });

  socket.on("match:stage", (payload = {}) => {
    const room = getRoomBySocketId(socket.id);
    if (!room) return;

    const side = getSideForSocket(room, socket.id);
    if (!side) return;
    if (!Number.isInteger(payload.turnNumber)) {
      console.log("ignored match:stage without turnNumber", room.code, side);
      emitRoomState(room.code);
      return;
    }

    if (isStaleTurnPayload(room, payload)) {
      console.log("ignored stale match:stage", room.code, side, payload.turnNumber, room.match.turnNumber);
      emitRoomState(room.code);
      return;
    }

    room.match.turn.staged[side] = true;
    room.match.turn.ready[side] = false;

    if (payload.snapshot) {
      setRoomSnapshot(room, payload.snapshot, `match:stage:${side}`);
    }

    recomputeTurnContract(room);

    console.log("match:stage", room.code, side, room.match.turn);
    emitRoomState(room.code);
  });

  socket.on("match:ready", (payload = {}) => {
    const room = getRoomBySocketId(socket.id);
    if (!room) return;

    const side = getSideForSocket(room, socket.id);
    if (!side) return;
    if (!Number.isInteger(payload.turnNumber)) {
      console.log("ignored match:ready without turnNumber", room.code, side);
      emitRoomState(room.code);
      return;
    }

    if (isStaleTurnPayload(room, payload)) {
      console.log("ignored stale match:ready", room.code, side, payload.turnNumber, room.match.turnNumber);
      emitRoomState(room.code);
      return;
    }

    room.match.turn.staged[side] = true;
    room.match.turn.ready[side] = true;

    if (payload.snapshot) {
      setRoomSnapshot(room, payload.snapshot, `match:ready:${side}`);
    }

    recomputeTurnContract(room);

    console.log("match:ready", room.code, side, room.match.turn);
    emitRoomState(room.code);
  });

  socket.on("match:resolve", (payload = {}) => {
    const room = getRoomBySocketId(socket.id);
    if (!room) return;
    if (!Number.isInteger(payload.turnNumber)) {
      console.log("ignored match:resolve without turnNumber", room.code);
      emitRoomState(room.code);
      return;
    }

    if (isStaleTurnPayload(room, payload)) {
      console.log("ignored stale match:resolve", room.code, payload.turnNumber, room.match.turnNumber);
      emitRoomState(room.code);
      return;
    }

    if (payload.snapshot) {
      setRoomSnapshot(room, payload.snapshot, "match:resolve:precheck");
    }

    recomputeTurnContract(room);
    const isFinalResolve = !!payload.finalResolveMode || !!payload.snapshot?.finalResolveMode;

    if (!room.match.turn.canResolve && !isFinalResolve) {
      emitRoomErrorToSocket(socket.id, "Both players are not ready");
      emitRoomState(room.code);
      return;
    }

    room.match.turnNumber += 1;
    resetTurnContract(room);

    if (payload.snapshot) {
      const postResolveSnapshot = clone(payload.snapshot);
      if (postResolveSnapshot && typeof postResolveSnapshot === "object") {
        postResolveSnapshot.turnNumber = room.match.turnNumber;
      }
      setRoomSnapshot(room, postResolveSnapshot, "match:resolve:postresolve");
    }

    console.log("match:resolve", room.code, "turn", room.match.turnNumber);
    emitRoomState(room.code);
  });

  socket.on("disconnect", () => {
    for (const [code, room] of rooms.entries()) {
      const isHost = room.hostSocketId === socket.id;
      const isGuest = room.guestSocketId === socket.id;

      if (!isHost && !isGuest) continue;

      if (isHost) {
        if (room.guestSocketId) {
          emitRoomErrorToSocket(room.guestSocketId, "Host disconnected");
        }
        rooms.delete(code);
      } else if (isGuest) {
        room.guestSocketId = null;
        room.players.guest = null;
        room.match.status = "waiting";
        resetTurnContract(room);
        emitRoomState(code);
      }

      break;
    }

    console.log("disconnected:", socket.id);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`HT54 server running on http://localhost:${PORT}`);
});
