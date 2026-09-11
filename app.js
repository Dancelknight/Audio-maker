import { phonemize } from "https://cdn.jsdelivr.net/npm/phonemizer@1.2.1";

const $ = (id) => document.getElementById(id);

const LOG_VERSION = "0.3";
const logLines = [];
function nowISO(){ return new Date().toISOString(); }
function safeJson(v){
  try { return JSON.stringify(v); } catch(_) { return String(v); }
}
function log(type, message, data){
  const line = `[${nowISO()}] [${type}] ${message}` + (data !== undefined ? ` | ${typeof data === "string" ? data : safeJson(data)}` : "");
  logLines.push(line);
  if(logLines.length > 2000) logLines.shift();
  const box = document.getElementById("debugLog");
  if(box){ box.value = logLines.join("\n"); box.scrollTop = box.scrollHeight; }
  try { console.log(line); } catch(_) {}
}
function logError(scope, err){
  log("ERROR", scope, {
    name: err?.name || null,
    message: err?.message || String(err),
    stack: err?.stack || null
  });
}

window.addEventListener("error", e => {
  log("WINDOW_ERROR", e.message || "unknown", {
    filename:e.filename, lineno:e.lineno, colno:e.colno,
    error:e.error?.message || null
  });
});
window.addEventListener("unhandledrejection", e => {
  logError("UNHANDLED_REJECTION", e.reason);
});

const els = {
  modelSelect:$("modelSelect"), speed:$("speed"), speedOut:$("speedOut"),
  loadModel:$("loadModel"), preview:$("preview"), diagnose:$("diagnose"), status:$("status"),
  progress:$("progress"), progressText:$("progressText"), text:$("text"),
  fileInput:$("fileInput"), loadBundled:$("loadBundled"), clearText:$("clearText"), forgetSavedText:$("forgetSavedText"), saveState:$("saveState"),
  charCount:$("charCount"), sentencePause:$("sentencePause"),
  paragraphPause:$("paragraphPause"), generate:$("generate"),
  cancel:$("cancel"), result:$("result"), audio:$("audio"), download:$("download"), debugLog:$("debugLog"), copyLog:$("copyLog"), clearLog:$("clearLog")
};

const MODELS = {
  medium: {
    model:"https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx?download=true",
    config:"https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json?download=true"
  },
  high: {
    model:"https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx?download=true",
    config:"https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx.json?download=true"
  }
};

let session=null, config=null, loadedModel=null, cancelRequested=false, resultUrl=null;
let lastStageStarted=0;

const STORAGE = {
  text: "gnr:text:v1",
  model: "gnr:model:v1",
  speed: "gnr:speed:v1",
  sentencePause: "gnr:sentencePause:v1",
  paragraphPause: "gnr:paragraphPause:v1"
};

function storageSet(key, value){
  try{
    localStorage.setItem(key, String(value));
    return true;
  }catch(err){
    logError("storageSet", err);
    return false;
  }
}
function storageGet(key, fallback=""){
  try{
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  }catch(err){
    logError("storageGet", err);
    return fallback;
  }
}
function persistText(reason="change"){
  const ok = storageSet(STORAGE.text, els.text.value);
  if(els.saveState){
    els.saveState.textContent = ok
      ? `Lokal gespeichert · ${els.text.value.length.toLocaleString("de-DE")} Zeichen`
      : "Lokales Speichern fehlgeschlagen.";
  }
  log("STORAGE","text persisted",{reason,chars:els.text.value.length,ok});
}
function restorePersistentState(){
  const savedText = storageGet(STORAGE.text,"");
  if(savedText){
    els.text.value = savedText;
    log("STORAGE","text restored",{chars:savedText.length});
  }

  const savedModel = storageGet(STORAGE.model,"");
  if(savedModel && [...els.modelSelect.options].some(o=>o.value===savedModel)){
    els.modelSelect.value=savedModel;
  }
  const savedSpeed = storageGet(STORAGE.speed,"");
  if(savedSpeed){
    els.speed.value=savedSpeed;
    els.speedOut.value=`${Number(savedSpeed).toFixed(2)}×`;
  }
  const savedSentencePause = storageGet(STORAGE.sentencePause,"");
  if(savedSentencePause) els.sentencePause.value=savedSentencePause;
  const savedParagraphPause = storageGet(STORAGE.paragraphPause,"");
  if(savedParagraphPause) els.paragraphPause.value=savedParagraphPause;

  if(els.saveState){
    els.saveState.textContent = savedText
      ? `Wiederhergestellt · ${savedText.length.toLocaleString("de-DE")} Zeichen`
      : "Text wird automatisch lokal gespeichert.";
  }
}

