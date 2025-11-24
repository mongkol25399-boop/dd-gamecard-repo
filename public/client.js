const socket = io();

// --- Variables ---
let myState = { index: -1, name: "", isHost: false };
let gameState = { turnIndex: 0, players: [] };
let setupNames = [];
let currentCardAction = "draw";

// --- Elements ---
const screens = {
  setup: document.getElementById("setup-screen"),
  lobby: document.getElementById("lobby-screen"),
  game: document.getElementById("game-screen"),
  landing: document.getElementById("landing-screen"),
};
const mainBtn = document.getElementById("main-btn");
const altBtn = document.getElementById("alt-btn");
const cardImg = document.getElementById("main-card-img");
const cardMsg = document.getElementById("card-message");
const deckCount = document.getElementById("deck-count");

// --- Sounds ---
function playSound(id) {
  const audio = document.getElementById(id);
  if (audio) {
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }
}

// --- Navigation ---
function switchScreen(name) {
  Object.values(screens).forEach((s) => s.classList.add("hidden"));
  screens[name].classList.remove("hidden");
}

// ==========================================
// 1. Socket Listeners
// ==========================================

socket.on("connect", () => {
  console.log("Connected!");
  document.getElementById("disconnect-overlay").classList.add("hidden");
});
socket.on("disconnect", () =>
  document.getElementById("disconnect-overlay").classList.remove("hidden")
);

socket.on("roomStatus", (data) => {
  const createArea = document.getElementById("create-room-area");
  const joinArea = document.getElementById("join-room-area");
  const hostNameDisplay = document.getElementById("host-name-display");

  if (screens.landing && !screens.landing.classList.contains("hidden")) {
    if (data.roomHostName) {
      if (createArea) createArea.classList.add("hidden");
      if (joinArea) joinArea.classList.remove("hidden");
      if (hostNameDisplay) hostNameDisplay.innerText = data.roomHostName;
    } else {
      if (createArea) createArea.classList.remove("hidden");
      if (joinArea) joinArea.classList.add("hidden");
    }
  }
});

socket.on("updateLobby", (data) => {
  gameState.players = data.players;

  // Auto Login
  const savedIndex = localStorage.getItem("myPlayerIndex");
  if (savedIndex !== null && myState.index === -1) {
    const idx = parseInt(savedIndex);
    if (gameState.players[idx]) {
      myState.index = idx;
      myState.name = gameState.players[idx].name;
      socket.emit("selectPlayer", idx);
    }
  }

  renderLobby();
  renderInGameList();

  if (data.gameStarted) {
    switchScreen("game");
    const myIdx = data.players.findIndex((p) => p.id === socket.id);
    if (myIdx !== -1) {
      myState.index = myIdx;
      localStorage.setItem("myPlayerIndex", myIdx);
    }
    updateTurnUI();
  } else if (data.players.length > 0) {
    // ถ้าเรามีตัวตนแล้ว หรือเป็น Host ให้ไป Lobby
    if (myState.index !== -1 || myState.isHost) {
      switchScreen("lobby");
    }

    if (data.players[0].id === socket.id) {
      myState.isHost = true;
      if (document.getElementById("host-controls"))
        document.getElementById("host-controls").classList.remove("hidden");
      renderKickList();
    } else {
      myState.isHost = false;
      if (document.getElementById("host-controls"))
        document.getElementById("host-controls").classList.add("hidden");
    }

    const allReady =
      data.players.length > 0 && data.players.every((p) => p.ready);
    const startBtn = document.getElementById("start-btn");
    if (startBtn) {
      startBtn.disabled = !allReady;
      startBtn.className = allReady ? "btn-start active" : "btn-start";
      startBtn.innerText = allReady
        ? "เริ่มเกมเลย!"
        : `รอเพื่อนพร้อม... (${data.players.filter((p) => p.ready).length}/${
            data.players.length
          })`;
      startBtn.onclick = window.startGame;
    }
  } else {
    if (myState.isHost) switchScreen("setup");
    else switchScreen("landing");
  }
});

