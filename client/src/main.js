import "./style.css";
import { DiscordSDK } from "@discord/embedded-app-sdk";
import { io } from "socket.io-client";
import { triviaQuestions, clueQuestions, drawWords, emojiQuestions } from "./questions.js";

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID || "";
const API_ORIGIN = import.meta.env.VITE_API_ORIGIN || "http://localhost:3001";

const state = {
  screen: "home",
  mode: "Mixed",
  round: 1,
  totalRounds: 8,
  score: 0,
  revealIndex: 0,
  current: null,
  playerName: "Player",
  room: new URLSearchParams(location.search).get("room") || "demo-room",
  socket: null,
  discord: null,
  discordUser: null,
  isDrawer: false,
  drawingWord: "",
  guesses: []
};

const app = document.querySelector("#app");

async function initDiscord() {
  if (!CLIENT_ID || window.parent === window) return;
  try {
    const discord = new DiscordSDK(CLIENT_ID);
    state.discord = discord;
    await Promise.race([
      discord.ready(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Discord ready timeout")), 5000))
    ]);

    const { code } = await discord.commands.authorize({
      client_id: CLIENT_ID,
      response_type: "code",
      state: "",
      prompt: "none",
      scope: ["identify"]
    });

    const tokenRes = await fetch(`${API_ORIGIN}/api/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    });
    if (!tokenRes.ok) throw new Error("Token exchange failed");
    const { access_token } = await tokenRes.json();

    const auth = await discord.commands.authenticate({ access_token });
    state.discordUser = auth?.user || null;
    if (state.discordUser?.username) state.playerName = state.discordUser.username;
  } catch (err) {
    console.warn("Discord SDK setup skipped:", err);
  }
}

function initSocket() {
  try {
    const socket = io(API_ORIGIN, { transports: ["websocket", "polling"] });
    state.socket = socket;
    socket.on("connect", () => {
      socket.emit("room:join", {
        room: state.room,
        player: { name: state.playerName }
      });
    });

    socket.on("draw:stroke", stroke => {
      if (state.screen === "draw" && !state.isDrawer) drawRemoteStroke(stroke);
    });

    socket.on("draw:clear", () => clearCanvas(false));
    socket.on("draw:guess", payload => {
      state.guesses.push(payload);
      renderGuessFeed();
    });
  } catch (err) {
    console.warn("Realtime server unavailable:", err);
  }
}

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));
}

function layout(inner) {
  app.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <button class="brand" id="brandBtn" aria-label="Go home">
          <span class="brandMark">0</span>
          <span>ZERO CONTEXT</span>
        </button>
        <div class="topRight">
          <span class="roomPill">ROOM ${escapeHtml(state.room)}</span>
          <span class="scorePill">${state.score} PTS</span>
        </div>
      </header>
      ${inner}
    </main>
  `;
  document.querySelector("#brandBtn")?.addEventListener("click", () => {
    state.screen = "home";
    render();
  });
}

function renderHome() {
  layout(`
    <section class="hero">
      <p class="eyebrow">DISCORD PARTY GAME</p>
      <h1>How much context<br/>do you need?</h1>
      <p class="heroCopy">Guess from fragments. Answer trivia. Draw the word. Beat your friends before the full context appears.</p>
      <div class="modeGrid">
        ${modeCard("Mixed", "🎲", "Everything shuffled together")}
        ${modeCard("Reveal", "👁", "Clues, emojis and progressive reveals")}
        ${modeCard("Trivia", "🧠", "Fast competitive questions")}
        ${modeCard("Draw", "✏️", "Draw a secret word while everyone guesses")}
      </div>
      <button class="primary big" id="startBtn">START ${escapeHtml(state.mode).toUpperCase()}</button>
      <p class="tiny">Selected mode: <strong>${escapeHtml(state.mode)}</strong></p>
    </section>
  `);

  document.querySelectorAll("[data-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.mode = btn.dataset.mode;
      renderHome();
    });
  });

  document.querySelector("#startBtn")?.addEventListener("click", startMode);
}

function modeCard(name, icon, copy) {
  const selected = state.mode === name ? "selected" : "";
  return `
    <button class="modeCard ${selected}" data-mode="${name}">
      <span class="modeIcon">${icon}</span>
      <span class="modeName">${name}</span>
      <span class="modeCopy">${copy}</span>
    </button>
  `;
}

function startMode() {
  state.round = 1;
  state.score = 0;
  if (state.mode === "Draw") startDraw();
  else if (state.mode === "Trivia") startTrivia();
  else if (state.mode === "Reveal") startReveal();
  else startMixed();
}

function startMixed() {
  const types = ["trivia", "reveal", "draw"];
  const type = randomItem(types);
  if (type === "trivia") startTrivia();
  else if (type === "reveal") startReveal();
  else startDraw();
}

function startTrivia() {
  state.screen = "trivia";
  state.current = randomItem(triviaQuestions);
  renderTrivia();
}

