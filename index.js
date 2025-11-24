const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

app.use(express.static("public"));

// --- Game State ---
let players = [];
let gameStarted = false;
let turnIndex = 0;
let deck = [];
let cardIndex = 0;
let currentKing = null;
let currentQueen = null;
let currentJack = null;
let buddyList = [];
let bombHolderIndex = -1;
// [ใหม่] ชื่อเจ้าของห้อง (ถ้ามีค่า = ห้องถูกสร้างแล้ว)
let roomHostName = null;

const cardData = {
  1: { name: "A - Waterfall (ดื่มคนเดียว)", type: "normal" },
  2: { name: "2 - Duo (เลือกเพื่อน 1 คน)", type: "multi_target", count: 1 },
  3: { name: "3 - Trio (เลือกเพื่อน 2 คน)", type: "multi_target", count: 2 },
  4: { name: "4 - Left (ซ้ายดื่ม)", type: "target_left" },
  5: { name: "5 - All Drink (ดื่มทุกคน)", type: "normal" },
  6: { name: "6 - Right (ขวาดื่ม)", type: "target_right" },
  7: { name: "7 - The Duel (ดวล)", type: "duel" },
  8: { name: "8 - Mate", type: "normal" },
  9: { name: "9 - Mini Games", type: "minigame" },
  10: { name: "10 - Powder (ทาแป้ง)", type: "powder" },
  11: { name: "J - Never Have I Ever", type: "status_j" },
  12: { name: "Q - Question Master", type: "status_q" },
  13: { name: "K - King's Cup", type: "status_k" },
};

function generateDeck() {
  let newDeck = [];
  for (let i = 1; i <= 13; i++) {
    for (let j = 0; j < 4; j++) {
      newDeck.push(i);
    }
  }
  for (let i = newDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
  }
  return newDeck;
}

