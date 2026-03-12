// WORMHOLE PROXY — Exit Node (Node.js)
// npm install @supabase/supabase-js simple-peer node-fetch wrtc

const { createClient } = require('@supabase/supabase-js');
const SimplePeer = require('simple-peer');
const fetch = require('node-fetch');
const wrtc = require('wrtc');

const SUPABASE_URL = 'https://nwbdbehcwthoidjulxay.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im53YmRiZWhjd3Rob2lkanVseGF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzMDkwOTgsImV4cCI6MjA4Nzg4NTA5OH0.kEdCZwmfLykDeWaUdFc2pHiM3bPNb3EKGzZFmra0XAE';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const ICE = { iceServers:[
  { urls:'stun:stun.l.google.com:19302' },
  { urls:'stun:stun.cloudflare.com:3478' },
  { urls:'turn:openrelay.metered.ca:80',  username:'openrelayproject', credential:'openrelayproject' }
]};

function rndCode(){
  const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:6}, ()=>c[Math.floor(Math.random()*c.length)]).join('');
}

function chunk(peer, obj){
  const s = JSON.stringify(obj);
  const n = Math.ceil(s.length/12000);
  const mid = Math.random().toString(36).slice(2);
  for(let i=0;i<n;i++) peer.send(JSON.stringify({_c:1,mid,i,n,d:s.slice(i*12000,(i+1)*12000)}));
}

const bufs = {};
function onData(raw, cb){
  const m = JSON.parse(raw);
  if(m._c){
    if(!bufs[m.mid]) bufs[m.mid]={p:new Array(m.n),g:0,n:m.n};
    const b=bufs[m.mid];
    if(!b.p[m.i]){b.p[m.i]=m.d;b.g++;}
    if(b.g===b.n){ const f=b.p.join(''); delete bufs[m.mid]; cb(JSON.parse(f)); }
  } else cb(m);
}

async function handleReq(peer, msg){
  const t0=Date.now(), {id,method,url,headers={}}=msg;
  console.log('[REQ]', method, url);
  try {
    const opts={method,headers};
    delete opts.headers.host;
    const r = await fetch(url, opts);
    const buf = await r.buffer();
    const ms = Date.now()-t0;
    const ct = r.headers.get('content-type')||'application/octet-stream';
    const hdrs = {};
    r.headers.forEach((v,k)=>hdrs[k]=v);
    console.log('[RES]', r.status, ct, buf.length+'B', ms+'ms');
    chunk(peer, {t:'res',id,status:r.status,statusText:r.statusText,
      ct,headers:hdrs,size:buf.length,ms,body:buf.toString('base64')});
  } catch(e){
    console.error('[ERR]', e.message);
    chunk(peer, {t:'res_err',id,msg:e.message,ms:Date.now()-t0});
  }
}

const myId = require('crypto').randomUUID();
const code = rndCode();
console.log('\n🌐 WORMHOLE PROXY — EXIT NODE');
console.log('══════════════════════════════');
console.log('КОД ДЛЯ КЛИЕНТА: ' + code);
console.log('══════════════════════════════\n');

const ch = sb.channel('proxy_'+code);
const ps = {};

ch.on('broadcast',{event:'signal'},({payload})=>{
  if(payload.sender===myId) return;
  if(payload.type==='join'){
    const rid=payload.sender;
    if(ps[rid]) try{ps[rid].destroy();}catch(e){}
    const peer=new SimplePeer({initiator:true,trickle:true,wrtc,config:ICE});
    ps[rid]=peer;
    peer.on('signal',d=>ch.send({type:'broadcast',event:'signal',payload:{type:'webrtc',target:rid,sender:myId,signal:d}}));
    peer.on('connect',()=>{ console.log('[✅] Клиент подключился!'); });
    peer.on('data',raw=>onData(raw.toString(),m=>{ if(m.t==='req') handleReq(peer,m); }));
    peer.on('close',()=>console.log('[⚠] Клиент отключился'));
  }
  if(payload.type==='webrtc'&&payload.target===myId) if(ps[payload.sender]) ps[payload.sender].signal(payload.signal);
}).subscribe(s=>{ if(s==='SUBSCRIBED') console.log('[✅] Supabase подключён, ждём клиента...\n'); });
