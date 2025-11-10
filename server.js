// Simple production-ish backend using Express + better-sqlite3
const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors()); // in production restrict origin
app.use(express.json({ limit: '5mb' }));

// DB - file-based persistent
const DB_PATH = path.join(__dirname, 'db.sqlite');
const db = new Database(DB_PATH);

// Init tables if not exist
db.prepare(`CREATE TABLE IF NOT EXISTS draws (
  id TEXT PRIMARY KEY,
  title TEXT,
  price INTEGER,
  datetime TEXT,
  description TEXT,
  status TEXT,
  winner_json TEXT,
  created_at TEXT
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT,
  draw_id TEXT,
  method TEXT,
  status TEXT,
  created_at TEXT
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  provider TEXT,
  value TEXT,
  notes TEXT,
  created_at TEXT
)`).run();

// Serve logos/static (if you upload logos in backend/public/logos)
app.use('/static', express.static(path.join(__dirname, 'public')));

// --- Draws API ---
app.get('/api/draws', (req,res)=>{
  const rows = db.prepare('SELECT * FROM draws ORDER BY created_at DESC').all();
  res.json(rows);
});

app.post('/api/draws', (req,res)=>{
  const { title, price, datetime, description } = req.body;
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO draws(id,title,price,datetime,description,status,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(id, title, price||0, datetime||'', description||'', 'inactive', now);
  res.json({ ok:true, id });
});

app.put('/api/draws/:id', (req,res)=>{
  const id = req.params.id;
  const { title, price, datetime, description, status, winner } = req.body;
  const stmt = db.prepare('UPDATE draws SET title=?,price=?,datetime=?,description=?,status=?,winner_json=? WHERE id=?');
  stmt.run(title, price, datetime, description, status||'inactive', winner? JSON.stringify(winner): null, id);
  res.json({ ok:true });
});

// pick winner server-side endpoint (deterministic-ish)
app.post('/api/draws/:id/pick', (req,res)=>{
  const id = req.params.id;
  const seed = req.body.seed || Math.random().toString(36).slice(2,12);
  const parts = db.prepare('SELECT * FROM participants WHERE draw_id=? AND status=?').all(id, 'confirmed');
  if(!parts || parts.length===0) return res.status(400).json({ error:'no participants' });
  // simple verifiable selection: hash-like using seed + timestamp
  let acc = 0;
  for(let i=0;i<seed.length;i++) acc = (acc * 31 + seed.charCodeAt(i)) >>> 0;
  const idx = (acc + Date.now()) % parts.length;
  const winner = parts[idx];
  const winnerJson = { id: winner.id, name: winner.name, phone: winner.phone, seed, at: new Date().toISOString() };
  db.prepare('UPDATE draws SET winner_json=? WHERE id=?').run(JSON.stringify(winnerJson), id);
  res.json({ ok:true, winner: winnerJson });
});

// --- Participants API ---
app.get('/api/participants', (req,res)=>{
  const rows = db.prepare('SELECT * FROM participants ORDER BY created_at DESC').all();
  res.json(rows);
});

app.post('/api/participants', (req,res)=>{
  const { name, phone, draw_id, method } = req.body;
  if(!name || !phone || !draw_id) return res.status(400).json({ error:'missing' });
  const id = uuidv4(), now = new Date().toISOString();
  db.prepare('INSERT INTO participants(id,name,phone,draw_id,method,status,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(id, name, phone, draw_id, method||'manual', 'pending', now);
  res.json({ ok:true, id });
});

app.put('/api/participants/:id', (req,res)=>{
  const id = req.params.id;
  const { status, name, phone } = req.body;
  const stmt = db.prepare('UPDATE participants SET status=?, name=?, phone=? WHERE id=?');
  stmt.run(status || 'pending', name || null, phone || null, id);
  res.json({ ok:true });
});

// --- Payments methods (admin manage) ---
app.get('/api/payments', (req,res)=>{
  res.json(db.prepare('SELECT * FROM payments ORDER BY created_at DESC').all());
});
app.post('/api/payments', (req,res)=>{
  const { provider, value, notes } = req.body;
  const id = uuidv4(), now = new Date().toISOString();
  db.prepare('INSERT INTO payments(id,provider,value,notes,created_at) VALUES(?,?,?,?,?)').run(id, provider, value, notes||'', now);
  res.json({ ok:true, id });
});
app.delete('/api/payments/:id',(req,res)=>{
  db.prepare('DELETE FROM payments WHERE id=?').run(req.params.id);
  res.json({ ok:true });
});

// health
app.get('/health',(req,res)=> res.json({ ok:true }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, ()=> console.log('Backend listening on', PORT));