function showDebugLog(){
  requestAnimationFrame(()=>{
    els.debugLog?.scrollIntoView({behavior:"smooth",block:"start"});
    setTimeout(()=>{
      if(els.debugLog){
        els.debugLog.scrollTop = els.debugLog.scrollHeight;
      }
    },450);
  });
}

window.ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
window.ort.env.wasm.numThreads = 1; // iOS Safari: keep memory/threading conservative
window.ort.env.wasm.simd = true;

log("BOOT","App loaded",{
  version:LOG_VERSION,
  href:location.href,
  userAgent:navigator.userAgent,
  platform:navigator.platform,
  language:navigator.language,
  languages:navigator.languages,
  online:navigator.onLine,
  deviceMemory:navigator.deviceMemory || null,
  hardwareConcurrency:navigator.hardwareConcurrency || null,
  crossOriginIsolated:window.crossOriginIsolated,
  hasCaches:"caches" in window,
  hasIndexedDB:"indexedDB" in window,
  hasWebAssembly:"WebAssembly" in window,
  hasBigInt64Array:"BigInt64Array" in window,
  hasAudioContext:!!(window.AudioContext || window.webkitAudioContext),
  ortVersion:window.ort?.version || "unknown"
});


function setStatus(msg, progress=null, right=""){
  els.status.textContent=msg;
  if(progress!==null) els.progress.value=Math.max(0,Math.min(1,progress));
  els.progressText.textContent=right;
  log("STATUS",msg,{progress,right});
}
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function withTimeout(promise, ms, label){
  let timer;
  return Promise.race([
    promise.finally(()=>clearTimeout(timer)),
    new Promise((_,rej)=>{timer=setTimeout(()=>rej(new Error(`${label}: Timeout nach ${Math.round(ms/1000)} s`)),ms)})
  ]);
}
async function cachedFetch(url){
  const t0=performance.now();
  log("FETCH","start",{url});
  try{
    if(!("caches" in window)){
      const r=await fetch(url);
      log("FETCH","network done",{url,status:r.status,ms:Math.round(performance.now()-t0),contentLength:r.headers.get("content-length")});
      return r;
    }
    const cache=await caches.open("german-neural-reader-v03");
    let r=await cache.match(url);
    if(r){
      log("FETCH","cache hit",{url,ms:Math.round(performance.now()-t0),contentLength:r.headers.get("content-length")});
      return r.clone();
    }
    r=await fetch(url,{mode:"cors",cache:"force-cache"});
    log("FETCH","network response",{url,status:r.status,type:r.type,contentLength:r.headers.get("content-length"),contentType:r.headers.get("content-type"),ms:Math.round(performance.now()-t0)});
    if(!r.ok) throw new Error(`Download failed (${r.status})`);
    try{
      await cache.put(url,r.clone());
      log("FETCH","cached",{url});
    }catch(err){ logError("cache.put",err); }
    return r;
  }catch(err){
    logError("cachedFetch",err);
    throw err;
  }
}

async function loadModel(){
  persistText("before-loadModel");
  const key=els.modelSelect.value;
  log("MODEL","load requested",{key});
  if(session && loadedModel===key) return;
  els.loadModel.disabled=true; els.preview.disabled=true; els.generate.disabled=true;
  try{
    setStatus("Sprachmodell wird geladen …",.03);
    const [modelResp,configResp]=await Promise.all([cachedFetch(MODELS[key].model),cachedFetch(MODELS[key].config)]);
    setStatus("ONNX-Modell wird initialisiert …",.25);
    const [bytes,cfg]=await Promise.all([modelResp.arrayBuffer(),configResp.json()]);
    log("MODEL","downloaded",{key,modelBytes:bytes.byteLength,configKeys:Object.keys(cfg||{}),sampleRate:cfg?.audio?.sample_rate,phonemeType:cfg?.phoneme_type,espeakVoice:cfg?.espeak?.voice,numSpeakers:cfg?.num_speakers});
    config=cfg;
    session=await withTimeout(window.ort.InferenceSession.create(bytes,{
      executionProviders:["wasm"], graphOptimizationLevel:"all"
    }),120000,"ONNX initialisieren");
    loadedModel=key;
    log("MODEL","session ready",{key,inputNames:session.inputNames,outputNames:session.outputNames});
    setStatus("Stimme ist bereit. Bitte zuerst „Stimme testen“.",1);
    els.preview.disabled=false; els.generate.disabled=!els.text.value.trim();
  }catch(err){
    console.error(err); logError("loadModel",err); setStatus("Fehler: "+(err?.message||err),0);
    session=null;config=null;loadedModel=null;
  }finally{els.loadModel.disabled=false}
}