socket.on("gameStarted", (data) => {
  gameState.turnIndex = data.turnIndex;
  if (deckCount) deckCount.innerText = `ไพ่เหลือ: ${data.remainingCards}`;
  switchScreen("game");
  updateTurnUI();
  playSound("sound-win");
});

socket.on("restoreTurn", (data) => {
  displayCard(data, false);
}); // false = ไม่ต้องหมุน (แค่โชว์)

socket.on("nextTurn", (data) => {
  gameState.turnIndex = data.turnIndex;
  closeOverlay();
  // Reset Card Back
  if (cardImg) {
    cardImg.style.transform = "rotateY(0deg)";
    cardImg.src = "assets/back.png";
  }
  updateTurnUI();
});

socket.on("cardResult", (data) => {
  displayCard(data, true); // true = หมุนไพ่
  handleCardEffect(data);
});

// [ฟังก์ชันแสดงไพ่ - แก้ไขใหม่]
function displayCard(data, animate = true) {
  if (animate && cardImg) {
    // 1. หมุนปิด (90 deg)
    cardImg.style.transform = "rotateY(90deg)";

    // 2. รอ 200ms แล้วเปลี่ยนรูป + หมุนเปิด (0 deg)
    setTimeout(() => {
      cardImg.src = `assets/${data.cardValue}.png`; // เช็คชื่อไฟล์ตรงนี้ (1.png, 2.png...)
      cardImg.style.transform = "rotateY(0deg)";
    }, 200);
    playSound("sound-draw");
  } else if (cardImg) {
    // กรณี Restore (คนหลุดกลับมา) ไม่ต้องหมุน
    cardImg.src = `assets/${data.cardValue}.png`;
    cardImg.style.transform = "rotateY(0deg)";
  }

  if (deckCount) deckCount.innerText = `ไพ่เหลือ: ${data.remainingCards}`;
  renderInGameList(data.statusHolders);
  if (cardMsg) cardMsg.classList.add("hidden");

  if (myState.index === data.drawerIndex) {
    updateMainBtnAsNext();
    if (data.cardValue === 7 || data.cardValue === 10)
      altBtn.classList.remove("hidden");
    else altBtn.classList.add("hidden");
  } else {
    updateMainBtnAsWait(data.drawerName);
    altBtn.classList.add("hidden");
  }
}

socket.on("showPunishment", (data) => {
  let html = "";
  const iAmVictim = data.victims.names.includes(myState.name);
  const isDrawer = gameState.turnIndex === myState.index;
  const isGroupBadLuck =
    data.victims.names.length > 1 && data.victims.isBuddyEffect;

  let title = "บทลงโทษ";
  let msgColor = "white";
  let actionText = "ดื่มซะ! 🍺";

  if (data.cause.includes("แป้ง")) {
    actionText = "ทาแป้งซะ! 🤡";
    msgColor = "#fab1a0";
  }
  if (isGroupBadLuck) title = "💀 ซวยหมู่! (แก๊งบัดดี้)";

  let btnHtml = `<button class="btn-primary" style="margin-top:20px;" onclick="closeOverlay()">ปิด</button>`;
  if (isDrawer)
    btnHtml = `<button class="btn-primary" style="margin-top:20px; background:#00b894;" onclick="endTurnAndClose()">✅ เรียบร้อย / จบเทิร์น</button>`;

  html = `
        <h1 style="color:#ff7675; font-size:2.5rem;">${title}</h1>
        <h3 style="color:#aaa; margin:10px 0;">${data.cause}</h3>
        <div style="background:rgba(255,255,255,0.1); padding:10px; border-radius:10px;">
            <h2 style="color:#ffeaa7;">รายชื่อผู้โชคร้าย</h2>
            <p style="font-size:1.2rem; line-height:1.5;">${data.victims.names.join(
              "<br>"
            )}</p>
        </div>
        <h1 style="font-size:3rem; margin-top:15px; color:${msgColor};">${actionText}</h1>
        ${btnHtml}
    `;

  if (iAmVictim) {
    document.body.classList.add("alert-mode");
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    playSound("sound-alert");
  }
  showOverlay("Alert", html);
  setTimeout(() => document.body.classList.remove("alert-mode"), 3000);
});

