import { phonemize } from "https://cdn.jsdelivr.net/npm/phonemizer@1.2.1";

const $ = (id) => document.getElementById(id);
const els = {
  modelSelect:$("modelSelect"), speed:$("speed"), speedOut:$("speedOut"),
  loadModel:$("loadModel"), preview:$("preview"), diagnose:$("diagnose"), status:$("status"),
  progress:$("progress"), progressText:$("progressText"), text:$("text"),
  fileInput:$("fileInput"), loadBundled:$("loadBundled"), clearText:$("clearText"),
  charCount:$("charCount"), sentencePause:$("sentencePause"),
  paragraphPause:$("paragraphPause"), generate:$("generate"),
  cancel:$("cancel"), result:$("result"), audio:$("audio"), download:$("download")
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

window.ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
window.ort.env.wasm.numThreads = 1; // iOS Safari: keep memory/threading conservative
window.ort.env.wasm.simd = true;

function setStatus(msg, progress=null, right=""){
  els.status.textContent=msg;
  if(progress!==null) els.progress.value=Math.max(0,Math.min(1,progress));
  els.progressText.textContent=right;
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
  if(!("caches" in window)) return fetch(url);
  const cache=await caches.open("german-neural-reader-v02");
  let r=await cache.match(url);
  if(r) return r.clone();
  r=await fetch(url,{mode:"cors",cache:"force-cache"});
  if(!r.ok) throw new Error(`Download failed (${r.status})`);
  try{await cache.put(url,r.clone())}catch(_){}
  return r;
}

async function loadModel(){
  const key=els.modelSelect.value;
  if(session && loadedModel===key) return;
  els.loadModel.disabled=true; els.preview.disabled=true; els.generate.disabled=true;
  try{
    setStatus("Sprachmodell wird geladen …",.03);
    const [modelResp,configResp]=await Promise.all([cachedFetch(MODELS[key].model),cachedFetch(MODELS[key].config)]);
    setStatus("ONNX-Modell wird initialisiert …",.25);
    const [bytes,cfg]=await Promise.all([modelResp.arrayBuffer(),configResp.json()]);
    config=cfg;
    session=await withTimeout(window.ort.InferenceSession.create(bytes,{
      executionProviders:["wasm"], graphOptimizationLevel:"all"
    }),120000,"ONNX initialisieren");
    loadedModel=key;
    setStatus("Stimme ist bereit. Bitte zuerst „Stimme testen“.",1);
    els.preview.disabled=false; els.generate.disabled=!els.text.value.trim();
  }catch(err){
    console.error(err); setStatus("Fehler: "+(err?.message||err),0);
    session=null;config=null;loadedModel=null;
  }finally{els.loadModel.disabled=false}
}

function addId(ids,map,key){
  const v=map[key]; if(v===undefined)return;
  if(Array.isArray(v)) ids.push(...v); else ids.push(v);
}
async function textToIds(text, timeout=45000){
  const voice=config?.espeak?.voice||"de";
  const out=await withTimeout(phonemize(text,voice),timeout,"Phonemisierung");
  let p=(Array.isArray(out)?out.join(" "):String(out)).normalize("NFD");
  const ids=[], map=config.phoneme_id_map;
  addId(ids,map,"^"); addId(ids,map,"_");
  for(const ch of Array.from(p)){ addId(ids,map,ch); addId(ids,map,"_"); }
  addId(ids,map,"$");
  if(ids.length<4) throw new Error("Phonemisierung lieferte keine verwertbaren Phoneme.");
  return ids;
}
async function synthesize(text,speed,stageCb=()=>{}){
  stageCb("Phonemisierung …");
  const ids=await textToIds(text);
  await sleep(0);
  stageCb("Audio-Berechnung …");
  const ort=window.ort;
  const feeds={
    input:new ort.Tensor("int64",BigInt64Array.from(ids,x=>BigInt(x)),[1,ids.length]),
    input_lengths:new ort.Tensor("int64",BigInt64Array.from([BigInt(ids.length)]),[1]),
    scales:new ort.Tensor("float32",Float32Array.from([0.667,1/speed,0.8]),[3])
  };
  if((config.num_speakers||1)>1) feeds.sid=new ort.Tensor("int64",BigInt64Array.from([0n]),[1]);
  const result=await withTimeout(session.run(feeds),90000,"ONNX-Audio");
  const audio=result.output?.data;
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
  try{
    if(!session)await loadModel(); if(!session)return;
    els.preview.disabled=true;
    const sample="Die Philosophie des Mittelalters ist vielfältiger, als das bekannte Vorurteil von der Magd der Theologie vermuten lässt.";
    const f32=await synthesize(sample,Number(els.speed.value),(stage)=>setStatus("Test: "+stage,.45));
    setStatus("Test: MP3 wird kodiert …",.8);
    const sr=config.audio.sample_rate, enc=new window.lamejs.Mp3Encoder(1,sr,96), parts=[];
    encodePCM(enc,floatToInt16(f32),parts); const tail=enc.flush(); if(tail.length)parts.push(new Uint8Array(tail));
    const url=URL.createObjectURL(new Blob(parts,{type:"audio/mpeg"})); const a=new Audio(url);
    a.onended=()=>URL.revokeObjectURL(url); await a.play();
    setStatus("Test erfolgreich. Die Engine funktioniert.",1);
  }catch(err){
    console.error(err); setStatus("Test-Fehler: "+(err?.message||err),0);
  }finally{els.preview.disabled=!session}
}

async function diagnose(){
  els.diagnose.disabled=true;
  try{
    setStatus("Diagnose 1/3: Phonemizer …",.1);
    const p=await withTimeout(phonemize("Das ist ein kurzer Test.","de"),45000,"Phonemizer");
    setStatus("Diagnose 2/3: Sprachmodell …",.4);
    if(!session)await loadModel();
    if(!session)throw new Error("Sprachmodell ist nicht geladen.");
    setStatus("Diagnose 3/3: Test-Inferenz …",.65);
    const audio=await synthesize("Kurzer Audiotest.",1,()=>{});
    if(!audio.length)throw new Error("Kein Audio.");
    setStatus("Diagnose OK: Phonemizer + ONNX funktionieren.",1);
  }catch(err){
    console.error(err); setStatus("Diagnose-Fehler: "+(err?.message||err),0);
  }finally{els.diagnose.disabled=false}
}

async function generate(){
  const txt=els.text.value.trim(); if(!txt)return;
  try{
    if(!session)await loadModel(); if(!session)return;
    cancelRequested=false; els.generate.disabled=true;els.cancel.disabled=false;els.preview.disabled=true;els.result.classList.add("hidden");
    const chunks=makeChunks(txt);
    if(!chunks.length)throw new Error("Kein lesbarer Text gefunden.");
    const sr=config.audio.sample_rate, enc=new window.lamejs.Mp3Encoder(1,sr,96), parts=[];
    const sPause=Number(els.sentencePause.value),pPause=Number(els.paragraphPause.value),speed=Number(els.speed.value);

    for(let i=0;i<chunks.length;i++){
      if(cancelRequested)throw new Error("Abgebrochen");
      const c=chunks[i], pct=i/chunks.length;
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

function updateTextState(){
  els.charCount.textContent=`${els.text.value.length.toLocaleString("de-DE")} Zeichen`;
  els.generate.disabled=!session||!els.text.value.trim();
}
els.speed.addEventListener("input",()=>els.speedOut.value=`${Number(els.speed.value).toFixed(2)}×`);
els.loadModel.addEventListener("click",loadModel);els.preview.addEventListener("click",preview);
els.diagnose.addEventListener("click",diagnose);els.generate.addEventListener("click",generate);
els.cancel.addEventListener("click",()=>{cancelRequested=true;els.cancel.disabled=true});
els.text.addEventListener("input",updateTextState);els.clearText.addEventListener("click",()=>{els.text.value="";updateTextState()});
els.modelSelect.addEventListener("change",()=>{session=null;config=null;loadedModel=null;els.preview.disabled=true;els.generate.disabled=true;setStatus("Anderes Modell gewählt. Bitte neu laden.",0)});
els.fileInput.addEventListener("change",async e=>{const f=e.target.files?.[0];if(!f)return;els.text.value=await f.text();updateTextState()});
els.loadBundled.addEventListener("click",async()=>{try{const r=await fetch("./Mittelalter_Vorlesetext.txt");if(!r.ok)throw new Error();els.text.value=await r.text();updateTextState();setStatus("Mittelalter-Text geladen.",els.progress.value)}catch(_){setStatus("Textdatei nicht gefunden. Nutze TXT auswählen.",0)}});
updateTextState();
