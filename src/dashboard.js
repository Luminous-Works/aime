// AIME — admin dashboard. Served by the same Worker as the mail path.
// NOTE: this is admin UI, not DSP — plain HTML/CSS/JS on purpose, no framework,
// no build step. Large type and saturated accent (Tony is visually impaired).
// Auth is HTTP Basic against AIME_ADMIN_TOKEN (fail closed). Put Cloudflare
// Access in front later for a real login wall.
import {
  stats,
  listThreads,
  getThread,
  recentEvents,
  listAllow,
  addAllow,
  removeAllow,
} from "./db.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// Basic auth: password must equal AIME_ADMIN_TOKEN. Missing token => deny (fail closed).
export function checkAuth(request, env) {
  const token = env && env.AIME_ADMIN_TOKEN;
  if (!token) return false;
  const h = request.headers.get("authorization") || "";
  const m = /^Basic\s+(.+)$/i.exec(h);
  if (!m) return false;
  let decoded = "";
  try {
    decoded = atob(m[1]);
  } catch {
    return false;
  }
  const pass = decoded.includes(":") ? decoded.slice(decoded.indexOf(":") + 1) : decoded;
  // Constant-ish compare; avoids trivial timing oracle.
  if (pass.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= pass.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

export async function serveApi(request, env, url) {
  const p = url.pathname;
  if (p === "/api/stats") return json(await stats(env.DB));
  if (p === "/api/threads") return json(await listThreads(env.DB));
  if (p === "/api/events") return json(await recentEvents(env.DB));
  if (p === "/api/allow") {
    if (request.method === "GET") return json(await listAllow(env.DB));
    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      await addAllow(env.DB, body.addr);
      return json({ ok: true });
    }
    if (request.method === "DELETE") {
      const addr = url.searchParams.get("addr") || "";
      await removeAllow(env.DB, addr);
      return json({ ok: true });
    }
  }
  const mt = /^\/api\/thread\/(.+)$/.exec(p);
  if (mt) return json(await getThread(env.DB, decodeURIComponent(mt[1])));
  return json({ error: "not found" }, 404);
}

export function renderDashboard() {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AIME — mail</title>
<style>
  :root { --bg:#0b0b0e; --panel:#141419; --line:#2a2a33; --tx:#f2f2f7; --dim:#a7a7b4; --hi:#F6DF4F; --bad:#ff5d5d; --ok:#5dffa0; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--tx); font:16px/1.5 system-ui,Segoe UI,Roboto,sans-serif; }
  header { padding:18px 24px; border-bottom:2px solid var(--line); display:flex; align-items:baseline; gap:16px; }
  h1 { font-size:24px; margin:0; letter-spacing:.02em; }
  h1 b { color:var(--hi); }
  .sub { color:var(--dim); font-size:14px; }
  main { padding:24px; display:grid; gap:24px; grid-template-columns:320px 1fr; align-items:start; }
  .cards { display:flex; gap:12px; flex-wrap:wrap; grid-column:1/-1; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 18px; min-width:150px; }
  .card .n { font-size:34px; font-weight:700; color:var(--hi); font-variant-numeric:tabular-nums; }
  .card .k { color:var(--dim); font-size:13px; text-transform:uppercase; letter-spacing:.06em; }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  .panel h2 { margin:0; padding:12px 16px; font-size:14px; text-transform:uppercase; letter-spacing:.08em; color:var(--dim); border-bottom:1px solid var(--line); }
  ul { list-style:none; margin:0; padding:0; max-height:60vh; overflow:auto; }
  li { padding:10px 16px; border-bottom:1px solid var(--line); cursor:pointer; }
  li:hover { background:#1c1c23; }
  li .from { font-weight:600; }
  li .when { color:var(--dim); font-size:12px; }
  li .n { color:var(--hi); font-size:12px; }
  .msgs { padding:16px; display:grid; gap:12px; }
  .msg { border-left:3px solid var(--line); padding:6px 12px; }
  .msg.in { border-color:var(--hi); }
  .msg.out { border-color:var(--ok); }
  .msg .meta { color:var(--dim); font-size:12px; margin-bottom:4px; }
  .msg pre { white-space:pre-wrap; word-break:break-word; margin:0; font:inherit; }
  .row { display:flex; gap:8px; padding:10px 16px; align-items:center; }
  input { background:#0b0b0e; color:var(--tx); border:1px solid var(--line); border-radius:8px; padding:8px 10px; font:inherit; flex:1; }
  button { background:var(--hi); color:#111; border:0; border-radius:8px; padding:8px 14px; font:inherit; font-weight:600; cursor:pointer; }
  button.ghost { background:transparent; color:var(--bad); border:1px solid var(--line); padding:4px 8px; }
  .drop { color:var(--bad); }
  .empty { padding:16px; color:var(--dim); }
</style></head>
<body>
<header><h1><b>AIME</b> mail</h1><span class="sub" id="who"></span></header>
<main>
  <div class="cards" id="cards"></div>
  <section class="panel">
    <h2>Allowlist</h2>
    <div class="row"><input id="newAddr" placeholder="name@example.com" autocomplete="off"><button id="addBtn">Add</button></div>
    <ul id="allow"></ul>
  </section>
  <section class="panel">
    <h2 id="rightTitle">Conversations</h2>
    <ul id="threads"></ul>
    <div class="msgs" id="thread"></div>
  </section>
  <section class="panel" style="grid-column:1/-1">
    <h2>Dropped / blocked</h2>
    <ul id="events"></ul>
  </section>
</main>
<script>
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s??'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const when = (t) => { try { return new Date(t).toLocaleString(); } catch { return t; } };

async function api(path, opt) {
  const r = await fetch(path, opt);
  if (!r.ok) throw new Error(r.status + '');
  return r.json();
}

function drawCards(s) {
  $('#cards').innerHTML =
    card(s.received, 'received') + card(s.replied, 'replied') + card(s.dropped, 'dropped') + card(s.threads, 'threads');
  $('#who').textContent = 'inbox: aime';
}
const card = (n, k) => '<div class="card"><div class="n">' + (n|0) + '</div><div class="k">' + k + '</div></div>';

function drawThreads(ts) {
  const ul = $('#threads'); ul.innerHTML = '';
  $('#rightTitle').textContent = 'Conversations (' + ts.length + ')';
  if (!ts.length) { ul.innerHTML = '<li class="empty">No mail yet.</li>'; return; }
  ts.forEach(t => {
    const li = document.createElement('li');
    li.innerHTML = '<div class="from">' + esc(t.thread) + ' <span class="n">' + t.n + '</span></div>' +
                   '<div class="when">' + esc(t.subject || '') + ' — ' + when(t.last) + '</div>';
    li.onclick = () => openThread(t.thread);
    ul.appendChild(li);
  });
}

async function openThread(id) {
  const msgs = await api('/api/thread/' + encodeURIComponent(id));
  const box = $('#thread'); box.innerHTML = '';
  msgs.forEach(m => {
    const d = document.createElement('div');
    d.className = 'msg ' + (m.direction === 'out' ? 'out' : 'in');
    d.innerHTML = '<div class="meta">' + (m.direction === 'out' ? 'AIME → ' + esc(m.sender) : 'them ← ' + esc(m.sender)) +
                  ' · ' + when(m.created_at) + ' · ' + esc(m.subject || '') + '</div><pre>' + esc(m.body) + '</pre>';
    box.appendChild(d);
  });
}

function drawAllow(list) {
  const ul = $('#allow'); ul.innerHTML = '';
  if (!list.length) { ul.innerHTML = '<li class="empty">No extra addresses. Only AIME_ALLOWED applies.</li>'; return; }
  list.forEach(a => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="from">' + esc(a.addr) + '</span>';
    const b = document.createElement('button'); b.className = 'ghost'; b.textContent = 'remove';
    b.onclick = async (e) => { e.stopPropagation(); await api('/api/allow?addr=' + encodeURIComponent(a.addr), { method: 'DELETE' }); refresh(); };
    li.appendChild(b);
    ul.appendChild(li);
  });
}

function drawEvents(evs) {
  const ul = $('#events'); ul.innerHTML = '';
  if (!evs.length) { ul.innerHTML = '<li class="empty">Nothing dropped.</li>'; return; }
  evs.forEach(e => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="drop">' + esc(e.kind) + '</span> <span class="from">' + esc(e.sender) + '</span> ' +
                   '<span class="when">' + esc(e.reason) + ' · ' + when(e.created_at) + '</span>';
    ul.appendChild(li);
  });
}

async function refresh() {
  try {
    const [s, ts, evs, allow] = await Promise.all([api('/api/stats'), api('/api/threads'), api('/api/events'), api('/api/allow')]);
    drawCards(s); drawThreads(ts); drawEvents(evs); drawAllow(allow);
  } catch (e) { $('#who').textContent = 'load failed (' + e.message + ')'; }
}

$('#addBtn').onclick = async () => {
  const v = $('#newAddr').value.trim();
  if (!v) return;
  await api('/api/allow', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ addr: v }) });
  $('#newAddr').value = ''; refresh();
};
$('#newAddr').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#addBtn').click(); });
refresh();
setInterval(refresh, 15000);
</script>
</body></html>`;
}