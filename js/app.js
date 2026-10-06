import{CONFIG}from"./config.js";
import{getAll,getByKey,put,del}from"./db.js";
import{activeLot,listLots,selectLot,createLot,updateLot,deleteLot}from"./lots.js";
import{unitsForActiveLot,stats,saveUnit,removeUnit}from"./inventory.js";
import{scanIdentification,closeScanner}from"./scanner.js";
import{audioTest,cleanupAudio}from"./audio-test.js";
import{exportExcel,exportCsv,exportJson,readExcelFile,rowToUnit}from"./excel.js";
import{sync}from"./sync.js";

const root=document.querySelector("#modalRoot");
const $=s=>document.querySelector(s);

let editing=null;
let draft={};

const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({
  "&":"&amp;",
  "<":"&lt;",
  ">":"&gt;",
  '"':"&quot;"
}[c]));

async function refresh(){
  const l=await activeLot();
  const u=await unitsForActiveLot();
  const s=stats(u);

  $("#activeLotName").textContent=
    l?l.name+" · "+l.date:"Sin lote";

  $("#stats").innerHTML=[
    ["Total",s.total],
    ["Reparables",s.reparable],
    ["No reparables",s.nonrepairable],
    ["Listas para empacar",s.ready],
    ["Empacadas",s.packed]
  ].map(x=>'<div class="stat"><b>'+x[1]+"</b><span>"+x[0]+"</span></div>").join("");

  const latest=[...u]
    .filter(x=>x.updatedAt)
    .sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt))
    .slice(0,5);

  const rank=new Map(latest.map((x,i)=>[x.id,i]));

  const filter=($("#idFilter")?.value||"").trim().toLowerCase();

  const filtered=filter
    ?u.filter(x=>String(x.unitId||"").toLowerCase().includes(filter))
    :u;

  const matches=filter
    ?u.filter(x=>String(x.unitId||"").toLowerCase().includes(filter))
    :[];

  $("#idFilterResult").textContent=
    filter
      ?(matches.length
        ?matches.map(x=>"casilla "+x.sequence).join(" · ")
        :"ID no encontrado")
      :"";

  $("#inventoryBody").innerHTML=filtered.map(x=>{
    const rnk=rank.get(x.id);
    const dot=
      rnk===0
        ?"newest"
        :rnk!==undefined&&rnk<3
          ?"recent"
          :rnk!==undefined
            ?"old"
            :"none";

    return '<tr class="'+
      (x.diagnosis==="No reparable"
        ?"state-no"
        :x.packaging==="Empacado"
          ?"state-packed"
          :x.packaging==="Listo para empacar"
            ?"state-ready"
            :"")+
      '">'+
      "<td>"+x.sequence+"</td>"+
      "<td>"+esc(x.ticket)+"</td>"+
      '<td><b>'+esc(x.unitId)+"</b></td>"+
      "<td>"+esc(x.manufacturer)+"</td>"+
      "<td>"+x.lotDate+"</td>"+
      "<td>"+esc(x.diagnosis)+"</td>"+
      "<td>"+
        (x.repairable===true
          ?"Sí"
          :x.repairable===false
            ?"No"
            :"")+
      "</td>"+
      "<td>"+esc((x.repairs||[]).join(" + "))+"</td>"+
      "<td>"+esc(x.observations)+"</td>"+
      "<td>"+esc(x.packaging)+"</td>"+
      '<td class="update-cell">'+
        (x.updatedAt
          ?'<span class="update-badge"><span class="update-dot '+
            dot+
            '"></span>'+
            relativeTime(x.updatedAt)+
            "</span>"
          :'<span class="update-badge"><span class="update-dot none"></span>Sin fecha</span>')+
      "</td>"+
      '<td class="actions-cell">'+
        '<button data-edit="'+x.id+'">Editar</button>'+
        '<button class="danger" data-del="'+x.id+'">Eliminar</button>'+
      "</td>"+
      "</tr>";
  }).join("");
}

function relativeTime(value){
  const ms=Math.max(0,Date.now()-new Date(value).getTime());
  const sec=Math.floor(ms/1000);

  if(sec<60){
    return sec<=1
      ?"hace un segundo"
      :"hace "+sec+" segundos";
  }

  const min=Math.floor(sec/60);

  if(min<60){
    return min+" "+(min===1?"minuto":"minutos");
  }

  const h=Math.floor(min/60);

  if(h<24){
    return h+" "+(h===1?"hora":"horas");
  }

  const d=Math.floor(h/24);

  if(d<7){
    return d+" "+(d===1?"día":"días");
  }

  const w=Math.floor(d/7);

  if(w<5){
    return w+" "+(w===1?"semana":"semanas");
  }

  const mo=Math.floor(d/30);

  if(mo<12){
    return mo+" "+(mo===1?"mes":"meses");
  }

  const y=Math.floor(d/365);

  return y+" "+(y===1?"año":"años");
}

