const $ = (id) => document.getElementById(id);

const LOG_VERSION = "0.49";
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
let debugRenderTimer=null;
function persistLogsSoon(){
  if(persistLogTimer) return;
  persistLogTimer=setTimeout(()=>{
    persistLogTimer=null;
    try{ localStorage.setItem(PERSISTENT_LOG_KEY, JSON.stringify(logLines.slice(-120))); }catch(_){}
  },1200);
}
function renderDebugLogNow(){
  if(debugRenderTimer){
    clearTimeout(debugRenderTimer);
    debugRenderTimer=null;
  }
  const box=document.getElementById("debugLog");
  if(box){
    box.value=logLines.join("\n");
    box.scrollTop=box.scrollHeight;
  }
}
function renderDebugLogSoon(){
  if(debugRenderTimer) return;
  debugRenderTimer=setTimeout(()=>{
    debugRenderTimer=null;
    renderDebugLogNow();
  },900);
}
function log(type, message, data){
  const line = `[${nowISO()}] [${type}] ${message}` + (data !== undefined ? ` | ${typeof data === "string" ? data : safeJson(data)}` : "");
  logLines.push(line);
  if(logLines.length > 1200) logLines.shift();
  persistLogsSoon();
  renderDebugLogSoon();
  // In-app diagnostics keep every line. Avoid expensive Safari console traffic
  // for high-frequency ONNX/status events unless it is actually an error.
  if(type==="ERROR" || type==="WINDOW_ERROR" || type==="CRASH_FORENSICS"){
    try { console.log(line); } catch(_) {}
  }
}
function logError(scope, err){
  log("ERROR", scope, {
    name: err?.name || null,
    message: err?.message || String(err),
    stack: err?.stack || null
  });
}

const CRASH_FORENSICS_KEY="gnr:crash-forensics:v1";
const SESSION_INSTANCE_ID=Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);

function persistCrashBreadcrumb(stage,data={}){
  try{
    const payload={
      active:true,
      version:LOG_VERSION,
      sessionId:SESSION_INSTANCE_ID,
      stage,
      ts:Date.now(),
      visibility:document.visibilityState,
      ...data
    };
    localStorage.setItem(CRASH_FORENSICS_KEY,JSON.stringify(payload));
  }catch(_){}
}
function clearCrashBreadcrumb(reason="completed"){
  try{
    const prev=JSON.parse(localStorage.getItem(CRASH_FORENSICS_KEY)||"null");
    if(prev){
      localStorage.setItem(CRASH_FORENSICS_KEY,JSON.stringify({
        ...prev,active:false,clearedAt:Date.now(),clearReason:reason
      }));
    }
  }catch(_){}
}
function readCrashBreadcrumb(){
  try{return JSON.parse(localStorage.getItem(CRASH_FORENSICS_KEY)||"null")}catch(_){return null}
}
function memorySnapshot(){
  const pm=performance?.memory;
  return {
    jsHeapUsed:pm?.usedJSHeapSize||null,
    jsHeapTotal:pm?.totalJSHeapSize||null,
    jsHeapLimit:pm?.jsHeapSizeLimit||null
  };
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
  backgroundPaused=document.visibilityState!=="visible";
  log("LIFECYCLE","visibilitychange",{visibility:document.visibilityState,backgroundPaused});
  if(!backgroundPaused){
    (async()=>{
      try{
        const resume=localStorage.getItem(RESUME_KEY);
        if((els.computeMode?.value||"local")==="local" && resume && els.text.value.trim() && !generationRunning){
          const matches=await resumeMatchesCurrentText(resume,els.text.value);
          if(matches){
            log("CHECKPOINT","resume on foreground",{jobKey:resume});
            setTimeout(()=>generate(),250);
          }else{
            localStorage.removeItem(RESUME_KEY);
            log("CHECKPOINT","stale foreground resume detached",{jobKey:resume,chars:els.text.value.length});
            discoverRecoverableJob();
          }
        }
      }catch(err){logError("foreground resume",err)}
    })();
  }
});

const els = {
  modelSelect:$("modelSelect"), speed:$("speed"), speedOut:$("speedOut"),
  loadModel:$("loadModel"), preview:$("preview"), diagnose:$("diagnose"), status:$("status"),
  progress:$("progress"), progressText:$("progressText"), text:$("text"),
  fileInput:$("fileInput"), loadBundled:$("loadBundled"), clearText:$("clearText"), forgetSavedText:$("forgetSavedText"), saveState:$("saveState"),
  charCount:$("charCount"), sentencePause:$("sentencePause"),
  paragraphPause:$("paragraphPause"), bitrate:$("bitrate"), generate:$("generate"),
  cancel:$("cancel"), result:$("result"), audio:$("audio"), download:$("download"), debugLog:$("debugLog"), copyLog:$("copyLog"), clearLog:$("clearLog"),
  computeMode:$("computeMode"), computeModeHint:$("computeModeHint"), hfEndpoint:$("hfEndpoint"), hfEndpointWrap:$("hfEndpointWrap"),
  loadTestText:$("loadTestText"), recoverJob:$("recoverJob")
};

