const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const fs   = require('fs');

// ── Logging ────────────────────────────────────────────────────────────────
const logFile = fs.createWriteStream(path.join(__dirname, 'magi.log'), { flags: 'a' });
function log(level, ...args) {
  const line = `${new Date().toISOString()} [${level}] ${args.join(' ')}`;
  console.log(line);
  logFile.write(line + '\n');
}

// ── Startup randomised display values ─────────────────────────────────────
const COMMON_CODES = ['127', '666', '263', '132', '253'];
const FILE_OPTIONS = ['MAGI_SYS', 'B_DANANG', 'AKAGI_CHK'];
function randomCode() {
  if (Math.random() < 0.8)
    return COMMON_CODES[Math.floor(Math.random() * COMMON_CODES.length)];
  return String(Math.floor(Math.random() * 900) + 100);
}
const STARTUP_CODE = randomCode();
const STARTUP_FILE = FILE_OPTIONS[Math.floor(Math.random() * FILE_OPTIONS.length)];
ipcMain.handle('get-startup-values', () => ({ code: STARTUP_CODE, file: STARTUP_FILE }));

// ── Persistence ────────────────────────────────────────────────────────────
const PREFS_FILE = path.join(__dirname, 'prefs.json');
function loadPrefs() {
  try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); }
  catch { return {}; }
}
function savePrefs(data) {
  try { fs.writeFileSync(PREFS_FILE, JSON.stringify(data, null, 2)); }
  catch (e) { log('ERROR', 'savePrefs:', e.message); }
}
ipcMain.handle('load-prefs',  ()     => loadPrefs());
ipcMain.handle('save-prefs',  (_, d) => { savePrefs(d); return true; });

// ── Dynamic Ollama endpoint ────────────────────────────────────────────────
// Load saved endpoint from prefs, fall back to default
const savedPrefs = loadPrefs();
let ollamaBaseUrl = (savedPrefs.endpoint) || 'http://localhost:11434';

ipcMain.handle('get-endpoint', ()      => ollamaBaseUrl);
ipcMain.handle('set-endpoint', (_, u)  => {
  ollamaBaseUrl = u.replace(/\/+$/, ''); // strip trailing slash
  const prefs = loadPrefs();
  prefs.endpoint = ollamaBaseUrl;
  savePrefs(prefs);
  log('INFO', 'Endpoint updated to:', ollamaBaseUrl);
  return true;
});

// ── Ollama HTTP helpers (use dynamic base URL) ─────────────────────────────
function parseUrl(base) {
  try { return new URL(base); }
  catch { return new URL('http://localhost:11434'); }
}

