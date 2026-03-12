// WORMHOLE PROXY — Exit Node
// Фиксированный код — клиент подключается автоматически

const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const http = require('http');

const SUPABASE_URL = 'https://nwbdbehcwthoidjulxay.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im53YmRiZWhjd3Rob2lkanVseGF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzMDkwOTgsImV4cCI6MjA4Nzg4NTA5OH0.kEdCZwmfLykDeWaUdFc2pHiM3bPNb3EKGzZFmra0XAE';

// ФИКСИРОВАННЫЙ КОД — менять только здесь если нужно
const CODE = 'WORMHL';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const CHUNK = 20000;

console.log('\n🌐 WORMHOLE EXIT NODE');
console.log('══════════════════════');
console.log('  КОД (фиксированный): ' + CODE);
console.log('══════════════════════\n');

const reqCh = sb.channel('req_' + CODE);
const resCh = sb.channel('res_' + CODE);

reqCh.on('broadcast', { event: 'req' }, async ({ payload }) => {
  const { id, url, method = 'GET', body } = payload;
  const t0 = Date.now();
  console.log('[>>]', method, url);

  try {
    const r = await fetch(url, {
      method,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'accept': '*/*',
        'accept-language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      ...(body && method === 'POST' ? { body } : {})
    });

    const buf = await r.buffer();
    const ms = Date.now() - t0;
    const ct = r.headers.get('content-type') || 'application/octet-stream';
    const b64 = buf.toString('base64');

    console.log('[OK]', r.status, ct, buf.length + 'B', ms + 'ms');

    const chunks = [];
    for (let i = 0; i < b64.length; i += CHUNK) chunks.push(b64.slice(i, i + CHUNK));

    const hdrs = {};
    r.headers.forEach((v, k) => { hdrs[k] = v; });

    await resCh.send({
      type: 'broadcast', event: 'res_meta',
      payload: { id, status: r.status, statusText: r.statusText, ct, size: buf.length, ms, chunks: chunks.length, headers: hdrs }
    });

    for (let i = 0; i < chunks.length; i++) {
      await resCh.send({ type: 'broadcast', event: 'res_chunk', payload: { id, i, data: chunks[i] } });
      if (chunks.length > 1) await new Promise(res => setTimeout(res, 20));
    }

  } catch (e) {
    console.log('[ERR]', e.message);
    await resCh.send({ type: 'broadcast', event: 'res_err', payload: { id, msg: e.message } });
  }
});

reqCh.subscribe(s => {
  if (s === 'SUBSCRIBED') console.log('[OK] Готов. Клиенты подключаются автоматически.');
});
resCh.subscribe();

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('WORMHOLE EXIT NODE ACTIVE\nCODE: ' + CODE);
}).listen(PORT, () => console.log('[HTTP] порт ' + PORT));