const MODELS = {
  mobile_safe: {
    model:"https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/eva_k/x_low/de_DE-eva_k-x_low.onnx?download=true",
    config:"https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/eva_k/x_low/de_DE-eva_k-x_low.onnx.json?download=true"
  },
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
let generationRunning=false;
let backgroundPaused=false;

const IS_IOS_WEBKIT=/iPad|iPhone|iPod/.test(navigator.userAgent) && /AppleWebKit/.test(navigator.userAgent);
const AUDIO_BACKEND="wasm";
const MOBILE_SAFE_MODEL="mobile_safe";
const TEST_TEXT="Dies ist ein kurzer Test für die deutsche Sprachausgabe. Das Leben schwingt, wie Schopenhauer meinte, zwischen Schmerz und Langeweile – dieser Test hoffentlich nicht.";


const STORAGE = {
  text: "gnr:text:v1",
  model: "gnr:model:v1",
  speed: "gnr:speed:v1",
  sentencePause: "gnr:sentencePause:v1",
  paragraphPause: "gnr:paragraphPause:v1",
  bitrate: "gnr:bitrate:v1",
  computeMode: "gnr:computeMode:v1",
  hfEndpoint: "gnr:hfEndpoint:v1"
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
  const savedBitrate = storageGet(STORAGE.bitrate,"");
  if(savedBitrate && els.bitrate && [...els.bitrate.options].some(o=>o.value===savedBitrate)){
    els.bitrate.value=savedBitrate;
  }
  let savedComputeMode=storageGet(STORAGE.computeMode,"local");
  if(savedComputeMode==="hf"){
    savedComputeMode="local";
    storageSet(STORAGE.computeMode,"local");
    log("EXTERNAL","untested Hugging Face mode ignored; reverted to local");
  }
  if(els.computeMode && [...els.computeMode.options].some(o=>o.value===savedComputeMode && !o.disabled)){
    els.computeMode.value=savedComputeMode;
  }
  const savedHfEndpoint=storageGet(STORAGE.hfEndpoint,"");
  if(els.hfEndpoint && savedHfEndpoint) els.hfEndpoint.value=savedHfEndpoint;

  if(els.saveState){
    els.saveState.textContent = savedText
      ? `Wiederhergestellt · ${savedText.length.toLocaleString("de-DE")} Zeichen`
      : "Text wird automatisch lokal gespeichert.";
  }
}

function showDebugLog(){
  renderDebugLogNow();
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

log("BOOT","App loaded v0.49",{
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
  ortVersion:window.ort?.version || "unknown",
  audioBackend:AUDIO_BACKEND,
  iosWebKit:IS_IOS_WEBKIT
});

try{
  const prevCrash=readCrashBreadcrumb();
  if(prevCrash?.active && prevCrash.sessionId!==SESSION_INSTANCE_ID){
    const ageMs=Date.now()-Number(prevCrash.ts||0);
    log("CRASH_FORENSICS","probable previous hard crash",{
      previousVersion:prevCrash.version||null,
      stage:prevCrash.stage||null,
      chunkIndex:prevCrash.chunkIndex||null,
      requestId:prevCrash.requestId||null,
      ids:prevCrash.ids||null,
      textLength:prevCrash.textLength||null,
      modelBytes:prevCrash.modelBytes||null,
      outputSamples:prevCrash.outputSamples||null,
      outputBytes:prevCrash.outputBytes||null,
      workerStage:prevCrash.workerStage||null,
      stageAgeMs:ageMs,
      visibilityAtLastMarker:prevCrash.visibility||null,
      memory:prevCrash.memory||null,
      backend:prevCrash.backend||null
    });
    clearCrashBreadcrumb("reported-after-reload");
  }
}catch(err){logError("crash forensic boot report",err)}


function setStatus(msg, progress=null, right=""){
  els.status.textContent=msg;
  if(progress!==null) els.progress.value=Math.max(0,Math.min(1,progress));
  els.progressText.textContent=right;
  log("STATUS",msg,{progress,right});
}
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
const JOB_DB_NAME="gnr-jobs-v1";
const JOB_STORE="jobs";
const RESUME_KEY="gnr:resume:v1";

function openJobDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(JOB_DB_NAME,1);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(JOB_STORE)) db.createObjectStore(JOB_STORE,{keyPath:"key"});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error("IndexedDB konnte nicht geöffnet werden."));
  });
}
async function jobPut(record){
  const db=await openJobDB();
  try{
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(JOB_STORE,"readwrite");
      tx.objectStore(JOB_STORE).put(record);
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error||new Error("Checkpoint speichern fehlgeschlagen."));
      tx.onabort=()=>reject(tx.error||new Error("Checkpoint abgebrochen."));
    });
  }finally{db.close()}
}
async function jobGet(key){
  const db=await openJobDB();
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(JOB_STORE,"readonly");
      const req=tx.objectStore(JOB_STORE).get(key);
      req.onsuccess=()=>resolve(req.result||null);
      req.onerror=()=>reject(req.error||new Error("Checkpoint lesen fehlgeschlagen."));
    });
  }finally{db.close()}
}
async function jobFindBestResume(total){
  const db=await openJobDB();
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(JOB_STORE,"readonly");
      const store=tx.objectStore(JOB_STORE);
      const req=store.openCursor();
      let best=null;
      req.onsuccess=()=>{
        const cursor=req.result;
        if(!cursor){
          resolve(best);
          return;
        }
        const v=cursor.value;
        const isMainJob=v && typeof v.key==="string" && !v.key.includes(":audio:") && !v.key.endsWith(":phonemes");
        if(isMainJob && Number(v.total)===Number(total)){
          const score=(v.phase==="audio"?1000000:0)+Number(v.audioDone||0)*1000+Number(v.done||0);
          const bestScore=best?((best.phase==="audio"?1000000:0)+Number(best.audioDone||0)*1000+Number(best.done||0)):-1;
          if(score>bestScore) best=v;
        }
        cursor.continue();
      };
      req.onerror=()=>reject(req.error||new Error("Jobsuche in IndexedDB fehlgeschlagen."));
    });
  }finally{db.close()}
}

async function savePhonemes(jobKey,phonemeBatches){
  await jobPut({
    key:`${jobKey}:phonemes`,
    parent:jobKey,
    phonemeBatches,
    count:Array.isArray(phonemeBatches)?phonemeBatches.length:0,
    updatedAt:Date.now()
  });
}
async function loadPhonemes(jobKey){
  const rec=await jobGet(`${jobKey}:phonemes`);
  return Array.isArray(rec?.phonemeBatches)?rec.phonemeBatches:null;
}

async function saveJobSource(jobKey,text){
  if(!jobKey || !text) return;
  const key=`${jobKey}:source`;
  const existing=await jobGet(key);
  if(existing?.text===text) return;
  await jobPut({key,parent:jobKey,text,chars:text.length,updatedAt:Date.now()});
}
async function loadJobSource(jobKey){
  const rec=await jobGet(`${jobKey}:source`);
  return typeof rec?.text==="string" ? rec.text : null;
}

async function fetchBundledText(){
  const urls=[
    "./Mittelalter_Vorlesetext.txt?v="+encodeURIComponent(LOG_VERSION),
    "https://raw.githubusercontent.com/Dancelknight/Audio-maker/main/Mittelalter_Vorlesetext.txt"
  ];
  let lastErr=null;
  for(const url of urls){
    try{
      const r=await fetch(url,{cache:"no-store"});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const txt=await r.text();
      if(!txt.trim()) throw new Error("Leere Textdatei");
      log("TEXT","repository text fetched",{url,chars:txt.length});
      return txt;
    }catch(err){
      lastErr=err;
      logError("repository text fetch "+url,err);
    }
  }
  throw lastErr||new Error("Repository-Text konnte nicht geladen werden.");
}

async function resumeMatchesCurrentText(jobKey,text){
  if(!jobKey || !text?.trim()) return false;

  // Newer jobs persist their exact source text.
  try{
    const source=await loadJobSource(jobKey);
    if(source) return source.trim()===text.trim();
  }catch(err){ logError("resume source check",err); }

  // Backward compatibility for the original 57,141-character repository job.
  try{
    const bundled=await fetchBundledText();
    if(bundled.trim()!==text.trim()) return false;
    const job=await jobGet(jobKey);
    if(!job) return false;
    const chunks=makeChunks(bundled,110);
    if(Number(job.total)!==chunks.length) return false;
    const bitrate=Number(job.bitrate||40);
    const key=await makeJobKey(bundled,chunks,bitrate);
    const legacy=await makeLegacyJobKey(bundled,chunks);
    return jobKey===key || jobKey===legacy;
  }catch(err){
    logError("legacy resume compatibility",err);
    return false;
  }
}
async function listMainJobs(){
  const db=await openJobDB();
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(JOB_STORE,"readonly");
      const req=tx.objectStore(JOB_STORE).openCursor();
      const out=[];
      req.onsuccess=()=>{
        const cursor=req.result;
        if(!cursor){ resolve(out); return; }
        const v=cursor.value;
        if(v && typeof v.key==="string" && /^job:[^:]+$/.test(v.key)) out.push(v);
        cursor.continue();
      };
      req.onerror=()=>reject(req.error||new Error("Jobs konnten nicht gelesen werden."));
    });
  }finally{db.close()}
}

async function resetJobData(jobKey,total,reason="reset"){
  log("CHECKPOINT","reset job data start",{jobKey,total,reason});
  for(let i=0;i<Number(total||0);i++){
    try{ await jobDelete(`${jobKey}:audio:${i}`); }catch(err){ logError(`reset audio ${i+1}`,err); }
    if((i+1)%50===0) await sleep(0);
  }
  try{ await jobDelete(`${jobKey}:phonemes`); }catch(err){ logError("reset phonemes",err); }
  try{ await jobDelete(jobKey); }catch(err){ logError("reset parent job",err); }
  try{
    if(localStorage.getItem(RESUME_KEY)===jobKey) localStorage.removeItem(RESUME_KEY);
  }catch(_){}
  log("CHECKPOINT","reset job data done",{jobKey,reason});
}

