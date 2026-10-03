let peer=null;
let connection=null;
let getSnapshot=async()=>({});
let applySnapshot=async()=>{};
let statusHandler=()=>{};

function emit(status,detail=""){statusHandler({status,detail});}

function attach(conn){
  connection=conn;
  conn.on("open",async()=>{
    emit("connected","Dispositivo conectado");
    try{conn.send({type:"request-snapshot"});}catch{}
  });
  conn.on("data",async msg=>{
    try{
      if(!msg||typeof msg!=="object")return;
      if(msg.type==="request-snapshot"){
        const snapshot=await getSnapshot();
        conn.send({type:"snapshot",snapshot});
      }else if(msg.type==="snapshot"&&msg.snapshot){
        await applySnapshot(msg.snapshot);
        emit("connected","Datos sincronizados");
      }else if(msg.type==="ping"){
        conn.send({type:"pong"});
      }
    }catch(e){emit("error",e?.message||"No se pudo sincronizar");}
  });
  conn.on("close",()=>{connection=null;emit("disconnected","La conexión se cerró");});
  conn.on("error",e=>emit("error",e?.message||"Error de conexión"));
}

function ensurePeer(){
  if(peer&&!peer.destroyed)return peer;
  if(!window.Peer)throw new Error("No se pudo cargar el servicio de sincronización.");
  peer=new Peer(undefined,{debug:0});
  peer.on("connection",attach);
  peer.on("disconnected",()=>emit("disconnected","Se perdió la señal de sincronización"));
  peer.on("error",e=>emit("error",e?.message||"No se pudo conectar"));
  return peer;
}

export async function host(){
  const p=ensurePeer();
  return await new Promise((resolve,reject)=>{
    if(p.open)return resolve(p.id);
    const onOpen=id=>{cleanup();resolve(id)};
    const onError=e=>{cleanup();reject(e)};
    const cleanup=()=>{p.off("open",onOpen);p.off("error",onError)};
    p.on("open",onOpen);p.on("error",onError);
  });
}

export async function join(id){
  id=String(id||"").trim();
  if(!id)throw new Error("Escribe o escanea el código del PC.");
  const p=ensurePeer();
  const conn=p.connect(id,{reliable:true,serialization:"json"});
  attach(conn);
  return conn;
}

export function configure(options={}){
  getSnapshot=options.getSnapshot||getSnapshot;
  applySnapshot=options.applySnapshot||applySnapshot;
  statusHandler=options.onStatus||statusHandler;
}

export function broadcastSnapshot(snapshot){
  if(connection?.open){
    try{connection.send({type:"snapshot",snapshot});return true}catch{}
  }
  return false;
}

export function isConnected(){return !!connection?.open}
export function currentPeerId(){return peer?.id||""}
export function disconnect(){
  try{connection?.close()}catch{}
  try{peer?.destroy()}catch{}
  connection=null;peer=null;emit("disconnected","Sincronización desconectada");
}

export const sync={host,join,configure,broadcastSnapshot,isConnected,currentPeerId,disconnect};