socket.on("minigameSelected", (data) => {
  let html = `<h1 style="color:#00b894; font-size:2rem;">🎮 ${data.gameName}</h1><p style="font-size:1.1rem; margin:15px 0;">เล่นกันเองในวง... ใครแพ้?</p>`;
  showOverlay("Minigame", html);
  if (gameState.turnIndex === myState.index) {
    updateMainBtn("เลือกคนแพ้", true, "pick_loser");
  }
});

socket.on("duelStarted", (data) => {
  closeOverlay();
  let html = `<h1 style="color:#fab1a0;">⚔️ ดวลเดือด!</h1><h2 style="font-size:2rem; margin:10px 0;">${data.challenger}<br>VS<br>${data.target}</h2><p>แข่งมินิเกมกันเดี๋ยวนี้!</p>`;
  if (gameState.turnIndex === myState.index) {
    html += `<hr style="border-color:#555; margin:15px 0;"><p>ผลเป็นยังไง?</p>
            <button class="btn-primary" style="background:#00b894; margin-bottom:10px;" onclick="socket.emit('resolveDuel', {winnerIndex: myState.index, loserIndex: ${gameState.players.findIndex(
              (p) => p.name === data.target
            )}})">😎 ฉันชนะ!</button>
            <button class="btn-primary" style="background:#d63031;" onclick="socket.emit('resolveDuel', {winnerIndex: ${gameState.players.findIndex(
              (p) => p.name === data.target
            )}, loserIndex: myState.index})">😭 ฉันแพ้...</button>`;
  } else {
    html += `<p style="color:#aaa;">(รอเพื่อนแข่งกัน...)</p>`;
  }
  showOverlay("Duel", html);
});

socket.on("duelResult", (data) => {
  closeOverlay();
  let emotion = "";
  if (data.winner === myState.name) {
    emotion = "เย้! คุณชนะ 🎉";
    playSound("sound-win");
    fireConfetti();
  } else if (data.loser === myState.name) {
    emotion = "แง! คุณแพ้ (ยินดีต้อนรับสู่แก๊งบัดดี้) 😭";
    document.body.classList.add("alert-mode");
    setTimeout(() => document.body.classList.remove("alert-mode"), 2000);
  } else {
    emotion = `${data.winner} ชนะ!`;
  }
  let html = `<h1 style="color:#55efc4;">${emotion}</h1><p style="font-size:1.2rem;">${data.message}</p>`;
  showOverlay("Result", html);
  setTimeout(closeOverlay, 3000);
  renderInGameList(data.statusHolders);
});

socket.on("bombStarted", (data) => {
  document.getElementById("bomb-overlay").classList.remove("hidden");
  updateBombUI(data.holderIndex);
});
socket.on("bombUpdate", (data) => {
  updateBombUI(data.holderIndex);
});
socket.on("bombExploded", (data) => {
  document.getElementById("bomb-overlay").classList.add("hidden");
  playSound("sound-alert");
});
function updateBombUI(holderIndex) {
  const holderName = gameState.players[holderIndex].name;
  document.getElementById(
    "bomb-status"
  ).innerText = `ระเบิดอยู่ที่: ${holderName}`;
  const btn = document.getElementById("pass-bomb-btn");
  if (holderIndex === myState.index) {
    document.body.classList.add("alert-mode");
    btn.classList.remove("hidden");
  } else {
    document.body.classList.remove("alert-mode");
    btn.classList.add("hidden");
  }
}
window.passBomb = () => {
  socket.emit("passBomb");
};