async function jobDelete(key){
  const db=await openJobDB();
  try{
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(JOB_STORE,"readwrite");
      tx.objectStore(JOB_STORE).delete(key);
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error||new Error("Checkpoint löschen fehlgeschlagen."));
    });
  }finally{db.close()}
}
async function jobPutAudioBlob(key,parent,index,blob){
  let lastErr=null;
  for(let attempt=1;attempt<=4;attempt++){
    await waitUntilVisible();
    let db=null;
    try{
      db=await openJobDB();
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(JOB_STORE,"readwrite");
        tx.objectStore(JOB_STORE).put({
          key,parent,index,blob,bytes:blob.size,updatedAt:Date.now()
        });
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error||new Error("Audio-Segment speichern fehlgeschlagen."));
        tx.onabort=()=>reject(tx.error||new Error("Audio-Segment speichern abgebrochen."));
      });
      if(attempt>1) log("INDEXEDDB","audio save recovered",{index:index+1,attempt});
      return;
    }catch(err){
      lastErr=err;
      logError(`INDEXEDDB audio save attempt ${attempt}`,err);
      const msg=String(err?.message||err);
      const retryable=/Indexed Database|Connection.*lost|internal error|UnknownError|InvalidStateError/i.test(msg)||err?.name==="UnknownError";
      if(!retryable || attempt===4) throw err;
      await sleep(500*attempt);
    }finally{
      try{db?.close()}catch(_){}
    }
  }
  throw lastErr||new Error("Audio-Segment konnte nicht gespeichert werden.");
}
async function makeLegacyJobKey(text,chunks){
  const data=new TextEncoder().encode(text+"|"+chunks.length+"|"+els.modelSelect.value+"|"+els.speed.value);
  const digest=await crypto.subtle.digest("SHA-256",data);
  return "job:"+Array.from(new Uint8Array(digest)).slice(0,12).map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function makeJobKey(text,chunks,bitrate){
  const data=new TextEncoder().encode(text+"|"+chunks.length+"|"+els.modelSelect.value+"|"+els.speed.value+"|"+bitrate);
  const digest=await crypto.subtle.digest("SHA-256",data);
  return "job:"+Array.from(new Uint8Array(digest)).slice(0,12).map(b=>b.toString(16).padStart(2,"0")).join("");
}

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
    els.preview.disabled=generationRunning;
    els.generate.disabled=generationRunning || !els.text.value.trim();
  }catch(err){
    console.error(err); logError("loadModel",err); setStatus("Fehler: "+(err?.message||err),0);
    session=null;config=null;loadedModel=null;
  }finally{els.loadModel.disabled=false}
}

function addId(ids,map,key){
  const v=map[key]; if(v===undefined)return;
  if(Array.isArray(v)) ids.push(...v); else ids.push(v);
}
function createPhonemizerClient(){
  const worker=new Worker("./phonemizer-worker.js?v=0.49");
  let seq=0;
  const pending=new Map();

  worker.onmessage=(e)=>{
    const msg=e.data||{};
    const p=pending.get(msg.requestId);
    if(!p) return;
    pending.delete(msg.requestId);
    if(msg.type==="result"){
      clearCrashBreadcrumb("phonemizer-result");
      p.resolve(msg);
    }else{
      persistCrashBreadcrumb("phonemizer:error",{requestId:msg.requestId,message:msg.message||"Phonemizer worker error"});
      p.reject(new Error(msg.message||"Phonemizer worker error"));
    }
  };
  worker.onerror=(e)=>{
    const err=new Error(e.message||"Phonemizer worker failed");
    for(const p of pending.values()) p.reject(err);
    pending.clear();
  };

  return {
    async phonemize(text,voice,timeout=45000){
      const requestId=++seq;
      const t0=performance.now();
      const result=await withTimeout(new Promise((resolve,reject)=>{
        pending.set(requestId,{resolve,reject});
        persistCrashBreadcrumb("phonemizer:request:start",{
          requestId,
          textLength:text.length,
          modelKey:els.modelSelect.value,
          memory:memorySnapshot()
        });
        worker.postMessage({
          requestId,
          text,
          language:voice,
          configUrl:MODELS[els.modelSelect.value]?.config||null,
          modelKey:els.modelSelect.value
        });
      }),timeout,"Phonemizer-Worker");
      log("PHONEMIZER_WORKER","done",{
        requestId,
        ms:Math.round(performance.now()-t0),
        idCount:result.ids?.length||0,
        phonemeCount:result.phonemeCount||0,
        processedText:result.processedText?.slice(0,140)||null,
        mapping:result.mapping||"unknown",
        modelKey:result.modelKey||els.modelSelect.value
      });
      return result.ids;
    },
    close(){
      try{ worker.postMessage({type:"close"}); }catch(_){}
      worker.terminate();
      log("PHONEMIZER_WORKER","terminated");
    }
  };
}

async function textToIds(text, timeout=45000){
  const voice=(config?.espeak?.voice||"de-de").toLowerCase();
  log("PHONEMIZER","textToIds",{voice,textLength:text.length,mode:"single-worker"});
  const client=createPhonemizerClient();
  try{
    const ids=await client.phonemize(text,voice,timeout);
    if(!Array.isArray(ids) || ids.length<4){
      throw new Error("Piper-WASM lieferte keine verwertbaren phoneme_ids.");
    }
    return ids;
  }finally{
    client.close();
    await sleep(80);
  }
}
async function synthesizeIds(ids,text,speed,stageCb=()=>{}){
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

async function synthesize(text,speed,stageCb=()=>{}){
  stageCb("Phonemisierung …");
  const ids=await textToIds(text);
  return await synthesizeIds(ids,text,speed,stageCb);
}

function createOnnxAudioClient(){
  const worker=new Worker("./onnx-worker.js?v=0.49");
  let seq=0;
  let closed=false;

  return {
    async synthesize(ids,text,speed,stageCb=()=>{},meta={}){
      if(closed) throw new Error("ONNX worker already closed");
      await waitUntilVisible();
      stageCb("Audio-Berechnung …");
      const requestId=++seq;
      const t0=performance.now();
      persistCrashBreadcrumb("workerRequest:start",{
        requestId,
        chunkIndex:meta.index||null,
        ids:ids.length,
        textLength:text.length,
        backend:AUDIO_BACKEND,
        memory:memorySnapshot()
      });

      const result=await withTimeout(new Promise((resolve,reject)=>{
        const onMessage=(e)=>{
          const msg=e.data||{};
          if(msg.requestId!==requestId) return;

          if(msg.type==="stage"){
            persistCrashBreadcrumb("worker:"+msg.stage,{
              requestId,
              chunkIndex:meta.index||null,
              ids:ids.length,
              textLength:text.length,
              workerStage:msg.stage,
              modelBytes:msg.modelBytes||null,
              outputSamples:msg.samples||null,
              outputBytes:msg.bytes||null,
              sessionRunCount:msg.sessionRunCount||null,
              workerTimestamp:msg.at||null,
              backend:msg.backend||AUDIO_BACKEND,
              memory:memorySnapshot()
            });
            log("ONNX_STAGE",msg.stage,{
              requestId,
              chunkIndex:meta.index||null,
              ids:ids.length,
              modelBytes:msg.modelBytes||null,
              samples:msg.samples||null,
              bytes:msg.bytes||null,
              sessionRunCount:msg.sessionRunCount||null,
              backend:msg.backend||AUDIO_BACKEND
            });
            return;
          }

          worker.removeEventListener("message",onMessage);
          worker.removeEventListener("error",onError);
          if(msg.type==="result") resolve(msg);
          else reject(Object.assign(new Error(msg.message||"ONNX worker error"),{name:msg.name||"Error",stack:msg.stack||null}));
        };
        const onError=(e)=>{
          persistCrashBreadcrumb("worker:error",{
            requestId,
            chunkIndex:meta.index||null,
            ids:ids.length,
            textLength:text.length,
            message:e.message||"ONNX worker failed",
            memory:memorySnapshot()
          });
          worker.removeEventListener("message",onMessage);
          worker.removeEventListener("error",onError);
          reject(new Error(e.message||"ONNX worker failed"));
        };
        worker.addEventListener("message",onMessage);
        worker.addEventListener("error",onError);
        worker.postMessage({
          type:"synthesize",
          requestId,
          modelUrl:MODELS[els.modelSelect.value].model,
          configUrl:MODELS[els.modelSelect.value].config,
          ids,
          speed,
          backend:AUDIO_BACKEND
        });
      }),120000,"ONNX-Worker");

      const audio=result.audio instanceof Float32Array ? result.audio : new Float32Array(result.audio||[]);
      if(!audio.length) throw new Error("ONNX-Worker hat kein Audio geliefert.");
      clearCrashBreadcrumb("onnx-result-received");

      log("ONNX_WORKER","done",{
        requestId,
        ms:Math.round(performance.now()-t0),
        initialized:!!result.initialized,
        initMs:result.initMs||0,
        runMs:result.runMs||null,
        sessionRunCount:result.sessionRunCount||null,
        sessionRecycled:!!result.sessionRecycled,
        recycleMs:result.recycleMs||0,
        samples:audio.length,
        sampleRate:result.sampleRate||22050,
        textLength:text.length,
        ids:ids.length,
        backend:result.backend||AUDIO_BACKEND
      });
      if(result.sessionRecycled){
        log("ONNX_WORKER","session recycled in-place",{
          afterRuns:result.sessionRunCount,
          recycleMs:result.recycleMs||0
        });
      }

      return {audio,sampleRate:result.sampleRate||22050};
    },
    hardTerminate(){
      if(closed) return;
      closed=true;
      try{worker.terminate()}catch(_){}
      log("ONNX_WORKER","hard terminated");
    },
    close(){
      if(closed) return;
      closed=true;
      try{worker.postMessage({type:"close"})}catch(_){}
      setTimeout(()=>{ try{worker.terminate()}catch(_){} },80);
      log("ONNX_WORKER","batch terminated");
    }
  };
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
  // The built-in smoke test is deliberately split into five audio segments so
  // it exercises phonemization, multiple persisted MP3 parts and final assembly.
  if(cleanText(text)===cleanText(TEST_TEXT)){
    return [
      {text:"Dies ist ein kurzer Test",paragraphEnd:false},
      {text:"für die deutsche Sprachausgabe.",paragraphEnd:false},
      {text:"Das Leben schwingt, wie Schopenhauer meinte,",paragraphEnd:false},
      {text:"zwischen Schmerz und Langeweile",paragraphEnd:false},
      {text:"– dieser Test hoffentlich nicht.",paragraphEnd:true}
    ];
  }
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
  log("DIAG","===== DIAGNOSE v0.49 START =====");

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
    log("DIAG","===== DIAGNOSE v0.49 OK =====");
  }catch(err){
    console.error(err);
    logError("DIAG FAIL",err);
    setStatus("Diagnose-Fehler: "+(err?.message||err),0);
    log("DIAG","===== DIAGNOSE v0.49 FEHLER =====");
  }finally{
    els.diagnose.disabled=false;
    showDebugLog();
  }
}