function addId(ids,map,key){
  const v=map[key]; if(v===undefined)return;
  if(Array.isArray(v)) ids.push(...v); else ids.push(v);
}
async function textToIds(text, timeout=45000){
  const voice=config?.espeak?.voice||"de";
  const t0=performance.now();
  log("PHONEMIZER","start",{voice,textLength:text.length,preview:text.slice(0,120)});
  let out;
  try{
    out=await withTimeout(phonemize(text,voice),timeout,"Phonemisierung");
    log("PHONEMIZER","done",{ms:Math.round(performance.now()-t0),type:Array.isArray(out)?"array":typeof out,preview:Array.isArray(out)?String(out[0]).slice(0,160):String(out).slice(0,160)});
  }catch(err){
    logError("phonemizer",err);
    throw err;
  }
  let p=(Array.isArray(out)?out.join(" "):String(out)).normalize("NFD");
  const ids=[], map=config.phoneme_id_map;
  addId(ids,map,"^"); addId(ids,map,"_");
  for(const ch of Array.from(p)){ addId(ids,map,ch); addId(ids,map,"_"); }
  addId(ids,map,"$");
  log("PHONEMIZER","ids built",{count:ids.length,phonemeChars:p.length});
  if(ids.length<4) throw new Error("Phonemisierung lieferte keine verwertbaren Phoneme.");
  return ids;
}
async function synthesize(text,speed,stageCb=()=>{}){
  stageCb("Phonemisierung …");
  const ids=await textToIds(text);
  log("ONNX","prepare inputs",{ids:ids.length,textLength:text.length});
  await sleep(0);
  stageCb("Audio-Berechnung …");
  const ort=window.ort;
  const feeds={
    input:new ort.Tensor("int64",BigInt64Array.from(ids,x=>BigInt(x)),[1,ids.length]),
    input_lengths:new ort.Tensor("int64",BigInt64Array.from([BigInt(ids.length)]),[1]),
    scales:new ort.Tensor("float32",Float32Array.from([0.667,1/speed,0.8]),[3])
  };
  if((config.num_speakers||1)>1) feeds.sid=new ort.Tensor("int64",BigInt64Array.from([0n]),[1]);
  const tRun=performance.now();
  let result;
  try{
    result=await withTimeout(session.run(feeds),90000,"ONNX-Audio");
    log("ONNX","run done",{ms:Math.round(performance.now()-tRun),outputs:Object.keys(result||{})});
  }catch(err){
    logError("onnx.run",err);
    throw err;
  }
  const audio=result.output?.data;
  log("ONNX","audio output",{samples:audio?.length||0,sampleRate:config?.audio?.sample_rate});
  if(!audio?.length) throw new Error("Das Modell hat kein Audio ausgegeben.");
  return new Float32Array(audio);
}