socket.on("backToSetup", (d) => {
  localStorage.removeItem("myPlayerIndex");
  closeOverlay();
  setupNames = d.names || [];
  renderSetupList();
  switchScreen("landing");
});
socket.on("gameOver", () => {
  showOverlay("GAME OVER", "<h1>ไพ่หมด!</h1>");
  if (myState.isHost)
    document.getElementById(
      "overlay-body"
    ).innerHTML += `<br><button class="btn-primary" onclick="socket.emit('resetGame')">กลับสู่ล็อบบี้</button>`;
});
socket.on("resetAll", () => {
  localStorage.removeItem("myPlayerIndex");
  location.reload();
});

// --- Functions ---
function updateTurnUI() {
  if (myState.index === -1) {
    const foundIdx = gameState.players.findIndex((p) => p.id === socket.id);
    if (foundIdx !== -1) myState.index = foundIdx;
  }
  const currentPlayer = gameState.players[gameState.turnIndex];
  if (currentPlayer) {
    const turnNameEl = document.getElementById("current-turn-name");
    if (turnNameEl) turnNameEl.innerText = `ตาของ: ${currentPlayer.name}`;
    if (gameState.turnIndex === myState.index) {
      currentCardAction = "draw";
      updateMainBtn("จั่วไพ่", true);
    } else {
      updateMainBtn(`รอ ${currentPlayer.name}`, false);
    }
  }
}

function updateMainBtn(text, active, action) {
  if (!mainBtn) return;
  mainBtn.innerText = text;
  if (active) {
    mainBtn.className = "my-turn";
    mainBtn.style.pointerEvents = "auto";
    if (action) currentCardAction = action;
  } else {
    mainBtn.className = "disabled";
    mainBtn.style.pointerEvents = "none";
  }
}
function updateMainBtnAsNext() {
  updateMainBtn("จบเทิร์น\nถัดไป", true, "next");
}
function updateMainBtnAsWait(name) {
  updateMainBtn(`ตาของ\n${name}`, false, "");
}

function handleEnter(e) {
  if (e.key === "Enter") addNameToList();
}
function addNameToList() {
  const n = document.getElementById("new-player-name");
  if (n.value.trim()) {
    setupNames.push(n.value.trim());
    n.value = "";
    renderSetupList();
  }
}
function removeName(i) {
  setupNames.splice(i, 1);
  renderSetupList();
}
function renderSetupList() {
  const l = document.getElementById("setup-list");
  if (l) {
    l.innerHTML = "";
    setupNames.forEach(
      (n, i) =>
        (l.innerHTML += `<div class="setup-item"><span>${
          i + 1
        }. ${n}</span><button class="btn-del" onclick="removeName(${i})">X</button></div>`)
    );
  }
}

window.setupGame = function () {
  const input = document.getElementById("new-player-name");
  if (input && input.value.trim() !== "") addNameToList();
  if (setupNames.length > 0) {
    localStorage.removeItem("myPlayerIndex");
    socket.emit("createRoom", setupNames);
    switchScreen("lobby");
  } else {
    alert("เพิ่มรายชื่อเพื่อนก่อนครับ");
  }
};

window.goToSetup = () => switchScreen("setup");
window.joinRoom = () => switchScreen("lobby");
window.backToLanding = () => switchScreen("landing");
window.startGame = () => {
  if (socket.connected) {
    socket.emit("startGame");
  } else {
    alert("Connection Lost!");
  }
};

