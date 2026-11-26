import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Firebase 初始化
const firebaseConfig = {
  apiKey: "AIzaSyCRzDPxdwDLNnGRCl2R9k0Gasjn9D--pnc",
  authDomain: "gaming-54198.firebaseapp.com",
  projectId: "gaming-54198",
  storageBucket: "gaming-54198.firebasestorage.app",
  messagingSenderId: "862115979383",
  appId: "1:862115979383:web:89620e2bbe81e89dfba672"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const ROOMS_COLLECTION = "tictactoe_rooms";

// 角色主題庫
const THEMES = [
  { name: "貓狗大戰", p1: "🐱", p2: "🐶" },
  { name: "甜點派對", p1: "🍩", p2: "🍓" },
  { name: "恐龍時代", p1: "🦖", p2: "🦕" }
];

const WIN_PATTERNS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

// 遊戲狀態
let gameMode = "ai"; // "ai" | "local" | "online"
let board = Array(9).fill("");
let currentPlayer = "p1";
let isGameActive = true;
let themeIndex = 0;
let soundEnabled = true;
let aiTimer = null;
let scores = { p1: 0, p2: 0, draw: 0 };

// 線上對戰專用狀態
let roomId = null;
let myRole = null; // "p1" | "p2"
let p2Joined = false;
let unsubscribeRoom = null;
let currentRoundId = 1;
let lastRenderedBoard = Array(9).fill("");

// DOM 元素
const cells = document.querySelectorAll(".cell");
const statusText = document.getElementById("status-text");
const modeBtn = document.getElementById("mode-btn");
const onlineToggleBtn = document.getElementById("online-toggle-btn");
const onlinePanel = document.getElementById("online-panel");
const lobbyControls = document.getElementById("lobby-controls");
const roomInfo = document.getElementById("room-info");
const createRoomBtn = document.getElementById("create-room-btn");
const joinRoomBtn = document.getElementById("join-room-btn");
const roomInput = document.getElementById("room-input");
const displayRoomId = document.getElementById("display-room-id");
const myRoleBadge = document.getElementById("my-role-badge");
const copyLinkBtn = document.getElementById("copy-link-btn");
const leaveRoomBtn = document.getElementById("leave-room-btn");

const themeBtn = document.getElementById("theme-btn");
const soundBtn = document.getElementById("sound-btn");
const restartBtn = document.getElementById("restart-btn");
const resetScoreBtn = document.getElementById("reset-score-btn");

const cardP1 = document.getElementById("card-p1");
const cardP2 = document.getElementById("card-p2");
const avatarP1 = document.getElementById("avatar-p1");
const avatarP2 = document.getElementById("avatar-p2");
const nameP1 = document.getElementById("name-p1");
const nameP2 = document.getElementById("name-p2");

const scoreP1El = document.getElementById("score-p1");
const scoreP2El = document.getElementById("score-p2");
const scoreDrawEl = document.getElementById("score-draw");

// Web Audio 趣味音效合成器
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type) {
  if (!soundEnabled) return;
  if (audioCtx.state === "suspended") audioCtx.resume();

  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  if (type === "pop1") {
    osc.type = "sine";
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(680, now + 0.12);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
    osc.start(now);
    osc.stop(now + 0.12);
  } else if (type === "pop2") {
    osc.type = "triangle";
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.12);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
    osc.start(now);
    osc.stop(now + 0.12);
  } else if (type === "win") {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "triangle";
      o.connect(g);
      g.connect(audioCtx.destination);
      o.frequency.setValueAtTime(freq, now + i * 0.1);
      g.gain.setValueAtTime(0.2, now + i * 0.1);
      g.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.25);
      o.start(now + i * 0.1);
      o.stop(now + i * 0.1 + 0.25);
    });
  } else if (type === "draw") {
    osc.type = "sine";
    osc.frequency.setValueAtTime(350, now);
    osc.frequency.linearRampToValueAtTime(260, now + 0.25);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
    osc.start(now);
    osc.stop(now + 0.25);
  }
}

function getIcon(player) {
  return THEMES[themeIndex][player];
}