function close(){
  cleanupAudio();
  root.innerHTML="";
  editing=null;
}

/* ── Test de audio independiente ── */
function openAudioTest(){
  cleanupAudio();

  root.innerHTML=
    '<div class="modalback">'+
      '<div class="modal audio-test-modal">'+
        '<div class="audio-test-header">'+
          '<div>'+
            '<span class="audio-test-kicker">PRUEBA DE AUDIO</span>'+
            '<h2>Test de micrófono</h2>'+
            '<p class="muted">Habla unos segundos para comprobar que la diadema graba y se escucha correctamente.</p>'+
          '</div>'+
          '<button id="closeAudioTest" class="audio-close" aria-label="Cerrar">×</button>'+
        '</div>'+
        '<div id="standaloneAudio"></div>'+
      '</div>'+
    '</div>';

  $("#closeAudioTest").onclick=close;

  audioTest(
    $("#standaloneAudio"),
    ()=>{}
  );
}

async function requireLot(){
  if(await activeLot())return true;

  alert("Primero crea o selecciona un lote.");
  openLots();

  return false;
}

function openForm(d={}){
  draft={...d};

  root.innerHTML=
    '<div class="modalback">'+
      '<div class="modal">'+
        '<h2 id="formTitle"></h2>'+
        '<p class="muted">ID y ticket son independientes. Tipo de lectura: <span id="readType"></span></p>'+
        '<div class="formgrid">'+
          '<div class="field">'+
            "<label>ID</label>"+
            '<input id="id" placeholder="Vacío = generar J001, J002…">'+
          "</div>"+
          '<div class="field">'+
            "<label>Ticket</label>"+
            '<input id="ticket">'+
          "</div>"+
          '<div class="field full">'+
            '<label>Test de audio</label>'+
            '<div id="audio">'+
              '<button id="test">🧪 Hacer test</button>'+
              "<button id=\"skip\">Omitir</button>"+
            "</div>"+
          "</div>"+
          '<div class="field">'+
            "<label>Fabricante</label>"+
            '<select id="man"></select>'+
          "</div>"+
          '<div class="field">'+
            "<label>Diagnóstico</label>"+
            '<select id="diag">'+
              "<option>Reparable</option>"+
              "<option>No reparable</option>"+
            "</select>"+
          "</div>"+
          '<div class="field">'+
            "<label>Empaque</label>"+
            '<select id="pack">'+
              "<option>Listo para empacar</option>"+
              "<option>Empacado</option>"+
            "</select>"+
          "</div>"+
          '<div class="field full">'+
            "<label>Motivos de no reparación</label>"+
            '<div id="reasons" class="choices"></div>'+
          "</div>"+
          '<div class="field full">'+
            "<label>Reparaciones (máximo 3)</label>"+
            '<div id="repairs" class="choices"></div>'+
          "</div>"+
          '<div class="field full">'+
            "<label>Observaciones</label>"+
            '<textarea id="obs"></textarea>'+
          "</div>"+
        "</div>"+
        '<div class="modal-actions">'+
          '<button id="cancel">Cancelar</button>'+
          '<button id="save" class="primary">Guardar</button>'+
        "</div>"+
      "</div>"+
    "</div>";

  $("#formTitle").textContent=
    editing
      ?"Editar diadema"
      :"Registrar diadema";

  $("#readType").textContent=d.readType||"Manual";

  $("#id").value=d.unitId||"";
  $("#ticket").value=d.ticket||"";

  $("#man").innerHTML=CONFIG.manufacturers
    .map(x=>"<option>"+esc(x)+"</option>")
    .join("");

  $("#man").value=d.manufacturer||"Pendiente";

  $("#diag").value=
    d.diagnosis==="No reparable"
      ?"No reparable"
      :"Reparable";

  $("#pack").value=
    d.packaging||"Listo para empacar";

  $("#reasons").innerHTML=CONFIG.noRepairReasons
    .map(x=>
      '<label><input type="checkbox" name="reason" value="'+
      esc(x)+
      '"> '+
      esc(x)+
      "</label>")
    .join("");

  $("#repairs").innerHTML=CONFIG.repairOptions
    .map(x=>
      '<label><input type="checkbox" name="repair" value="'+
      esc(x)+
      '">'+
      esc(x)+
      "</label>")
    .join("");

  (d.noRepairReasons||[]).forEach(v=>{
    const e=[...root.querySelectorAll('input[name="reason"]')]
      .find(i=>i.value===v);

    if(e)e.checked=true;
  });

  (d.repairs||[]).forEach(v=>{
    const e=[...root.querySelectorAll('input[name="repair"]')]
      .find(i=>i.value===v);

    if(e)e.checked=true;
  });

  const rules=()=>{
    const no=$("#diag").value==="No reparable";

    const m=[
      ...root.querySelectorAll('input[name="repair"]')
    ].find(i=>i.value==="Mantenimiento");

    if(no){
      $("#pack").value="Listo para empacar";

      root.querySelectorAll('input[name="repair"]')
        .forEach(i=>i.checked=false);

      if(m)m.checked=false;
    }else if(m){
      m.checked=true;
    }

    root.querySelectorAll('input[name="reason"]')
      .forEach(i=>i.disabled=!no);

    root.querySelectorAll('input[name="repair"]')
      .forEach(i=>{
        i.disabled=no||i.value==="Mantenimiento";
      });

    if(!no&&m)m.disabled=true;

    $("#reasons").classList.toggle("hidden",!no);
    $("#repairs").classList.toggle("hidden",no);
  };

  $("#diag").onchange=rules;

  root.querySelectorAll('input[name="repair"]')
    .forEach(i=>{
      i.onchange=()=>{
        if(
          root.querySelectorAll(
            'input[name="repair"]:checked'
          ).length>3
        ){
          i.checked=false;

          alert(
            "Máximo 3 trabajos de reparación, contando Mantenimiento."
          );
        }
      };
    });

  $("#cancel").onclick=close;

  $("#test").onclick=()=>
    audioTest(
      $("#audio"),
      v=>$("#audio").dataset.result=v
    );

  $("#skip").onclick=()=>
    $("#audio").dataset.result="Omitido";

  $("#save").onclick=async()=>{
    try{
      const id=$("#id").value.trim();
      const no=$("#diag").value==="No reparable";

      const rs=[
        ...root.querySelectorAll(
          'input[name="repair"]:checked'
        )
      ].map(i=>i.value);

      const nr=[
        ...root.querySelectorAll(
          'input[name="reason"]:checked'
        )
      ].map(i=>i.value);

      if(
        !no&&
        !rs.includes("Mantenimiento")
      ){
        return alert(
          "Mantenimiento es obligatorio."
        );
      }

      if(no&&rs.length){
        return alert(
          "Una unidad no reparable no puede tener trabajos de reparación."
        );
      }

      if(no&&!nr.length){
        return alert(
          "Selecciona al menos un motivo de no reparación."
        );
      }

      const all=await getAll(CONFIG.store);

      if(
        id&&
        all.some(
          x=>x.unitId===id&&
          x.id!==editing?.id
        )
      ){
        return alert(
          "Este número ya se encuentra registrado. Puedes continuar con la siguiente diadema."
        );
      }

      const saved=await saveUnit({
        unitId:id,
        ticket:$("#ticket").value.trim(),
        manufacturer:$("#man").value,
        diagnosis:$("#diag").value,
        repairable:!no,
        noRepairReasons:no?nr:[],
        repairs:no?[]:rs,
        observations:$("#obs").value.trim(),
        packaging:$("#pack").value,
        readType:draft.readType||"Manual",
        audioTest:
          $("#audio").dataset.result||
          d.audioTest||
          "Omitido"
      },editing?.id);

      editing=null;

      close();

      await refresh();

      await sync.broadcastSnapshot(
        await getSnapshot()
      );

      alert(
        "Unidad guardada: "+saved.unitId
      );
    }catch(e){
      alert(
        e.message||
        "No se pudo guardar."
      );
    }
  };

  rules();
}