function renderTrivia(message = "") {
  const q = state.current;
  layout(`
    <section class="game">
      ${roundHeader("TRIVIA", "1000")}
      <div class="questionCard">
        <span class="category">${escapeHtml(q.category)} · ${escapeHtml(q.difficulty)}</span>
        <h2>${escapeHtml(q.prompt)}</h2>
        <div class="answers">
          ${q.options.map(opt => `<button class="answerBtn" data-answer="${escapeHtml(opt)}">${escapeHtml(opt)}</button>`).join("")}
        </div>
        <div class="feedback" aria-live="polite">${message}</div>
      </div>
    </section>
  `);

  document.querySelectorAll("[data-answer]").forEach(btn => {
    btn.addEventListener("click", () => {
      const correct = btn.dataset.answer === q.answer;
      if (correct) state.score += 1000;
      document.querySelectorAll("[data-answer]").forEach(b => {
        b.disabled = true;
        if (b.dataset.answer === q.answer) b.classList.add("correct");
        else if (b === btn) b.classList.add("wrong");
      });
      document.querySelector(".feedback").innerHTML = correct
        ? `✓ Correct — <strong>+1000</strong>`
        : `Not quite. Answer: <strong>${escapeHtml(q.answer)}</strong>`;
      setTimeout(nextRound, 1200);
    });
  });
}

function startReveal() {
  state.screen = "reveal";
  state.current = randomItem(Math.random() > 0.35 ? clueQuestions : emojiQuestions);
  state.revealIndex = 0;
  renderReveal();
}

function renderReveal(message = "") {
  const q = state.current;
  const isEmoji = q.prompt;
  const points = [1000, 750, 500, 250][Math.min(state.revealIndex, 3)];
  let contextHtml = "";

  if (isEmoji) {
    const blur = [16, 10, 5, 0][Math.min(state.revealIndex, 3)];
    contextHtml = `<div class="emojiReveal" style="filter:blur(${blur}px)">${escapeHtml(q.prompt)}</div>`;
  } else {
    const clues = q.clues.slice(0, state.revealIndex + 1);
    contextHtml = `<ol class="clues">${clues.map((c, i) => `<li><span>${i + 1}</span>${escapeHtml(c)}</li>`).join("")}</ol>`;
  }

  layout(`
    <section class="game">
      ${roundHeader("REVEAL", points)}
      <div class="questionCard">
        <span class="category">${escapeHtml(q.category)} · CONTEXT ${state.revealIndex + 1}/4</span>
        <h2>Know it?</h2>
        ${contextHtml}
        <form id="guessForm" class="guessRow">
          <input id="guessInput" autocomplete="off" placeholder="Type your answer..." />
          <button class="primary" type="submit">LOCK IN</button>
        </form>
        <button class="secondary" id="revealBtn" ${state.revealIndex >= 3 ? "disabled" : ""}>+ REVEAL MORE CONTEXT</button>
        <div class="feedback" aria-live="polite">${message}</div>
      </div>
    </section>
  `);

  document.querySelector("#guessForm")?.addEventListener("submit", e => {
    e.preventDefault();
    const guess = document.querySelector("#guessInput").value.trim().toLowerCase();
    if (!guess) return;
    const answer = q.answer.toLowerCase();
    const correct = guess === answer || answer.includes(guess) && guess.length >= 5;
    if (correct) {
      state.score += points;
      document.querySelector(".feedback").innerHTML = `✓ ${escapeHtml(q.answer)} — <strong>+${points}</strong>`;
      document.querySelector("#guessInput").disabled = true;
      document.querySelector("#revealBtn").disabled = true;
      setTimeout(nextRound, 1200);
    } else {
      document.querySelector(".feedback").textContent = "Nope — try again or reveal more context.";
      document.querySelector("#guessInput").select();
    }
  });

  document.querySelector("#revealBtn")?.addEventListener("click", () => {
    state.revealIndex = Math.min(3, state.revealIndex + 1);
    renderReveal();
  });
}

function startDraw() {
  state.screen = "draw";
  state.isDrawer = true;
  state.drawingWord = randomItem(drawWords);
  state.guesses = [];
  renderDraw();
}

