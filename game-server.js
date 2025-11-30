// game-server.js
const WebSocket = require('ws');

const PORT = 8080;
const TICK_RATE = 60; // Server updates 60 times per second
const COIN_SPAWN_INTERVAL = 3000; // Spawn coin every 3 seconds
const MAP_SIZE = 800;
const PLAYER_SIZE = 30;
const COIN_SIZE = 20;
const PLAYER_SPEED = 3;
const NETWORK_LATENCY = 180; // 200ms simulated latency

class GameServer {
  constructor() {
    this.wss = new WebSocket.Server({ port: PORT });
    this.players = new Map();
    this.coins = [];
    this.nextPlayerId = 1;
    this.gameStarted = false;
    this.lastCoinSpawn = Date.now();
    
    this.wss.on('connection', this.handleConnection.bind(this));
    this.startGameLoop();
    
    console.log(`Game Server running on port ${PORT}`);
  }

  handleConnection(ws) {
    const playerId = this.nextPlayerId++;
    
    // Simulate network latency wrapper
    const sendWithLatency = (data) => {
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(data));
        }
      }, NETWORK_LATENCY);
    };

    const player = {
      id: playerId,
      x: Math.random() * (MAP_SIZE - PLAYER_SIZE),
      y: Math.random() * (MAP_SIZE - PLAYER_SIZE),
      score: 0,
      color: `hsl(${Math.random() * 360}, 70%, 60%)`,
      ws: ws,
      sendWithLatency: sendWithLatency,
      inputs: { up: false, down: false, left: false, right: false }
    };

    this.players.set(playerId, player);
    
    // Send player their ID and initial state
    sendWithLatency({
      type: 'init',
      playerId: playerId,
      player: this.serializePlayer(player)
    });

    console.log(`Player ${playerId} connected. Total players: ${this.players.size}`);

    // Auto-start game when 2 players connect
    if (this.players.size >= 2 && !this.gameStarted) {
      this.gameStarted = true;
      this.spawnCoin();
      console.log('Game started!');
    }

    ws.on('message', (message) => {
      // Simulate receiving with latency
      setTimeout(() => {
        this.handleMessage(playerId, message);
      }, NETWORK_LATENCY);
    });

    ws.on('close', () => {
      this.players.delete(playerId);
      console.log(`Player ${playerId} disconnected`);
      this.broadcastGameState();
    });
  }

  handleMessage(playerId, message) {
    try {
      const data = JSON.parse(message);
      const player = this.players.get(playerId);
      
      if (!player) return;

      if (data.type === 'input') {
        // Client sends input intent only
        player.inputs = data.inputs;
      }
    } catch (e) {
      console.error('Error parsing message:', e);
    }
  }

  startGameLoop() {
    setInterval(() => {
      if (this.gameStarted) {
        this.update();
        this.broadcastGameState();
      }
    }, 1000 / TICK_RATE);

    // Coin spawning
    setInterval(() => {
      if (this.gameStarted && this.coins.length < 5) {
        this.spawnCoin();
      }
    }, COIN_SPAWN_INTERVAL);
  }

  update() {
    const dt = 1 / TICK_RATE;

    // Update player positions based on inputs (SERVER AUTHORITY)
    for (const [id, player] of this.players) {
      let dx = 0, dy = 0;

      if (player.inputs.up) dy -= PLAYER_SPEED;
      if (player.inputs.down) dy += PLAYER_SPEED;
      if (player.inputs.left) dx -= PLAYER_SPEED;
      if (player.inputs.right) dx += PLAYER_SPEED;

      // Normalize diagonal movement
      if (dx !== 0 && dy !== 0) {
        const factor = Math.sqrt(2);
        dx /= factor;
        dy /= factor;
      }

      player.x += dx;
      player.y += dy;

      // Clamp to map bounds
      player.x = Math.max(0, Math.min(MAP_SIZE - PLAYER_SIZE, player.x));
      player.y = Math.max(0, Math.min(MAP_SIZE - PLAYER_SIZE, player.y));

      // Check coin collisions (SERVER VALIDATES)
      this.checkCoinCollisions(player);
    }
  }

  checkCoinCollisions(player) {
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const coin = this.coins[i];
      
      // AABB collision detection
      if (
        player.x < coin.x + COIN_SIZE &&
        player.x + PLAYER_SIZE > coin.x &&
        player.y < coin.y + COIN_SIZE &&
        player.y + PLAYER_SIZE > coin.y
      ) {
        // Valid collision - server authority
        player.score++;
        this.coins.splice(i, 1);
        console.log(`Player ${player.id} collected coin! Score: ${player.score}`);
      }
    }
  }

  spawnCoin() {
    this.coins.push({
      id: Date.now(),
      x: Math.random() * (MAP_SIZE - COIN_SIZE),
      y: Math.random() * (MAP_SIZE - COIN_SIZE)
    });
  }

  serializePlayer(player) {
    return {
      id: player.id,
      x: player.x,
      y: player.y,
      score: player.score,
      color: player.color
    };
  }

  broadcastGameState() {
    const state = {
      type: 'state',
      timestamp: Date.now(),
      players: Array.from(this.players.values()).map(p => this.serializePlayer(p)),
      coins: this.coins
    };

    for (const [id, player] of this.players) {
      player.sendWithLatency(state);
    }
  }
}

new GameServer();