async function openLots(){
  const l=await listLots();

  const list=l.map(x=>
    '<div class="lot-item">'+
      "<div>"+
        "<b>"+esc(x.name)+"</b><br>"+
        '<span class="muted">'+
          x.date+
          " · "+
          esc(x.status||"active")+
        "</span>"+
      "</div>"+
      "<div>"+
        '<button data-l="'+x.id+'">Abrir</button> '+
        '<button data-e="'+x.id+'">Editar</button> '+
        '<button class="danger" data-d="'+x.id+'">Eliminar</button>'+
      "</div>"+
    "</div>"
  ).join("");

  root.innerHTML=
    '<div class="modalback">'+
      '<div class="modal">'+
        "<h2>Lotes</h2>"+
        '<div class="lot-list">'+
          list+
        "</div>"+
        '<div class="modal-actions">'+
          '<button id="new" class="primary">Nuevo lote</button>'+
          '<button id="x">Cerrar</button>'+
        "</div>"+
      "</div>"+
    "</div>";

  $("#x").onclick=close;

  $("#new").onclick=()=>lotForm();

  root.querySelectorAll("[data-l]")
    .forEach(b=>{
      b.onclick=async()=>{
        await selectLot(b.dataset.l);
        close();
        refresh();
      };
    });

  root.querySelectorAll("[data-e]")
    .forEach(b=>{
      b.onclick=async()=>{
        const x=await getByKey(
          CONFIG.lots,
          b.dataset.e
        );

        lotForm(x);
      };
    });

  root.querySelectorAll("[data-d]")
    .forEach(b=>{
      b.onclick=async()=>{
        if(
          confirm(
            "Eliminar lote y sus unidades? Esta acción no se puede deshacer."
          )
        ){
          await deleteLot(b.dataset.d);
          await sync.broadcastSnapshot(
            await getSnapshot()
          );
          openLots();
          refresh();
        }
      };
    });
}

