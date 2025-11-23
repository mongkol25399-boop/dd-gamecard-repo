const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

app.use(express.static("public"));

// --- ตัวแปรเกม (Game State) ---
let players = []; // { id, name, ready, avatarColor }
let gameStarted = false;
let turnIndex = 0;
let deck = [];
let cardIndex = 0;

// สถานะพิเศษ
let currentKing = null;
let currentQueen = null;
let currentJack = null;
let buddyList = [];

// กติกาไพ่
const cardData = {
  1: { name: "A - Waterfall", type: "normal" },
  2: { name: "2 - You", type: "normal" },
  3: { name: "3 - Me", type: "normal" },
  4: { name: "4 - Left (ซ้ายดื่ม)", type: "target_left" },
  5: { name: "5 - Thumb Master", type: "normal" },
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
  socket.emit("updateLobby", { players, gameStarted });

  socket.on("updatePlayersList", (names) => {
    let newPlayers = names.map((name) => {
      let existing = players.find((p) => p.name === name);
      return {
        name: name,
        id: existing ? existing.id : null,
        ready: existing ? existing.ready : false,
        color: existing ? existing.color : getRandomColor(),
      };
    });
    players = newPlayers;
    io.emit("updateLobby", { players, gameStarted });
  });

  socket.on("selectPlayer", (index) => {
    if (players[index]) {
      players[index].id = socket.id;
      players[index].ready = true;
      io.emit("updateLobby", { players, gameStarted });
    }
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

    if (cardValue === 4) {
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
    }

    io.emit("cardResult", {
      cardValue,
      cardInfo,
      drawerName: drawer.name,
      drawerIndex: turnIndex,
      effectData,
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

  socket.on("punishLoser", (loserIndex) => {
    io.emit("showPunishment", {
      cause: "แพ้มินิเกม",
      victims: getVictims(loserIndex),
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

  socket.on("resetGame", () => {
    gameStarted = false;
    players = [];
    io.emit("resetAll");
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

const PORT = 3000;
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
