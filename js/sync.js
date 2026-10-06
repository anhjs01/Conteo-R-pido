let peer=null,connection=null,getSnapshot=async()=>({}),applySnapshot=async()=>{},statusHandler=()=>{};
let role="host",synced=false,localVersion=0,remoteVersion=0,pendingSnapshot=null,pendingVersion=0,remoteHello=null,decisionMade=false;
const SNAPSHOT_CHUNK_SIZE=5000;
const incomingTransfers=new Map();
const emit=(status,detail="")=>statusHandler({status,detail});
const units=s=>Array.isArray(s?.units)?s.units.length:0;
const lots=s=>Array.isArray(s?.lots)?s.lots.length:0;
function latest(s){let a=[];for(const list of [s?.units,s?.lots,s?.meta])if(Array.isArray(list))for(const x of list)for(const k of ["updatedAt","createdAt","timestamp","exportedAt"]){const raw=x?.[k],t=typeof raw==="number"?raw:Date.parse(raw);if(Number.isFinite(t))a.push(t)}return a.length?Math.max(...a):0}
async function summary(s=null){s=s||await getSnapshot();return{units:units(s),lots:lots(s),total:units(s)+lots(s),updatedAt:Math.max(localVersion,latest(s),1)}}
function send(m){if(!connection?.open)return false;try{connection.send(m);return true}catch{return false}}
async function finish(detail="Datos sincronizados."){synced=true;decisionMade=true;emit("synced",detail);if(pendingSnapshot){const s=pendingSnapshot,v=pendingVersion;pendingSnapshot=null;pendingVersion=0;sendUpdate(s,v)}}
function sendSnapshot(type,snapshot,version=0){
  if(!snapshot)return false;
  const chars=Array.from(JSON.stringify(snapshot));
  const total=Math.max(1,Math.ceil(chars.length/SNAPSHOT_CHUNK_SIZE));
  const transferId=type+"-"+Date.now()+"-"+Math.random().toString(36).slice(2,8);
  for(let i=0;i<total;i++){
    const chunk=chars.slice(i*SNAPSHOT_CHUNK_SIZE,(i+1)*SNAPSHOT_CHUNK_SIZE).join("");
    if(!send({type:"snapshot-chunk",transferId,index:i,total,version,purpose:type,data:chunk}))return false;
  }
  return true;
}
function sendUpdate(snapshot,version=0){
  if(!snapshot)return false;
  localVersion=Math.max(localVersion,version||Date.now());
  return sendSnapshot("state-update",snapshot,localVersion);
}
async function receiveSnapshotChunk(m){
  const id=String(m.transferId||"");
  if(!id||!Number.isInteger(m.index)||!Number.isInteger(m.total)||m.total<1||m.index<0||m.index>=m.total||typeof m.data!=="string")return;
  let t=incomingTransfers.get(id);
  if(!t){
    t={total:m.total,version:Number(m.version)||Date.now(),purpose:m.purpose,chunks:new Array(m.total),received:0};
    incomingTransfers.set(id,t);
  }
  if(t.total!==m.total)return;
  if(t.chunks[m.index]===undefined){
    t.chunks[m.index]=m.data;
    t.received++;
  }
  if(t.received<t.total)return;
  incomingTransfers.delete(id);
  const snapshot=JSON.parse(t.chunks.join(""));
  const v=t.version;
  if(t.purpose==="state-response"){
    if(v>=remoteVersion){
      remoteVersion=v;
      emit("applying","Aplicando los datos del otro dispositivo…");
      await applySnapshot(snapshot);
    }
    send({type:"sync-ack",version:remoteVersion});
    await finish("Sincronización inicial completada.");
    return;
  }
  if(t.purpose==="state-update"){
    if(v<=remoteVersion)return;
    remoteVersion=v;
    emit("applying","Aplicando actualización…");
    await applySnapshot(snapshot);
    emit("synced","Datos actualizados desde el otro dispositivo.");
  }
}
async function handshake(){if(!connection?.open)return;synced=false;decisionMade=false;remoteHello=null;const s=await getSnapshot(),sum=await summary(s);localVersion=Math.max(localVersion,sum.updatedAt);send({type:"hello",role,summary:sum});emit("checking","Comparando los datos de ambos dispositivos…")}
async function decideAsHost(){
  if(decisionMade||role!=="host"||!remoteHello||!connection?.open)return;
  decisionMade=true;
  const local=await summary();
  const remote=remoteHello.summary||{};
  const remoteTotal=Number(remote.total??((remote.units??0)+(remote.lots??0)));
  const hostWins=local.total>remoteTotal||(local.total===remoteTotal&&(local.updatedAt??0)>=(remote.updatedAt??0));

  if(hostWins){
    const s=await getSnapshot(),v=Math.max(localVersion,Date.now());
    localVersion=v;
    send({type:"initial-decision",winner:"host",version:v});
    emit("applying","Enviando los datos del PC al dispositivo…");
    sendSnapshot("state-response",s,v);
  }else{
    send({type:"initial-decision",winner:"joiner"});
    send({type:"request-state"});
    emit("applying","Recibiendo los datos del dispositivo…");
  }
}