function lotForm(l={}){
  root.innerHTML=
    '<div class="modalback">'+
      '<div class="modal">'+
        "<h2>"+
          (l.id?"Editar lote":"Nuevo lote")+
        "</h2>"+
        '<div class="formgrid">'+
          '<div class="field">'+
            "<label>Nombre</label>"+
            '<input id="ln" value="'+esc(l.name)+'">'+
          "</div>"+
          '<div class="field">'+
            "<label>Fecha del lote</label>"+
            '<input id="ld" type="date" value="'+
              esc(
                l.date||
                new Date()
                  .toISOString()
                  .slice(0,10)
              )+
            '">'+
          "</div>"+
          '<div class="field">'+
            "<label>Estado</label>"+
            '<select id="ls">'+
              '<option value="active">Activo</option>'+
              '<option value="closed">Cerrado</option>'+
            "</select>"+
          "</div>"+
          '<div class="field full">'+
            "<label>Observaciones</label>"+
            '<textarea id="lo">'+
              esc(l.observations)+
            "</textarea>"+
          "</div>"+
        "</div>"+
        '<div class="modal-actions">'+
          '<button id="lc">Cancelar</button>'+
          '<button id="lok" class="primary">Guardar lote</button>'+
        "</div>"+
      "</div>"+
    "</div>";

  $("#ls").value=l.status||"active";

  $("#lc").onclick=openLots;

  $("#lok").onclick=async()=>{
    const name=$("#ln").value.trim();

    if(!name){
      return alert("Escribe un nombre.");
    }

    if(l.id){
      await updateLot({
        ...l,
        name,
        date:$("#ld").value,
        status:$("#ls").value,
        observations:$("#lo").value.trim()
      });
    }else{
      await createLot(
        name,
        $("#ld").value,
        $("#lo").value.trim()
      );
    }

    await sync.broadcastSnapshot(
      await getSnapshot()
    );

    close();
    refresh();
  };
}

async function getSnapshot(){
  return{
    units:await getAll(CONFIG.store),
    lots:await getAll(CONFIG.lots),
    meta:await getAll(CONFIG.meta)
  };
}

async function applySnapshot(snapshot){
  if(
    !snapshot||
    !Array.isArray(snapshot.units)||
    !Array.isArray(snapshot.lots)||
    !Array.isArray(snapshot.meta)
  ){
    throw new Error(
      "Datos de sincronización inválidos."
    );
  }

  for(
    const store of [
      CONFIG.store,
      CONFIG.lots,
      CONFIG.meta
    ]
  ){
    for(
      const x of await getAll(store)
    ){
      await del(
        store,
        x.id??x.key
      );
    }
  }

  for(const x of snapshot.units){
    await put(
      CONFIG.store,
      x
    );
  }

  for(const x of snapshot.lots){
    await put(
      CONFIG.lots,
      x
    );
  }

  for(const x of snapshot.meta){
    await put(
      CONFIG.meta,
      x
    );
  }

  await refresh();
}

function syncStatusText(info){
  if(!info)return"Sin conexión";

  if(info.status==="ready"){
    return info.detail||"Listo para conectar.";
  }

  if(info.status==="checking"){
    return info.detail||"Comprobando datos…";
  }

  if(info.status==="conflict-checking"){
    return info.detail||"Revisando diferencias…";
  }

  if(info.status==="synced"){
    return info.detail||"Datos sincronizados.";
  }

  if(info.status==="connected"){
    return info.detail||"Dispositivo conectado.";
  }

  if(info.status==="disconnected"){
    return info.detail||"Sin conexión.";
  }

  return info.detail||info.status||"Sincronización";
}

function updateSyncVisual(info){
  const status=$("#syncStatus");

  if(!status)return;

  status.textContent=syncStatusText(info);

  status.classList.toggle(
    "connected",
    info.status==="synced"||
    info.status==="connected"
  );
}

