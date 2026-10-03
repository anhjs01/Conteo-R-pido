import{CONFIG}from"./config.js";import{getAll,getByKey,put,del}from"./db.js";import{activeLot,listLots,selectLot,createLot,updateLot,deleteLot}from"./lots.js";import{unitsForActiveLot,stats,saveUnit,removeUnit}from"./inventory.js";import{scanIdentification,closeScanner}from"./scanner.js";import{audioTest,cleanupAudio}from"./audio-test.js";import{exportExcel,exportCsv,exportJson}from"./excel.js";
import{sync}from"./sync.js";
const root=document.querySelector("#modalRoot"),$=s=>document.querySelector(s);let editing=null,draft={};const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
async function refresh(){
 const l=await activeLot(),u=await unitsForActiveLot(),s=stats(u);
 $("#activeLotName").textContent=l?l.name+" · "+l.date:"Sin lote";
 $("#stats").innerHTML=[["Total",s.total],["Reparables",s.reparable],["No reparables",s.nonrepairable],["Listas para empacar",s.ready],["Empacadas",s.packed]].map(x=>'<div class="stat"><b>'+x[1]+'</b><span>'+x[0]+"</span></div>").join("");
 const latest=[...u].filter(x=>x.updatedAt).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)).slice(0,5);
 const rank=new Map(latest.map((x,i)=>[x.id,i]));
 const filter=($("#idFilter")?.value||"").trim().toLowerCase();
 const filtered=filter?u.filter(x=>String(x.unitId||"").toLowerCase().includes(filter)):u;
 const matches=filter?u.filter(x=>String(x.unitId||"").toLowerCase().includes(filter)):[];
 $("#idFilterResult").textContent=filter?(matches.length?matches.map(x=>"casilla "+x.sequence).join(" · "):"ID no encontrado"):"";
 $("#inventoryBody").innerHTML=filtered.map(x=>{
   const rnk=rank.get(x.id),dot=rnk===0?"newest":rnk!==undefined&&rnk<3?"recent":rnk!==undefined?"old":"none";
   return '<tr class="'+(x.diagnosis==="No reparable"?"state-no":x.packaging==="Empacado"?"state-packed":x.packaging==="Listo para empacar"?"state-ready":"")+'"><td>'+x.sequence+'</td><td>'+esc(x.ticket)+'</td><td><b>'+esc(x.unitId)+'</b></td><td>'+esc(x.manufacturer)+'</td><td>'+x.lotDate+'</td><td>'+esc(x.diagnosis)+'</td><td>'+(x.repairable===true?"Sí":x.repairable===false?"No":"")+'</td><td>'+esc((x.repairs||[]).join(" + "))+'</td><td>'+esc(x.observations)+'</td><td>'+esc(x.packaging)+'</td><td class="update-cell">'+(x.updatedAt?'<span class="update-badge"><span class="update-dot '+dot+'"></span>'+relativeTime(x.updatedAt)+'</span>':'<span class="update-badge"><span class="update-dot none"></span>Sin fecha</span>')+'</td><td class="actions-cell"><button data-edit="'+x.id+'">Editar</button><button class="danger" data-del="'+x.id+'">Eliminar</button></td></tr>';
 }).join("");
}
function relativeTime(value){
 const ms=Math.max(0,Date.now()-new Date(value).getTime()),sec=Math.floor(ms/1000);
 if(sec<60)return sec<=1?"hace un segundo":"hace "+sec+" segundos";
 const min=Math.floor(sec/60);if(min<60)return min+" "+(min===1?"minuto":"minutos");
 const h=Math.floor(min/60);if(h<24)return h+" "+(h===1?"hora":"horas");
 const d=Math.floor(h/24);if(d<7)return d+" "+(d===1?"día":"días");
 const w=Math.floor(d/7);if(w<5)return w+" "+(w===1?"semana":"semanas");
 const mo=Math.floor(d/30);if(mo<12)return mo+" "+(mo===1?"mes":"meses");
 return Math.floor(d/365)+" "+(Math.floor(d/365)===1?"año":"años");
}
function close(){cleanupAudio();root.innerHTML="";editing=null}
async function requireLot(){if(await activeLot())return true;alert("Primero crea o selecciona un lote.");openLots();return false}
function openForm(d={}){
 draft={...d};
 root.innerHTML='<div class="modalback"><div class="modal"><h2 id="formTitle"></h2><p class="muted">ID y ticket son independientes. Tipo de lectura: <span id="readType"></span></p><div class="formgrid"><div class="field"><label>ID</label><input id="id" placeholder="Vacío = generar J001, J002…"></div><div class="field"><label>Ticket</label><input id="ticket"></div><div class="field full"><label>Test de audio</label><div id="audio"><button id="test">🧪 Hacer test</button><button id="skip">Omitir</button></div></div><div class="field"><label>Fabricante</label><select id="man"></select></div><div class="field"><label>Diagnóstico</label><select id="diag"><option>Reparable</option><option>No reparable</option></select></div><div class="field"><label>Empaque</label><select id="pack"><option>Listo para empacar</option><option>Empacado</option></select></div><div class="field full"><label>Motivos de no reparación</label><div id="reasons" class="choices"></div></div><div class="field full"><label>Reparaciones (máximo 3)</label><div id="repairs" class="choices"></div></div><div class="field full"><label>Observaciones</label><textarea id="obs"></textarea></div></div><div class="modal-actions"><button id="cancel">Cancelar</button><button id="save" class="primary">Guardar</button></div></div></div>';
 $("#formTitle").textContent=editing?"Editar diadema":"Registrar diadema";$("#readType").textContent=d.readType||"Manual";
 $("#id").value=d.unitId||"";$("#ticket").value=d.ticket||"";
 $("#man").innerHTML=CONFIG.manufacturers.map(x=>'<option>'+esc(x)+'</option>').join("");$("#man").value=d.manufacturer||"Pendiente";
 $("#diag").value=d.diagnosis==="No reparable"?"No reparable":"Reparable";$("#pack").value=d.packaging||"Listo para empacar";
 $("#reasons").innerHTML=CONFIG.noRepairReasons.map(x=>'<label><input type="checkbox" name="reason" value="'+esc(x)+'"> '+esc(x)+'</label>').join("");
 $("#repairs").innerHTML=CONFIG.repairOptions.map(x=>'<label><input type="checkbox" name="repair" value="'+esc(x)+'"> '+esc(x)+'</label>').join("");
 (d.noRepairReasons||[]).forEach(v=>{const e=[...root.querySelectorAll('input[name="reason"]')].find(i=>i.value===v);if(e)e.checked=true});
 (d.repairs||[]).forEach(v=>{const e=[...root.querySelectorAll('input[name="repair"]')].find(i=>i.value===v);if(e)e.checked=true});
 const rules=()=>{
   const no=$("#diag").value==="No reparable",m=[...root.querySelectorAll('input[name="repair"]')].find(i=>i.value==="Mantenimiento");
   if(no){$("#pack").value="Listo para empacar";root.querySelectorAll('input[name="repair"]').forEach(i=>i.checked=false);if(m)m.checked=false}
   else if(m){m.checked=true}
   root.querySelectorAll('input[name="reason"]').forEach(i=>i.disabled=!no);
   root.querySelectorAll('input[name="repair"]').forEach(i=>{i.disabled=no||i.value==="Mantenimiento";});
   if(!no&&m)m.disabled=true;
   $("#reasons").classList.toggle("hidden",!no);$("#repairs").classList.toggle("hidden",no);
 };
 $("#diag").onchange=rules;
 root.querySelectorAll('input[name="repair"]').forEach(i=>i.onchange=()=>{
   if(root.querySelectorAll('input[name="repair"]:checked').length>3){i.checked=false;alert("Máximo 3 trabajos de reparación, contando Mantenimiento.")}
 });
 $("#cancel").onclick=close;
 $("#test").onclick=()=>audioTest($("#audio"),v=>$("#audio").dataset.result=v);
 $("#skip").onclick=()=>$("#audio").dataset.result="Omitido";
 $("#save").onclick=async()=>{
  try{
   const id=$("#id").value.trim(),no=$("#diag").value==="No reparable";
   const rs=[...root.querySelectorAll('input[name="repair"]:checked')].map(i=>i.value),nr=[...root.querySelectorAll('input[name="reason"]:checked')].map(i=>i.value);
   if(!no&&!rs.includes("Mantenimiento"))return alert("Mantenimiento es obligatorio.");
   if(no&&rs.length)return alert("Una unidad no reparable no puede tener trabajos de reparación.");
   if(no&&!nr.length)return alert("Selecciona al menos un motivo de no reparación.");
   const all=await getAll(CONFIG.store);
   if(id&&all.some(x=>x.unitId===id&&x.id!==editing?.id))return alert("Este número ya se encuentra registrado. Puedes continuar con la siguiente diadema.");
   const saved=await saveUnit({unitId:id,ticket:$("#ticket").value.trim(),manufacturer:$("#man").value,diagnosis:$("#diag").value,repairable:!no,noRepairReasons:no?nr:[],repairs:no?[]:rs,observations:$("#obs").value.trim(),packaging:$("#pack").value,readType:draft.readType||"Manual",audioTest:$("#audio").dataset.result||d.audioTest||"Omitido"},editing?.id);
   editing=null;close();await refresh();await sync.broadcastSnapshot(await getSnapshot());alert("Unidad guardada: "+saved.unitId);
  }catch(e){alert(e.message||"No se pudo guardar.")}
 };
 rules();
}
async function openLots(){const l=await listLots();const list=l.map(x=>'<div class="lot-item"><div><b>'+esc(x.name)+'</b><br><span class="muted">'+x.date+' · '+esc(x.status||"active")+'</span></div><div><button data-l="'+x.id+'">Abrir</button> <button data-e="'+x.id+'">Editar</button> <button class="danger" data-d="'+x.id+'">Eliminar</button></div></div>').join("");root.innerHTML='<div class="modalback"><div class="modal"><h2>Lotes</h2><div class="lot-list">'+list+'</div><div class="modal-actions"><button id="new" class="primary">Nuevo lote</button><button id="x">Cerrar</button></div></div></div>';$("#x").onclick=close;$("#new").onclick=()=>lotForm();root.querySelectorAll("[data-l]").forEach(b=>b.onclick=async()=>{await selectLot(b.dataset.l);close();refresh()});root.querySelectorAll("[data-e]").forEach(b=>b.onclick=async()=>{const x=await getByKey(CONFIG.lots,b.dataset.e);lotForm(x)});root.querySelectorAll("[data-d]").forEach(b=>b.onclick=async()=>{if(confirm("Eliminar lote y sus unidades? Esta acción no se puede deshacer.")){await deleteLot(b.dataset.d);openLots();refresh()}})}
function lotForm(l={}){root.innerHTML='<div class="modalback"><div class="modal"><h2>'+(l.id?"Editar lote":"Nuevo lote")+'</h2><div class="formgrid"><div class="field"><label>Nombre</label><input id="ln" value="'+esc(l.name)+'"></div><div class="field"><label>Fecha del lote</label><input id="ld" type="date" value="'+esc(l.date||new Date().toISOString().slice(0,10))+'"></div><div class="field"><label>Estado</label><select id="ls"><option value="active">Activo</option><option value="closed">Cerrado</option></select></div><div class="field full"><label>Observaciones</label><textarea id="lo">'+esc(l.observations)+'</textarea></div></div><div class="modal-actions"><button id="lc">Cancelar</button><button id="lok" class="primary">Guardar lote</button></div></div></div>';$("#ls").value=l.status||"active";$("#lc").onclick=openLots;$("#lok").onclick=async()=>{const name=$("#ln").value.trim();if(!name)return alert("Escribe un nombre.");if(l.id)await updateLot({...l,name,date:$("#ld").value,status:$("#ls").value,observations:$("#lo").value.trim()});else await createLot(name,$("#ld").value,$("#lo").value.trim());close();refresh()}}
async function getSnapshot(){
 return {units:await getAll(CONFIG.store),lots:await getAll(CONFIG.lots),meta:await getAll(CONFIG.meta)};
}
async function applySnapshot(snapshot){
 if(!snapshot||!Array.isArray(snapshot.units)||!Array.isArray(snapshot.lots)||!Array.isArray(snapshot.meta))throw new Error("Datos de sincronización inválidos.");
 for(const store of [CONFIG.store,CONFIG.lots,CONFIG.meta])for(const x of await getAll(store))await del(store,x.id??x.key);
 for(const x of snapshot.units)await put(CONFIG.store,x);
 for(const x of snapshot.lots)await put(CONFIG.lots,x);
 for(const x of snapshot.meta)await put(CONFIG.meta,x);
 await refresh();
}
function openSync(){
 root.innerHTML='<div class="modalback"><div class="modal"><h2>🔗 Sincronizar PC ↔ teléfono</h2><p class="sync-help">Crea un código en el PC y escanéalo desde el teléfono. Mientras ambos estén conectados, los cambios de inventario se envían automáticamente en ambos sentidos.</p><div id="syncStatus" class="sync-status">Sin conexión</div><div class="field"><label>Código del dispositivo</label><div id="syncCode" class="sync-code">Aún no generado</div><div id="syncQr" class="sync-qr"></div></div><div class="modal-actions" style="position:static"><button id="makeSync" class="primary">Generar código en este equipo</button><button id="scanSync">📷 Escanear código</button><button id="disconnectSync" class="secondary">Desconectar</button><button id="closeSync">Cerrar</button></div><div class="field"><label>También puedes escribir el código del otro equipo</label><input id="joinCode" placeholder="Pega aquí el código"></div><div class="modal-actions" style="position:static"><button id="joinSync" class="primary">Conectar con este código</button></div><div class="sync-camera-wrap"><video id="syncCamera" class="sync-camera hidden" autoplay playsinline muted></video><button id="toggleFlash" class="flash-btn hidden" type="button">🔦 Activar flash</button></div></div></div>';
 const status=$("#syncStatus"),code=$("#syncCode"),qr=$("#syncQr"),video=$("#syncCamera"),flash=$("#toggleFlash");let cam=null,flashOn=false;
 const stopCamera=()=>{cam?.getTracks().forEach(t=>t.stop());cam=null;flashOn=false;flash?.classList.add("hidden");if(flash)flash.textContent="🔦 Activar flash";video.classList.add("hidden");video.srcObject=null};
 const setupFlash=()=>{const track=cam?.getVideoTracks?.()[0],caps=track?.getCapabilities?.()||{};if(caps.torch){flash.classList.remove("hidden");flash.disabled=false;flash.textContent="🔦 Activar flash"}else{flash.classList.add("hidden")}};
 const setFlash=async on=>{const track=cam?.getVideoTracks?.()[0];if(!track)return;try{await track.applyConstraints({advanced:[{torch:on}]});flashOn=on;flash.textContent=on?"💡 Apagar flash":"🔦 Activar flash"}catch{flashOn=false;flash.textContent="🔦 Activar flash";alert("El flash no está disponible en esta cámara o navegador.")}};
 const setStatus=x=>{status.textContent=x.detail||x.status;status.classList.toggle("connected",x.status==="connected")};
 sync.configure({getSnapshot,applySnapshot,onStatus:setStatus});
 $("#makeSync").onclick=async()=>{try{const id=await sync.host();code.textContent=id;qr.innerHTML="";if(window.QRCode)new QRCode(qr,{text:id,width:190,height:190});setStatus({status:"ready",detail:"Código listo. Escanéalo desde el teléfono."})}catch(e){setStatus({status:"error",detail:e.message||"No se pudo generar el código."})}};
 $("#joinSync").onclick=async()=>{try{await sync.join($("#joinCode").value.trim());setStatus({status:"ready",detail:"Conectando…"})}catch(e){setStatus({status:"error",detail:e.message||"No se pudo conectar."})}};
 $("#disconnectSync").onclick=()=>sync.disconnect();
 $("#closeSync").onclick=()=>{stopCamera();close()};
 $("#toggleFlash").onclick=()=>setFlash(!flashOn);
 $("#scanSync").onclick=async()=>{
  try{
   if(!("BarcodeDetector"in window))return alert("Este navegador no permite escanear QR automáticamente. Usa la casilla de código.");
   stopCamera();
   cam=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}}});video.classList.remove("hidden");video.srcObject=cam;await video.play();setupFlash();
   const detector=new BarcodeDetector({formats:["qr_code"]});let tries=0;
   const loop=async()=>{if(video.classList.contains("hidden"))return;try{const found=await detector.detect(video);if(found[0]?.rawValue){$("#joinCode").value=found[0].rawValue;stopCamera();await sync.join(found[0].rawValue);setStatus({status:"ready",detail:"Conectando…"});return}}catch{}if(++tries<300)setTimeout(loop,200);else{stopCamera()}};loop();
  }catch{alert("No se pudo abrir la cámara para escanear el código.")}
 };
}
$("#scanBtn").onclick=async()=>{if(!await requireLot())return;scanIdentification(r=>{if(r.type==="manual"){closeScanner();openForm({readType:"Manual"})}else openForm({unitId:r.value,readType:r.type})})};$("#manualBtn").onclick=async()=>{if(await requireLot())openForm({readType:"Manual"})};$("#inventoryBody").onclick=async e=>{const a=e.target.closest("[data-edit]"),b=e.target.closest("[data-del]");if(a){editing=await getByKey(CONFIG.store,a.dataset.edit);openForm(editing)}if(b&&confirm("¿Eliminar? El ID quedará reservado y no se reutilizará.")){await removeUnit(b.dataset.del);refresh();await sync.broadcastSnapshot(await getSnapshot())}};$("#lotBtn").onclick=openLots;$("#syncBtn").onclick=openSync;$("#idFilter").oninput=refresh;
$("#copyBtn").onclick=async()=>{const u=await unitsForActiveLot(),txt=u.map(x=>[x.sequence,x.ticket,x.unitId,x.manufacturer,x.lotDate,x.readType,x.diagnosis,x.repairable===true?"Sí":x.repairable===false?"No":"",(x.repairs||[]).join(" + "),x.observations,x.packaging].join("\t")).join("\n");try{await navigator.clipboard.writeText(txt);alert("Tabla copiada.")}catch{const t=document.createElement("textarea");t.value=txt;document.body.append(t);t.select();document.execCommand("copy");t.remove();alert("Tabla copiada.")}};
$("#exportExcel").onclick=async()=>exportExcel(await unitsForActiveLot());$("#exportCsv").onclick=async()=>exportCsv(await unitsForActiveLot());$("#exportJson").onclick=async()=>{const lot=await activeLot(),u=await unitsForActiveLot(),used=await getByKey(CONFIG.meta,"usedIds"),deleted=await getByKey(CONFIG.meta,"deletedIds"),seq=await getByKey(CONFIG.meta,"lastSequence");exportJson({version:CONFIG.appVersion,exportedAt:new Date().toISOString(),lot,units:u,history:{usedIds:used?.value||[],deletedIds:deleted?.value||[],lastSequence:seq?.value||0},configuration:CONFIG})};$("#importJson").onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(!confirm("Importar reemplazará los datos actuales. ¿Continuar?"))return;const p=JSON.parse(await f.text());for(const x of await getAll(CONFIG.store))await del(CONFIG.store,x.id);for(const x of await getAll(CONFIG.lots))await del(CONFIG.lots,x.id);if(p.lot){await put(CONFIG.lots,p.lot);await put(CONFIG.meta,{key:"activeLot",value:p.lot.id})}else await del(CONFIG.meta,"activeLot");for(const x of p.units||[])await put(CONFIG.store,x);if(p.history){await put(CONFIG.meta,{key:"usedIds",value:p.history.usedIds||[]});await put(CONFIG.meta,{key:"deletedIds",value:p.history.deletedIds||[]});await put(CONFIG.meta,{key:"lastSequence",value:p.history.lastSequence||0})}location.reload()}catch(e){alert("JSON inválido o incompatible: "+e.message)}e.target.value=""};
sync.configure({getSnapshot,applySnapshot,onStatus:()=>{}});setInterval(()=>{if(document.querySelector("#inventoryBody"))refresh()},15000);refresh();if("serviceWorker"in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});