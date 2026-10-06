let peer=null;
const connections=new Map();

let getSnapshot=async()=>({});
let applySnapshot=async()=>{};
let statusHandler=()=>{};

const DEVICE_NAME_KEY="conteo-rapido-device-name";

let deviceName=localStorage.getItem(DEVICE_NAME_KEY)||"Dispositivo";

function emit(status,detail="",extra={}){
  try{
    statusHandler({
      status,
      detail,
      ...extra
    });
  }catch{}
}

function setDeviceName(name){
  const value=String(name||"").trim()||"Dispositivo";
  deviceName=value;
  localStorage.setItem(DEVICE_NAME_KEY,value);

  for(const item of connections.values()){
    if(item.connection?.open){
      try{
        item.connection.send({
          type:"device-info",
          device:{
            id:peer?.id||"",
            name:deviceName
          }
        });
      }catch{}
    }
  }

  return value;
}

function getDeviceName(){
  return deviceName;
}

function getLastUpdate(snapshot){
  const dates=[];

  for(const list of [snapshot?.units,snapshot?.lots]){
    if(!Array.isArray(list))continue;

    for(const item of list){
      if(!item?.updatedAt)continue;

      const t=new Date(item.updatedAt).getTime();

      if(!Number.isNaN(t))dates.push(t);
    }
  }

  return dates.length
    ?new Date(Math.max(...dates)).toISOString()
    :null;
}

function stableValue(value){
  if(Array.isArray(value)){
    return value.map(stableValue);
  }

  if(value&&typeof value==="object"){
    return Object.keys(value)
      .sort()
      .reduce((out,key)=>{
        out[key]=stableValue(value[key]);
        return out;
      },{});
  }

  return value;
}

function fingerprint(snapshot){
  try{
    const normalized={
      units:Array.isArray(snapshot?.units)
        ?[...snapshot.units].sort((a,b)=>
          String(a?.id??a?.unitId??"")
          .localeCompare(String(b?.id??b?.unitId??""))
        )
        :[],
      lots:Array.isArray(snapshot?.lots)
        ?[...snapshot.lots].sort((a,b)=>
          String(a?.id??"")
          .localeCompare(String(b?.id??""))
        )
        :[],
      meta:Array.isArray(snapshot?.meta)
        ?[...snapshot.meta].sort((a,b)=>
          String(a?.key??a?.id??"")
          .localeCompare(String(b?.key??b?.id??""))
        )
        :[]
    };

    const text=JSON.stringify(stableValue(normalized));

    let hash=2166136261;

    for(let i=0;i<text.length;i++){
      hash^=text.charCodeAt(i);
      hash=Math.imul(hash,16777619);
    }

    return (hash>>>0).toString(16).padStart(8,"0");
  }catch{
    return "";
  }
}

async function buildInfo(){
  const snapshot=await getSnapshot();

  return{
    fingerprint:fingerprint(snapshot),
    units:Array.isArray(snapshot?.units)
      ?snapshot.units.length
      :0,
    lots:Array.isArray(snapshot?.lots)
      ?snapshot.lots.length
      :0,
    lastUpdate:getLastUpdate(snapshot)
  };
}

function connectionSummary(){
  return [...connections.entries()]
    .filter(([,item])=>item.connection?.open)
    .map(([key,item])=>({
      key,
      peerId:item.peerId||"",
      name:item.name||"Dispositivo conectado",
      state:item.state||"connected",
      summary:item.summary||null,
      lastSync:item.lastSync||null,
      open:true
    }));
}

function findConnection(peerId){
  const id=String(peerId||"");

  for(const [key,item] of connections.entries()){
    if(String(item.peerId||"")===id){
      return{
        key,
        ...item
      };
    }
  }

  return null;
}

function send(conn,message){
  if(!conn?.open)return false;

  try{
    conn.send(message);
    return true;
  }catch{
    return false;
  }
}

function markSynced(item,info={}){
  if(!item)return;

  item.state="synced";
  item.remoteFingerprint=info.fingerprint||item.remoteFingerprint||"";
  item.syncedFingerprint=info.fingerprint||item.syncedFingerprint||"";
  item.lastSync=new Date().toISOString();
}

async function evaluateConnection(item){
  if(!item?.connection?.open)return;

  try{
    const local=await buildInfo();

    item.localSummary=local;
    item.state="checking";

    send(item.connection,{
      type:"sync-info",
      device:{
        id:peer?.id||"",
        name:deviceName
      },
      summary:local
    });

    emit(
      "checking",
      "Comprobando datos del dispositivo…",
      {
        peerId:item.peerId,
        peerName:item.name,
        connections:connectionSummary()
      }
    );
  }catch(e){
    emit(
      "error",
      e?.message||"No se pudo comprobar la sincronización.",
      {
        peerId:item.peerId,
        connections:connectionSummary()
      }
    );
  }
}