function renderLobby() {
  const list = document.getElementById("lobby-list");
  if (list) {
    list.innerHTML = "";
    gameState.players.forEach((p, idx) => {
      const btn = document.createElement("button");
      btn.className = `lobby-btn ${p.ready ? "ready" : ""}`;
      btn.style.borderLeft = `5px solid ${p.color}`;
      const isMe = myState.index === idx;
      btn.innerHTML = `<span>${p.name} ${isMe ? "(คุณ)" : ""}</span> <span>${
        p.ready ? "✅ พร้อม" : "(ว่าง)"
      }</span>`;
      if (isMe) btn.classList.add("ready");
      if (!p.ready && myState.index === -1) {
        btn.onclick = () => {
          myState.index = idx;
          myState.name = p.name;
          localStorage.setItem("myPlayerIndex", idx);
          socket.emit("selectPlayer", idx);
        };
      } else {
        btn.disabled = true;
      }
      list.appendChild(btn);
    });
  }
}
function renderKickList() {
  const container = document.getElementById("kick-container");
  if (!container) return;
  container.innerHTML = "";
  gameState.players.forEach((p, idx) => {
    const div = document.createElement("div");
    div.style.cssText =
      "display:flex; justify-content:space-between; padding:5px; border-bottom:1px solid #444;";
    div.innerHTML = `<span>${p.name}</span> <button style="padding:5px; font-size:0.8rem; background:#d63031; color:white; width:auto;" onclick="kickPlayer('${p.name}')">ลบ</button>`;
    container.appendChild(div);
  });
}
function renderInGameList(statusHolders) {
  const list = document.getElementById("in-game-list");
  if (!list) return;
  list.innerHTML = "";
  gameState.players.forEach((p, idx) => {
    let badges = "";
    if (statusHolders) {
      if (statusHolders.K === p.name)
        badges += `<span class="badge badge-k">K</span>`;
      if (statusHolders.Q === p.name)
        badges += `<span class="badge badge-q">Q</span>`;
      if (statusHolders.J === p.name)
        badges += `<span class="badge badge-j">J</span>`;
      if (statusHolders.Stars.includes(p.name))
        badges += `<span class="badge badge-star">⭐</span>`;
    }
    const isCurrent = idx === gameState.turnIndex;
    const row = document.createElement("div");
    if (!p.online) row.className = "player-row offline";
    else row.className = "player-row";
    row.style.backgroundColor = isCurrent ? "#2d3436" : "transparent";
    row.style.borderLeft = `5px solid ${p.color}`;
    row.innerHTML = `<div class="player-name" style="${
      isCurrent ? "color:#fdcb6e; font-weight:bold;" : ""
    }">${p.name} ${badges}</div>`;
    list.appendChild(row);
  });
}