function attach(conn,r="host"){
  if(connection&&connection!==conn){try{conn.close()}catch{}return}
  connection=conn;
  role=r;
  conn.on("open",async()=>{
    emit("connected","Dispositivo conectado. Comparando datos…");
    await handshake();
  });
  conn.on("data",async m=>{
    try{
      if(!m||typeof m!=="object")return;
      if(m.type==="hello"){
        remoteHello=m;
        emit("checking","Comparando los datos de ambos dispositivos…");
        if(role==="host"&&m.role==="joiner")await decideAsHost();
        return;
      }
      if(m.type==="initial-decision"){
        if(m.winner==="host")emit("applying","Aplicando los datos del PC…");
        else if(m.winner==="joiner")emit("applying","Enviando los datos del dispositivo al PC…");
        return;
      }
      if(m.type==="request-state"){
        const s=await getSnapshot(),sum=await summary(s);
        localVersion=Math.max(localVersion,sum.updatedAt,Date.now());
        sendSnapshot("state-response",s,localVersion);
        return;
      }
      if(m.type==="snapshot-chunk"){
        await receiveSnapshotChunk(m);
        return;
      }
      if(m.type==="state-response"&&m.snapshot){
        const v=Number(m.version)||Date.now();
        if(v>=remoteVersion){
          remoteVersion=v;
          emit("applying","Aplicando los datos del otro dispositivo…");
          await applySnapshot(m.snapshot);
        }
        send({type:"sync-ack",version:remoteVersion});
        await finish("Sincronización inicial completada.");
        return;
      }
      if(m.type==="sync-ack"){
        if(!synced)await finish("Sincronización inicial completada.");
        return;
      }
      if(m.type==="state-update"&&m.snapshot){
        const v=Number(m.version)||0;
        if(v<=remoteVersion)return;
        remoteVersion=v;
        emit("applying","Aplicando actualización…");
        await applySnapshot(m.snapshot);
        emit("synced","Datos actualizados desde el otro dispositivo.");
        return;
      }
      if(m.type==="ping")send({type:"pong"});
    }catch(e){emit("error",e?.message||"No se pudo sincronizar.")}
  });
  conn.on("close",()=>{
    if(connection===conn){
      connection=null;
      synced=false;
      decisionMade=false;
      remoteHello=null;
      emit("disconnected","La conexión se cerró.");
    }
  });
  conn.on("error",e=>emit("error",e?.message||"Error de conexión."));
}

function ensure(){if(peer&&!peer.destroyed)return peer;if(!window.Peer)throw new Error("No se pudo cargar el servicio de sincronización.");peer=new Peer(undefined,{debug:0});peer.on("connection",c=>attach(c,"host"));peer.on("disconnected",()=>emit("disconnected","Se perdió la señal de sincronización."));peer.on("error",e=>emit("error",e?.message||"No se pudo conectar."));return peer}
export async function host(){const p=ensure();role="host";return await new Promise((resolve,reject)=>{if(p.open)return resolve(p.id);const o=id=>{clean();resolve(id)},e=x=>{clean();reject(x)},clean=()=>{p.off("open",o);p.off("error",e)};p.on("open",o);p.on("error",e)})}
export async function join(id){id=String(id||"").trim();if(!id)throw new Error("Escribe o escanea el código del PC.");const p=ensure();if(connection){try{connection.close()}catch{}connection=null}role="joiner";const c=p.connect(id,{reliable:true,serialization:"json",metadata:{role:"joiner"}});attach(c,"joiner");return c}
export function configure(o={}){getSnapshot=o.getSnapshot||getSnapshot;applySnapshot=o.applySnapshot||applySnapshot;statusHandler=o.onStatus||statusHandler}
export function broadcastSnapshot(snapshot){const v=Math.max(Date.now(),localVersion+1);localVersion=v;if(!synced||!connection?.open){pendingSnapshot=snapshot;pendingVersion=v;return false}sendUpdate(snapshot,v);return true}
export function isConnected(){return!!connection?.open}
export function currentPeerId(){return peer?.id||""}
export function disconnect(){try{connection?.close()}catch{}try{peer?.destroy()}catch{}connection=null;peer=null;synced=false;decisionMade=false;remoteHello=null;pendingSnapshot=null;pendingVersion=0;emit("disconnected","Sincronización desconectada.")}
export const sync={host,join,configure,broadcastSnapshot,isConnected,currentPeerId,disconnect};