async function waitUntilVisible(){
  while(document.visibilityState!=="visible"){
    backgroundPaused=true;
    setStatus("Pausiert – Safari ist im Hintergrund. Beim Zurückkehren geht es automatisch weiter.",els.progress.value,els.progressText.textContent);
    await sleep(500);
  }
  backgroundPaused=false;
}

async function encodeAndPersistAudioChunk({jobKey,index,chunk,ids,speed,sPause,pPause,mp3Bitrate,audioClient,prefix,pct}){
  const workerResult=await audioClient.synthesize(
    ids,chunk.text,speed,
    (stage)=>setStatus(`${prefix}: ${stage}`,pct,`${Math.round(pct*100)} %`),
    {index:index+1}
  );
  const f32=workerResult.audio;
  const sr=workerResult.sampleRate;

  setStatus(`${prefix}: MP3-Segment speichern …`,pct,`${Math.round(pct*100)} %`);
  persistCrashBreadcrumb("mp3Encode:start",{chunkIndex:index+1,outputSamples:f32.length,outputBytes:f32.byteLength,memory:memorySnapshot()});

  const enc=new window.lamejs.Mp3Encoder(1,sr,mp3Bitrate);
  const segParts=[];
  const pcm=floatToInt16(f32);
  encodePCM(enc,pcm,segParts);
  encodePCM(enc,silence(sr,chunk.paragraphEnd?pPause:sPause),segParts);
  const tail=enc.flush();
  if(tail.length) segParts.push(new Uint8Array(tail));

  const segmentBlob=new Blob(segParts,{type:"audio/mpeg"});
  clearCrashBreadcrumb("mp3-encoded");
  log("CHUNK","segment encoded",{index:index+1,parts:segParts.length,bytes:segmentBlob.size});

  await sleep(IS_IOS_WEBKIT?8:30);
  await waitUntilVisible();
  persistCrashBreadcrumb("indexedDB:audioSave:start",{chunkIndex:index+1,segmentBytes:segmentBlob.size,memory:memorySnapshot()});
  await jobPutAudioBlob(`${jobKey}:audio:${index}`,jobKey,index,segmentBlob);
  clearCrashBreadcrumb("indexeddb-audio-saved");
  log("CHUNK","segment saved",{index:index+1,bytes:segmentBlob.size});
  return segmentBlob.size;
}


const COLAB_NOTEBOOK_URL="https://colab.research.google.com/github/Dancelknight/Audio-maker/blob/main/colab/GermanReader_Colab.ipynb";

function normalizedHfEndpoint(){
  return String(els.hfEndpoint?.value||"").trim().replace(/\/+$/,"");
}

function updateComputeModeUI(){
  let mode=els.computeMode?.value||"local";
  if(mode==="hf"){
    mode="local";
    if(els.computeMode) els.computeMode.value="local";
    storageSet(STORAGE.computeMode,"local");
  }
  if(els.hfEndpointWrap) els.hfEndpointWrap.style.display=mode==="hf"?"block":"none";
  if(els.computeModeHint){
    els.computeModeHint.textContent=
      mode==="local"
        ? "Lokal: Text bleibt auf diesem Gerät. Für iPhone/iPad wird Eva K Mobile Safe verwendet."
        : mode==="hf"
          ? "Extern: Der Text wird an deinen Hugging-Face-Space gesendet und dort als MP3 berechnet."
          : "Extern: Die Seite speichert deinen Text als TXT und öffnet das vorbereitete Google-Colab-Notebook.";
  }
  if(els.loadModel) els.loadModel.disabled=mode!=="local";
  if(els.preview) els.preview.disabled=mode!=="local" || !session;
  if(els.generate){
    els.generate.textContent=
      mode==="local" ? "2 · Komplette MP3 erzeugen" :
      mode==="hf" ? "2 · Extern auf Hugging Face erzeugen" :
      "2 · In Google Colab erzeugen";
    els.generate.disabled=generationRunning || !els.text.value.trim() || (mode==="local" && !session);
  }
}

async function generateOnHuggingFace(){
  const txt=els.text.value.trim();
  if(!txt) return;
  const base=normalizedHfEndpoint();
  if(!base){
    setStatus("Bitte zuerst die URL deines Hugging-Face-Spaces eintragen.",0);
    els.hfEndpoint?.focus();
    return;
  }
  generationRunning=true;
  els.generate.disabled=true;
  els.cancel.disabled=true;
  els.result.classList.add("hidden");
  storageSet(STORAGE.hfEndpoint,base);
  setStatus("Text wird an Hugging Face gesendet …",.1,"10 %");
  log("EXTERNAL","huggingface request start",{endpoint:base,chars:txt.length});
  try{
    const r=await fetch(base+"/tts",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        text:txt,
        speed:Number(els.speed.value),
        bitrate:Number(els.bitrate?.value||40),
        sentence_pause_ms:Number(els.sentencePause.value),
        paragraph_pause_ms:Number(els.paragraphPause.value)
      })
    });
    if(!r.ok){
      let detail="";
      try{ detail=await r.text(); }catch(_){}
      throw new Error(`Hugging Face HTTP ${r.status}${detail?": "+detail.slice(0,240):""}`);
    }
    setStatus("MP3 wird geladen …",.9,"90 %");
    const blob=await r.blob();
    if(!blob.size) throw new Error("Der Hugging-Face-Space lieferte eine leere Datei.");
    if(resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl=URL.createObjectURL(blob);
    els.audio.src=resultUrl;
    els.download.href=resultUrl;
    els.download.download=`GermanReader_HF_${new Date().toISOString().slice(0,10)}.mp3`;
    els.result.classList.remove("hidden");
    log("EXTERNAL","huggingface request done",{bytes:blob.size});
    setStatus("Fertig. Externe MP3 ist bereit.",1,"100 %");
  }catch(err){
    logError("HUGGING_FACE",err);
    setStatus("Hugging Face Fehler: "+(err?.message||err),0);
  }finally{
    generationRunning=false;
    updateComputeModeUI();
  }
}