function ollamaRequest(apiPath, body) {
  return new Promise((resolve, reject) => {
    const u    = parseUrl(ollamaBaseUrl);
    const data = JSON.stringify(body);
    const lib  = u.protocol === 'https:' ? https : http;
    const options = {
      hostname: u.hostname,
      port:     u.port || (u.protocol === 'https:' ? 443 : 80),
      path:     apiPath,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    };
    const req = lib.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('JSON parse error: ' + raw.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(180000, () => { req.destroy(); reject(new Error('Ollama request timed out')); });
    req.write(data);
    req.end();
  });
}

function ollamaGet(apiPath) {
  return new Promise((resolve, reject) => {
    const u   = parseUrl(ollamaBaseUrl);
    const lib = u.protocol === 'https:' ? https : http;
    const options = {
      hostname: u.hostname,
      port:     u.port || (u.protocol === 'https:' ? 443 : 80),
      path:     apiPath,
      method:   'GET',
    };
    const req = lib.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('JSON parse error')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

// ── Ping ───────────────────────────────────────────────────────────────────
ipcMain.handle('ping-ollama', async () => {
  try { await ollamaGet('/api/tags'); return true; }
  catch { return false; }
});

ipcMain.handle('list-models', async () => {
  try {
    const result = await ollamaGet('/api/tags');
    return (result.models || []).map(m => m.name);
  } catch (e) {
    log('ERROR', 'list-models:', e.message);
    return [];
  }
});

// Relay ollama-status from control → display
ipcMain.on('ollama-status', (_, status) => {
  safeSend(displayWin, 'ollama-status', status);
});

// ── Chat ───────────────────────────────────────────────────────────────────
async function chat(model, messages, maxTokens) {
  const body = { model, messages, stream: false };
  if (maxTokens) body.options = { num_predict: maxTokens };
  log('INFO', `→ Ollama [${model}] messages=${messages.length}`);
  log('INFO', `  prompt: ${messages[messages.length - 1].content.slice(0, 200)}`);
  const result = await ollamaRequest('/api/chat', body);
  const content = result.message.content.trim();
  log('INFO', `← Ollama response: ${content.slice(0, 300)}`);
  return content;
}

// ── Yes/No classifier ──────────────────────────────────────────────────────
function isYesNoQuestion(question) {
  const q   = question.trim();
  const aux = `is|are|was|were|will|would|can|could|should|shall|may|might|must` +
    `|do|does|did|has|have|had|am` +
    `|isn't|aren't|wasn't|weren't|won't|wouldn't|can't|couldn't` +
    `|shouldn't|don't|doesn't|didn't|hasn't|haven't|hadn't`;
  const result =
    new RegExp(`^(${aux})\\b`, 'i').test(q) ||
    new RegExp(`[,;]\\s*(${aux})\\b`, 'i').test(q) ||
    new RegExp(`\\b(${aux})\\s+\\w+.*\\?$`, 'i').test(q);
  log('INFO', `is_yes_or_no [result=${result}] ${q.slice(0, 80)}`);
  return result;
}

// ── Agent query ────────────────────────────────────────────────────────────
async function queryAgent(question, personality, model, isYesNo) {
  const prompt = isYesNo
    ? `${personality}\n\nQuestion: ${question}\n\n` +
      `Answer in 1-3 sentences from your perspective, then on a new line write:\n` +
      `VERDICT: yes       (if your answer is definitively yes)\n` +
      `VERDICT: no        (if your answer is definitively no)\n` +
      `VERDICT: conditional  (if it depends on circumstances)\n\n` +
      `Write the VERDICT line last. No other text after it.`
    : `${personality}\n\nQuestion: ${question}\n\nAnswer in 2-4 sentences from your perspective.`;

  log('INFO', `query_agent [${personality.slice(0, 40)} | yes_no=${isYesNo}]`);
  const raw = await chat(model, [{ role: 'user', content: prompt }]);
  log('INFO', `query_agent raw:\n${raw}`);

  if (!isYesNo) return { response: raw, status: 'info', conditions: null, error: null };

  const m = raw.match(/VERDICT:\s*(\w+)/i);
  let verdictWord, fullResponse;
  if (m) {
    verdictWord  = m[1].toLowerCase();
    fullResponse = raw.slice(0, m.index).trim();
  } else {
    const lower = raw.toLowerCase();
    verdictWord  = /\bconditional\b/.test(lower) ? 'conditional'
                 : /\byes\b/.test(lower)          ? 'yes'
                 : /\bno\b/.test(lower)           ? 'no' : 'info';
    fullResponse = raw.trim();
    log('WARN', `query_agent: no VERDICT line, inferred '${verdictWord}'`);
  }
  const status     = verdictWord === 'yes' ? 'yes'
                   : verdictWord === 'no'  ? 'no'
                   : /^conditional/.test(verdictWord) ? 'conditional' : 'info';
  const conditions = status === 'conditional' ? fullResponse : null;
  log('INFO', `query_agent result: status=${status}`);
  return { response: fullResponse, status, conditions, error: null };
}

// ── Active job tracking ────────────────────────────────────────────────────
let currentJobId = 0;

function safeSend(win, channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

// ── Submit query ───────────────────────────────────────────────────────────
ipcMain.handle('submit-query', async (event, { jobId, query, models }) => {
  currentJobId = jobId;
  log('INFO', `=== Job ${jobId} starting: "${query}" models=${JSON.stringify(models)}`);

  safeSend(displayWin, 'new-job', { jobId, query });

  const isYesNo = isYesNoQuestion(query);
  log('INFO', `Job ${jobId}: is_yes_or_no=${isYesNo}`);
  safeSend(displayWin, 'annotation', { jobId, isYesNo });

  const personalities = {
    melchior:  'You are a scientist. Your goal is to further our understanding of the universe and advance our technological progress.',
    balthasar: 'You are a mother. Your goal is to protect your children and ensure their well-being.',
    casper:    'You are a woman. Your goal is to pursue love, dreams and desires.',
  };

  ['melchior', 'balthasar', 'casper'].forEach(name => {
    const model       = models[name] || models.melchior;
    const personality = personalities[name];
    log('INFO', `Agent ${name} starting (job ${jobId}) model=${model}`);
    queryAgent(query, personality, model, isYesNo)
      .then(result => {
        if (currentJobId !== jobId) return;
        log('INFO', `Agent ${name} done: status=${result.status}`);
        safeSend(displayWin, 'agent-result', { jobId, name, query, isYesNo, ...result });
      })
      .catch(err => {
        log('ERROR', `Agent ${name} error: ${err.message}`);
        if (currentJobId !== jobId) return;
        // Notify control panel if Ollama went offline
        safeSend(controlWin, 'ollama-offline', {});
        safeSend(displayWin, 'agent-result', {
          jobId, name, query, isYesNo,
          response: err.message, status: 'error', conditions: null, error: err.message,
        });
      });
  });

  return { jobId, isYesNo };
});

// ── Clipboard ──────────────────────────────────────────────────────────────
ipcMain.handle('clipboard-read',  ()        => clipboard.readText());
ipcMain.handle('clipboard-write', (_, text) => { clipboard.writeText(text); return true; });

// ── Sound settings ─────────────────────────────────────────────────────────
ipcMain.on('sound-settings', (_, settings) => {
  safeSend(displayWin, 'sound-settings', settings);
  const prefs = loadPrefs(); prefs.sound = settings; savePrefs(prefs);
});

// ── Focus / recreate display window ───────────────────────────────────────
ipcMain.on('focus-display', () => {
  if (displayWin && !displayWin.isDestroyed()) {
    if (displayWin.isMinimized()) displayWin.restore();
    displayWin.show(); displayWin.focus();
  } else {
    createDisplayWindow();
  }
});

// ── Window creation ────────────────────────────────────────────────────────
let displayWin, controlWin;

function addF11Fullscreen(win) {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      const nowFs = !win.isFullScreen();
      win.setFullScreen(nowFs);
      // Notify display renderer so it can swap the background pattern
      if (win === displayWin) {
        safeSend(displayWin, 'fullscreen-change', nowFs);
      }
      event.preventDefault();
    }
  });
  // Also fire when fullscreen changes via any means (title bar button, etc.)
  win.on('enter-full-screen', () => { if (win === displayWin) safeSend(displayWin, 'fullscreen-change', true); });
  win.on('leave-full-screen', () => { if (win === displayWin) safeSend(displayWin, 'fullscreen-change', false); });
}

function createDisplayWindow() {
  displayWin = new BrowserWindow({
    width: 1280, height: 720, title: 'MAGI', backgroundColor: '#000',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  displayWin.loadFile('display.html');
  displayWin.setMenu(null);
  addF11Fullscreen(displayWin);
  displayWin.on('closed', () => { displayWin = null; });
}

function createWindows() {
  createDisplayWindow();
  controlWin = new BrowserWindow({
    width: 1100, height: 780, title: 'NERV - TERMINAL 01', backgroundColor: '#000',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  controlWin.loadFile('control.html');
  controlWin.setMenu(null);
  addF11Fullscreen(controlWin);
  controlWin.on('closed', () => app.quit());
}

app.whenReady().then(createWindows);
app.on('window-all-closed', () => app.quit());
