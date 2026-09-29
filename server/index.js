import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";

const PORT = Number(process.env.PORT || 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/token", async (req, res) => {
  const { code } = req.body || {};
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;

  if (!code || !clientId || !clientSecret) {
    return res.status(400).json({
      error: "Missing code or Discord server credentials."
    });
  }

  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code
    });

    const response = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Discord token exchange failed." });
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, credentials: true }
});

io.on("connection", socket => {
  socket.on("room:join", ({ room, player }) => {
    if (!room) return;
    socket.join(room);
    socket.data.room = room;
    socket.data.player = player || { name: "Player" };
  });

  socket.on("draw:stroke", ({ room, stroke }) => {
    if (!room || !stroke) return;
    socket.to(room).emit("draw:stroke", stroke);
  });

  socket.on("draw:clear", ({ room }) => {
    if (!room) return;
    socket.to(room).emit("draw:clear");
  });

  socket.on("draw:guess", ({ room, name, text, correct }) => {
    if (!room || !text) return;
    socket.to(room).emit("draw:guess", { name, text, correct: Boolean(correct) });
  });
});

server.listen(PORT, () => {
  console.log(`Zero Context server running on http://localhost:${PORT}`);
});
