import {test}from'node:test';import assert from'node:assert/strict';import {Readable}from'node:stream';import {buildApp}from'./app.mjs';
test('public gateway isolates sessions, calculates totals and blocks internal manager APIs',async()=>{
 const app=buildApp({database:':memory:',now:()=>new Date('2026-11-20T18:00:00Z')});
 const call=async(path,{method='GET',body,cookie,key,origin}={})=>{
  const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);req.url=path;req.method=method;req.socket={remoteAddress:'local'};req.headers={host:'example.com','content-type':'application/json',...(cookie?{cookie}:{}),...(key?{'idempotency-key':key}:{}),...(origin?{origin}:{})};
  const headers={};return new Promise(resolve=>app.handler(req,{statusCode:200,setHeader(k,v){headers[k]=v},end(raw){let data;try{data=JSON.parse(raw)}catch{data=String(raw)}resolve({status:this.statusCode,headers,data})}}));
 };
 try{
  assert.equal((await call('/healthz')).data.realPayments,false);
  assert.equal((await call('/api/balance')).status,401);
  const a=await call('/api/session',{method:'POST',body:{}}),b=await call('/api/session',{method:'POST',body:{}});
  const ca=a.headers['Set-Cookie'].split(';')[0],cb=b.headers['Set-Cookie'].split(';')[0];assert.notEqual(ca,cb);assert.equal(a.data.balance,5000);
  assert.equal((await call('/api/session',{method:'POST',body:{},cookie:ca})).data.balance,5000);
  const order={method:'pickup',items:[{id:'ttp-040',qty:1}]};
  const first=await call('/api/orders',{method:'POST',body:order,cookie:ca,key:'demo-order-001'});
  assert.equal(first.data.balance,4000);assert.equal(first.data.order.total,1000);
  assert.equal((await call('/api/orders',{method:'POST',body:order,cookie:ca,key:'demo-order-001'})).data.balance,4000);
  assert.equal((await call('/api/orders',{cookie:cb})).data.orders.length,0);
  assert.equal((await call('/api/test/credit',{method:'POST',body:{},cookie:ca})).status,404);
  assert.equal((await call('/api/orders',{method:'POST',body:order,cookie:ca,key:'cross-origin',origin:'https://evil.example'})).status,403);
 }finally{app.close()}
});

test('manager HUD feed is private, replay-safe and synchronizes competing managers',async()=>{
 const ids=['2cf44513-e9e7-48f2-b717-b8ffe5117a37','436b1c38-e897-491a-80fb-6a7d5c4864c0'];
 const secrets=['a'.repeat(64),'b'.repeat(64)];
 const app=buildApp({database:':memory:',now:()=>new Date('2026-11-20T18:00:00Z'),managerTokens:Object.fromEntries(ids.map((id,i)=>[id,secrets[i]]))});
 const call=(path,{method='GET',body,cookie,key,staff,secret}={})=>{
  const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);req.url=path;req.method=method;req.socket={remoteAddress:'local'};
  req.headers={host:'example.com','content-type':'application/json',...(cookie?{cookie}:{}),...(key?{'idempotency-key':key}:{}),...(staff!==undefined?{'x-secondlife-owner-key':ids[staff],authorization:'Bearer '+(secret??secrets[staff])}:{})};
  const headers={};return new Promise(resolve=>app.handler(req,{statusCode:200,setHeader(k,v){headers[k]=v},end(raw){resolve({status:this.statusCode,headers,data:JSON.parse(raw)})}}));
 };
 try{
  assert.equal((await call('/staff/feed')).status,401);
  assert.equal((await call('/staff/feed',{staff:0,secret:secrets[1]})).status,401);
  const session=await call('/api/session',{method:'POST',body:{}}),cookie=session.headers['Set-Cookie'].split(';')[0];
  const request={method:'delivery',slurl:'https://maps.secondlife.com/secondlife/Riverstone/193/11/22',items:[{id:'ttp-040',qty:1}],notes:'Counter test'};
  const order=await call('/api/orders',{method:'POST',cookie,body:request,key:'hud-test-order'});assert.equal(order.status,200);
  await call('/api/orders',{method:'POST',cookie,body:request,key:'hud-test-order'});
  const first=await call('/staff/feed?after=0',{staff:0}),other=await call('/staff/feed?after=0',{staff:1});
  assert.equal(first.data.order.id,order.data.order.id);assert.equal(other.data.order.id,first.data.order.id);
  assert.equal(first.data.order.total,1250);assert.match(first.data.order.summary,/1 x/);assert.equal(first.data.order.notes,'Counter test');
  assert.equal((await call('/staff/feed?after='+first.data.cursor,{staff:0})).data.order,null);
  const route='/staff/orders/'+first.data.order.id+'/advance';
  const changed=await call(route,{method:'POST',staff:0,body:{expectedStatus:'New'},key:'hud-advance-one'});assert.equal(changed.data.order.status,'Accepted');
  assert.equal((await call(route,{method:'POST',staff:1,body:{expectedStatus:'New'},key:'hud-advance-two'})).status,409);
  assert.equal((await call(route,{method:'POST',staff:0,body:{expectedStatus:'New'},key:'hud-advance-one'})).data.order.status,'Accepted');
  const update=await call('/staff/feed?after='+first.data.cursor,{staff:1});assert.equal(update.data.order.status,'Accepted');
  assert.equal((await call('/staff/feed?after='+update.data.cursor,{staff:1})).data.order,null);
  assert.equal((await call('/staff/queue',{staff:1})).data.count,1);
  assert.equal((await call('/staff/feed?after=999999',{staff:0})).data.reset,true);
  assert.equal((await call('/api/orders',{cookie})).data.orders[0].status,'Accepted');
 }finally{app.close()}
});