// 更新整體畫面
function updateUI() {
  const theme = THEMES[themeIndex];
  avatarP1.textContent = theme.p1;
  avatarP2.textContent = theme.p2;
  themeBtn.textContent = `🎨 ${theme.name}`;

  if (gameMode === "online") {
    nameP1.textContent = myRole === "p1" ? "你 (房主)" : "房主";
    nameP2.textContent = myRole === "p2" ? "你 (挑戰者)" : (p2Joined ? "挑戰者" : "等待加入...");
    if (myRole) {
      myRoleBadge.textContent = myRole === "p1"
        ? `你是 ${theme.p1} 房主`
        : `你是 ${theme.p2} 挑戰者`;
    }
  } else {
    nameP1.textContent = "玩家 1";
    nameP2.textContent = gameMode === "ai" ? "小電腦" : "玩家 2";
  }

  scoreP1El.textContent = scores.p1;
  scoreP2El.textContent = scores.p2;
  scoreDrawEl.textContent = scores.draw;

  cells.forEach((cell, idx) => {
    const val = board[idx];
    cell.textContent = val ? getIcon(val) : "";
    const lockedByTurn = gameMode === "online" && (!roomId || !p2Joined || currentPlayer !== myRole);
    cell.disabled = !isGameActive || val !== "" || lockedByTurn;
  });

  const canHighlightTurn = isGameActive && (gameMode !== "online" || (roomId && p2Joined));
  cardP1.classList.toggle("active", canHighlightTurn && currentPlayer === "p1");
  cardP2.classList.toggle("active", canHighlightTurn && currentPlayer === "p2");
}

// 檢查連線
function checkWinner(targetBoard, player) {
  return WIN_PATTERNS.find(combo =>
    combo.every(index => targetBoard[index] === player)
  ) || null;
}

// --- 線上 Firestore 房間邏輯 ---

function generateRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function createOnlineRoom() {
  createRoomBtn.disabled = true;
  createRoomBtn.textContent = "建立中...";

  try {
    let newCode = generateRoomCode();
    let roomRef = doc(db, ROOMS_COLLECTION, newCode);
    let snap = await getDoc(roomRef);

    // 若房號剛好存在則重抽一次
    if (snap.exists()) {
      newCode = generateRoomCode();
      roomRef = doc(db, ROOMS_COLLECTION, newCode);
    }

    const initialData = {
      board: Array(9).fill(""),
      currentPlayer: "p1",
      themeIndex,
      scores: { p1: 0, p2: 0, draw: 0 },
      p2Joined: false,
      roundId: 1,
      updatedAt: serverTimestamp()
    };

    await setDoc(roomRef, initialData);
    enterRoom(newCode, "p1");
  } catch (err) {
    console.error("建立房間失敗：", err);
    alert("建立房間失敗，請確認 Firestore 權限規則是否已開啟讀寫！");
  } finally {
    createRoomBtn.disabled = false;
    createRoomBtn.textContent = "🏠 建立房間";
  }
}

async function joinOnlineRoom(targetCode) {
  const cleanCode = targetCode.trim();
  if (!/^\d{4}$/.test(cleanCode)) {
    alert("請輸入 4 位數字房號喔！");
    return;
  }

  joinRoomBtn.disabled = true;
  joinRoomBtn.textContent = "加入中...";

  try {
    const roomRef = doc(db, ROOMS_COLLECTION, cleanCode);
    const snap = await getDoc(roomRef);

    if (!snap.exists()) {
      alert(`找不到 ${cleanCode} 號房間，請確認房號是否正確！`);
      return;
    }

    const data = snap.data();
    // 判斷是否為自己原本開的房（透過 sessionStorage 記憶）
    const savedRole = sessionStorage.getItem(`ttt_role_${cleanCode}`);
    let assignedRole = "p2";

    if (savedRole === "p1") {
      assignedRole = "p1";
    } else if (!data.p2Joined) {
      await updateDoc(roomRef, {
        p2Joined: true,
        updatedAt: serverTimestamp()
      });
      assignedRole = "p2";
    } else if (savedRole === "p2") {
      assignedRole = "p2";
    } else {
      alert("這間房間已經有兩位小朋友在對戰囉！請換一間或自己建立新房間。");
      return;
    }

    enterRoom(cleanCode, assignedRole);
  } catch (err) {
    console.error("加入房間失敗：", err);
    alert("加入房間失敗，請檢查網路或 Firestore 設定！");
  } finally {
    joinRoomBtn.disabled = false;
    joinRoomBtn.textContent = "加入";
  }
}