function renderSyncDevices(){
  const box=$("#syncDevices");

  if(!box)return;

  const devices=sync.getConnections();

  if(!devices.length){
    box.innerHTML=
      '<div class="sync-device-empty">'+
        "No hay dispositivos conectados."+
      "</div>";

    return;
  }

  box.innerHTML=devices.map(d=>{
    const state=
      d.state==="synced"
        ?"✓ Sincronizado"
        :d.state==="conflict"
          ?"⚠ Diferencias"
          :d.state==="checking"
            ?"Comprobando…"
            :"Conectando…";

    const count=
      d.summary&&
      typeof d.summary.units==="number"
        ?d.summary.units+" registros"
        :"";

    return(
      '<div class="sync-device-item">'+
        '<div class="sync-device-main">'+
          "<b>"+esc(d.name)+"</b>"+
          "<span>"+esc(state)+"</span>"+
        "</div>"+
        '<div class="sync-device-meta">'+
          esc(count)+
          (
            d.lastSync
              ?" · Última sincronización "+
                relativeTime(d.lastSync)
              :""
          )+
        "</div>"+
      "</div>"
    );
  }).join("");
}

function showSyncConflict(info){
  const panel=$("#syncConflict");

  if(!panel)return;

  const peerName=
    info.peerName||
    info.remoteDevice?.name||
    "Otro dispositivo";

  const local=info.localSummary||{};
  const remote=info.remoteSummary||info.summary||{};

  $("#syncConflictDevice").textContent=
    peerName;

  $("#syncLocalCount").textContent=
    String(local.units??0);

  $("#syncRemoteCount").textContent=
    String(remote.units??0);

  $("#syncLocalLots").textContent=
    String(local.lots??0);

  $("#syncRemoteLots").textContent=
    String(remote.lots??0);

  $("#syncConflictMessage").textContent=
    "Los datos de este dispositivo y de "+
    peerName+
    " son diferentes. No se reemplazará nada hasta que elijas qué información conservar.";

  panel.classList.remove("hidden");

  panel.dataset.peerId=
    info.peerId||
    "";

  panel._snapshot=
    info.snapshot||
    null;
}

function hideSyncConflict(){
  const panel=$("#syncConflict");

  if(!panel)return;

  panel.classList.add("hidden");
  panel.dataset.peerId="";
  panel._snapshot=null;
}

async function handleSyncStatus(info){
  updateSyncVisual(info);
  renderSyncDevices();

  if(
    info.status==="snapshot-received"
  ){
    showSyncConflict(info);
    return;
  }

  if(
    info.status==="snapshot-conflict"
  ){
    /*
     * El snapshot llegará inmediatamente después
     * mediante request-snapshot.
     */
    return;
  }

  if(
    info.status==="synced"
  ){
    hideSyncConflict();
    await refresh();
  }
}

async function chooseSyncData(choice){
  const panel=$("#syncConflict");

  if(!panel)return;

  const peerId=panel.dataset.peerId;

  if(!peerId){
    alert(
      "No se encontró el dispositivo que tiene los datos."
    );
    return;
  }

  const snapshot=panel._snapshot;

  const buttons=[
    $("#syncKeepLocal"),
    $("#syncUseRemote"),
    $("#syncCancel")
  ].filter(Boolean);

  buttons.forEach(b=>b.disabled=true);

  try{
    if(choice==="local"){
      /*
       * "Conservar mis datos":
       * enviamos nuestro snapshot al otro dispositivo.
       */
      const ok=await sync.keepLocal(peerId);

      if(!ok){
        throw new Error(
          "No se pudo enviar el inventario de este dispositivo."
        );
      }

      hideSyncConflict();

      updateSyncVisual({
        status:"checking",
        detail:
          "Enviando los datos de este dispositivo…"
      });
    }

    if(choice==="remote"){
      /*
       * "Usar datos del otro":
       * snapshot recibido -> reemplazo local explícitamente autorizado.
       */
      if(!snapshot){
        throw new Error(
          "Todavía no se recibieron los datos del otro dispositivo."
        );
      }

      const ok=await sync.useRemote(
        peerId,
        snapshot
      );

      if(!ok){
        throw new Error(
          "No se pudieron aplicar los datos remotos."
        );
      }

      hideSyncConflict();

      await refresh();

      updateSyncVisual({
        status:"synced",
        detail:
          "Se utilizaron los datos de "+
          (panel.dataset.peerName||
            "el otro dispositivo")+
          "."
      });

      renderSyncDevices();
    }
  }catch(e){
    alert(
      e.message||
      "No se pudo completar la sincronización."
    );
  }finally{
    buttons.forEach(b=>b.disabled=false);
  }
}