function cleanText(s){
  return s.replace(/\u00ad/g,"").replace(/[‐‑‒–—]/g,"-").replace(/[“”]/g,'"').replace(/[‘’]/g,"'")
    .replace(/\s+\n/g,"\n").replace(/\n{3,}/g,"\n\n").trim();
}
function splitLongSentence(s,maxLen){
  if(s.length<=maxLen)return[s];
  const out=[]; let rest=s;
  while(rest.length>maxLen){
    let cut=Math.max(rest.lastIndexOf(",",maxLen),rest.lastIndexOf(";",maxLen),rest.lastIndexOf(" ",maxLen));
    if(cut<maxLen*.5)cut=maxLen;
    out.push(rest.slice(0,cut).trim()); rest=rest.slice(cut).trim();
  }
  if(rest)out.push(rest); return out;
}
function makeChunks(text,maxLen=180){
  // Smaller chunks are deliberately used on iPhone/Safari to reduce peak memory and long blocking calls.
  const paras=cleanText(text).split(/\n\s*\n/).filter(Boolean), chunks=[];
  for(const paraRaw of paras){
    const para=paraRaw.replace(/\s*\n\s*/g," ").trim();
    const sentences=para.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g)||[para];
    let buf="";
    for(const raw of sentences){
      for(const piece of splitLongSentence(raw.trim(),maxLen)){
        if(!piece)continue;
        if((buf+" "+piece).trim().length<=maxLen) buf=(buf+" "+piece).trim();
        else { if(buf)chunks.push({text:buf,paragraphEnd:false}); buf=piece; }
      }
    }
    if(buf)chunks.push({text:buf,paragraphEnd:true});
    else if(chunks.length)chunks[chunks.length-1].paragraphEnd=true;
  }
  return chunks;
}
function floatToInt16(f32){
  const out=new Int16Array(f32.length);
  for(let i=0;i<f32.length;i++){const s=Math.max(-1,Math.min(1,f32[i]));out[i]=s<0?s*32768:s*32767}
  return out;
}
function encodePCM(enc,pcm,parts){
  const block=1152;
  for(let i=0;i<pcm.length;i+=block){
    const b=enc.encodeBuffer(pcm.subarray(i,Math.min(i+block,pcm.length)));
    if(b.length)parts.push(new Uint8Array(b));
  }
}
function silence(sr,ms){return new Int16Array(Math.floor(sr*ms/1000))}

async function preview(){
  persistText("before-preview");
  try{
    if(!session)await loadModel(); if(!session)return;
    els.preview.disabled=true;
    const sample="Die Philosophie des Mittelalters ist vielfältiger, als das bekannte Vorurteil von der Magd der Theologie vermuten lässt.";
    const f32=await synthesize(sample,Number(els.speed.value),(stage)=>setStatus("Test: "+stage,.45));
    setStatus("Test: MP3 wird kodiert …",.8);
    const sr=config.audio.sample_rate, enc=new window.lamejs.Mp3Encoder(1,sr,96), parts=[];
    encodePCM(enc,floatToInt16(f32),parts);
      log("CHUNK","encoded",{index:i+1,samples:f32.length,parts:parts.length}); const tail=enc.flush(); if(tail.length)parts.push(new Uint8Array(tail));
    const url=URL.createObjectURL(new Blob(parts,{type:"audio/mpeg"})); const a=new Audio(url);
    a.onended=()=>URL.revokeObjectURL(url); await a.play();
    setStatus("Test erfolgreich. Die Engine funktioniert.",1);
  }catch(err){
    console.error(err); setStatus("Test-Fehler: "+(err?.message||err),0);
  }finally{els.preview.disabled=!session}
}

