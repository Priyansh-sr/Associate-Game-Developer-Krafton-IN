// game-client-simple.js
// Terminal client with proper screen updates
const WebSocket = require('ws');
const readline = require('readline');

const SERVER_URL = 'ws://localhost:8080';
const INTERPOLATION_DELAY = 100;

class GameClient {
  constructor() {
    this.myPlayerId = null;
    this.serverStates = [];
    this.inputs = { up: false, down: false, left: false, right: false };
    this.lastRender = '';
    
    this.setupInput();
    this.connect();
    this.startRenderLoop();
  }

  setupInput() {
    // Use readline for better PowerShell compatibility
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    // Hide cursor
    process.stdout.write('\x1B[?25l');

    console.log('\n=== COIN COLLECTOR CLIENT ===');
    console.log('Controls:');
    console.log('  W or ↑ = Move Up');
    console.log('  S or ↓ = Move Down');
    console.log('  A or ← = Move Left');
    console.log('  D or → = Move Right');
    console.log('  Q = Quit\n');
    console.log('Connecting to server...\n');

    process.stdin.on('keypress', (str, key) => {
      if (key.ctrl && key.name === 'c') {
        this.cleanup();
      }
      if (key.name === 'q') {
        this.cleanup();
      }

      // Handle WASD and arrow keys
      if (key.name === 'up' || key.name === 'w') {
        this.inputs.up = true;
      }
      if (key.name === 'down' || key.name === 's') {
        this.inputs.down = true;
      }
      if (key.name === 'left' || key.name === 'a') {
        this.inputs.left = true;
      }
      if (key.name === 'right' || key.name === 'd') {
        this.inputs.right = true;
      }

      this.sendInput();

      // Auto-release after short delay
      setTimeout(() => {
        this.inputs = { up: false, down: false, left: false, right: false };
        this.sendInput();
      }, 150);
    });
  }

  connect() {
    this.ws = new WebSocket(SERVER_URL);

    this.ws.on('open', () => {
      console.log('✓ Connected to server!');
      console.log('✓ Waiting for another player...\n');
    });

    this.ws.on('message', (data) => {
      const message = JSON.parse(data);
      this.handleMessage(message);
    });

    this.ws.on('close', () => {
      console.log('\n✗ Disconnected from server');
      this.cleanup();
    });

    this.ws.on('error', (err) => {
      console.error('Connection error:', err.message);
      this.cleanup();
    });
  }

  handleMessage(message) {
    if (message.type === 'init') {
      this.myPlayerId = message.playerId;
      console.log(`✓ You are Player ${this.myPlayerId}\n`);
    } else if (message.type === 'state') {
      this.serverStates.push({
        timestamp: message.timestamp,
        players: message.players,
        coins: message.coins
      });

      const cutoff = Date.now() - 1000;
      this.serverStates = this.serverStates.filter(s => s.timestamp > cutoff);
    }
  }

  sendInput() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'input',
        inputs: this.inputs
      }));
    }
  }

  interpolateState() {
    const now = Date.now();
    const renderTime = now - INTERPOLATION_DELAY;

    if (this.serverStates.length < 2) {
      return this.serverStates[0] || { players: [], coins: [] };
    }

    let before = null, after = null;

    for (let i = 0; i < this.serverStates.length - 1; i++) {
      if (this.serverStates[i].timestamp <= renderTime && 
          this.serverStates[i + 1].timestamp >= renderTime) {
        before = this.serverStates[i];
        after = this.serverStates[i + 1];
        break;
      }
    }

    if (!before || !after) {
      return this.serverStates[this.serverStates.length - 1];
    }

    const t = (renderTime - before.timestamp) / (after.timestamp - before.timestamp);
    
    const interpolatedPlayers = before.players.map((beforePlayer) => {
      const afterPlayer = after.players.find(p => p.id === beforePlayer.id);
      if (!afterPlayer) return beforePlayer;

      return {
        ...beforePlayer,
        x: beforePlayer.x + (afterPlayer.x - beforePlayer.x) * t,
        y: beforePlayer.y + (afterPlayer.y - beforePlayer.y) * t,
        score: afterPlayer.score
      };
    });

    return {
      players: interpolatedPlayers,
      coins: after.coins
    };
  }

  startRenderLoop() {
    setInterval(() => {
      const state = this.interpolateState();
      if (state && state.players && state.players.length > 0) {
        this.render(state);
      }
    }, 1000 / 30);
  }

  render(state) {
    const mapSize = 40;
    const scale = mapSize / 800;
    
    let output = '';

    // Create map with dots for grid
    const map = Array(mapSize).fill().map(() => Array(mapSize).fill('·'));

    // Draw coins
    for (const coin of state.coins) {
      const x = Math.floor(coin.x * scale);
      const y = Math.floor(coin.y * scale);
      if (x >= 0 && x < mapSize && y >= 0 && y < mapSize) {
        map[y][x] = '$';
      }
    }

    // Draw players
    for (const player of state.players) {
      const x = Math.floor(player.x * scale);
      const y = Math.floor(player.y * scale);
      const char = player.id === this.myPlayerId ? '@' : 'P';
      if (x >= 0 && x < mapSize && y >= 0 && y < mapSize) {
        map[y][x] = char;
      }
    }

    // Build output string
    output += '┌' + '─'.repeat(mapSize) + '┐\n';
    for (let y = 0; y < mapSize; y++) {
      output += '│' + map[y].join('') + '│\n';
    }
    output += '└' + '─'.repeat(mapSize) + '┘\n';

    // Add scores
    output += '\nSCORES:\n';
    for (const player of state.players) {
      const marker = player.id === this.myPlayerId ? ' ← YOU' : '';
      output += `  Player ${player.id}: ${player.score}${marker}\n`;
    }

    output += '\nControls: W/A/S/D or Arrow Keys | Q to Quit';

    // Only update if content changed
    if (output !== this.lastRender) {
      // Move cursor to home position and clear screen
      process.stdout.write('\x1B[H\x1B[2J');
      process.stdout.write(output);
      this.lastRender = output;
    }
  }

  cleanup() {
    // Show cursor again
    process.stdout.write('\x1B[?25h');
    
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    if (this.ws) {
      this.ws.close();
    }
    console.log('\n\nGoodbye!');
    process.exit(0);
  }
}

new GameClient();