function handleMainAction() {
  playSound("sound-click");
  if (currentCardAction === "draw") socket.emit("drawCard");
  else if (currentCardAction === "next") socket.emit("endTurn");
  else if (currentCardAction === "pick_loser")
    showPlayerSelector("เลือกคนแพ้", (targetIdx) => {
      socket.emit("punishLoser", targetIdx);
    });
}
window.endTurnAndClose = () => {
  socket.emit("endTurn");
  closeOverlay();
};
function handleCardEffect(data) {
  if (
    data.effectData.type === "auto_target" ||
    data.effectData.type === "self_punish"
  ) {
    setTimeout(() => {
      let causeText = "ทำโทษ";
      if (data.cardValue === 10) causeText = "โดนทาแป้ง";
      if (data.cardValue === 4) causeText = "เพื่อนทางขวาส่งมา (ซ้ายดื่ม)";
      if (data.cardValue === 6) causeText = "เพื่อนทางซ้ายส่งมา (ขวาดื่ม)";
      if (data.cardValue === 1) causeText = "ดื่มคนเดียว เหงาๆ";
      socket.emit("punishLoser", {
        index:
          data.effectData.type === "self_punish"
            ? data.drawerIndex
            : gameState.players.findIndex(
                (p) => p.name === data.effectData.targetName
              ),
        cause: causeText,
      });
    }, 2000);
  }
  if (
    data.effectData.type === "multi_select" &&
    myState.index === data.drawerIndex
  ) {
    showMultiPlayerSelector(data.effectData.count);
  }
  if (data.cardValue === 9 && myState.index === data.drawerIndex) {
    showMinigameSelector();
  }
  if (data.cardValue === 7 && myState.index === data.drawerIndex) {
    showPlayerSelector("เลือกคู่ดวล", (idx) => socket.emit("startDuel", idx));
  }
  if (data.effectData.type === "all_drink") {
    setTimeout(() => {
      showOverlay(
        "ปาร์ตี้!",
        `<h1 style="font-size:3rem; color:#ffeaa7;">ดื่มทุกคน</h1><br><h1 style="font-size:4rem; color:white;">เอา ชน !!!!! 🍻</h1><br><button class="btn-primary" onclick="closeOverlay()">จัดไป!</button>`
      );
      playSound("sound-alert");
      if (navigator.vibrate) navigator.vibrate(200);
    }, 1000);
  }
}
function showMultiPlayerSelector(count) {
  let html = `<p style="color:#aaa;">คุณซวยแล้ว! หาเพื่อนซวยด้วยอีก ${count} คน</p><form id="multi-select-form">`;
  gameState.players.forEach((p, idx) => {
    if (idx === myState.index)
      html += `<div style="background:#333; padding:10px; border-radius:5px; margin:5px 0; opacity:0.6;"><input type="checkbox" checked disabled> ${p.name} (คุณ)</div>`;
    else
      html += `<div style="background:#444; padding:10px; border-radius:5px; margin:5px 0;"><input type="checkbox" name="victim" value="${idx}" id="cb-${idx}"><label for="cb-${idx}" style="color:white; margin-left:10px; cursor:pointer;">${p.name}</label></div>`;
  });
  html += `</form><button class="btn-primary" onclick="submitMultiSelect(${count})">ยืนยันเลือกเพื่อน</button>`;
  showOverlay(`หาเพื่อนร่วมวง (${count} คน)`, html);
}
window.submitMultiSelect = (requiredCount) => {
  const checkboxes = document.querySelectorAll('input[name="victim"]:checked');
  if (checkboxes.length !== requiredCount) {
    alert(`ต้องเลือกเพื่อนให้ครบ ${requiredCount} คนนะ!`);
    return;
  }
  let selectedIndices = [myState.index];
  checkboxes.forEach((cb) => selectedIndices.push(parseInt(cb.value)));
  closeOverlay();
  socket.emit("punishMultiple", selectedIndices);
};
function showMinigameSelector() {
  const games = [
    "1. แพะร้องแบะ",
    "2. หมวดหมู่ห้ามซ้ำ",
    "3. เลขอันตราย",
    "4. สุ่มโหวต",
    "5. ท่องจำ",
    "6. แข่งนับ",
    "7. จังหวัด",
    "8. ระเบิดเวลา 💣",
  ];
  let h = `<h3>เลือกเกม</h3><div class="game-grid">`;
  games.forEach((g) => {
    let action = `onclick="selectGame('${g}')"`;
    if (g.includes("ระเบิด")) action = `onclick="startBombGame()"`;
    else if (g.includes("หมวดหมู่"))
      action = `onclick="showCategorySelector('${g}')"`;
    else if (g.includes("โหวต")) action = `onclick="startVoteGame()"`;
    h += `<button class="game-choice-btn" ${action}>${g}</button>`;
  });
  h += `</div>`;
  showOverlay("เลือกมินิเกม", h);
}
function showCategorySelector(gameTitle) {
  const categories = [
    "สัตว์",
    "ผลไม้",
    "อาหาร",
    "เครื่องแต่งกาย",
    "ร่างกาย",
    "อาชีพ",
    "ชื่อคน",
    "เครื่องใช้ไฟฟ้า",
    "ประเทศ",
    "การ์ตูน",
    "ของใช้ในบ้าน",
    "กีฬา",
    "แบรนด์ดัง",
    "ของในครัว",
    "ของในห้องน้ำ",
    "ก.ไก่",
    "ยี่ห้อรถ",
    "ชื่อหนัง",
  ];
  let html = `<h3>หัวข้อ: ${gameTitle}</h3><div style="display:grid; grid-template-columns: 1fr 1fr; gap:5px;">`;
  categories.forEach(
    (c) =>
      (html += `<button class="game-choice-btn" style="font-size:0.8rem" onclick="selectGame('${gameTitle}: ${c}')">${c}</button>`)
  );
  html += `</div><button class="game-choice-btn" style="margin-top:10px; background:#e17055" onclick="selectGame('${gameTitle}: ตั้งเอง')">ตั้งหมวดเอง</button>`;
  showOverlay("เลือกหมวดหมู่", html);
}
window.startBombGame = () => {
  socket.emit("startBomb");
  closeOverlay();
};
window.startVoteGame = () => selectGame("4. สุ่มโหวตคนดวงซวย");
window.selectGame = (gameName) => socket.emit("chooseMinigame", gameName);
window.requestMinigameMode = () => {
  if (confirm("เปลี่ยนเป็นมินิเกม?")) {
    showMinigameSelector();
    altBtn.classList.add("hidden");
  }
};
function showPlayerSelector(title, callback) {
  let html = "";
  gameState.players.forEach((p, idx) => {
    if (idx !== myState.index)
      html += `<button class="game-choice-btn" onclick="window.resolveSelection(${idx})">${p.name}</button>`;
  });
  window.resolveSelection = (idx) => {
    callback(idx);
    closeOverlay();
  };
  showOverlay(title, html);
}
window.sendDuelResult = (iWon) => {
  if (!confirm(iWon ? "ยืนยันชนะ?" : "ยืนยันแพ้?")) return;
  closeOverlay();
  if (iWon)
    showPlayerSelector("จิ้มคนแพ้ (คู่ดวล)", (loserIdx) => {
      socket.emit("resolveDuel", {
        winnerIndex: myState.index,
        loserIndex: loserIdx,
      });
      finishAction();
    });
  else
    showPlayerSelector("จิ้มคนชนะ", (winnerIdx) => {
      socket.emit("resolveDuel", {
        winnerIndex: winnerIdx,
        loserIndex: myState.index,
      });
      finishAction();
    });
};
window.kickPlayer = (name) => {
  if (confirm(`จะลบ ${name} ออกจากเกมจริงไหม?`))
    alert("ตอนนี้ให้ใช้วิธีกดปุ่ม ⬅️ กลับไปแก้รายชื่อ แทนนะครับ");
};
window.goBackToSetup = () => {
  if (
    confirm("ต้องการกลับไปแก้ไขรายชื่อผู้เล่น? (สถานะความพร้อมจะถูกรีเซ็ต)")
  ) {
    socket.emit("hostBackToSetup");
  }
};
window.forceResetGame = () => {
  let content = `<h2 style="color:#ff7675; font-size:1.5rem;">⚠️ อันตราย! ⚠️</h2><p style="font-size:1.1rem; margin:15px 0;">คุณกำลังจะล้างห้องและเตะทุกคนออก<br>เพื่อเริ่มเกมใหม่ทั้งหมด</p><div style="margin-top:20px; display:flex; flex-direction:column; gap:10px;"><button class="btn-primary" style="background:#d63031; border:2px solid white;" onclick="confirmReset()">✅ ยืนยัน ล้างห้องเดี๋ยวนี้!</button><button class="btn-primary" style="background:#636e72; border:1px solid #999;" onclick="closeOverlay()">❌ ยกเลิก</button></div>`;
  showOverlay("ยืนยันการล้างห้อง?", content);
};
window.confirmReset = () => {
  closeOverlay();
  socket.emit("forceReset");
};
window.toggleSettings = () => {
  if (myState.isHost && confirm("กลับไปหน้าตั้งค่า? (เกมจะหยุด)"))
    switchScreen("lobby");
};
function flipCardAnimation(cardValue) {
  if (cardImg) {
    cardImg.style.transform = "rotateY(90deg)";
    setTimeout(() => {
      cardImg.src = `assets/${cardValue}.png`;
      cardImg.style.transform = "rotateY(0deg)";
    }, 200);
  }
}
function fireConfetti() {
  if (typeof confetti === "function") {
    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
  }
}
function showOverlay(title, content) {
  document.getElementById("overlay-title").innerText = title;
  document.getElementById("overlay-body").innerHTML = content;
  document.getElementById("overlay").classList.remove("hidden");
}
function closeOverlay() {
  document.getElementById("overlay").classList.add("hidden");
}