async function diagnose(){
  persistText("before-diagnose");
  els.diagnose.disabled=true;
  log("DIAG","===== DIAGNOSE START =====");
  try{
    log("DIAG","environment",{
      version:LOG_VERSION,
      href:location.href,
      userAgent:navigator.userAgent,
      online:navigator.onLine,
      visibility:document.visibilityState,
      crossOriginIsolated:window.crossOriginIsolated,
      wasm:typeof WebAssembly!=="undefined",
      bigint64:typeof BigInt64Array!=="undefined",
      ortPresent:!!window.ort
    });

    setStatus("Diagnose 1/5: CDN/Phonemizer-Modul …",.08);
    log("DIAG","phonemizer function",{type:typeof phonemize});

    setStatus("Diagnose 2/5: Phonemizer Mini-Test …",.18);
    const p0=performance.now();
    let p;
    try{
      p=await withTimeout(phonemize("Test.","de"),15000,"Phonemizer Mini-Test");
      log("DIAG","phonemizer mini success",{ms:Math.round(performance.now()-p0),result:p});
    }catch(err){
      logError("DIAG phonemizer mini",err);
      throw err;
    }

    setStatus("Diagnose 3/5: Phonemizer Deutsch-Test …",.30);
    const p1=performance.now();
    try{
      const pde=await withTimeout(phonemize("Die Philosophie des Mittelalters.","de"),30000,"Phonemizer Deutsch-Test");
      log("DIAG","phonemizer german success",{ms:Math.round(performance.now()-p1),result:pde});
    }catch(err){
      logError("DIAG phonemizer german",err);
      throw err;
    }

    setStatus("Diagnose 4/5: Sprachmodell …",.48);
    if(!session) await loadModel();
    if(!session) throw new Error("Sprachmodell ist nicht geladen.");
    log("DIAG","model ready",{loadedModel,sampleRate:config?.audio?.sample_rate,espeakVoice:config?.espeak?.voice});

    setStatus("Diagnose 5/5: ONNX-Test-Inferenz …",.68);
    const audio=await synthesize("Kurzer Audiotest.",1,(stage)=>log("DIAG_STAGE",stage));
    if(!audio.length)throw new Error("Kein Audio.");
    log("DIAG","audio success",{samples:audio.length,sampleRate:config.audio.sample_rate,durationSec:Number((audio.length/config.audio.sample_rate).toFixed(2))});

    setStatus("Diagnose OK: alle Tests erfolgreich.",1);
    log("DIAG","===== DIAGNOSE OK =====");
  }catch(err){
    console.error(err);
    logError("DIAG FAIL",err);
    setStatus("Diagnose-Fehler: "+(err?.message||err),0);
    log("DIAG","===== DIAGNOSE ENDE MIT FEHLER =====");
  }finally{
    els.diagnose.disabled=false;
    showDebugLog();
  }
}

async function generate(){
  const txt=els.text.value.trim(); if(!txt)return;
  try{
    if(!session)await loadModel(); if(!session)return;
    cancelRequested=false; els.generate.disabled=true;els.cancel.disabled=false;els.preview.disabled=true;els.result.classList.add("hidden");
    const chunks=makeChunks(txt);
    log("GENERATE","start",{textLength:txt.length,chunks:chunks.length,speed:Number(els.speed.value),sentencePause:Number(els.sentencePause.value),paragraphPause:Number(els.paragraphPause.value)});
    if(!chunks.length)throw new Error("Kein lesbarer Text gefunden.");
    const sr=config.audio.sample_rate, enc=new window.lamejs.Mp3Encoder(1,sr,96), parts=[];
    const sPause=Number(els.sentencePause.value),pPause=Number(els.paragraphPause.value),speed=Number(els.speed.value);

    for(let i=0;i<chunks.length;i++){
      if(cancelRequested)throw new Error("Abgebrochen");
      const c=chunks[i], pct=i/chunks.length;
      log("CHUNK","start",{index:i+1,total:chunks.length,textLength:c.text.length,paragraphEnd:c.paragraphEnd,preview:c.text.slice(0,100)});
      const prefix=`Abschnitt ${i+1}/${chunks.length}`;
      const f32=await synthesize(c.text,speed,(stage)=>setStatus(`${prefix}: ${stage}`,pct,`${Math.round(pct*100)} %`));
      setStatus(`${prefix}: MP3 kodieren …`,pct,`${Math.round(pct*100)} %`);
      encodePCM(enc,floatToInt16(f32),parts);
      encodePCM(enc,silence(sr,c.paragraphEnd?pPause:sPause),parts);
      // Give Mobile Safari time to service UI/events and release temporaries.
      await sleep(25);
    }
    setStatus("MP3 wird abgeschlossen …",.995,"99 %");
    const tail=enc.flush();if(tail.length)parts.push(new Uint8Array(tail));
    const blob=new Blob(parts,{type:"audio/mpeg"});
    if(resultUrl)URL.revokeObjectURL(resultUrl);
    resultUrl=URL.createObjectURL(blob);els.audio.src=resultUrl;els.download.href=resultUrl;
    els.download.download=`Mittelalter_${new Date().toISOString().slice(0,10)}.mp3`;
    els.result.classList.remove("hidden");
    setStatus("Fertig. Die komplette MP3 ist bereit.",1,"100 %");
  }catch(err){
    console.error(err);
    setStatus(String(err?.message||err)==="Abgebrochen"?"Erzeugung abgebrochen.":"Fehler: "+(err?.message||err),0);
  }finally{
    els.generate.disabled=!session||!els.text.value.trim();els.cancel.disabled=true;els.preview.disabled=!session;
  }
}