function openSync(){
  root.innerHTML=
    '<div class="modalback">'+
      '<div class="modal">'+
        '<h2>🔗 Sincronizar dispositivos</h2>'+

        '<div class="field">'+
          "<label>Nombre de este dispositivo</label>"+
          '<input id="syncDeviceName" placeholder="Ej. PC Andrés">'+
          '<small class="sync-help">Usa un nombre fácil de reconocer, por ejemplo: PC Andrés, Xiaomi Carlos o PC Taller 2.</small>'+
        "</div>"+

        '<div id="syncStatus" class="sync-status">Sin conexión</div>'+

        '<div id="syncDevices" class="sync-devices">'+
          '<div class="sync-device-empty">No hay dispositivos conectados.</div>'+
        "</div>"+

        '<div id="syncConflict" class="sync-conflict hidden">'+
          "<h3>⚠ Hay datos diferentes</h3>"+
          '<p id="syncConflictMessage"></p>'+

          '<div class="sync-conflict-grid">'+
            '<div class="sync-conflict-card">'+
              "<b>Este dispositivo</b>"+
              '<strong id="syncLocalCount">0</strong>'+
              "<span>registros</span>"+
              '<small>Lotes: <b id="syncLocalLots">0</b></small>'+
            "</div>"+

            '<div class="sync-conflict-card remote">'+
              '<b id="syncConflictDevice">Otro dispositivo</b>'+
              '<strong id="syncRemoteCount">0</strong>'+
              "<span>registros</span>"+
              '<small>Lotes: <b id="syncRemoteLots">0</b></small>'+
            "</div>"+
          "</div>"+

          '<p class="sync-help">La elección indica qué inventario reemplazará al otro. No se combinarán los datos en esta primera versión.</p>'+

          '<div class="modal-actions" style="position:static">'+
            '<button id="syncKeepLocal" class="primary">Conservar mis datos</button>'+
            '<button id="syncUseRemote" class="primary">Usar datos del otro dispositivo</button>'+
            '<button id="syncCancel">Cancelar</button>'+
          "</div>"+
        "</div>"+

        '<div class="field">'+
          "<label>Código de este dispositivo</label>"+
          '<div id="syncCode" class="sync-code">Aún no generado</div>'+
          '<div id="syncQr" class="sync-qr"></div>'+
        "</div>"+

        '<div class="modal-actions" style="position:static">'+
          '<button id="makeSync" class="primary">Generar código en este equipo</button>'+
          '<button id="scanSync">📷 Escanear código</button>'+
          '<button id="disconnectSync" class="secondary">Desconectar</button>'+
          '<button id="closeSync">Cerrar</button>'+
        "</div>"+

        '<div class="field">'+
          "<label>Conectar usando el código del otro equipo</label>"+
          '<input id="joinCode" placeholder="Pega aquí el código">'+
        "</div>"+

        '<div class="modal-actions" style="position:static">'+
          '<button id="joinSync" class="primary">Conectar con este código</button>'+
        "</div>"+

        '<div class="sync-camera-wrap">'+
          '<video id="syncCamera" class="sync-camera hidden" autoplay playsinline muted></video>'+
          '<button id="toggleFlash" class="flash-btn hidden" type="button">🔦 Activar flash</button>'+
        "</div>"+

      "</div>"+
    "</div>";

  const nameInput=$("#syncDeviceName");

  nameInput.value=
    sync.getDeviceName()||
    "Dispositivo";

  nameInput.onchange=()=>{
    sync.setDeviceName(
      nameInput.value.trim()||
      "Dispositivo"
    );

    renderSyncDevices();
  };

  updateSyncVisual({
    status:sync.isConnected()
      ?"connected"
      :"disconnected",
    detail:sync.isConnected()
      ?"Dispositivo conectado."
      :"Sin conexión."
  });

  renderSyncDevices();

  const status=$("#syncStatus");
  const code=$("#syncCode");
  const qr=$("#syncQr");
  const video=$("#syncCamera");
  const flash=$("#toggleFlash");

  let cam=null;
  let flashOn=false;

  const stopCamera=()=>{
    cam?.getTracks().forEach(
      t=>t.stop()
    );

    cam=null;
    flashOn=false;

    flash?.classList.add("hidden");

    if(flash){
      flash.textContent="🔦 Activar flash";
    }

    video.classList.add("hidden");
    video.srcObject=null;
  };

  const setupFlash=()=>{
    const track=
      cam?.getVideoTracks?.()[0];

    const caps=
      track?.getCapabilities?.()||{};

    flash.classList.remove("hidden");

    if(caps.torch){
      flash.disabled=false;
      flash.textContent="🔦 Activar flash";
    }else{
      flash.disabled=true;
      flash.textContent="🔦 Flash no disponible";
    }
  };

  const setFlash=async on=>{
    const track=
      cam?.getVideoTracks?.()[0];

    if(!track)return;

    try{
      await track.applyConstraints({
        advanced:[{torch:on}]
      });

      flashOn=on;

      flash.textContent=
        on
          ?"💡 Apagar flash"
          :"🔦 Activar flash";
    }catch{
      flashOn=false;
      flash.textContent="🔦 Activar flash";

      alert(
        "El flash no está disponible en esta cámara o navegador."
      );
    }
  };

  $("#makeSync").onclick=async()=>{
    try{
      const id=await sync.host();

      code.textContent=id;

      qr.innerHTML="";

      if(window.QRCode){
        new QRCode(qr,{
          text:id,
          width:190,
          height:190
        });
      }

      updateSyncVisual({
        status:"ready",
        detail:
          "Código listo. Escanéalo desde el otro dispositivo."
      });
    }catch(e){
      updateSyncVisual({
        status:"error",
        detail:
          e.message||
          "No se pudo generar el código."
      });
    }
  };

  $("#joinSync").onclick=async()=>{
    try{
      await sync.join(
        $("#joinCode").value.trim()
      );

      updateSyncVisual({
        status:"ready",
        detail:"Conectando…"
      });
    }catch(e){
      updateSyncVisual({
        status:"error",
        detail:
          e.message||
          "No se pudo conectar."
      });
    }
  };

  $("#disconnectSync").onclick=()=>{
    sync.disconnect();
    renderSyncDevices();
  };

  $("#closeSync").onclick=()=>{
    stopCamera();
    close();
  };

  $("#toggleFlash").onclick=()=>
    setFlash(!flashOn);

  $("#scanSync").onclick=async()=>{
    try{
      if(!("BarcodeDetector" in window)){
        return alert(
          "Este navegador no permite escanear QR automáticamente. Usa la casilla de código."
        );
      }

      stopCamera();

      cam=
        await navigator.mediaDevices.getUserMedia({
          video:{
            facingMode:{
              ideal:"environment"
            }
          }
        });

      video.classList.remove("hidden");

      video.srcObject=cam;

      await video.play();

      setupFlash();

      const detector=
        new BarcodeDetector({
          formats:["qr_code"]
        });

      let tries=0;

      const loop=async()=>{
        if(video.classList.contains("hidden"))return;

        try{
          const found=
            await detector.detect(video);

          if(found[0]?.rawValue){
            $("#joinCode").value=
              found[0].rawValue;

            stopCamera();

            await sync.join(
              found[0].rawValue
            );

            updateSyncVisual({
              status:"ready",
              detail:"Conectando…"
            });

            return;
          }
        }catch{}

        if(++tries<300){
          setTimeout(loop,200);
        }else{
          stopCamera();
        }
      };

      loop();
    }catch{
      alert(
        "No se pudo abrir la cámara para escanear el código."
      );
    }
  };

  $("#syncKeepLocal").onclick=()=>
    chooseSyncData("local");

  $("#syncUseRemote").onclick=()=>
    chooseSyncData("remote");

  $("#syncCancel").onclick=()=>{
    hideSyncConflict();

    updateSyncVisual({
      status:"checking",
      detail:
        "La conexión sigue activa, pero los datos aún no están sincronizados."
    });
  };

  /*
   * Actualizamos el estado de la ventana inmediatamente
   * por si ya existía una conexión antes de abrirla.
   */
  renderSyncDevices();
}