function getVictims(targetIndex) {
  if (!players[targetIndex]) return { isBuddyEffect: false, names: [] };
  let victims = [players[targetIndex].name];
  if (buddyList.includes(targetIndex)) {
    const buddyNames = buddyList.map((idx) => players[idx].name);
    victims = [...new Set([...victims, ...buddyNames])];
    return { isBuddyEffect: true, names: victims };
  }
  return { isBuddyEffect: false, names: victims };
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // ส่งสถานะห้องปัจจุบันไปให้คนมาใหม่
  socket.emit("roomStatus", {
    roomHostName: roomHostName,
    isGameRunning: gameStarted,
  });

  // ถ้ามีห้องอยู่แล้ว ส่งข้อมูลผู้เล่นไปด้วย
  if (roomHostName) {
    socket.emit("updateLobby", { players, gameStarted });
  }

  if (gameStarted) {
    socket.emit("gameStarted", {
      turnIndex,
      remainingCards: deck.length - cardIndex,
      statusHolders: {
        K: currentKing,
        Q: currentQueen,
        J: currentJack,
        Stars: buddyList.map((i) => players[i].name),
      },
    });
    if (bombHolderIndex !== -1)
      socket.emit("bombStarted", { holderIndex: bombHolderIndex });
  }

  socket.on("createRoom", (names) => {
    // รับชื่อจาก Host แล้วสร้างห้อง
    players = names.map((name) => ({
      name: name,
      id: null,
      ready: false,
      color: getRandomColor(),
      online: true,
    }));
    roomHostName = names[0]; // คนแรกคือ Host เสมอ

    // บอกทุกคนว่ามีห้องแล้ว
    io.emit("roomStatus", { roomHostName: roomHostName, isGameRunning: false });
    io.emit("updateLobby", { players, gameStarted });
  });

  socket.on("selectPlayer", (index) => {
    if (players[index]) {
      players[index].id = socket.id;
      players[index].ready = true;
      players[index].online = true;
      io.emit("updateLobby", { players, gameStarted });
      if (gameStarted) io.emit("updateGameStatus", { players });
    }
  });

  socket.on("hostBackToSetup", () => {
    gameStarted = false;
    const currentNames = players.map((p) => p.name);
    players = [];
    roomHostName = null; // เคลียร์ห้อง
    io.emit("roomStatus", { roomHostName: null, isGameRunning: false });
    io.emit("backToSetup", { names: currentNames });
  });

  socket.on("forceReset", () => {
    gameStarted = false;
    players = [];
    turnIndex = 0;
    deck = generateDeck();
    currentKing = null;
    currentQueen = null;
    currentJack = null;
    buddyList = [];
    roomHostName = null; // เคลียร์ห้อง
    io.emit("roomStatus", { roomHostName: null, isGameRunning: false });
    io.emit("backToSetup", { names: [] });
  });

  socket.on("startGame", () => {
    gameStarted = true;
    turnIndex = 0;
    deck = generateDeck();
    cardIndex = 0;
    currentKing = null;
    currentQueen = null;
    currentJack = null;
    buddyList = [];
    io.emit("gameStarted", {
      turnIndex,
      remainingCards: deck.length,
      statusHolders: { K: null, Q: null, J: null, Stars: [] },
    });
  });

  socket.on("drawCard", () => {
    if (!gameStarted || players[turnIndex].id !== socket.id) return;
    if (cardIndex >= deck.length) {
      io.emit("gameOver");
      return;
    }

    const cardValue = deck[cardIndex];
    cardIndex++;
    const cardInfo = cardData[cardValue];
    const drawer = players[turnIndex];
    let effectData = {};

    if (cardValue === 11) currentJack = drawer.name;
    if (cardValue === 12) currentQueen = drawer.name;
    if (cardValue === 13) currentKing = drawer.name;

    if (cardInfo.type === "multi_target")
      effectData = { type: "multi_select", count: cardInfo.count };
    else if (cardValue === 4) {
      let targetIdx = (turnIndex + 1) % players.length;
      effectData = {
        type: "auto_target",
        targetName: players[targetIdx].name,
        direction: "ซ้าย",
      };
      effectData.victims = getVictims(targetIdx);
    } else if (cardValue === 6) {
      let targetIdx = (turnIndex - 1 + players.length) % players.length;
      effectData = {
        type: "auto_target",
        targetName: players[targetIdx].name,
        direction: "ขวา",
      };
      effectData.victims = getVictims(targetIdx);
    } else if (cardValue === 10) {
      effectData = { type: "self_punish", victims: getVictims(turnIndex) };
    } else if (cardValue === 1) {
      effectData = { type: "self_punish", victims: getVictims(turnIndex) };
    } else if (cardValue === 5) {
      effectData = { type: "all_drink" };
    }

    io.emit("cardResult", {
      cardValue,
      cardInfo,
      drawerName: drawer.name,
      drawerIndex: turnIndex,
      effectData,
      remainingCards: deck.length - cardIndex,
      statusHolders: {
        K: currentKing,
        Q: currentQueen,
        J: currentJack,
        Stars: buddyList.map((i) => players[i].name),
      },
    });
  });

  socket.on("endTurn", () => {
    if (!gameStarted || players[turnIndex].id !== socket.id) return;
    turnIndex = (turnIndex + 1) % players.length;
    io.emit("nextTurn", { turnIndex });
  });

  socket.on("chooseMinigame", (gameName) =>
    io.emit("minigameSelected", { gameName })
  );
  socket.on("punishLoser", (data) => {
    const index = typeof data === "object" ? data.index : data;
    const cause = typeof data === "object" ? data.cause : "แพ้มินิเกม";
    io.emit("showPunishment", { cause: cause, victims: getVictims(index) });
  });
  socket.on("punishMultiple", (indices) => {
    let allNames = [];
    let isBuddyEffect = false;
    indices.forEach((idx) => {
      const result = getVictims(idx);
      allNames.push(...result.names);
      if (result.isBuddyEffect) isBuddyEffect = true;
    });
    allNames = [...new Set(allNames)];
    io.emit("showPunishment", {
      cause: "เพื่อนรักเพื่อนร้าย",
      victims: { isBuddyEffect, names: allNames },
    });
  });
  socket.on("startDuel", (targetIndex) => {
    io.emit("duelStarted", {
      challenger: players[turnIndex].name,
      target: players[targetIndex].name,
    });
  });
  socket.on("resolveDuel", (data) => {
    let msg = "";
    const winnerHadStar = buddyList.includes(data.winnerIndex);
    if (winnerHadStar) {
      buddyList = buddyList.filter((id) => id !== data.winnerIndex);
      msg = "โยนขี้สำเร็จ! ดาวบัดดี้ย้ายไปหาผู้แพ้";
    } else {
      msg = "ผู้แพ้ได้รับดาวบัดดี้!";
    }
    if (!buddyList.includes(data.loserIndex)) buddyList.push(data.loserIndex);
    io.emit("duelResult", {
      winner: players[data.winnerIndex].name,
      loser: players[data.loserIndex].name,
      message: msg,
      statusHolders: {
        K: currentKing,
        Q: currentQueen,
        J: currentJack,
        Stars: buddyList.map((i) => players[i].name),
      },
    });
  });

  socket.on("startBomb", () => {
    bombHolderIndex = turnIndex;
    io.emit("bombStarted", { holderIndex: bombHolderIndex });
    setTimeout(() => {
      if (bombHolderIndex !== -1) {
        io.emit("bombExploded", { loserIndex: bombHolderIndex });
        const result = getVictims(bombHolderIndex);
        io.emit("showPunishment", {
          cause: "💣 โดนระเบิดใส่หน้า!",
          victims: result,
        });
        bombHolderIndex = -1;
      }
    }, 30000);
  });
  socket.on("passBomb", () => {
    if (bombHolderIndex !== -1) {
      bombHolderIndex = (bombHolderIndex + 1) % players.length;
      io.emit("bombUpdate", { holderIndex: bombHolderIndex });
    }
  });

  socket.on("resetGame", () => {
    gameStarted = false;
    turnIndex = 0;
    deck = generateDeck();
    currentKing = null;
    currentQueen = null;
    currentJack = null;
    buddyList = [];
    const currentNames = players.map((p) => p.name);
    players = [];
    roomHostName = null;
    io.emit("roomStatus", { roomHostName: null, isGameRunning: false });
    io.emit("backToSetup", { names: currentNames });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    const player = players.find((p) => p.id === socket.id);
    if (player) {
      player.online = false;
      io.emit("updateLobby", { players, gameStarted });
      if (gameStarted) io.emit("updateGameStatus", { players });
    }
  });
});

function getRandomColor() {
  const colors = [
    "#FF6B6B",
    "#4ECDC4",
    "#FFE66D",
    "#FF9F43",
    "#A8D8EA",
    "#AA96DA",
    "#FCBAD3",
    "#FFFFD2",
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