function enterRoom(code, role) {
  if (unsubscribeRoom) unsubscribeRoom();

  gameMode = "online";
  roomId = code;
  myRole = role;
  sessionStorage.setItem(`ttt_role_${code}`, role);

  // 更新網址參數方便分享
  const url = new URL(window.location.href);
  url.searchParams.set("room", code);
  window.history.replaceState({}, "", url);

  onlinePanel.classList.remove("hidden");
  onlineToggleBtn.classList.add("active-mode");
  lobbyControls.classList.add("hidden");
  roomInfo.classList.remove("hidden");
  displayRoomId.textContent = code;

  const roomRef = doc(db, ROOMS_COLLECTION, code);
  unsubscribeRoom = onSnapshot(roomRef, (snapshot) => {
    if (!snapshot.exists()) return;
    syncFromFirestore(snapshot.data());
  });
}

function syncFromFirestore(data) {
  const newBoard = data.board || Array(9).fill("");
  const newRoundId = data.roundId || 1;
  const isNewRound = newRoundId !== currentRoundId;

  // 偵測新落子以播放音效與彈出動畫
  let movedIdx = -1;
  if (!isNewRound) {
    for (let i = 0; i < 9; i++) {
      if (lastRenderedBoard[i] === "" && newBoard[i] !== "") {
        movedIdx = i;
        break;
      }
    }
  }

  board = [...newBoard];
  lastRenderedBoard = [...newBoard];
  currentPlayer = data.currentPlayer || "p1";
  themeIndex = data.themeIndex ?? 0;
  scores = data.scores || { p1: 0, p2: 0, draw: 0 };
  p2Joined = Boolean(data.p2Joined);
  currentRoundId = newRoundId;

  // 清除舊特效
  statusText.classList.remove("win", "waiting");
  cells.forEach(c => c.classList.remove("win-cell"));

  if (isNewRound) {
    stopConfetti();
    cells.forEach(c => c.classList.remove("pop"));
  }

  if (movedIdx !== -1) {
    const movedPlayer = board[movedIdx];
    cells[movedIdx].classList.add("pop");
    playSound(movedPlayer === "p1" ? "pop1" : "pop2");
  }

  // 判斷勝負狀態
  const winP1 = checkWinner(board, "p1");
  const winP2 = checkWinner(board, "p2");
  const winCombo = winP1 || winP2;
  const winner = winP1 ? "p1" : (winP2 ? "p2" : null);

  if (winner) {
    isGameActive = false;
    winCombo.forEach(idx => cells[idx].classList.add("win-cell"));
    const isMe = winner === myRole;
    statusText.textContent = isMe
      ? `🎉 太棒了！你 (${getIcon(winner)}) 贏了！`
      : `👏 ${getIcon(winner)} 對手贏了！再挑戰一局吧！`;
    statusText.classList.add("win");
    if (movedIdx !== -1) {
      playSound("win");
      launchConfetti();
    }
  } else if (board.every(cell => cell !== "")) {
    isGameActive = false;
    statusText.textContent = "🤝 哇！勢均力敵，平手！";
    if (movedIdx !== -1) playSound("draw");
  } else {
    isGameActive = true;
    stopConfetti();

    if (!p2Joined) {
      statusText.textContent = `⏳ 等待對手加入房間（房號 ${roomId}）...`;
      statusText.classList.add("waiting");
    } else if (currentPlayer === myRole) {
      statusText.textContent = `✨ 輪到你 (${getIcon(myRole)}) 囉！快選一格！`;
    } else {
      statusText.textContent = `👀 換對手 (${getIcon(currentPlayer)}) 思考中...`;
    }
  }

  updateUI();
}

async function leaveOnlineRoom() {
  if (unsubscribeRoom) {
    unsubscribeRoom();
    unsubscribeRoom = null;
  }
  roomId = null;
  myRole = null;
  p2Joined = false;
  lastRenderedBoard = Array(9).fill("");

  const url = new URL(window.location.href);
  url.searchParams.delete("room");
  window.history.replaceState({}, "", url);

  roomInfo.classList.add("hidden");
  lobbyControls.classList.remove("hidden");
  switchToOfflineMode("ai");
}

// --- 玩家點擊與下棋邏輯 ---

function handleCellClick(e) {
  const idx = Number(e.target.dataset.index);
  if (!isGameActive || board[idx] !== "") return;

  if (gameMode === "online") {
    if (!roomId || !p2Joined || currentPlayer !== myRole) return;
    makeOnlineMove(idx);
  } else {
    if (gameMode === "ai" && currentPlayer === "p2") return;
    makeLocalMove(idx, currentPlayer);
  }
}

