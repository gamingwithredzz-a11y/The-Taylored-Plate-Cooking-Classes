// Same-origin browser demo session. No real-avatar or manager credentials.
let connected=false,pending=null,busy=false;
async function api(path,options={}){
 const response=await fetch('/api/'+path,{credentials:'same-origin',...options});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data;
}
async function sync(){
 const [b,o]=await Promise.all([api('balance'),api('orders')]);balance=b.balance;orders=o.orders;render();
 $('#balance').textContent='Demo balance · '+money(balance);
}
async function initialize(){
 balance=0;render();$('#checkout').disabled=true;
 try{await api('session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});connected=true;await sync();$('#message').textContent='Server demo connected. No real L$. Orders enter the Manager HUD queue.'}
 catch(e){$('#message').textContent=e.message;$('#checkout').disabled=true}
}
$('#demoHours').closest('label').style.display='none';$('#clock').value='live';
$('#demoReset').textContent='Clear cart';$('#demoReset').onclick=()=>{if(busy)return;cart=[];pending=null;$('#notes').value='';$('#slurl').value='';render();$('#message').textContent='Cart cleared. Server demo balance and history kept.'};
$('#checkout').onclick=async()=>{
 if(!connected||busy||!cart.length)return;
 if(!isOpen()){$('#message').textContent='Closed. Orders open Monday–Saturday, 10 AM–7 PM SLT.';return}
 const body={method:$('#method').value,slurl:$('#slurl').value,notes:$('#notes').value,items:cart.map(i=>({id:i.id,qty:i.qty,...(i.flavor?{flavor:i.flavor}:{})}))};
 if(body.method==='delivery'&&!parseDeliverySLURL(body.slurl)){$('#message').textContent='Paste a valid community delivery SLURL.';return}
 const fingerprint=JSON.stringify(body);if(!pending||pending.fingerprint!==fingerprint)pending={fingerprint,key:crypto.randomUUID()};
 busy=true;const controls=[...document.querySelectorAll('button,input,select,textarea')].map(el=>({el,disabled:el.disabled}));controls.forEach(({el})=>el.disabled=true);
 try{
  const result=await api('orders',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':pending.key},body:fingerprint});
  balance=result.balance;cart=[];pending=null;$('#notes').value='';$('#message').textContent='Demo order saved for the Manager HUD queue. No real L$ charged.';
 }catch(e){$('#message').textContent=e.message+' Retry uses the same request key.'}
 finally{busy=false;controls.forEach(({el,disabled})=>el.disabled=disabled);await sync().catch(()=>render())}
};
document.querySelector('.demoBanner span').textContent='SERVER DEMO · no real L$ · Manager HUD queue';
document.querySelector('.foot').textContent='Taylored Eats server demo. Anonymous browser session only; not your Second Life account. Demo data can reset on service restart. Real payments are disabled. Authorized, connected Manager HUDs receive demo order alerts.';
initialize();setInterval(()=>{if(connected&&!busy)sync().catch(()=>{})},20000);