function renderDraw() {
  layout(`
    <section class="game drawGame">
      ${roundHeader("DRAW", "UP TO 1000")}
      <div class="drawLayout">
        <div class="canvasPanel">
          <div class="drawTop">
            <div>
              <span class="category">YOUR WORD</span>
              <div class="secretWord">${state.isDrawer ? escapeHtml(state.drawingWord) : "••••••••"}</div>
            </div>
            <div class="timer" id="timer">60</div>
          </div>
          <canvas id="drawCanvas" width="1000" height="620" aria-label="Drawing canvas"></canvas>
          <div class="tools">
            <label>Size <input id="brushSize" type="range" min="2" max="28" value="8"></label>
            <input id="brushColor" type="color" value="#111111" aria-label="Brush color">
            <button class="secondary small" id="clearBtn">CLEAR</button>
          </div>
        </div>
        <aside class="guessPanel">
          <h3>Guesses</h3>
          <div class="guessFeed" id="guessFeed"></div>
          <form id="drawGuessForm" class="guessStack">
            <input id="drawGuessInput" autocomplete="off" placeholder="Guess the drawing..." />
            <button class="primary" type="submit">GUESS</button>
          </form>
          <p class="tiny">Demo mode lets the drawer guess too, so you can test this alone.</p>
        </aside>
      </div>
    </section>
  `);

  setupCanvas();
  renderGuessFeed();
  startTimer();
  document.querySelector("#clearBtn")?.addEventListener("click", () => clearCanvas(true));
  document.querySelector("#drawGuessForm")?.addEventListener("submit", e => {
    e.preventDefault();
    const input = document.querySelector("#drawGuessInput");
    const text = input.value.trim();
    if (!text) return;
    const correct = text.toLowerCase() === state.drawingWord.toLowerCase();
    const payload = { name: state.playerName, text, correct };
    state.guesses.push(payload);
    state.socket?.emit("draw:guess", { room: state.room, ...payload });
    renderGuessFeed();
    input.value = "";
    if (correct) {
      state.score += 1000;
      setTimeout(nextRound, 900);
    }
  });
}

function renderGuessFeed() {
  const feed = document.querySelector("#guessFeed");
  if (!feed) return;
  feed.innerHTML = state.guesses.length
    ? state.guesses.slice(-8).map(g => `
      <div class="guessMsg ${g.correct ? "hit" : ""}">
        <strong>${escapeHtml(g.name)}</strong>
        <span>${g.correct ? "GUESSED IT!" : escapeHtml(g.text)}</span>
      </div>`).join("")
    : `<p class="muted">No guesses yet.</p>`;
}

let timerInterval = null;
function startTimer() {
  clearInterval(timerInterval);
  let remaining = 60;
  const timer = document.querySelector("#timer");
  timerInterval = setInterval(() => {
    remaining -= 1;
    if (timer) timer.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(timerInterval);
      nextRound();
    }
  }, 1000);
}

function setupCanvas() {
  const canvas = document.querySelector("#drawCanvas");
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  let drawing = false;
  let last = null;

  const point = e => {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width * canvas.width,
      y: (e.clientY - r.top) / r.height * canvas.height
    };
  };

  canvas.addEventListener("pointerdown", e => {
    drawing = true;
    last = point(e);
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", e => {
    if (!drawing) return;
    const p = point(e);
    const stroke = {
      x1: last.x, y1: last.y, x2: p.x, y2: p.y,
      size: Number(document.querySelector("#brushSize").value),
      color: document.querySelector("#brushColor").value
    };
    drawStroke(stroke);
    state.socket?.emit("draw:stroke", { room: state.room, stroke });
    last = p;
  });

  const stop = () => { drawing = false; last = null; };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
}

function drawStroke(s) {
  const canvas = document.querySelector("#drawCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.size;
  ctx.beginPath();
  ctx.moveTo(s.x1, s.y1);
  ctx.lineTo(s.x2, s.y2);
  ctx.stroke();
}

function drawRemoteStroke(payload) {
  drawStroke(payload.stroke || payload);
}

function clearCanvas(emit = true) {
  const canvas = document.querySelector("#drawCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (emit) state.socket?.emit("draw:clear", { room: state.room });
}

function roundHeader(label, points) {
  return `
    <div class="roundHeader">
      <div>
        <span class="roundNo">ROUND ${state.round} / ${state.totalRounds}</span>
        <span class="modeTag">${label}</span>
      </div>
      <div class="points">${points} PTS</div>
    </div>
  `;
}

function nextRound() {
  clearInterval(timerInterval);
  if (state.round >= state.totalRounds) {
    showResults();
    return;
  }
  state.round += 1;
  if (state.mode === "Mixed") startMixed();
  else if (state.mode === "Trivia") startTrivia();
  else if (state.mode === "Reveal") startReveal();
  else startDraw();
}

function showResults() {
  state.screen = "results";
  layout(`
    <section class="results">
      <p class="eyebrow">GAME COMPLETE</p>
      <h1>${state.score.toLocaleString()}</h1>
      <p class="heroCopy">Final score</p>
      <div class="resultCard">
        <div><span>Mode</span><strong>${escapeHtml(state.mode)}</strong></div>
        <div><span>Rounds</span><strong>${state.totalRounds}</strong></div>
        <div><span>Room</span><strong>${escapeHtml(state.room)}</strong></div>
      </div>
      <button class="primary big" id="againBtn">PLAY AGAIN</button>
      <button class="secondary" id="homeBtn">CHANGE MODE</button>
    </section>
  `);
  document.querySelector("#againBtn")?.addEventListener("click", startMode);
  document.querySelector("#homeBtn")?.addEventListener("click", () => {
    state.screen = "home";
    render();
  });
}

function render() {
  if (state.screen === "home") renderHome();
  else if (state.screen === "trivia") renderTrivia();
  else if (state.screen === "reveal") renderReveal();
  else if (state.screen === "draw") renderDraw();
  else showResults();
}

await initDiscord();
initSocket();
render();
