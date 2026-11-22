import http from 'node:http';
import {Readable} from 'node:stream';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createService} from './order-core.mjs';
import {staffConfig,createStaffHandler} from './staff.mjs';

// Public DEMO gateway. Internal test identities and manager credentials never
// cross the HTTP boundary. Real avatars, money and staff alerts are unconnected.
export function buildApp({database=process.env.TE_DATABASE??'taylored-eats-demo.sqlite',now,managerTokens}={}){
 const credentials=staffConfig(managerTokens);
 const token=randomBytes(32).toString('hex');
 const core=createService({database,token,...(now?{now}:{})});
 const db=new DatabaseSync(database);
 db.exec('CREATE TABLE IF NOT EXISTS demo_sessions (hash TEXT PRIMARY KEY, avatar TEXT NOT NULL, expires INTEGER NOT NULL)');
 const screen=readFileSync(new URL('./screen.html',import.meta.url));
 const adapter=readFileSync(new URL('./screen-api.js',import.meta.url));
 const sessions=new Map(),rates=new Map();
 const manager='436b1c38-e897-491a-80fb-6a7d5c4864c0';
 function invoke(path,avatar,method='GET',body,key){
  const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);
  req.url=path;req.method=method;req.headers={authorization:`Bearer ${token}`,'x-test-avatar':avatar,...(key?{'idempotency-key':key}:{})};
  return new Promise(resolve=>core.server.emit('request',req,{statusCode:200,setHeader(){},end(text){resolve({status:this.statusCode,body:JSON.parse(text)})}}));
 }
 const staff=createStaffHandler({invoke,credentials});
 async function handler(req,res){
  const send=(code,body)=>{res.statusCode=code;res.end(JSON.stringify(body))};
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  try{
   const u=new URL(req.url,'http://localhost');
   if(req.method==='GET'&&u.pathname==='/healthz')return send(200,{ok:true,product:'Taylored Eats',mode:'demo',realPayments:false});
   if(req.method==='GET'&&['/','/customer-screen.html'].includes(u.pathname)){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(screen)}
   if(req.method==='GET'&&u.pathname==='/screen-api.js'){res.setHeader('Content-Type','application/javascript; charset=utf-8');return res.end(adapter)}
   if(u.pathname.startsWith('/staff/'))return await staff(req,res,u,send);
   if(!u.pathname.startsWith('/api/'))return send(404,{error:'Not found'});
   const ip=req.socket?.remoteAddress??'local',stamp=Date.now(),prior=rates.get(ip);
   if(prior&&stamp-prior.start<60000){if(++prior.count>120)return send(429,{error:'Please wait a minute'})}else rates.set(ip,{start:stamp,count:1});
   if(rates.size>10000)for(const [k,v]of rates)if(stamp-v.start>60000)rates.delete(k);
   if(req.method==='POST'){
    const origin=req.headers.origin;
    // Cross-origin writes are refused. Cookie auth, no public test-avatar header.
    if(origin&&new URL(origin).host!==req.headers.host)return send(403,{error:'Cross-origin request refused'});
    if(!String(req.headers['content-type']??'').startsWith('application/json'))return send(415,{error:'JSON required'});
   }
   const cookie=String(req.headers.cookie??'').match(/(?:^|;\s*)te_demo=([a-f0-9]{64})(?:;|$)/)?.[1];
   const hash=cookie?createHash('sha256').update(cookie).digest('hex'):null;
   let session=hash?db.prepare('SELECT avatar,expires FROM demo_sessions WHERE hash=?').get(hash):null;
   if(session&&session.expires<Date.now())session=null;
   if(req.method==='POST'&&u.pathname==='/api/session'){
    if(!session){
     // Bound demo session growth; this is not public account enrollment.
     const count=db.prepare('SELECT count(*) AS n FROM demo_sessions WHERE expires>?').get(Date.now()).n;
     if(count>=1000)return send(503,{error:'Demo capacity reached'});
     db.prepare('DELETE FROM demo_sessions WHERE expires<?').run(Date.now());
     const value=randomBytes(32).toString('hex'),newHash=createHash('sha256').update(value).digest('hex'),avatar=randomUUID();
     const credit=await invoke('/test/credit',manager,'POST',{avatar,amount:5000},'initial-'+avatar);
     if(credit.status!==200)return send(503,{error:'Demo setup unavailable'});
     db.prepare('INSERT INTO demo_sessions VALUES (?,?,?)').run(newHash,avatar,Date.now()+86400000);
     session={avatar};res.setHeader('Set-Cookie',`te_demo=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`);
    }
    const b=await invoke('/balance',session.avatar);return send(b.status,b.body);
   }
   if(!session)return send(401,{error:'Start a demo session first'});
   if(req.method==='GET'&&['/api/balance','/api/orders','/api/menu'].includes(u.pathname)){
    const response=await invoke(u.pathname.slice(4),session.avatar);return send(response.status,response.body);
   }
   if(req.method==='POST'&&u.pathname==='/api/orders'){
    let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16384)return send(413,{error:'Order too large'})}
    let body;try{body=JSON.parse(raw)}catch{return send(400,{error:'Invalid JSON'})}
    const response=await invoke('/orders',session.avatar,'POST',body,req.headers['idempotency-key']);return send(response.status,response.body);
   }
   return send(404,{error:'Endpoint unavailable in screen demo'});
  }catch{return send(500,{error:'Service unavailable'})}
 }
 return {server:http.createServer(handler),handler,close(){core.close();db.close()}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const app=buildApp();app.server.listen(Number(process.env.PORT??8787),'0.0.0.0',()=>console.log('Taylored Eats demo ready; real payments disabled'));
}