$( "#scanBtn" ).onclick=async()=>{
  if(!await requireLot())return;

  scanIdentification(r=>{
    if(r.type==="manual"){
      closeScanner();
      openForm({
        readType:"Manual"
      });
    }else{
      openForm({
        unitId:r.value,
        readType:r.type
      });
    }
  });
};

$("#audioTestBtn").onclick=openAudioTest;

$("#manualBtn").onclick=async()=>{
  if(await requireLot()){
    openForm({
      readType:"Manual"
    });
  }
};

$("#inventoryBody").onclick=async e=>{
  const a=e.target.closest("[data-edit]");
  const b=e.target.closest("[data-del]");

  if(a){
    editing=await getByKey(
      CONFIG.store,
      a.dataset.edit
    );

    openForm(editing);
  }

  if(
    b&&
    confirm(
      "¿Eliminar? El ID quedará reservado y no se reutilizará."
    )
  ){
    await removeUnit(
      b.dataset.del
    );

    await refresh();

    await sync.broadcastSnapshot(
      await getSnapshot()
    );
  }
};

$("#lotBtn").onclick=openLots;
$("#syncBtn").onclick=openSync;
$("#idFilter").oninput=refresh;

$("#copyBtn").onclick=async()=>{
  const u=await unitsForActiveLot();

  const txt=u.map(x=>[
    x.sequence,
    x.ticket,
    x.unitId,
    x.manufacturer,
    x.lotDate,
    x.readType,
    x.diagnosis,
    x.repairable===true
      ?"Sí"
      :x.repairable===false
        ?"No"
        :"",
    (x.repairs||[]).join(" + "),
    x.observations,
    x.packaging
  ].join("\t")).join("\n");

  try{
    await navigator.clipboard.writeText(txt);
    alert("Tabla copiada.");
  }catch{
    const t=document.createElement("textarea");

    t.value=txt;

    document.body.append(t);

    t.select();

    document.execCommand("copy");

    t.remove();

    alert("Tabla copiada.");
  }
};

$("#exportExcel").onclick=async()=>
  exportExcel(
    await unitsForActiveLot()
  );

