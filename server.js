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
  const turn = room.match.turn;
  turn.canResolve = !!turn.staged.blue && !!turn.staged.red && !!turn.ready.blue && !!turn.ready.red;
  room.match.phase = turn.canResolve ? "resolving" : "staging";
}

function resetTurnContract(room) {
  room.match.turn = createEmptyTurnContract();
  room.match.phase = "staging";
}

function sideNeedsStagingFromSnapshot(side, snapshot = null) {
  if (!snapshot || typeof snapshot !== "object") return true;
  if (snapshot.finalResolveMode) return false;
  const hand = snapshot?.sides?.[side]?.hand;
  if (!Array.isArray(hand)) return true;
  return hand.length > 0;
}

function canSideStageNow(room, side) {
  const turn = room.match.turn;
  const snapshot = room.match.snapshot || null;
  const blueNeedsStaging = sideNeedsStagingFromSnapshot("blue", snapshot);
  const redNeedsStaging = sideNeedsStagingFromSnapshot("red", snapshot);
  const blueSatisfied = !!turn.staged.blue || !blueNeedsStaging;

  if (side === "blue") return blueNeedsStaging && !turn.staged.blue;
  if (side === "red") return redNeedsStaging && !turn.staged.red && blueSatisfied;
  return false;
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

function isStaleTurnPayload(room, payload = {}) {
  if (!room) return true;
  if (!Number.isInteger(payload.turnNumber)) return false;
  return payload.turnNumber !== room.match.turnNumber;
}

function emitRoomErrorToSocket(socketId, error) {
  if (!socketId) return;
  io.to(socketId).emit("room:state", { ok: false, error });
}

function buildRoomState(room) {
  return {
    code: room.code,
    status: room.match.status,
    turnNumber: room.match.turnNumber,
    phase: room.match.phase,
    settings: clone(room.match.settings),
    snapshot: clone(room.match.snapshot),
    resolved: clone(room.match.lastResolved),
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

function getRoomBySocketId(socketId) {
  for (const room of rooms.values()) {
    if (room.hostSocketId === socketId || room.guestSocketId === socketId) return room;
  }
  return null;
}

function getSideForSocket(room, socketId) {
  if (!room) return null;
  if (room.hostSocketId === socketId) return room.players.host?.side || null;
  if (room.guestSocketId === socketId) return room.players.guest?.side || null;
  return null;
}

function setRoomSnapshot(room, snapshot) {
  if (!room || !snapshot || typeof snapshot !== "object") return false;
  const next = clone(snapshot);
  room.match.snapshot = next;
  return true;
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
        snapshot: clone(payload.snapshot || null),
        lastResolved: null
      }
    };

    rooms.set(code, room);
    socket.join(code);
    console.log("room created:", code, { hostSide, guestSide });
    emitRoomStateToSocket(socket.id, "host", room);
  });

  socket.on("room:join", ({ code }) => {
    const room = rooms.get(sanitizeRoomCode(code));
    if (!room) return emitRoomErrorToSocket(socket.id, "Room not found");
    if (room.players.guest) return emitRoomErrorToSocket(socket.id, "Room is full");

    const guestSide = oppositeSide(room.match.settings?.hostSide || room.players.host?.side || "blue");
    room.guestSocketId = socket.id;
    room.players.guest = { socketId: socket.id, side: guestSide };
    room.match.status = "ready";

    socket.join(room.code);
    console.log("room joined:", room.code, { hostSide: room.players.host?.side, guestSide });
    emitRoomState(room.code);
  });

  socket.on("match:stage", (payload = {}) => {
    const room = getRoomBySocketId(socket.id);
    if (!room) return;

    const side = getSideForSocket(room, socket.id);
    if (!side) return;

    if (!Number.isInteger(payload.turnNumber)) {
      emitRoomState(room.code);
      return;
    }

    if (isStaleTurnPayload(room, payload)) {
      emitRoomState(room.code);
      return;
    }

    if (!canSideStageNow(room, side)) {
      emitRoomErrorToSocket(socket.id, side === "red" ? "Blue must stage before Red" : "Blue has already staged this turn");
      emitRoomState(room.code);
      return;
    }

    room.match.turn.staged[side] = true;
    room.match.turn.ready[side] = false;
    if (payload.snapshot && typeof payload.snapshot === "object") {
      setRoomSnapshot(room, payload.snapshot);
    }
    recomputeTurnContract(room);
    const snapshotCards = Array.isArray(room.match.snapshot?.board)
      ? room.match.snapshot.board.flat().filter(Boolean).length
      : 0;
    console.log("[online:server:stage]", {
      code: room.code,
      side,
      turnNumber: room.match.turnNumber,
      staged: room.match.turn.staged,
      ready: room.match.turn.ready,
      canResolve: room.match.turn.canResolve,
      snapshotCards
    });
    emitRoomState(room.code);
  });

  socket.on("match:unstage", (payload = {}) => {
    const room = getRoomBySocketId(socket.id);
    if (!room) return;

    const side = getSideForSocket(room, socket.id);
    if (!side) return;

    if (!Number.isInteger(payload.turnNumber)) {
      emitRoomState(room.code);
      return;
    }

    if (isStaleTurnPayload(room, payload)) {
      emitRoomState(room.code);
      return;
    }

    room.match.turn.staged[side] = false;
    room.match.turn.ready[side] = false;
    if (payload.snapshot && typeof payload.snapshot === "object") {
      setRoomSnapshot(room, payload.snapshot);
    }
    recomputeTurnContract(room);
    emitRoomState(room.code);
  });

  socket.on("match:ready", (payload = {}) => {
    const room = getRoomBySocketId(socket.id);
    if (!room) return;

    const side = getSideForSocket(room, socket.id);
    if (!side) return;

    if (!Number.isInteger(payload.turnNumber)) {
      emitRoomState(room.code);
      return;
    }

    if (isStaleTurnPayload(room, payload)) {
      emitRoomState(room.code);
      return;
    }

    const snapshot = room.match.snapshot || null;
    const sideNeedsStaging = sideNeedsStagingFromSnapshot(side, snapshot);
    const blueNeedsStaging = sideNeedsStagingFromSnapshot("blue", snapshot);
    const blueSatisfied = !!room.match.turn.staged.blue || !blueNeedsStaging;

    if (!room.match.turn.staged[side]) {
      if (side === "red" && !blueSatisfied) {
        emitRoomErrorToSocket(socket.id, "Blue must stage before Red");
        emitRoomState(room.code);
        return;
      }
      if (sideNeedsStaging) {
        emitRoomErrorToSocket(socket.id, "Stage a card before readying");
        emitRoomState(room.code);
        return;
      }
      room.match.turn.staged[side] = true;
    }

    room.match.turn.ready[side] = true;
    recomputeTurnContract(room);
    emitRoomState(room.code);
  });

  socket.on("match:resolve", (payload = {}) => {
    const room = getRoomBySocketId(socket.id);
    if (!room) return;

    const side = getSideForSocket(room, socket.id);
    if (!side) return;

    if (!Number.isInteger(payload.turnNumber)) {
      emitRoomState(room.code);
      return;
    }

    if (isStaleTurnPayload(room, payload)) {
      emitRoomState(room.code);
      return;
    }

    if (side !== "blue") {
      emitRoomErrorToSocket(socket.id, "Only BLUE can resolve the turn");
      emitRoomState(room.code);
      return;
    }

    recomputeTurnContract(room);
    if (!room.match.turn.canResolve) {
      emitRoomErrorToSocket(socket.id, "Both players are not ready");
      emitRoomState(room.code);
      return;
    }

    const resolved = clone(payload.resolved || null);
    if (!resolved || resolved.kind !== "ht54_online_resolve_v1" || !resolved.snapshot) {
      emitRoomErrorToSocket(socket.id, "Missing authoritative resolved payload");
      emitRoomState(room.code);
      return;
    }

    if (resolved.turnNumber !== room.match.turnNumber) {
      emitRoomErrorToSocket(socket.id, "Resolved payload turn mismatch");
      emitRoomState(room.code);
      return;
    }

    const resolvedTurnId = resolved.resolvedTurnId || `resolve_t${room.match.turnNumber}`;
    room.match.lastResolved = {
      kind: "ht54_online_resolve_v1",
      resolvedTurnId,
      turnNumber: room.match.turnNumber,
      snapshot: clone(resolved.snapshot)
    };

    const nextTurnNumber = room.match.turnNumber + 1;
    const nextSnapshot = clone(resolved.snapshot);
    if (nextSnapshot && typeof nextSnapshot === "object") {
      nextSnapshot.turnNumber = nextTurnNumber;
    }
    setRoomSnapshot(room, nextSnapshot);

    room.match.turnNumber = nextTurnNumber;
    resetTurnContract(room);
    emitRoomState(room.code);
  });

  socket.on("disconnect", () => {
    for (const [code, room] of rooms.entries()) {
      const isHost = room.hostSocketId === socket.id;
      const isGuest = room.guestSocketId === socket.id;
      if (!isHost && !isGuest) continue;

      if (isHost) {
        if (room.guestSocketId) emitRoomErrorToSocket(room.guestSocketId, "Host disconnected");
        rooms.delete(code);
      } else {
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