async function makeOnlineMove(idx) {
  const nextBoard = [...board];
  nextBoard[idx] = myRole;

  const winCombo = checkWinner(nextBoard, myRole);
  const isDraw = !winCombo && nextBoard.every(cell => cell !== "");
  const nextScores = { ...scores };

  if (winCombo) {
    nextScores[myRole] += 1;
  } else if (isDraw) {
    nextScores.draw += 1;
  }

  const nextPlayer = myRole === "p1" ? "p2" : "p1";

  // 先在本地更新避免連點
  isGameActive = false;
  updateUI();

  const roomRef = doc(db, ROOMS_COLLECTION, roomId);
  await updateDoc(roomRef, {
    board: nextBoard,
    currentPlayer: nextPlayer,
    scores: nextScores,
    updatedAt: serverTimestamp()
  });
}

function makeLocalMove(idx, player) {
  board[idx] = player;
  const cell = cells[idx];
  cell.textContent = getIcon(player);
  cell.classList.add("pop");

  playSound(player === "p1" ? "pop1" : "pop2");

  const winCombo = checkWinner(board, player);
  if (winCombo) {
    endLocalGame(player, winCombo);
    return;
  }

  if (board.every(item => item !== "")) {
    endLocalGame("draw", null);
    return;
  }

  currentPlayer = player === "p1" ? "p2" : "p1";
  updateUI();

  if (gameMode === "ai" && currentPlayer === "p2") {
    statusText.textContent = `${getIcon("p2")} 小電腦正在想辦法...`;
    aiTimer = setTimeout(aiMove, 550);
  } else {
    statusText.textContent = `輪到 ${getIcon(currentPlayer)} 囉！選一格吧！`;
  }
}

function aiMove() {
  if (!isGameActive || gameMode !== "ai") return;

  let move = findBestMove("p2");
  if (move === null && Math.random() < 0.75) {
    move = findBestMove("p1");
  }
  if (move === null && board[4] === "" && Math.random() < 0.6) {
    move = 4;
  }
  if (move === null) {
    const emptyCells = board
      .map((val, idx) => (val === "" ? idx : null))
      .filter(val => val !== null);
    move = emptyCells[Math.floor(Math.random() * emptyCells.length)];
  }

  makeLocalMove(move, "p2");
}

function findBestMove(player) {
  for (const [a, b, c] of WIN_PATTERNS) {
    const line = [board[a], board[b], board[c]];
    if (line.filter(v => v === player).length === 2 && line.includes("")) {
      if (board[a] === "") return a;
      if (board[b] === "") return b;
      if (board[c] === "") return c;
    }
  }
  return null;
}

function endLocalGame(result, winCombo) {
  isGameActive = false;
  updateUI();

  if (result === "draw") {
    scores.draw++;
    statusText.textContent = "🤝 哇！勢均力敵，平手！";
    playSound("draw");
  } else {
    scores[result]++;
    winCombo.forEach(idx => cells[idx].classList.add("win-cell"));
    const winnerName = result === "p1" ? "玩家 1" : (gameMode === "ai" ? "小電腦" : "玩家 2");
    statusText.textContent = `🎉 太棒了！${getIcon(result)} ${winnerName} 贏了！`;
    statusText.classList.add("win");
    playSound("win");
    launchConfetti();
  }
  updateUI();
}

function restartLocalGame() {
  clearTimeout(aiTimer);
  board = Array(9).fill("");
  currentPlayer = "p1";
  isGameActive = true;
  statusText.classList.remove("win", "waiting");
  statusText.textContent = `輪到 ${getIcon("p1")} 囉！選一格吧！`;

  cells.forEach(cell => {
    cell.textContent = "";
    cell.classList.remove("pop", "win-cell");
  });

  stopConfetti();
  updateUI();
}

function switchToOfflineMode(targetMode) {
  if (unsubscribeRoom) {
    unsubscribeRoom();
    unsubscribeRoom = null;
  }
  roomId = null;
  myRole = null;
  p2Joined = false;

  gameMode = targetMode;
  onlinePanel.classList.add("hidden");
  onlineToggleBtn.classList.remove("active-mode");
  modeBtn.textContent = gameMode === "ai" ? "🤖 挑戰小電腦" : "👫 同機雙人";

  scores = { p1: 0, p2: 0, draw: 0 };
  restartLocalGame();
}

// --- 按鈕事件監聽 ---

modeBtn.addEventListener("click", () => {
  const nextMode = gameMode === "ai" ? "local" : "ai";
  switchToOfflineMode(nextMode);
});

onlineToggleBtn.addEventListener("click", () => {
  if (gameMode === "online" && !roomId) {
    switchToOfflineMode("ai");
    return;
  }
  clearTimeout(aiTimer);
  gameMode = "online";
  onlinePanel.classList.remove("hidden");
  onlineToggleBtn.classList.add("active-mode");
  statusText.classList.remove("win");
  statusText.classList.add("waiting");
  statusText.textContent = "🌐 請建立新房間，或輸入 4 碼房號加入！";
  board = Array(9).fill("");
  isGameActive = false;
  stopConfetti();
  updateUI();
});