$("#importExcel").onclick=async()=>{
  if(!(await requireLot())){
    return;
  }

  $("#importExcelFile").click();
};

$("#importExcelFile").onchange=async e=>{
  const input=e.target;
  const file=input.files?.[0];

  if(!file){
    return;
  }

  try{
    const lot=await activeLot();

    if(!lot){
      throw new Error("Primero crea o selecciona un lote.");
    }

    const result=await readExcelFile(file);
    const current=await unitsForActiveLot();
    const currentIds=new Set(
      current.map(x=>String(x.unitId||"").trim()).filter(Boolean)
    );

    const history=await getByKey(
      CONFIG.meta,
      "usedIds"
    );

    const usedIds=new Set(
      Array.isArray(history?.value)
        ?history.value
        :[]
    );

    const pending=[];
    let skipped=0;

    for(let i=0;i<result.rows.length;i++){
      const imported=rowToUnit(result.rows[i],i,lot);
      const unitId=String(imported.unitId||"").trim();

      if(currentIds.has(unitId)){
        skipped++;
        continue;
      }

      if(usedIds.has(unitId)){
        throw new Error(
          `El ID "${unitId}" ya fue utilizado anteriormente y no puede reutilizarse.`
        );
      }

      currentIds.add(unitId);
      usedIds.add(unitId);
      pending.push(imported);
    }

    for(const imported of pending){
      await saveUnit({
        ...imported,
        sequence:undefined
      });
    }

    const added=pending.length;

    await refresh();

    await sync.broadcastSnapshot(
      await getSnapshot()
    );

    alert(
      "Excel importado correctamente.\n"+
      "Unidades añadidas: "+added+
      "\nUnidades ya existentes omitidas: "+skipped+
      "\nEl conteo continúa desde la última unidad."
    );
  }catch(e){
    alert(
      "No se pudo importar el Excel: "+
      (e.message||"archivo inválido.")
    );
  }finally{
    input.value="";
  }
};

$("#exportCsv").onclick=async()=>
  exportCsv(
    await unitsForActiveLot()
  );

$("#exportJson").onclick=async()=>{
  const lot=await activeLot();
  const u=await unitsForActiveLot();
  const used=await getByKey(
    CONFIG.meta,
    "usedIds"
  );
  const deleted=await getByKey(
    CONFIG.meta,
    "deletedIds"
  );
  const seq=await getByKey(
    CONFIG.meta,
    "lastSequence"
  );

  exportJson({
    version:CONFIG.appVersion,
    exportedAt:new Date().toISOString(),
    lot,
    units:u,
    history:{
      usedIds:used?.value||[],
      deletedIds:deleted?.value||[],
      lastSequence:seq?.value||0
    },
    configuration:CONFIG
  });
};

$("#importJson").onchange=async e=>{
  try{
    const f=e.target.files[0];

    if(!f)return;

    if(
      !confirm(
        "Importar reemplazará los datos actuales. ¿Continuar?"
      )
    ){
      return;
    }

    const p=
      JSON.parse(
        await f.text()
      );

    for(
      const x of await getAll(CONFIG.store)
    ){
      await del(
        CONFIG.store,
        x.id
      );
    }

    for(
      const x of await getAll(CONFIG.lots)
    ){
      await del(
        CONFIG.lots,
        x.id
      );
    }

    if(p.lot){
      await put(
        CONFIG.lots,
        p.lot
      );

      await put(
        CONFIG.meta,
        {
          key:"activeLot",
          value:p.lot.id
        }
      );
    }else{
      await del(
        CONFIG.meta,
        "activeLot"
      );
    }

    for(const x of p.units||[]){
      await put(
        CONFIG.store,
        x
      );
    }

    if(p.history){
      await put(
        CONFIG.meta,
        {
          key:"usedIds",
          value:p.history.usedIds||[]
        }
      );

      await put(
        CONFIG.meta,
        {
          key:"deletedIds",
          value:p.history.deletedIds||[]
        }
      );

      await put(
        CONFIG.meta,
        {
          key:"lastSequence",
          value:p.history.lastSequence||0
        }
      );
    }

    location.reload();
  }catch(e){
    alert(
      "JSON inválido o incompatible: "+
      e.message
    );
  }

  e.target.value="";
};

/*
 * Configuración ÚNICA de sincronización.
 *
 * El código anterior tenía otra llamada al final:
 *
 * sync.configure(... onStatus:()=>{})
 *
 * que anulaba el estado de la ventana.
 *
 * Ahora queda una sola configuración.
 */
sync.configure({
  getSnapshot,
  applySnapshot,
  onStatus:handleSyncStatus
});

setInterval(()=>{
  if(
    document.querySelector(
      "#inventoryBody"
    )
  ){
    refresh();
  }
},15000);

refresh();

if("serviceWorker" in navigator){
  navigator.serviceWorker
    .register("./sw.js")
    .catch(()=>{});
}