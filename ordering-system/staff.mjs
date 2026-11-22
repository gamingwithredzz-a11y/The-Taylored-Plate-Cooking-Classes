import {timingSafeEqual} from 'node:crypto';
export const MANAGERS=['2cf44513-e9e7-48f2-b717-b8ffe5117a37','436b1c38-e897-491a-80fb-6a7d5c4864c0'];
export function staffConfig(raw=process.env.TE_MANAGER_TOKENS??'{}'){
 const config=typeof raw==='string'?JSON.parse(raw):raw;
 if(!config||typeof config!=='object'||Array.isArray(config))throw Error('Invalid manager configuration');
 for(const [id,secret] of Object.entries(config))if(!MANAGERS.includes(id)||typeof secret!=='string'||!/^[a-f0-9]{64}$/.test(secret))throw Error('Invalid manager credential');
 return config;
}
export function compact(order){
 if(!order)return null;
 const summary=order.items.map(i=>`${i.qty} x ${i.name}${i.flavor?' ('+i.flavor+')':''}`).join('\n');
 return {id:order.id,status:order.status,method:order.method,location:order.location,total:order.total,
  created:order.created,customer:order.avatar,notes:order.notes,summary:summary.slice(0,1800),truncated:summary.length>1800};
}
export function createStaffHandler({invoke,credentials}){
 const rates=new Map();
 return async(req,res,u,send)=>{
  const manager=String(req.headers['x-secondlife-owner-key']??'').toLowerCase();
  const supplied=Buffer.from(String(req.headers.authorization??'')),secret=credentials[manager];
  const expected=Buffer.from('Bearer '+(secret??''));
  if(!secret||supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return send(401,{error:'Manager HUD credential required'});
  const stamp=Date.now(),prior=rates.get(manager);
  if(prior&&stamp-prior.start<60000){if(++prior.count>60)return send(429,{error:'Wait before retrying'})}else rates.set(manager,{start:stamp,count:1});
  if(req.method==='GET'&&u.pathname==='/staff/feed'){
   const response=await invoke('/staff/feed'+u.search,manager);
   return send(response.status,response.status===200?{...response.body,order:compact(response.body.order)}:response.body);
  }
  if(req.method==='GET'&&u.pathname==='/staff/queue'){
   const response=await invoke('/orders',manager);
   if(response.status!==200)return send(response.status,response.body);
   const active=response.body.orders.filter(o=>!['Delivered','Collected'].includes(o.status));
   const index=Number(u.searchParams.get('index')??0);
   if(!Number.isSafeInteger(index)||index<0)return send(400,{error:'Invalid queue index'});
   return send(200,{count:active.length,index:active.length?index%active.length:0,order:compact(active[index%active.length]),mode:'demo'});
  }
  if(req.method==='POST'&&/^\/staff\/orders\/[a-f0-9-]{36}\/advance$/.test(u.pathname)){
   if(!String(req.headers['content-type']??'').startsWith('application/json'))return send(415,{error:'JSON required'});
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048)return send(413,{error:'Request too large'})}
   let body;try{body=JSON.parse(raw)}catch{return send(400,{error:'Invalid JSON'})}
   const response=await invoke(u.pathname.slice(6),manager,'POST',body,req.headers['idempotency-key']);
   return send(response.status,response.status===200?{...response.body,order:compact(response.body.order)}:response.body);
  }
  return send(404,{error:'Staff endpoint missing'});
 };
}