let textSaveTimer=null;
function updateTextState({save=true, reason="edit"}={}){
  els.charCount.textContent=`${els.text.value.length.toLocaleString("de-DE")} Zeichen`;
  els.generate.disabled=!session||!els.text.value.trim();
  if(save){
    clearTimeout(textSaveTimer);
    textSaveTimer=setTimeout(()=>persistText(reason),120);
  }
}
els.speed.addEventListener("input",()=>{
  els.speedOut.value=`${Number(els.speed.value).toFixed(2)}×`;
  storageSet(STORAGE.speed, els.speed.value);
});

els.loadModel.addEventListener("click",loadModel);
els.preview.addEventListener("click",preview);
els.diagnose.addEventListener("click",diagnose);
els.generate.addEventListener("click",generate);
els.cancel.addEventListener("click",()=>{cancelRequested=true;els.cancel.disabled=true});

els.text.addEventListener("input",()=>updateTextState({save:true,reason:"typing"}));

els.clearText.addEventListener("click",()=>{
  els.text.value="";
  persistText("clear");
  updateTextState({save:false});
});

els.forgetSavedText.addEventListener("click",()=>{
  try{localStorage.removeItem(STORAGE.text)}catch(err){logError("remove saved text",err)}
  els.text.value="";
  updateTextState({save:false});
  if(els.saveState) els.saveState.textContent="Gespeicherter Text wurde gelöscht.";
  setStatus("Gespeicherter Text wurde gelöscht.",els.progress.value);
});

els.modelSelect.addEventListener("change",()=>{
  persistText("before-model-change");
  storageSet(STORAGE.model,els.modelSelect.value);
  session=null;config=null;loadedModel=null;
  els.preview.disabled=true;els.generate.disabled=true;
  setStatus("Anderes Modell gewählt. Bitte neu laden.",0);
});

els.sentencePause.addEventListener("change",()=>storageSet(STORAGE.sentencePause,els.sentencePause.value));
els.paragraphPause.addEventListener("change",()=>storageSet(STORAGE.paragraphPause,els.paragraphPause.value));

els.fileInput.addEventListener("change",async e=>{
  const f=e.target.files?.[0];
  if(!f)return;
  try{
    const txt=await f.text();
    els.text.value=txt;
    persistText("file-upload");
    updateTextState({save:false});
    setStatus(`TXT geladen und gespeichert: ${f.name}`,els.progress.value);
    log("TEXT","file uploaded",{name:f.name,size:f.size,chars:txt.length,type:f.type});
  }catch(err){
    logError("file upload",err);
    setStatus("TXT konnte nicht geladen werden: "+(err?.message||err),0);
  }finally{
    // iOS: allow selecting the same file again later.
    e.target.value="";
  }
});

els.loadBundled.addEventListener("click",async()=>{
  try{
    const r=await fetch("./Mittelalter_Vorlesetext.txt",{cache:"no-store"});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const txt=await r.text();
    els.text.value=txt;
    persistText("bundled-text");
    updateTextState({save:false});
    setStatus("Mittelalter-Text geladen und gespeichert.",els.progress.value);
    log("TEXT","bundled text loaded",{chars:txt.length});
  }catch(err){
    logError("bundled text",err);
    setStatus("Textdatei nicht gefunden. Nutze TXT auswählen.",0);
  }
});

els.copyLog.addEventListener("click",async()=>{
  const txt=logLines.join("\n");
  try{
    await navigator.clipboard.writeText(txt);
    setStatus("Kompletter Diagnose-Log wurde kopiert.",els.progress.value);
    log("LOG","copied",{lines:logLines.length,chars:txt.length});
  }catch(err){
    logError("clipboard",err);
    els.debugLog.focus();
    els.debugLog.select();
    try{
      document.execCommand("copy");
      setStatus("Kompletter Diagnose-Log wurde kopiert.",els.progress.value);
    }catch(e){
      setStatus("Kopieren fehlgeschlagen – Log ist markiert, bitte manuell kopieren.",els.progress.value);
    }
  }
});

els.clearLog.addEventListener("click",()=>{
  logLines.length=0;
  els.debugLog.value="";
  log("LOG","Log cleared by user");
});

restorePersistentState();
updateTextState({save:false});