createRoomBtn.addEventListener("click", createOnlineRoom);
joinRoomBtn.addEventListener("click", () => joinOnlineRoom(roomInput.value));
roomInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinOnlineRoom(roomInput.value);
});
leaveRoomBtn.addEventListener("click", leaveOnlineRoom);

copyLinkBtn.addEventListener("click", async () => {
  if (!roomId) return;
  const shareUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
  try {
    await navigator.clipboard.writeText(shareUrl);
    const oldText = copyLinkBtn.textContent;
    copyLinkBtn.textContent = "✅ 已複製！快傳給好友";
    setTimeout(() => (copyLinkBtn.textContent = oldText), 2000);
  } catch {
    prompt("請複製以下連結分享給好友：", shareUrl);
  }
});

themeBtn.addEventListener("click", async () => {
  const nextTheme = (themeIndex + 1) % THEMES.length;
  if (gameMode === "online" && roomId) {
    const roomRef = doc(db, ROOMS_COLLECTION, roomId);
    await updateDoc(roomRef, { themeIndex: nextTheme });
  } else {
    themeIndex = nextTheme;
    updateUI();
    if (isGameActive) {
      statusText.textContent = `輪到 ${getIcon(currentPlayer)} 囉！選一格吧！`;
    }
  }
});

soundBtn.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  soundBtn.textContent = soundEnabled ? "🔊" : "🔇";
});

restartBtn.addEventListener("click", async () => {
  if (gameMode === "online" && roomId) {
    // 下一局輪流先攻，更公平！
    const nextStarter = (currentRoundId % 2 === 1) ? "p2" : "p1";
    const roomRef = doc(db, ROOMS_COLLECTION, roomId);
    await updateDoc(roomRef, {
      board: Array(9).fill(""),
      currentPlayer: nextStarter,
      roundId: currentRoundId + 1,
      updatedAt: serverTimestamp()
    });
  } else {
    restartLocalGame();
  }
});

resetScoreBtn.addEventListener("click", async () => {
  if (gameMode === "online" && roomId) {
    const roomRef = doc(db, ROOMS_COLLECTION, roomId);
    await updateDoc(roomRef, {
      board: Array(9).fill(""),
      currentPlayer: "p1",
      scores: { p1: 0, p2: 0, draw: 0 },
      roundId: currentRoundId + 1,
      updatedAt: serverTimestamp()
    });
  } else {
    scores = { p1: 0, p2: 0, draw: 0 };
    restartLocalGame();
  }
});

cells.forEach(cell => cell.addEventListener("click", handleCellClick));

// --- 勝利彩帶雨特效 ---
const canvas = document.getElementById("confetti-canvas");
const ctx = canvas.getContext("2d");
let particles = [];
let animationId = null;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

function launchConfetti() {
  const colors = ["#ff6b8b", "#ffd43b", "#51cf66", "#4dabf7", "#cc5de8"];
  particles = Array.from({ length: 85 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height - canvas.height,
    size: Math.random() * 10 + 6,
    color: colors[Math.floor(Math.random() * colors.length)],
    speedY: Math.random() * 4 + 2.5,
    speedX: Math.random() * 4 - 2,
    rotation: Math.random() * 360,
    rotSpeed: Math.random() * 8 - 4
  }));
  animateConfetti();
}

function animateConfetti() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles.forEach(p => {
    p.y += p.speedY;
    p.x += p.speedX;
    p.rotation += p.rotSpeed;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate((p.rotation * Math.PI) / 180);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
    ctx.restore();
  });

  particles = particles.filter(p => p.y < canvas.height + 20);
  if (particles.length > 0) {
    animationId = requestAnimationFrame(animateConfetti);
  }
}

function stopConfetti() {
  cancelAnimationFrame(animationId);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles = [];
}

// --- 啟動時檢查網址是否帶有 ?room=XXXX ---
const urlParams = new URLSearchParams(window.location.search);
const autoRoomCode = urlParams.get("room");
if (autoRoomCode && /^\d{4}$/.test(autoRoomCode)) {
  gameMode = "online";
  onlinePanel.classList.remove("hidden");
  onlineToggleBtn.classList.add("active-mode");
  joinOnlineRoom(autoRoomCode);
} else {
  updateUI();
}