async function openColabFlow(){
  const txt=els.text.value.trim();
  if(!txt) return;
  generationRunning=true;
  updateComputeModeUI();
  try{
    // Save the exact input as a TXT so Colab can upload it without losing formatting.
    const blob=new Blob([txt],{type:"text/plain;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;
    a.download="GermanReader_input.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
    try{ await navigator.clipboard.writeText(txt); }catch(_){}
    log("EXTERNAL","colab handoff",{chars:txt.length,notebook:COLAB_NOTEBOOK_URL});
    setStatus("TXT gespeichert. Google Colab wird geöffnet …",.05,"");
    window.open(COLAB_NOTEBOOK_URL,"_blank","noopener");
  }finally{
    generationRunning=false;
    if(els.computeMode){
      els.computeMode.value="local";
      storageSet(STORAGE.computeMode,"local");
    }
    updateComputeModeUI();
    updateTextState({save:false});
    setStatus("Colab wurde geöffnet. Diese Seite ist wieder im lokalen Modus.",els.progress.value,"");
    log("EXTERNAL","colab handoff finished; local mode restored");
  }
}

async function handleGenerate(){
  const mode=els.computeMode?.value||"local";
  if(mode==="hf") return await generateOnHuggingFace();
  if(mode==="colab") return await openColabFlow();
  return await generate();
}

async function generate(){
  const txt=els.text.value.trim(); if(!txt)return;
  if(generationRunning){
    log("GENERATE","duplicate start ignored");
    return;
  }
  generationRunning=true;
  let jobKey=null;
  try{
    cancelRequested=false;
    setGenerationUiLocked(true);
    els.generate.disabled=true;
    els.cancel.disabled=false;
    if(els.bitrate) els.bitrate.disabled=true;
    els.preview.disabled=true;
    els.result.classList.add("hidden");

    const resumeKey=localStorage.getItem(RESUME_KEY);
    // Preserve the exact old 110-char segmentation for any running job so an
    // update never invalidates checkpoints. New Eva Mobile Safe jobs use 160 chars.
    const desiredChunkLen=(IS_IOS_WEBKIT && els.modelSelect.value===MOBILE_SAFE_MODEL && !resumeKey) ? 160 : 110;
    const chunks=makeChunks(txt,desiredChunkLen);
    if(!chunks.length)throw new Error("Kein lesbarer Text gefunden.");
    log("SPEED","chunk policy",{maxLen:desiredChunkLen,chunks:chunks.length,resuming:!!resumeKey});

    const selectedBitrate=Number(els.bitrate?.value||40);
    const legacyKey=await makeLegacyJobKey(txt,chunks);
    const newKey=await makeJobKey(txt,chunks,selectedBitrate);

    let checkpoint=null;

    const mobileSafeJob=IS_IOS_WEBKIT && els.modelSelect.value===MOBILE_SAFE_MODEL;

    // v0.49 one-time repair: v0.36 created an Eva job using Thorsten phoneme IDs.
    // Eva has a different phoneme-id table, so that job must be discarded and
    // phonemized again from scratch. The old Thorsten job uses a different key
    // and is deliberately left untouched.
    if(mobileSafeJob){
      try{
        const existingEva=await jobGet(newKey);
        const evaPhonemes=await loadPhonemes(newKey);
        // Only the real v0.36 migration job carries this explicit marker.
        // NEVER infer corruption from a low audioDone value: a perfectly valid
        // Eva job is expected to have audioDone 1..6 before a controlled reload.
        const looksLikeV036Migration=!!existingEva?.migratedPhonemesFrom;
        if(looksLikeV036Migration){
          log("MOBILE","invalid v0.36 Eva phonemes detected",{jobKey:newKey,audioDone:existingEva?.audioDone||0});
          await resetJobData(newKey,chunks.length,"v0.36-thorsten-phonemes-in-eva");
        }
      }catch(err){
        logError("mobile v0.36 reset",err);
      }
    }

    // First trust our persisted resume pointer if it belongs to the current job.
    if(resumeKey && (!mobileSafeJob || resumeKey===newKey)){
      try{
        const resumed=await jobGet(resumeKey);
        if(resumed && Number(resumed.total)===chunks.length){
          checkpoint=resumed;
          jobKey=resumeKey;
          log("CHECKPOINT","resume key accepted",{
            jobKey,
            phase:checkpoint.phase,
            done:checkpoint.done,
            audioDone:checkpoint.audioDone,
            phonemeModelKey:checkpoint.phonemeModelKey||null,
            preserveAudio:checkpoint.phase==="audio"
          });
        }
      }catch(err){
        logError("resume key lookup",err);
      }
    }

    // For normal/desktop jobs, recover the most advanced compatible job.
    // Mobile-safe iOS deliberately does NOT resume an old Thorsten audio job.
    if(!checkpoint && !mobileSafeJob){
      try{
        const best=await jobFindBestResume(chunks.length);
        if(best){
          checkpoint=best;
          jobKey=best.key;
          localStorage.setItem(RESUME_KEY,jobKey);
          log("CHECKPOINT","best existing job recovered",{
            jobKey,
            phase:best.phase,
            done:best.done,
            audioDone:best.audioDone,
            bitrate:best.bitrate||null
          });
        }
      }catch(err){
        logError("best job recovery",err);
      }
    }

    // Only create/use the new bitrate-aware job when nothing resumable exists.
    if(!checkpoint){
      jobKey=newKey;
      checkpoint=await jobGet(jobKey);

    }

    // Jobs created before bitrate-aware checkpoints may have been encoded at 96 kbps.
    // Never change their bitrate mid-job.
    const mp3Bitrate=Number(checkpoint?.bitrate || (jobKey===legacyKey ? 96 : selectedBitrate));

    // Persist source text once so orphaned jobs can be recovered after a reload
    // or after the user intentionally switches to another text.
    try{ await saveJobSource(jobKey,txt); }catch(err){ logError("save job source",err); }

    let phase=checkpoint?.phase || "phoneme";
    let startIndex=Number(checkpoint?.done||0);
    let audioDone=Number(checkpoint?.audioDone||0);

    // v0.49: completed jobs keep one final MP3 record. Never re-enter the
    // repair path merely because segment cleanup/reload happened later.
    if(checkpoint?.phase==="complete"){
      const finalRec=await jobGet(`${jobKey}:audio:final`);
      if(finalRec?.blob){
        if(resultUrl) URL.revokeObjectURL(resultUrl);
        resultUrl=URL.createObjectURL(finalRec.blob);
        els.audio.src=resultUrl;
        els.download.href=resultUrl;
        els.download.download=`GermanReader_${new Date().toISOString().slice(0,10)}.mp3`;
        els.result.classList.remove("hidden");
        localStorage.removeItem(RESUME_KEY);
        setStatus("Fertig. Gespeicherte MP3 wurde wiederhergestellt.",1,"100 %");
        log("FINAL","completed MP3 restored",{jobKey,bytes:finalRec.blob.size});
        return;
      }
      // A complete marker without a final blob is inconsistent; fall back to
      // normal verification/repair rather than pretending the file exists.
      phase="audio";
      audioDone=Number(checkpoint?.audioDone||0);
      log("FINAL","complete marker missing final blob; falling back",{jobKey,audioDone});
    }

    // v0.49 stores the large immutable phoneme matrix separately so the tiny
    // audio checkpoint no longer structured-clones all 665 arrays after every chunk.
    let phonemeBatches=null;
    try{
      phonemeBatches=jobKey ? await loadPhonemes(jobKey) : null;
      if(phonemeBatches && checkpoint?.phonemeModelKey && checkpoint.phonemeModelKey!==els.modelSelect.value){
        log("PHONEMIZER","stored phonemes belong to another model",{
          stored:checkpoint.phonemeModelKey,
          current:els.modelSelect.value
        });
        phonemeBatches=null;
      }
    }catch(err){
      logError("load separate phonemes",err);
    }
    if(!phonemeBatches && Array.isArray(checkpoint?.phonemeBatches)){
      phonemeBatches=checkpoint.phonemeBatches;
      try{
        await savePhonemes(jobKey,phonemeBatches);
        log("CHECKPOINT","legacy phonemes migrated",{jobKey,count:phonemeBatches.length});
      }catch(err){
        logError("migrate legacy phonemes",err);
      }
    }
    if(!Array.isArray(phonemeBatches) || phonemeBatches.length!==chunks.length){
      if(phase==="audio"){
        throw new Error("Audio-Checkpoint vorhanden, aber gespeicherte Phoneme fehlen oder sind unvollständig. Audiojob wird nicht automatisch auf Phonemisierung zurückgesetzt.");
      }
      phonemeBatches=new Array(chunks.length);
      phase="phoneme";
      startIndex=0;
      audioDone=0;
    }

    try{ localStorage.setItem(RESUME_KEY,jobKey); }catch(_){}

    log("GENERATE","start",{
      textLength:txt.length,
      chunks:chunks.length,
      speed:Number(els.speed.value),
      sentencePause:Number(els.sentencePause.value),
      paragraphPause:Number(els.paragraphPause.value),
      mode:"resumable-segmented-mp3",
      phase,startIndex,audioDone,bitrateKbps:mp3Bitrate,jobKey
    });

    const voice="de";

    // PHASE 1: phonemization with persistent checkpoints.
    if(phase!=="audio"){
      // Mobile memory safety: the preview/model-load session is not needed during
      // phonemization. Release it before creating Piper/eSpeak WASM workers.
      if(session){
        try{
          await session.release();
          log("MODEL","main session released before phonemization");
        }catch(err){
          logError("main session release before phonemization",err);
        }
        session=null;
        loadedModel=null;
        config=null;
        await sleep(500);
      }
      if(startIndex>0){
        log("CHECKPOINT","resume phonemization",{jobKey,done:startIndex,total:chunks.length});
        setStatus(`Fortsetzen ab Phonemisierung ${startIndex+1}/${chunks.length} …`,(startIndex/chunks.length)*.35,`${Math.round(startIndex/chunks.length*100)} %`);
      }

      let client=null;
      try{
        for(let i=startIndex;i<chunks.length;i++){
          if(cancelRequested)throw new Error("Abgebrochen");

          if(!client){
            persistCrashBreadcrumb("phonemizer:workerBatch:start",{
              chunkIndex:i+1,
              total:chunks.length,
              modelKey:els.modelSelect.value,
              memory:memorySnapshot()
            });
            client=createPhonemizerClient();
            log("PHASE1","worker batch start",{from:i+1,to:Math.min(i+5,chunks.length)});
          }

          const pct=(i/chunks.length)*0.35;
          setStatus(`Phonemisierung ${i+1}/${chunks.length} …`,pct,`${Math.round((i/chunks.length)*100)} %`);
          const ids=await client.phonemize(chunks[i].text,voice,45000);
          if(!Array.isArray(ids)||ids.length<4) throw new Error(`Keine Phoneme für Abschnitt ${i+1}`);
          phonemeBatches[i]=ids;

          if((i+1)%5===0 || (i+1)===chunks.length){
            client.close();
            client=null;
            log("PHASE1","worker batch released",{done:i+1,total:chunks.length});
            clearCrashBreadcrumb("phonemizer-batch-released");
            await sleep(500);
          }

          if((i+1)%25===0 || (i+1)===chunks.length){
            await savePhonemes(jobKey,phonemeBatches);
            await jobPut({
              key:jobKey,done:i+1,total:chunks.length,
              phase:"phoneme",audioDone:0,bitrate:mp3Bitrate,phonemeModelKey:els.modelSelect.value,updatedAt:Date.now()
            });
            localStorage.setItem(RESUME_KEY,jobKey);
            log("CHECKPOINT","saved phonemes",{jobKey,done:i+1,total:chunks.length,separate:true,resumable:true});
          }

          if((i+1)%150===0 && (i+1)<chunks.length){
            if(client){client.close();client=null}
            await savePhonemes(jobKey,phonemeBatches);
            await jobPut({
              key:jobKey,done:i+1,total:chunks.length,
              phase:"phoneme",audioDone:0,bitrate:mp3Bitrate,phonemeModelKey:els.modelSelect.value,updatedAt:Date.now()
            });
            localStorage.setItem(RESUME_KEY,jobKey);
            setStatus(`Speicherbereinigung nach ${i+1} Abschnitten – wird automatisch fortgesetzt …`,pct,`${Math.round((i+1)/chunks.length*100)} %`);
            log("CHECKPOINT","controlled reload phoneme",{jobKey,done:i+1,total:chunks.length});
            await sleep(250);
            location.reload();
            return;
          }
        }
      }finally{
        if(client) client.close();
      }

      phase="audio";
      startIndex=chunks.length;
      audioDone=0;
      await savePhonemes(jobKey,phonemeBatches);
      await jobPut({
        key:jobKey,done:chunks.length,total:chunks.length,
        phase:"audio",audioDone:0,bitrate:mp3Bitrate,phonemeModelKey:els.modelSelect.value,updatedAt:Date.now()
      });
      localStorage.setItem(RESUME_KEY,jobKey);
      log("PHASE1","complete",{chunks:chunks.length});
    }else{
      log("CHECKPOINT","resume audio",{jobKey,audioDone,total:chunks.length});
    }

    // PHASE 2: each chunk becomes an independent MP3 segment in IndexedDB.
    // This allows a full Safari reload without losing already generated audio.
    setStatus(
      audioDone>0 ? `Audio wird fortgesetzt ab ${audioDone+1}/${chunks.length} …` : "Phonemisierung fertig. Sprachmodell wird geladen …",
      .35+(audioDone/chunks.length)*.64,
      `${Math.round((.35+(audioDone/chunks.length)*.64)*100)} %`
    );

    await waitUntilVisible();

    // LOW-MEMORY AUDIO MODE:
    // Never keep the preview/main-thread ONNX session alive while an audio worker
    // owns its own model session. On iOS both live in the same WebKit process.
    if(session){
      try{
        await session.release();
        log("MODEL","main session released before audio phase");
      }catch(err){
        logError("main session release before audio phase",err);
      }
      session=null;
      loadedModel=null;
      config=null;
      await sleep(700);
    }

    // v0.49: iPhone/iPad Safari stays on WASM but uses the much smaller
    // Eva K x_low model. Eva's phoneme IDs are generated from scratch for Eva;
    // Thorsten phoneme IDs are never reused.
    const AUDIO_CHUNKS_PER_LIFECYCLE=6;
    const lifecycleStartAudioDone=audioDone;
    log("BACKEND","audio execution provider selected",{
      backend:AUDIO_BACKEND,
      iosWebKit:IS_IOS_WEBKIT,
      mobileSafeJob,
      sessionPolicy:mobileSafeJob?"persistent-until-crash":"reload-every-6",
      speedMode:"v0.49-low-overhead"
    });
    const sPause=Number(els.sentencePause.value);
    const pPause=Number(els.paragraphPause.value);
    const speed=Number(els.speed.value);

    let audioClient=null;
    try{
      for(let i=audioDone;i<chunks.length;i++){
      if(cancelRequested)throw new Error("Abgebrochen");
      await waitUntilVisible();

      const chunk=chunks[i];
      const pct=.35+(i/chunks.length)*.64;
      const prefix=`Audio ${i+1}/${chunks.length}`;
      const ids=phonemeBatches[i];

      if(!Array.isArray(ids)||ids.length<4){
        throw new Error(`Phoneme für Abschnitt ${i+1} fehlen.`);
      }

      if(!audioClient){
        audioClient=createOnnxAudioClient();
        log("ONNX_WORKER","audio worker start",{
          from:i+1,
          to:IS_IOS_WEBKIT?chunks.length:Math.min(i+AUDIO_CHUNKS_PER_LIFECYCLE,chunks.length),
          mode:mobileSafeJob?"mobile-safe-eva-persistent-session":"controlled-page-reload",
          backend:AUDIO_BACKEND
        });
      }

      log("CHUNK","audio start",{index:i+1,total:chunks.length,textLength:chunk.text.length,ids:ids.length});
      const savedBytes=await encodeAndPersistAudioChunk({
        jobKey,index:i,chunk,ids,speed,sPause,pPause,mp3Bitrate,audioClient,prefix,pct
      });

      audioDone=i+1;
      await jobPut({
        key:jobKey,
        done:chunks.length,
        total:chunks.length,
        phase:"audio",
        audioDone,
        bitrate:mp3Bitrate,
        phonemeModelKey:els.modelSelect.value,
        updatedAt:Date.now()
      });

      log("CHUNK","checkpoint advanced",{index:i+1,total:chunks.length,bytes:savedBytes,audioDone});

      if(audioDone<chunks.length){
        localStorage.setItem(RESUME_KEY,jobKey);
        setStatus(
          `Audio ${audioDone}/${chunks.length} gespeichert …`,
          .35+(audioDone/chunks.length)*.64,
          `${Math.round((.35+(audioDone/chunks.length)*.64)*100)} %`
        );
      }

      const chunksThisLifecycle=audioDone-lifecycleStartAudioDone;
      // Thorsten/desktop keeps the conservative 6-chunk reload.
      // Eva K Mobile Safe is small enough to keep one persistent session; forcing
      // a reload here caused Safari to crash during the next sessionCreate.
      if(!mobileSafeJob && AUDIO_BACKEND==="wasm" && audioDone<chunks.length && chunksThisLifecycle>=AUDIO_CHUNKS_PER_LIFECYCLE){
        localStorage.setItem(RESUME_KEY,jobKey);
        clearCrashBreadcrumb("controlled-audio-reload");
        setStatus(
          `Speicher-Reset nach ${audioDone}/${chunks.length} – wird automatisch fortgesetzt …`,
          .35+(audioDone/chunks.length)*.64,
          `${Math.round((.35+(audioDone/chunks.length)*.64)*100)} %`
        );
        log("CHECKPOINT","controlled reload audio",{
          jobKey,
          phase:"audio",
          audioDone,
          total:chunks.length,
          chunksThisLifecycle,
          nextAudio:audioDone+1
        });
        if(audioClient){
          audioClient.hardTerminate();
          audioClient=null;
        }
        try{
          localStorage.setItem(PERSISTENT_LOG_KEY,JSON.stringify(logLines.slice(-120)));
        }catch(_){}
        await sleep(300);
        location.reload();
        return;
      }

      await sleep(mobileSafeJob?8:60);
      }
    }finally{
      if(audioClient){
        audioClient.close();
        log("ONNX_WORKER","lifecycle worker closed");
      }
    }

    // FINAL ASSEMBLY: verify all persisted segments first.
    // Safari may occasionally lose an IndexedDB record after a crash; repair only missing pieces.
    setStatus("Alle Audioteile fertig. Segmente werden geprüft …",.992,"99 %");
    log("FINAL","verification start",{segments:chunks.length});

    const missing=[];
    for(let i=0;i<chunks.length;i++){
      const seg=await jobGet(`${jobKey}:audio:${i}`);
      if(!seg?.blob) missing.push(i);
      if((i+1)%50===0) await sleep(0);
    }

    if(missing.length){
      log("FINAL","missing segments detected",{
        count:missing.length,
        first:missing.slice(0,20).map(i=>i+1)
      });
      setStatus(
        `${missing.length} fehlende Audio-Segmente werden repariert …`,
        .90,
        "Reparatur 0 %"
      );

      let repairClient=null;
      try{
        for(let m=0;m<missing.length;m++){
          const i=missing[m];
          if(cancelRequested) throw new Error("Abgebrochen");
          await waitUntilVisible();

          if(!repairClient){
            repairClient=createOnnxAudioClient();
            log("REPAIR","worker batch start",{missingIndex:m+1,totalMissing:missing.length,segment:i+1});
          }

          const chunk=chunks[i];
          const ids=phonemeBatches[i];
          if(!Array.isArray(ids)||ids.length<4){
            throw new Error(`Phoneme für Reparatur-Segment ${i+1} fehlen.`);
          }

          const repairFraction=(m+1)/missing.length;
          const repairProgress=.90+repairFraction*.09;
          const prefix=`Reparatur ${m+1}/${missing.length} · Segment ${i+1}`;
          log("REPAIR","segment start",{index:i+1,missingPosition:m+1,totalMissing:missing.length});

          await encodeAndPersistAudioChunk({
            jobKey,index:i,chunk,ids,speed,sPause,pPause,mp3Bitrate,
            audioClient:repairClient,prefix,pct:repairProgress
          });

          setStatus(
            `Reparatur ${m+1}/${missing.length} abgeschlossen …`,
            repairProgress,
            `Reparatur ${Math.round(repairFraction*100)} %`
          );
          log("REPAIR","segment restored",{index:i+1});

          // Yield briefly without adding a large per-segment delay.
          await sleep(mobileSafeJob?8:50);
        }
      }finally{
        if(repairClient) repairClient.close();
      }
    }

    setStatus("Alle Segmente vorhanden. Eine MP3 wird zusammengesetzt …",.995,"99 %");
    log("FINAL","assembly start",{segments:chunks.length,repaired:missing.length});

    const finalParts=[];
    let totalBytes=0;
    for(let i=0;i<chunks.length;i++){
      const seg=await jobGet(`${jobKey}:audio:${i}`);
      if(!seg?.blob) throw new Error(`MP3-Segment ${i+1} fehlt auch nach Reparatur.`);
      finalParts.push(seg.blob);
      totalBytes+=seg.blob.size;
    }

    const blob=new Blob(finalParts,{type:"audio/mpeg"});
    log("FINAL","assembly done",{segments:finalParts.length,totalBytes,blobBytes:blob.size});

    if(resultUrl)URL.revokeObjectURL(resultUrl);
    resultUrl=URL.createObjectURL(blob);
    els.audio.src=resultUrl;
    els.download.href=resultUrl;
    els.download.download=`GermanReader_${new Date().toISOString().slice(0,10)}.mp3`;
    els.result.classList.remove("hidden");

    // v0.49 crash-safe completion:
    // 1) persist the final MP3,
    // 2) mark the parent complete,
    // 3) clear auto-resume.
    // Do NOT delete the segment records here. Older code deleted them one by
    // one; if Safari died mid-cleanup, audioDone stayed at 665 while hundreds
    // of blobs were already gone, which triggered a huge false "repair" pass.
    await jobPut({
      key:`${jobKey}:audio:final`,
      parent:jobKey,
      index:-1,
      blob,
      bytes:blob.size,
      updatedAt:Date.now()
    });
    await jobPut({
      key:jobKey,
      done:chunks.length,
      total:chunks.length,
      phase:"complete",
      audioDone:chunks.length,
      bitrate:mp3Bitrate,
      phonemeModelKey:els.modelSelect.value,
      finalBytes:blob.size,
      completedAt:Date.now(),
      updatedAt:Date.now()
    });
    localStorage.removeItem(RESUME_KEY);
    clearCrashBreadcrumb("job-complete");
    log("FINAL","job marked complete; segments retained",{jobKey,segments:chunks.length,blobBytes:blob.size});

    setStatus("Fertig. Eine komplette MP3 ist bereit.",1,"100 %");
  }catch(err){
    console.error(err);
    logError("GENERATE",err);
    setStatus(String(err?.message||err)==="Abgebrochen"?"Erzeugung abgebrochen.":"Fehler: "+(err?.message||err),0);
  }finally{
    generationRunning=false;
    setGenerationUiLocked(false);
    updateComputeModeUI();
    els.cancel.disabled=true;
    els.preview.disabled=(els.computeMode?.value||"local")!=="local" || !session;
    discoverRecoverableJob();
  }
}

let textSaveTimer=null;

function setGenerationUiLocked(locked){
  const controls=[
    els.text,els.fileInput,els.loadTestText,els.loadBundled,els.clearText,
    els.forgetSavedText,els.modelSelect,els.speed,els.sentencePause,
    els.paragraphPause,els.bitrate,els.computeMode,els.hfEndpoint
  ];
  for(const el of controls){ if(el) el.disabled=!!locked; }
  if(els.loadModel) els.loadModel.disabled=!!locked || (els.computeMode?.value||"local")!=="local";
  if(els.diagnose) els.diagnose.disabled=!!locked;
  if(els.recoverJob) els.recoverJob.disabled=!!locked;
  if(els.cancel) els.cancel.disabled=!locked;
}

function detachActiveResume(reason="text-changed"){
  try{
    const old=localStorage.getItem(RESUME_KEY);
    if(old){
      localStorage.removeItem(RESUME_KEY);
      log("CHECKPOINT","active resume detached but job retained",{jobKey:old,reason});
    }
  }catch(err){ logError("detach resume",err); }
}

async function discoverRecoverableJob(){
  if(!els.recoverJob) return;
  try{
    const jobs=(await listMainJobs())
      .filter(j=>j.phase!=="complete" && (Number(j.audioDone||0)>0 || Number(j.done||0)>0))
      .sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0));
    if(!jobs.length){
      els.recoverJob.hidden=true;
      return;
    }

    let candidate=null;
    let source=null;
    for(const j of jobs){
      source=await loadJobSource(j.key);
      if(source){ candidate=j; break; }
    }

    // Backward-compatible recovery for the existing 57,141-character lecture job:
    // older versions did not persist the source text separately.
    if(!candidate){
      try{
        const bundled=await fetchBundledText();
        if(bundled){
          const oldChunks=makeChunks(bundled,110);
          for(const j of jobs){
            if(Number(j.total)!==oldChunks.length) continue;
            const bitrate=Number(j.bitrate||40);
            const key=await makeJobKey(bundled,oldChunks,bitrate);
            const legacy=await makeLegacyJobKey(bundled,oldChunks);
            if(j.key===key || j.key===legacy){
              candidate=j;
              source=bundled;
              await saveJobSource(j.key,bundled);
              break;
            }
          }
        }
      }catch(err){ logError("legacy source recovery",err); }
    }

    if(!candidate || !source){
      els.recoverJob.hidden=true;
      return;
    }
    els.recoverJob.hidden=false;
    els.recoverJob.dataset.jobKey=candidate.key;
    els.recoverJob.dataset.sourceKey=`${candidate.key}:source`;
    els.recoverJob.textContent=`Alten Job fortsetzen · ${Number(candidate.audioDone||0)}/${Number(candidate.total||0)}`;
    log("CHECKPOINT","recoverable job found",{jobKey:candidate.key,phase:candidate.phase,audioDone:candidate.audioDone,total:candidate.total,chars:source.length});
  }catch(err){
    logError("discover recoverable job",err);
    els.recoverJob.hidden=true;
  }
}

