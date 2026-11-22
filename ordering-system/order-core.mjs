import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const menu = JSON.parse(readFileSync(new URL('./menu.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const regions = ['Evergreen Falls','Willow Grove','Cedar Ridge','Oakwood Lake','Harmony West','Riverstone','Harmony Pines','London Square','Rosewood Heights','Harmony Cove','Harmony Hills','Ohana Coast'];
const managers = ['2cf44513-e9e7-48f2-b717-b8ffe5117a37','436b1c38-e897-491a-80fb-6a7d5c4864c0'];
export function deliveryURL(raw) {
  try {
    const u = new URL(raw), parts = u.pathname.split('/').filter(Boolean);
    if (['http:', 'https:'].includes(u.protocol)) {
      if (!['maps.secondlife.com','slurl.com','www.slurl.com'].includes(u.hostname) || u.username || u.password || u.port || parts.shift() !== 'secondlife') return null;
    } else if (u.protocol !== 'secondlife:' || u.host) return null;
    if (parts.length !== 4) return null;
    const region = regions.find(r => r.toLowerCase() === decodeURIComponent(parts[0]).toLowerCase());
    if (!region || parts.slice(1).some((v,k) => !/^\d+$/.test(v) || +v > (k === 2 ? 4096 : 255))) return null;
    return `https://maps.secondlife.com/secondlife/${encodeURIComponent(region)}/${parts.slice(1).map(Number).join('/')}`;
  } catch { return null; }
}
export function openAt(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone:'America/Los_Angeles', weekday:'short', hour:'numeric', hourCycle:'h23' }).formatToParts(date);
  const value = key => parts.find(p => p.type === key).value;
  return value('weekday') !== 'Sun' && +value('hour') >= 10 && +value('hour') < 19;
}
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
export function createService({ database = 'taylored-plate-test.sqlite', token, now = () => new Date() } = {}) {
  if (!token || token.length < 24) throw new Error('Set TTP_TEST_TOKEN to a random secret of at least 24 characters.');
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS accounts (avatar TEXT PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0));
    CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, avatar TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ledger (id TEXT PRIMARY KEY, avatar TEXT NOT NULL, amount INTEGER NOT NULL, kind TEXT NOT NULL, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requests (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS staff_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL);`);
  const balance = avatar => db.prepare('SELECT balance FROM accounts WHERE avatar=?').get(avatar)?.balance ?? 0;
  function transact(key, fingerprint, action) {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(key)) fail(400,'Supply an Idempotency-Key of 8–100 letters, digits, underscores or hyphens.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const prior = db.prepare('SELECT * FROM requests WHERE key=?').get(key);
      if (prior) { if (prior.fingerprint !== fingerprint) fail(409,'Idempotency key already used for a different request.'); db.exec('COMMIT'); return JSON.parse(prior.response); }
      const result = action();
      db.prepare('INSERT INTO requests VALUES (?,?,?)').run(key,fingerprint,JSON.stringify(result));
      db.exec('COMMIT'); return result;
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  const server = http.createServer(async (req,res) => {
    res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control','no-store');
    try {
      const provided = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${token}`);
      if (provided.length !== expected.length || !timingSafeEqual(provided,expected)) fail(401,'Unauthorized');
      // Local integration credential only. A live service must authenticate each avatar.
      const avatar = req.headers['x-test-avatar'];
      if (typeof avatar !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(avatar)) fail(400,'Provide X-Test-Avatar UUID.');
      const manager = managers.includes(avatar.toLowerCase());
      const url = new URL(req.url,'http://localhost');
      let raw=''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw)>32768) fail(413,'Request too large'); }
      let body={}; if(raw) { try { body=JSON.parse(raw); } catch { fail(400,'Invalid JSON'); } }
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400,'JSON object required');
      const fingerprint=JSON.stringify([req.method,url.pathname,avatar,body]);
      let result;
      if (req.method==='GET' && url.pathname==='/menu') result={...menu,regions,open:openAt(now()),mode:'test'};
      else if (req.method==='GET' && url.pathname==='/balance') result={balance:balance(avatar),mode:'test'};
      else if (req.method==='POST' && url.pathname==='/test/credit') {
        if (!manager) fail(403,'Manager access required');
        if (!/^[0-9a-f-]{36}$/i.test(body.avatar ?? '') || !Number.isSafeInteger(body.amount) || body.amount<1 || body.amount>1000000) fail(400,'Invalid test credit');
        result=transact(req.headers['idempotency-key'],fingerprint,()=>{
          db.prepare('INSERT INTO accounts VALUES (?,?) ON CONFLICT(avatar) DO UPDATE SET balance=balance+excluded.balance').run(body.avatar,body.amount);
          db.prepare('INSERT INTO ledger VALUES (?,?,?,?,?)').run(randomUUID(),body.avatar,body.amount,'test_credit',now().toISOString());
          return {balance:balance(body.avatar),mode:'test'};
        });
      } else if (req.method==='POST' && url.pathname==='/orders') {
        result=transact(req.headers['idempotency-key'],fingerprint,()=>{
          if (!openAt(now())) fail(409,'Restaurant closed');
          if (!['delivery','pickup'].includes(body.method)) fail(400,'Choose delivery or pickup');
          const location=body.method==='delivery'?deliveryURL(body.slurl):'https://maps.secondlife.com/secondlife/Riverstone/193/11/22';
          if (!location) fail(400,'SLURL outside supported coverage or malformed');
          if (!Array.isArray(body.items) || !body.items.length || body.items.length>100) fail(400,'Choose 1–100 order lines');
          const items=body.items.map(line=>{
            const item=menu.items.find(i=>i.id===line?.id);
            if (!item || item.id==='ttp-044' || !Number.isInteger(line.qty) || line.qty<1 || line.qty>99) fail(400,'Invalid or unavailable item');
            if (item.id==='ttp-070' && !menu.beverage_options.includes(line.flavor)) fail(400,'Choose one refresher flavor');
            return {id:item.id,name:item.name,price:item.price_linden,qty:line.qty,...(item.id==='ttp-070'?{flavor:line.flavor}:{})};
          });
          if (body.notes !== undefined && (typeof body.notes!=='string' || body.notes.length>500)) fail(400,'Notes must be at most 500 characters');
          const subtotal=items.reduce((s,i)=>s+i.price*i.qty,0),fee=body.method==='delivery'?250:0,total=subtotal+fee;
          if(balance(avatar)<total) fail(409,'Insufficient balance');
          const order={id:randomUUID(),avatar,items,method:body.method,location,notes:body.notes??'',subtotal,fee,total,status:'New',created:now().toISOString()};
          db.prepare('UPDATE accounts SET balance=balance-? WHERE avatar=?').run(total,avatar);
          db.prepare('INSERT INTO orders VALUES (?,?,?)').run(order.id,avatar,JSON.stringify(order));
          db.prepare('INSERT INTO staff_events(body) VALUES (?)').run(JSON.stringify(order));
          db.prepare('INSERT INTO ledger VALUES (?,?,?,?,?)').run(order.id,avatar,-total,'order',order.created);
          return {order,balance:balance(avatar),mode:'test'};
        });
      } else if (req.method==='GET' && url.pathname==='/staff/feed') {
        if(!manager) fail(403,'Manager access required');
        const after=Number(url.searchParams.get('after')??0);
        if(!Number.isSafeInteger(after)||after<0) fail(400,'Invalid cursor');
        const latest=db.prepare('SELECT coalesce(max(seq),0) AS seq FROM staff_events').get().seq;
        const row=db.prepare('SELECT seq,body FROM staff_events WHERE seq>? ORDER BY seq LIMIT 1').get(after>latest?0:after);
        result={cursor:row?.seq??latest,reset:after>latest,order:row?JSON.parse(row.body):null,mode:'demo'};
      } else if (req.method==='GET' && url.pathname==='/orders') {
        const rows=manager?db.prepare('SELECT body FROM orders').all():db.prepare('SELECT body FROM orders WHERE avatar=?').all(avatar);
        result={orders:rows.map(r=>JSON.parse(r.body)),mode:'test'};
      } else if (req.method==='POST' && /^\/orders\/[^/]+\/advance$/.test(url.pathname)) {
        if(!manager) fail(403,'Manager access required');
        result=transact(req.headers['idempotency-key'],fingerprint,()=>{
          const row=db.prepare('SELECT body FROM orders WHERE id=?').get(url.pathname.split('/')[2]);
          if(!row) fail(404,'Order missing');
          const order=JSON.parse(row.body);
          if(body.expectedStatus!==order.status) fail(409,'Order changed; refresh queue');
          const steps=order.method==='delivery'?['New','Accepted','Preparing','Out for delivery','Delivered']:['New','Accepted','Preparing','Ready for pickup','Collected'];
          const next=steps[steps.indexOf(order.status)+1];if(!next)fail(409,'Order complete');
          order.status=next;db.prepare('UPDATE orders SET body=? WHERE id=?').run(JSON.stringify(order),order.id);
          db.prepare('INSERT INTO staff_events(body) VALUES (?)').run(JSON.stringify(order));
          return {order,mode:'test'};
        });
      } else fail(404,'Endpoint missing');
      res.end(JSON.stringify(result));
    } catch(e) {res.statusCode=e.status??500;res.end(JSON.stringify({error:e.status?e.message:'Internal server error'}));}
  });
  return {server,close:()=>db.close()};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const service=createService({database:process.env.TTP_TEST_DATABASE??'taylored-plate-test.sqlite',token:process.env.TTP_TEST_TOKEN});
  service.server.listen(Number(process.env.PORT??8787),'127.0.0.1',()=>console.log('Taylored Plate TEST service: http://127.0.0.1:'+(process.env.PORT??8787)));
}

