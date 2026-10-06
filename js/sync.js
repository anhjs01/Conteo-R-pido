let peer=null;
let connection=null;
let getSnapshot=async()=>({});
let applySnapshot=async()=>{};
let statusHandler=()=>{};

let role="host";
let synced=false;
let localVersion=0;
let remoteVersion=0;
let pendingSnapshot=null;
let pendingVersion=0;
let remoteHello=null;
let decisionMade=false;

function emit(status,detail=""){
  statusHandler({status,detail});
}

function countUnits(snapshot){
  return Array.isArray(snapshot?.units)?snapshot.units.length:0;
}

function countLots(snapshot){
  return Array.isArray(snapshot?.lots)?snapshot.lots.length:0;
}

function latestTimestamp(snapshot){
  const values=[];

  for(const list of [snapshot?.units,snapshot?.lots,snapshot?.meta]){
    if(!Array.isArray(list))continue;

    for(const item of list){
      for(const key of ["updatedAt","createdAt","timestamp","exportedAt"]){
        const t=Date.parse(item?.[key]);

        if(Number.isFinite(t)){
          values.push(t);
        }
      }
    }
  }

  return values.length?Math.max(...values):0;
}

async function makeSummary(snapshot=null){
  const s=snapshot||await getSnapshot();

  return {
    units:countUnits(s),
    lots:countLots(s),
    updatedAt:Math.max(
      localVersion,
      latestTimestamp(s),
      1
    )
  };
}

function send(message){
  if(!connection?.open)return false;

  try{
    connection.send(message);
    return true;
  }catch{
    return false;
  }
}

async function finishSynced(detail="Datos sincronizados."){
  synced=true;
  decisionMade=true;

  emit("synced",detail);

  if(pendingSnapshot){
    const snapshot=pendingSnapshot;
    const version=pendingVersion;

    pendingSnapshot=null;
    pendingVersion=0;

    await sendLocalUpdate(snapshot,version);
  }
}

async function sendLocalUpdate(snapshot,version=0){
  if(!snapshot)return false;

  localVersion=Math.max(
    localVersion,
    version||Date.now()
  );

  return send({
    type:"state-update",
    version:localVersion,
    snapshot
  });
}

async function beginHandshake(){
  if(!connection?.open)return;

  synced=false;
  decisionMade=false;
  remoteHello=null;
  pendingSnapshot=null;
  pendingVersion=0;

  const snapshot=await getSnapshot();
  const summary=await makeSummary(snapshot);

  localVersion=Math.max(
    localVersion,
    summary.updatedAt
  );

  send({
    type:"hello",
    role,
    summary
  });

  emit(
    "checking",
    "Comparando los datos de ambos dispositivos…"
  );
}

async function decideInitialSync(){
  if(
    decisionMade||
    role!=="joiner"||
    !remoteHello||
    !connection?.open
  ){
    return;
  }

  decisionMade=true;

  const local=await makeSummary();
  const remote=remoteHello.summary||{};

  let winner="joiner";

  if((remote.units??0)>local.units){
    winner="host";
  }else if((remote.units??0)===local.units){
    if((remote.lots??0)>local.lots){
      winner="host";
    }else if(
      (remote.lots??0)===local.lots&&
      (remote.updatedAt??0)>=local.updatedAt
    ){
      winner="host";
    }
  }

  if(winner==="joiner"){
    const snapshot=await getSnapshot();
    const version=Math.max(
      localVersion,
      Date.now()
    );

    localVersion=version;

    send({
      type:"initial-decision",
      winner:"joiner",
      version,
      snapshot
    });

    await finishSynced(
      "Sincronización inicial completada. Se conservaron los datos con más registros."
    );
  }else{
    send({
      type:"initial-decision",
      winner:"host"
    });

    send({
      type:"request-state"
    });
  }
}