function updateTextState({save=true, reason="edit"}={}){
  els.charCount.textContent=`${els.text.value.length.toLocaleString("de-DE")} Zeichen`;
  const mode=els.computeMode?.value||"local";
  els.generate.disabled=generationRunning || !els.text.value.trim() || (mode==="local" && !session);
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
els.generate.addEventListener("click",handleGenerate);
els.cancel.addEventListener("click",()=>{cancelRequested=true;els.cancel.disabled=true});

els.text.addEventListener("input",()=>{
  if(!generationRunning) detachActiveResume("typing");
  updateTextState({save:true,reason:"typing"});
  discoverRecoverableJob();
});

els.clearText.addEventListener("click",()=>{
  detachActiveResume("clear-text");
  els.text.value="";
  persistText("clear");
  updateTextState({save:false});
});

els.forgetSavedText.addEventListener("click",()=>{
  detachActiveResume("forget-text");
  try{localStorage.removeItem(STORAGE.text)catch(err){logError("remove saved text",err)}
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
els.bitrate?.addEventListener("change",()=>storageSet(STORAGE.bitrate,els.bitrate.value));
els.computeMode?.addEventListener("change",()=>{
  if(els.computeMode.value==="hf"){
    els.computeMode.value="local";
    storageSet(STORAGE.computeMode,"local");
    setStatus("Hugging Face ist derzeit deaktiviert, weil die Funktion noch nicht getestet wurde.",els.progress.value);
    log("EXTERNAL","blocked untested Hugging Face mode");
  }else{
    storageSet(STORAGE.computeMode,els.computeMode.value);
  }
  updateComputeModeUI();
});
els.hfEndpoint?.addEventListener("change",()=>storageSet(STORAGE.hfEndpoint,normalizedHfEndpoint()));


els.loadTestText?.addEventListener("click",()=>{
  if(generationRunning) return;
  detachActiveResume("load-test-text");
  els.text.value=TEST_TEXT;
  persistText("test-text");
  updateTextState({save:false});
  setStatus("Test-Text geladen: 5 Segmente werden zu einer MP3 zusammengeführt.",els.progress.value);
  log("TEST","test text loaded",{text:TEST_TEXT,segments:5});
  discoverRecoverableJob();
});

els.fileInput.addEventListener("change",async e=>{
  const f=e.target.files?.[0];
  if(!f)return;
  try{
    const txt=await f.text();
    detachActiveResume("file-upload");
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
  if(generationRunning){
    setStatus("Ein Job läuft gerade. Bitte zuerst abbrechen oder fertig laufen lassen.",els.progress.value);
    return;
  }
  try{
    const txt=await fetchBundledText();
    detachActiveResume("bundled-text");
    els.text.value=txt;
    persistText("bundled-text");
    updateTextState({save:false});
    setStatus(`Repository-Text geladen und gespeichert · ${txt.length.toLocaleString("de-DE")} Zeichen.`,els.progress.value);
    log("TEXT","bundled text loaded",{chars:txt.length});
    discoverRecoverableJob();
  }catch(err){
    logError("bundled text",err);
    setStatus("Repository-Text konnte nicht geladen werden: "+(err?.message||err),0);
  }
});

els.recoverJob?.addEventListener("click",async()=>{
  if(generationRunning) return;
  try{
    const jobKey=els.recoverJob.dataset.jobKey;
    if(!jobKey) throw new Error("Kein wiederherstellbarer Job gefunden.");
    let source=await loadJobSource(jobKey);
    if(!source){
      source=await fetchBundledText();
    }
    if(!source) throw new Error("Quelltext des alten Jobs konnte nicht wiederhergestellt werden.");
    els.text.value=source;
    persistText("recover-old-job");
    updateTextState({save:false});
    localStorage.setItem(RESUME_KEY,jobKey);
    setStatus("Alter Job wiederhergestellt. Fortsetzung wird gestartet …",els.progress.value);
    log("CHECKPOINT","manual recovery selected",{jobKey,chars:source.length});
    await generate();
  }catch(err){
    logError("manual job recovery",err);
    setStatus("Wiederherstellung fehlgeschlagen: "+(err?.message||err),0);
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
if(IS_IOS_WEBKIT && [...els.modelSelect.options].some(o=>o.value===MOBILE_SAFE_MODEL)){
  if(els.modelSelect.value!==MOBILE_SAFE_MODEL){
    log("MOBILE","forcing Safari iOS safe voice",{from:els.modelSelect.value,to:MOBILE_SAFE_MODEL});
  }
  els.modelSelect.value=MOBILE_SAFE_MODEL;
  storageSet(STORAGE.model,MOBILE_SAFE_MODEL);
}
setGenerationUiLocked(false);
updateTextState({save:false});
updateComputeModeUI();
discoverRecoverableJob();

setTimeout(async()=>{
  try{
    const resume=localStorage.getItem(RESUME_KEY);
    if((els.computeMode?.value||"local")==="local" && resume && els.text.value.trim() && !generationRunning && document.visibilityState==="visible"){
      const matches=await resumeMatchesCurrentText(resume,els.text.value);
      if(matches){
        log("CHECKPOINT","auto resume requested",{jobKey:resume});
        generate();
      }else{
        localStorage.removeItem(RESUME_KEY);
        log("CHECKPOINT","stale startup resume detached",{jobKey:resume,chars:els.text.value.length});
        setGenerationUiLocked(false);
        updateComputeModeUI();
        discoverRecoverableJob();
      }
    }
  }catch(err){logError("auto resume",err)}
},700);
