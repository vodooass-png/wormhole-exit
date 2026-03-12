// WORMHOLE PROXY — Exit Node (Node.js)
// Деплой на Railway: просто положи этот файл + package.json в GitHub репо

const { createClient } = require('@supabase/supabase-js');
const { SimplePeer } = require('node-datachannel/polyfill');
const fetch = require('node-fetch');

const SUPABASE_URL = 'https://nwbdbehcwthoidjulxay.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im53YmRiZWhjd3Rob2lkanVseGF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzMDkwOTgsImV4cCI6MjA4Nzg4NTA5OH0.kEdCZwmfLykDeWaUdFc2pHiM3bPNb3EKGzZFmra0XAE';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'turn:openrelay.metered.ca:80',  username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};

// --- генератор кода ---
function rndCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => c[Math.floor(Math.random() * c.length)]).join('');
}

// --- чанкованный протокол (как в браузерной версии) ---
function chunkSend(peer, obj) {
  const s = JSON.stringify(obj);
  const CSIZ = 12000;
  const n = Math.ceil(s.length / CSIZ);
  const mid = Math.random().toString(36).slice(2);
  for (let i = 0; i < n; i++) {
    peer.send(JSON.stringify({ _c: 1, mid, i, n, d: s.slice(i * CSIZ, (i + 1) * CSIZ) }));
  }
}

const bufs = {};
function onData(raw, cb) {
  let m;
  try { m = JSON.parse(raw); } catch (e) { return; }
  if (m._c) {
    if (!bufs[m.mid]) bufs[m.mid] = { p: new Array(m.n), g: 0, n: m.n };
    const b = bufs[m.mid];
    if (!b.p[m.i]) { b.p[m.i] = m.d; b.g++; }
    if (b.g === b.n) {
      const full = b.p.join('');
      delete bufs[m.mid];
      try { cb(JSON.parse(full)); } catch (e) { console.error('[parse err]', e.message); }
    }
  } else {
    cb(m);
  }
}

// --- обработка запроса от клиента ---
async function handleReq(peer, msg) {
  const t0 = Date.now();
  const { id, method = 'GET', url, headers = {} } = msg;
  console.log('[REQ]', method, url);

  try {
    const opts = { method, headers: { 'user-agent': 'Mozilla/5.0', 'accept': '*/*' } };
    // для POST передаём тело если есть
    if (msg.body && method === 'POST') opts.body = msg.body;

    const r = await fetch(url, opts);
    const buf = await r.buffer();
    const ms = Date.now() - t0;
    const ct = r.headers.get('content-type') || 'application/octet-stream';

    const hdrs = {};
    r.headers.forEach((v, k) => { hdrs[k] = v; });

    console.log('[RES]', r.status, ct, buf.length + 'B', ms + 'ms');

    chunkSend(peer, {
      t: 'res',
      id,
      status: r.status,
      statusText: r.statusText,
      ct,
      headers: hdrs,
      size: buf.length,
      ms,
      proxy: 'node',
      body: buf.toString('base64')
    });

  } catch (e) {
    console.error('[ERR]', e.message);
    chunkSend(peer, { t: 'res_err', id, msg: e.message, ms: Date.now() - t0 });
  }
}

// --- главный цикл ---
const myId = require('crypto').randomUUID();
const code = rndCode();

console.log('');
console.log('🌐 WORMHOLE PROXY — EXIT NODE ЗАПУЩЕН');
console.log('══════════════════════════════════════');
console.log('  КОД ДЛЯ КЛИЕНТА: ' + code);
console.log('══════════════════════════════════════');
console.log('Жди подключения клиента...');
console.log('');

const ch = sb.channel('proxy_' + code);
const ps = {};

ch.on('broadcast', { event: 'signal' }, ({ payload }) => {
  if (payload.sender === myId) return;

  if (payload.type === 'join') {
    const rid = payload.sender;
    if (ps[rid]) { try { ps[rid].destroy(); } catch (e) {} }

    const peer = new SimplePeer({ initiator: true, trickle: true, config: ICE });
    ps[rid] = peer;

    peer.on('signal', d => {
      ch.send({ type: 'broadcast', event: 'signal', payload: { type: 'webrtc', target: rid, sender: myId, signal: d } });
    });

    peer.on('connect', () => {
      console.log('[✅] Клиент подключился! Туннель открыт.');
    });

    peer.on('data', raw => {
      onData(raw.toString(), m => {
        if (m.t === 'req') handleReq(peer, m);
      });
    });

    peer.on('close', () => {
      console.log('[⚠]  Клиент отключился.');
      delete ps[rid];
    });

    peer.on('error', e => {
      console.error('[peer err]', e.message);
    });
  }

  if (payload.type === 'webrtc' && payload.target === myId) {
    if (ps[payload.sender]) ps[payload.sender].signal(payload.signal);
  }

}).subscribe(status => {
  if (status === 'SUBSCRIBED') {
    console.log('[✅] Supabase подключён, ждём клиента...');
  }
});

// Railway требует что-то слушающее порт — вешаем простой HTTP сервер
const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WORMHOLE EXIT NODE ACTIVE\nКОД: ' + code + '\n');
}).listen(PORT, () => {
  console.log('[HTTP] Сервер слушает порт ' + PORT);
});