function attach(conn,initiator=false){
  if(!conn)return;

  const peerId=String(conn.peer||"");
  const key=peerId||Math.random().toString(36).slice(2);

  const old=connections.get(key);

  if(old?.connection&&old.connection!==conn){
    try{
      old.connection.close();
    }catch{}
  }

  const item={
    connection:conn,
    peerId,
    name:"Dispositivo conectado",
    state:"connecting",
    initiator,
    remoteFingerprint:"",
    syncedFingerprint:"",
    localSummary:null,
    summary:null,
    lastSync:null
  };

  connections.set(key,item);

  conn.on("open",async()=>{
    item.state="checking";

    send(conn,{
      type:"hello",
      device:{
        id:peer?.id||"",
        name:deviceName
      }
    });

    await evaluateConnection(item);
  });

  conn.on("data",async msg=>{
    try{
      if(!msg||typeof msg!=="object")return;

      if(msg.type==="hello"){
        item.name=
          String(msg.device?.name||"").trim()||
          "Dispositivo conectado";

        emit(
          "checking",
          "Dispositivo identificado. Comprobando datos…",
          {
            peerId:item.peerId,
            peerName:item.name,
            remoteDevice:msg.device||{},
            connections:connectionSummary()
          }
        );

        return;
      }

      if(msg.type==="sync-info"){
        item.name=
          String(msg.device?.name||"").trim()||
          item.name||
          "Dispositivo conectado";

        item.summary={
          units:Number(msg.summary?.units||0),
          lots:Number(msg.summary?.lots||0),
          lastUpdate:msg.summary?.lastUpdate||null,
          fingerprint:String(msg.summary?.fingerprint||"")
        };

        item.remoteFingerprint=
          String(msg.summary?.fingerprint||"");

        const local=await buildInfo();

        item.localSummary=local;

        /*
         * Si ambos estados son idénticos no hay conflicto.
         */
        if(
          local.fingerprint&&
          item.remoteFingerprint&&
          local.fingerprint===item.remoteFingerprint
        ){
          markSynced(item,{
            fingerprint:local.fingerprint
          });

          send(conn,{
            type:"sync-state",
            state:"synced",
            fingerprint:local.fingerprint
          });

          emit(
            "synced",
            "Datos sincronizados.",
            {
              peerId:item.peerId,
              peerName:item.name,
              localSummary:local,
              remoteSummary:item.summary,
              connections:connectionSummary()
            }
          );

          return;
        }

        /*
         * Los datos son diferentes.
         *
         * Nunca reemplazamos datos aquí.
         *
         * Pedimos el snapshot únicamente para que app.js
         * pueda mostrar al usuario ambos lados y preguntarle.
         */
        item.state="conflict";

        send(conn,{
          type:"request-snapshot"
        });

        emit(
          "conflict-checking",
          "Se detectaron diferencias. Revisando los datos…",
          {
            peerId:item.peerId,
            peerName:item.name,
            localSummary:local,
            remoteSummary:item.summary,
            connections:connectionSummary()
          }
        );

        return;
      }

      if(msg.type==="request-snapshot"){
        const snapshot=await getSnapshot();

        send(conn,{
          type:"snapshot",
          snapshot,
          source:{
            id:peer?.id||"",
            name:deviceName
          },
          summary:{
            fingerprint:fingerprint(snapshot),
            units:Array.isArray(snapshot?.units)
              ?snapshot.units.length
              :0,
            lots:Array.isArray(snapshot?.lots)
              ?snapshot.lots.length
              :0,
            lastUpdate:getLastUpdate(snapshot)
          },
          sentAt:new Date().toISOString()
        });

        return;
      }

      if(msg.type==="snapshot"){
        /*
         * IMPORTANTE:
         * jamás aplicamos el snapshot automáticamente.
         */
        item.state="conflict";

        item.name=
          String(msg.source?.name||"").trim()||
          item.name||
          "Dispositivo conectado";

        item.summary=msg.summary||null;

        emit(
          "snapshot-received",
          "Se recibieron datos para decidir qué inventario conservar.",
          {
            peerId:item.peerId,
            peerName:item.name,
            snapshot:msg.snapshot,
            remoteDevice:msg.source||{},
            remoteSummary:msg.summary||{},
            connections:connectionSummary()
          }
        );

        return;
      }

      if(msg.type==="replace-snapshot"){
        /*
         * Esta orden solo llega después de que el otro
         * dispositivo eligió explícitamente conservar
         * sus propios datos.
         */
        if(!msg.snapshot)return;

        await applySnapshot(msg.snapshot);

        const info=await buildInfo();

        markSynced(item,{
          fingerprint:info.fingerprint
        });

        send(conn,{
          type:"sync-ack",
          fingerprint:info.fingerprint,
          detail:"Datos recibidos y sincronizados."
        });

        emit(
          "synced",
          "Datos recibidos y sincronizados.",
          {
            peerId:item.peerId,
            peerName:item.name,
            connections:connectionSummary()
          }
        );

        return;
      }

      if(msg.type==="sync-ack"){
        item.state="synced";
        item.syncedFingerprint=
          String(msg.fingerprint||"");
        item.remoteFingerprint=
          String(msg.fingerprint||"");
        item.lastSync=new Date().toISOString();

        emit(
          "synced",
          msg.detail||"Datos sincronizados.",
          {
            peerId:item.peerId,
            peerName:item.name,
            connections:connectionSummary()
          }
        );

        return;
      }

      if(msg.type==="sync-state"){
        if(msg.state==="synced"){
          item.state="synced";
          item.syncedFingerprint=
            String(msg.fingerprint||"");
          item.remoteFingerprint=
            String(msg.fingerprint||"");
          item.lastSync=new Date().toISOString();

          emit(
            "synced",
            "Datos sincronizados.",
            {
              peerId:item.peerId,
              peerName:item.name,
              connections:connectionSummary()
            }
          );
        }

        return;
      }

      if(msg.type==="state-update"){
        const local=await buildInfo();

        /*
         * Si el estado local sigue siendo exactamente el estado
         * que ambos tenían cuando quedaron sincronizados,
         * el cambio remoto se puede aplicar automáticamente.
         */
        if(
          msg.baseFingerprint&&
          local.fingerprint===msg.baseFingerprint
        ){
          await applySnapshot(msg.snapshot);

          const info=await buildInfo();

          item.state="synced";
          item.syncedFingerprint=info.fingerprint;
          item.remoteFingerprint=info.fingerprint;
          item.lastSync=new Date().toISOString();

          send(conn,{
            type:"sync-state",
            state:"synced",
            fingerprint:info.fingerprint
          });

          emit(
            "synced",
            "Cambio sincronizado.",
            {
              peerId:item.peerId,
              peerName:item.name,
              connections:connectionSummary()
            }
          );
        }else{
          /*
           * Ambos dispositivos cambiaron datos por separado.
           * Volvemos a pedir decisión humana.
           */
          item.state="conflict";

          send(conn,{
            type:"request-snapshot"
          });

          emit(
            "snapshot-conflict",
            "Ambos dispositivos tienen cambios diferentes.",
            {
              peerId:item.peerId,
              peerName:item.name,
              connections:connectionSummary()
            }
          );
        }

        return;
      }

      if(msg.type==="ping"){
        send(conn,{
          type:"pong"
        });

        return;
      }

      if(msg.type==="pong"){
        return;
      }
    }catch(e){
      emit(
        "error",
        e?.message||"No se pudo procesar la sincronización.",
        {
          peerId:item.peerId,
          peerName:item.name,
          connections:connectionSummary()
        }
      );
    }
  });

  conn.on("close",()=>{
    connections.delete(key);

    emit(
      connections.size
        ?"connected"
        :"disconnected",
      connections.size
        ?"Un dispositivo se desconectó."
        :"La conexión de sincronización se cerró.",
      {
        peerId,
        connections:connectionSummary()
      }
    );
  });

  conn.on("error",e=>{
    emit(
      "error",
      e?.message||"Error de conexión.",
      {
        peerId,
        peerName:item.name,
        connections:connectionSummary()
      }
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

  peer=new Peer(undefined,{
    debug:0
  });

  peer.on("connection",conn=>{
    attach(conn,false);
  });

  peer.on("open",id=>{
    emit(
      "ready",
      "Dispositivo listo para sincronizar.",
      {
        peerId:id,
        deviceName,
        connections:connectionSummary()
      }
    );
  });

  peer.on("disconnected",()=>{
    emit(
      "disconnected",
      "Se perdió la conexión con el servicio de sincronización.",
      {
        connections:connectionSummary()
      }
    );
  });

  peer.on("error",e=>{
    emit(
      "error",
      e?.message||"No se pudo conectar.",
      {
        connections:connectionSummary()
      }
    );
  });

  peer.on("close",()=>{
    emit(
      "disconnected",
      "Servicio de sincronización cerrado.",
      {
        connections:connectionSummary()
      }
    );
  });

  return peer;
}

export async function host(){
  const p=ensurePeer();

  return await new Promise((resolve,reject)=>{
    if(p.open){
      resolve(p.id);
      return;
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
      "Escribe o escanea el código del otro dispositivo."
    );
  }

  const p=ensurePeer();

  const conn=p.connect(id,{
    reliable:true,
    serialization:"json"
  });

  attach(conn,true);

  return conn;
}

export function configure(options={}){
  if(typeof options.getSnapshot==="function"){
    getSnapshot=options.getSnapshot;
  }

  if(typeof options.applySnapshot==="function"){
    applySnapshot=options.applySnapshot;
  }

  if(typeof options.onStatus==="function"){
    statusHandler=options.onStatus;
  }
}

export async function broadcastSnapshot(snapshot){
  if(!snapshot){
    try{
      snapshot=await getSnapshot();
    }catch{
      return false;
    }
  }

  const currentFingerprint=fingerprint(snapshot);
  let sent=false;

  for(const item of connections.values()){
    const conn=item.connection;

    if(!conn?.open)continue;

    /*
     * Solo los dispositivos que ya resolvieron su sincronización
     * reciben cambios automáticos.
     */
    if(item.state!=="synced")continue;

    try{
      conn.send({
        type:"state-update",
        snapshot,
        baseFingerprint:item.syncedFingerprint||currentFingerprint,
        sentAt:new Date().toISOString(),
        source:{
          id:peer?.id||"",
          name:deviceName
        }
      });

      item.syncedFingerprint=currentFingerprint;
      sent=true;
    }catch{}
  }

  return sent;
}

export async function keepLocal(peerId){
  const item=findConnection(peerId);

  if(!item?.connection?.open)return false;

  try{
    const snapshot=await getSnapshot();
    const info={
      fingerprint:fingerprint(snapshot),
      units:Array.isArray(snapshot?.units)
        ?snapshot.units.length
        :0,
      lots:Array.isArray(snapshot?.lots)
        ?snapshot.lots.length
        :0,
      lastUpdate:getLastUpdate(snapshot)
    };

    item.state="syncing";

    item.connection.send({
      type:"replace-snapshot",
      snapshot,
      source:{
        id:peer?.id||"",
        name:deviceName
      },
      summary:info
    });

    item.syncedFingerprint=info.fingerprint;

    return true;
  }catch{
    return false;
  }
}

export async function useRemote(peerId,snapshot){
  const item=findConnection(peerId);

  if(!item?.connection?.open||!snapshot)return false;

  try{
    const info={
      fingerprint:fingerprint(snapshot),
      units:Array.isArray(snapshot?.units)
        ?snapshot.units.length
        :0,
      lots:Array.isArray(snapshot?.lots)
        ?snapshot.lots.length
        :0,
      lastUpdate:getLastUpdate(snapshot)
    };

    /*
     * Aplicamos localmente SOLO porque el usuario eligió
     * explícitamente los datos remotos.
     */
    await applySnapshot(snapshot);

    item.state="syncing";
    item.syncedFingerprint=info.fingerprint;

    item.connection.send({
      type:"sync-ack",
      fingerprint:info.fingerprint,
      detail:"Se utilizaron los datos de este dispositivo."
    });

    item.state="synced";
    item.lastSync=new Date().toISOString();

    return true;
  }catch{
    return false;
  }
}

export function isConnected(){
  return [...connections.values()]
    .some(x=>x.connection?.open);
}

export function connectionCount(){
  return [...connections.values()]
    .filter(x=>x.connection?.open)
    .length;
}

export function currentPeerId(){
  return peer?.id||"";
}

export function getConnections(){
  return connectionSummary();
}

export function disconnectPeer(peerId){
  peerId=String(peerId||"");

  for(const [key,item] of connections.entries()){
    if(String(item.peerId||"")===peerId){
      try{
        item.connection.close();
      }catch{}

      connections.delete(key);
      return true;
    }
  }

  return false;
}

export function disconnect(){
  for(const item of connections.values()){
    try{
      item.connection.close();
    }catch{}
  }

  connections.clear();

  try{
    peer?.destroy();
  }catch{}

  peer=null;

  emit(
    "disconnected",
    "Sincronización desconectada."
  );
}

export const sync={
  host,
  join,
  configure,
  setDeviceName,
  getDeviceName,
  getConnections,
  broadcastSnapshot,
  keepLocal,
  useRemote,
  isConnected,
  connectionCount,
  currentPeerId,
  disconnectPeer,
  disconnect
};