async function attach(conn,connectionRole="host"){
  if(connection&&connection!==conn){
    try{
      conn.close();
    }catch{}

    return;
  }

  connection=conn;
  role=connectionRole;

  conn.on("open",async()=>{
    emit(
      "connected",
      "Dispositivo conectado. Comparando datos…"
    );

    await beginHandshake();
  });

  conn.on("data",async msg=>{
    try{
      if(!msg||typeof msg!=="object")return;

      if(msg.type==="hello"){
        remoteHello=msg;

        emit(
          "checking",
          "Comparando los datos de ambos dispositivos…"
        );

        await decideInitialSync();
        return;
      }

      if(msg.type==="initial-decision"){
        if(msg.winner==="joiner"){
          remoteVersion=Math.max(
            remoteVersion,
            Number(msg.version)||0
          );

          if(msg.snapshot){
            await applySnapshot(msg.snapshot);

            remoteVersion=Math.max(
              remoteVersion,
              Number(msg.version)||0
            );
          }

          await finishSynced(
            "Sincronización inicial completada. Los datos del otro dispositivo tenían más registros."
          );
        }

        return;
      }

      if(msg.type==="request-state"){
        const snapshot=await getSnapshot();
        const summary=await makeSummary(snapshot);

        localVersion=Math.max(
          localVersion,
          summary.updatedAt,
          Date.now()
        );

        send({
          type:"state-response",
          version:localVersion,
          snapshot
        });

        if(role==="host"){
          await finishSynced(
            "Sincronización inicial completada."
          );
        }

        return;
      }

      if(msg.type==="state-response"&&msg.snapshot){
        const version=Number(msg.version)||Date.now();

        if(version>=remoteVersion){
          remoteVersion=version;
          await applySnapshot(msg.snapshot);
        }

        await finishSynced(
          "Sincronización inicial completada."
        );

        return;
      }

      if(msg.type==="state-update"&&msg.snapshot){
        const version=Number(msg.version)||0;

        if(version<=remoteVersion)return;

        remoteVersion=version;

        await applySnapshot(msg.snapshot);

        emit(
          "synced",
          "Datos actualizados desde el otro dispositivo."
        );

        return;
      }

      if(msg.type==="ping"){
        send({type:"pong"});
      }
    }catch(e){
      emit(
        "error",
        e?.message||"No se pudo sincronizar."
      );
    }
  });

  conn.on("close",()=>{
    if(connection===conn){
      connection=null;
      synced=false;
      decisionMade=false;

      emit(
        "disconnected",
        "La conexión se cerró."
      );
    }
  });

  conn.on("error",e=>{
    emit(
      "error",
      e?.message||"Error de conexión."
    );
  });
}

function ensurePeer(){
  if(peer&&!peer.destroyed)return peer;

  if(!window.Peer){
    throw new Error(
      "No se pudo cargar el servicio de sincronización."
    );
  }

  peer=new Peer(undefined,{debug:0});

  peer.on(
    "connection",
    conn=>attach(conn,"host")
  );

  peer.on(
    "disconnected",
    ()=>emit(
      "disconnected",
      "Se perdió la señal de sincronización."
    )
  );

  peer.on(
    "error",
    e=>emit(
      "error",
      e?.message||"No se pudo conectar."
    )
  );

  return peer;
}

export async function host(){
  const p=ensurePeer();

  role="host";

  return await new Promise((resolve,reject)=>{
    if(p.open){
      return resolve(p.id);
    }

    const onOpen=id=>{
      cleanup();
      resolve(id);
    };

    const onError=e=>{
      cleanup();
      reject(e);
    };

    const cleanup=()=>{
      p.off("open",onOpen);
      p.off("error",onError);
    };

    p.on("open",onOpen);
    p.on("error",onError);
  });
}

export async function join(id){
  id=String(id||"").trim();

  if(!id){
    throw new Error(
      "Escribe o escanea el código del PC."
    );
  }

  const p=ensurePeer();

  if(connection){
    try{
      connection.close();
    }catch{}

    connection=null;
  }

  role="joiner";

  const conn=p.connect(
    id,
    {
      reliable:true,
      serialization:"json",
      metadata:{
        role:"joiner"
      }
    }
  );

  attach(conn,"joiner");

  return conn;
}

export function configure(options={}){
  getSnapshot=
    options.getSnapshot||
    getSnapshot;

  applySnapshot=
    options.applySnapshot||
    applySnapshot;

  statusHandler=
    options.onStatus||
    statusHandler;
}

export function broadcastSnapshot(snapshot){
  const version=Math.max(
    Date.now(),
    localVersion+1
  );

  localVersion=version;

  if(!synced||!connection?.open){
    pendingSnapshot=snapshot;
    pendingVersion=version;
    return false;
  }

  sendLocalUpdate(
    snapshot,
    version
  );

  return true;
}

export function isConnected(){
  return !!connection?.open;
}

export function currentPeerId(){
  return peer?.id||"";
}

export function disconnect(){
  try{
    connection?.close();
  }catch{}

  try{
    peer?.destroy();
  }catch{}

  connection=null;
  peer=null;
  synced=false;
  decisionMade=false;
  remoteHello=null;
  pendingSnapshot=null;
  pendingVersion=0;

  emit(
    "disconnected",
    "Sincronización desconectada."
  );
}

export const sync={
  host,
  join,
  configure,
  broadcastSnapshot,
  isConnected,
  currentPeerId,
  disconnect
};
