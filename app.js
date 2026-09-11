const $ = (id) => document.getElementById(id);

const LOG_VERSION = "0.13";
const PERSISTENT_LOG_KEY = "gnr:debuglog:v1";
const TEXT_BACKUP_KEY = "gnr:text:backup:v1";
let logLines = [];
try{
  const prev = JSON.parse(localStorage.getItem(PERSISTENT_LOG_KEY) || "[]");
  if(Array.isArray(prev)) logLines = prev.slice(-500);
}catch(_){ logLines = []; }
function nowISO(){ return new Date().toISOString(); }
function safeJson(v){
  try { return JSON.stringify(v); } catch(_) { return String(v); }
}
let persistLogTimer=null;
function persistLogsSoon(){
  if(persistLogTimer) return;
  persistLogTimer=setTimeout(()=>{
    persistLogTimer=null;
    try{ localStorage.setItem(PERSISTENT_LOG_KEY, JSON.stringify(logLines.slice(-120))); }catch(_){}
  },1200);
}
function log(type, message, data){
  const line = `[${nowISO()}] [${type}] ${message}` + (data !== undefined ? ` | ${typeof data === "string" ? data : safeJson(data)}` : "");
  logLines.push(line);
  if(logLines.length > 1200) logLines.shift();
  persistLogsSoon();
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
window.addEventListener("pagehide", e => {
  try{ persistText("pagehide"); }catch(_){}
  log("LIFECYCLE","pagehide",{persisted:e.persisted,visibility:document.visibilityState});
});
window.addEventListener("pageshow", e => {
  log("LIFECYCLE","pageshow",{persisted:e.persisted,visibility:document.visibilityState});
});
document.addEventListener("visibilitychange", () => {
  try{ persistText("visibilitychange"); }catch(_){}
  log("LIFECYCLE","visibilitychange",{visibility:document.visibilityState});
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

const PHONEMIZER = {
  js: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.js",
  wasm: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm",
  data: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data"
};

let phonemizerFactory = null;
let phonemizerModule = null;
let phonemizerPending = null;

async function fetchProbe(url, label){
  const t0 = performance.now();
  log("PHONEMIZER_ASSET",`${label} fetch start`,{url});
  try{
    const r = await fetch(url,{method:"GET",cache:"force-cache",mode:"cors"});
    log("PHONEMIZER_ASSET",`${label} fetch response`,{
      ok:r.ok,status:r.status,type:r.type,
      contentType:r.headers.get("content-type"),
      contentLength:r.headers.get("content-length"),
      ms:Math.round(performance.now()-t0)
    });
    if(!r.ok) throw new Error(`${label} HTTP ${r.status}`);
    // We intentionally do not read huge WASM/data bodies here during normal generation.
    return true;
  }catch(err){
    logError(`PHONEMIZER_ASSET ${label}`,err);
    throw err;
  }
}

async function loadPiperPhonemizerScript(){
  if(phonemizerFactory) return phonemizerFactory;
  if(window.createPiperPhonemize){
    phonemizerFactory = window.createPiperPhonemize;
    log("PHONEMIZER","factory already present");
    return phonemizerFactory;
  }

  log("PHONEMIZER","script element create",{src:PHONEMIZER.js});
  await new Promise((resolve,reject)=>{
    const s=document.createElement("script");
    s.src=PHONEMIZER.js;
    s.async=true;
    s.onload=()=>{
      log("PHONEMIZER","script onload",{factoryType:typeof window.createPiperPhonemize});
      if(window.createPiperPhonemize) resolve();
      else reject(new Error("piper-wasm script loaded, but createPiperPhonemize was not found"));
    };
    s.onerror=(e)=>{
      log("PHONEMIZER","script onerror",{src:PHONEMIZER.js});
      reject(new Error("piper-wasm script failed to load"));
    };
    document.head.appendChild(s);
  });

  phonemizerFactory = window.createPiperPhonemize;
  return phonemizerFactory;
}

async function initPiperPhonemizer(){
  if(phonemizerModule) return phonemizerModule;
  const factory = await loadPiperPhonemizerScript();

  const t0=performance.now();
  log("PHONEMIZER","WASM module init start",{
    wasm:PHONEMIZER.wasm,
    data:PHONEMIZER.data
  });

  phonemizerModule = await withTimeout(factory({
    noInitialRun:true,
    noExitRuntime:true,
    print:(line)=>{
      if(phonemizerPending){
        try{
          const parsed=JSON.parse(line);
          if(Array.isArray(parsed?.phoneme_ids)){
            log("PHONEMIZER_STDOUT","parsed",{
              idCount:parsed.phoneme_ids.length,
              phonemeCount:parsed.phonemes?.length||0,
              processedText:parsed.processed_text?.slice(0,140)||null
            });
            const pending=phonemizerPending;
            phonemizerPending=null;
            pending.resolve(parsed);
            return;
          }
        }catch(err){}
      }
      log("PHONEMIZER_STDOUT","line",String(line).slice(0,240));
    },
    printErr:(line)=>{
      log("PHONEMIZER_STDERR","line",line);
      if(phonemizerPending && /error|fatal|exception|abort/i.test(String(line))){
        const pending=phonemizerPending;
        phonemizerPending=null;
        pending.reject(new Error(String(line)));
      }
    },
    locateFile:(file)=>{
      let resolved=file;
      if(file.endsWith(".wasm")) resolved=PHONEMIZER.wasm;
      else if(file.endsWith(".data")) resolved=PHONEMIZER.data;
      log("PHONEMIZER","locateFile",{file,resolved});
      return resolved;
    },
    monitorRunDependencies:(left)=>{
      if(left===0 || left<=10 || left%50===0){
        log("PHONEMIZER","run dependencies",{left});
      }
    }
  }),90000,"Piper-WASM Initialisierung");

  log("PHONEMIZER","WASM module init done",{
    ms:Math.round(performance.now()-t0),
    hasCallMain:typeof phonemizerModule?.callMain==="function"
  });

  if(typeof phonemizerModule?.callMain!=="function"){
    throw new Error("Piper-WASM initialisiert, aber callMain fehlt.");
  }
  return phonemizerModule;
}

async function piperPhonemize(text, language="de-de", timeout=45000){
  const mod=await initPiperPhonemizer();
  const t0=performance.now();
  log("PHONEMIZER","callMain start",{language,textLength:text.length,preview:text.slice(0,120)});

  if(phonemizerPending){
    throw new Error("Phonemizer ist bereits beschäftigt.");
  }

  const resultPromise=new Promise((resolve,reject)=>{
    phonemizerPending={resolve,reject};
  });

  try{
    mod.callMain([
      "-l", language,
      "--input", JSON.stringify([{text:text.trim()}]),
      "--espeak_data", "/espeak-ng-data"
    ]);
  }catch(err){
    phonemizerPending=null;
    logError("PHONEMIZER callMain",err);
    throw err;
  }

  let parsed;
  try{
    parsed=await withTimeout(resultPromise,timeout,"Piper-WASM Phonemisierung");
  }catch(err){
    phonemizerPending=null;
    logError("PHONEMIZER wait output",err);
    throw err;
  }

  log("PHONEMIZER","callMain done",{
    ms:Math.round(performance.now()-t0),
    idCount:parsed.phoneme_ids?.length||0,
    phonemeCount:parsed.phonemes?.length||0,
    processedText:parsed.processed_text||null
  });

  return parsed.phoneme_ids;
}


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
    if(key === "gnr:text:v1") localStorage.setItem(TEXT_BACKUP_KEY, String(value));
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
  let savedText = storageGet(STORAGE.text,"");
  if(!savedText){
    try{
      savedText = localStorage.getItem(TEXT_BACKUP_KEY) || "";
      if(savedText) log("STORAGE","text restored from backup",{chars:savedText.length});
    }catch(err){ logError("backup restore",err); }
  }
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

log("BOOT","App loaded v0.13",{
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
      executionProviders:["wasm"],
      graphOptimizationLevel:"basic",
      enableCpuMemArena:false,
      enableMemPattern:false,
      extra:{session:{disable_prepacking:"1"}}
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
  const voice=(config?.espeak?.voice||"de-de").toLowerCase();
  log("PHONEMIZER","textToIds",{voice,textLength:text.length});
  const ids=await piperPhonemize(text,voice,timeout);
  if(!Array.isArray(ids) || ids.length<4){
    throw new Error("Piper-WASM lieferte keine verwertbaren phoneme_ids.");
  }
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
    const audio=result.output?.data;
    log("ONNX","audio output",{samples:audio?.length||0,sampleRate:config?.audio?.sample_rate});
    if(!audio?.length) throw new Error("Das Modell hat kein Audio ausgegeben.");
    return new Float32Array(audio);
  }catch(err){
    logError("onnx.run",err);
    throw err;
  }finally{
    try{
      for(const t of Object.values(feeds)) t?.dispose?.();
      for(const t of Object.values(result||{})) t?.dispose?.();
      log("ONNX","tensors disposed");
    }catch(err){
      logError("onnx.dispose",err);
    }
  }
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
function makeChunks(text,maxLen=110){
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
  const block=1152, frames=[];
  let total=0;
  for(let i=0;i<pcm.length;i+=block){
    const b=enc.encodeBuffer(pcm.subarray(i,Math.min(i+block,pcm.length)));
    if(b.length){
      const u=new Uint8Array(b);
      frames.push(u);
      total+=u.length;
    }
  }
  if(total){
    const merged=new Uint8Array(total);
    let off=0;
    for(const f of frames){ merged.set(f,off); off+=f.length; }
    parts.push(merged);
  }
}
function silence(sr,ms){return new Int16Array(Math.floor(sr*ms/1000))}

async function recycleOnnxSession(reason="periodic"){
  if(!session) return;
  const modelKey=loadedModel || els.modelSelect.value;
  log("MODEL","session recycle start",{reason,modelKey});
  try{
    await session.release();
    log("MODEL","session released",{reason});
  }catch(err){
    logError("session.release",err);
  }
  session=null;
  loadedModel=null;
  // Give WebKit a chance to reclaim WASM/session resources before recreating.
  await sleep(650);
  await loadModel();
  if(!session) throw new Error("ONNX-Session konnte nach Speicherbereinigung nicht neu geladen werden.");
  log("MODEL","session recycle done",{reason,modelKey});
}

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
    log("PREVIEW","encoded",{samples:f32.length,parts:parts.length});
    const tail=enc.flush(); if(tail.length)parts.push(new Uint8Array(tail));
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
  log("DIAG","===== DIAGNOSE v0.13 START =====");

  try{
    setStatus("Diagnose 1/8: Browser-Umgebung …",.04);
    log("DIAG","environment",{
      version:LOG_VERSION,
      href:location.href,
      userAgent:navigator.userAgent,
      platform:navigator.platform,
      language:navigator.language,
      online:navigator.onLine,
      visibility:document.visibilityState,
      crossOriginIsolated:window.crossOriginIsolated,
      wasm:typeof WebAssembly!=="undefined",
      bigint64:typeof BigInt64Array!=="undefined",
      hardwareConcurrency:navigator.hardwareConcurrency||null,
      deviceMemory:navigator.deviceMemory||null
    });

    setStatus("Diagnose 2/8: Piper-WASM JavaScript erreichbar? …",.12);
    await fetchProbe(PHONEMIZER.js,"JS");

    setStatus("Diagnose 3/8: Piper-WASM WASM erreichbar? …",.20);
    await fetchProbe(PHONEMIZER.wasm,"WASM");

    setStatus("Diagnose 4/8: eSpeak-Datendatei erreichbar? …",.28);
    await fetchProbe(PHONEMIZER.data,"DATA");

    setStatus("Diagnose 5/8: Piper-WASM Script laden …",.36);
    const factory=await withTimeout(loadPiperPhonemizerScript(),30000,"Piper-WASM Script");
    log("DIAG","factory ready",{type:typeof factory});

    setStatus("Diagnose 6/8: eSpeak/WASM initialisieren …",.48);
    const mod=await initPiperPhonemizer();
    log("DIAG","module ready",{
      hasCallMain:typeof mod?.callMain==="function",
      hasFS:!!mod?.FS
    });

    setStatus("Diagnose 7/8: Deutsche Phonemisierung …",.62);
    const ids=await piperPhonemize("Die Philosophie des Mittelalters.","de-de",30000);
    log("DIAG","german phonemization success",{idCount:ids.length,firstIds:ids.slice(0,30)});

    setStatus("Diagnose 8/8: Thorsten ONNX + Audio …",.75);
    if(!session) await loadModel();
    if(!session) throw new Error("Thorsten-Sprachmodell ist nicht geladen.");

    const audio=await synthesize("Kurzer Audiotest.",1,(stage)=>log("DIAG_STAGE",stage));
    if(!audio.length) throw new Error("ONNX lieferte kein Audio.");
    log("DIAG","audio success",{
      samples:audio.length,
      sampleRate:config.audio.sample_rate,
      durationSec:Number((audio.length/config.audio.sample_rate).toFixed(2))
    });

    setStatus("Diagnose OK: Piper-WASM, Deutsch und ONNX funktionieren.",1);
    log("DIAG","===== DIAGNOSE v0.13 OK =====");
  }catch(err){
    console.error(err);
    logError("DIAG FAIL",err);
    setStatus("Diagnose-Fehler: "+(err?.message||err),0);
    log("DIAG","===== DIAGNOSE v0.13 FEHLER =====");
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
      log("CHUNK","done",{index:i+1,total:chunks.length,mp3Parts:parts.length});
      // iOS Safari: bound cumulative ONNX/WASM memory. Recreate the session every 2 chunks.
      if((i+1)%2===0 && (i+1)<chunks.length){
        setStatus(`${prefix}: Speicher wird freigegeben …`,pct,`${Math.round(pct*100)} %`);
        await recycleOnnxSession(`after chunk ${i+1}`);
      }else{
        await sleep(220);
      }
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
    logError("GENERATE",err);
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
  try{ localStorage.removeItem(PERSISTENT_LOG_KEY); }catch(_){}
  els.debugLog.value="";
  log("LOG","Log cleared by user");
});

restorePersistentState();
updateTextState({save:false});
