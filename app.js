import { phonemize } from "https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/+esm";

const $ = (id) => document.getElementById(id);
const els = {
  modelSelect:$("modelSelect"), speed:$("speed"), speedOut:$("speedOut"),
  loadModel:$("loadModel"), preview:$("preview"), status:$("status"),
  progress:$("progress"), progressText:$("progressText"), text:$("text"),
  fileInput:$("fileInput"), loadBundled:$("loadBundled"), clearText:$("clearText"),
  charCount:$("charCount"), sentencePause:$("sentencePause"),
  paragraphPause:$("paragraphPause"), generate:$("generate"),
  cancel:$("cancel"), result:$("result"), audio:$("audio"), download:$("download")
};

const MODELS = {
  medium: {
    model:"https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx",
    config:"https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json"
  },
  high: {
    model:"https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx",
    config:"https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx.json"
  }
};

let session = null;
let config = null;
let loadedModel = null;
let cancelRequested = false;
let resultUrl = null;

window.ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
window.ort.env.wasm.numThreads = 1;
window.ort.env.wasm.simd = true;

function setStatus(msg, progress=null, right=""){
  els.status.textContent = msg;
  if(progress !== null) els.progress.value = Math.max(0, Math.min(1, progress));
  els.progressText.textContent = right;
}

async function cachedFetch(url){
  if(!("caches" in window)) return fetch(url);
  const cache = await caches.open("german-neural-reader-v1");
  let r = await cache.match(url);
  if(r) return r.clone();
  r = await fetch(url, {mode:"cors"});
  if(!r.ok) throw new Error(`Download failed (${r.status})`);
  try { await cache.put(url, r.clone()); } catch (_) {}
  return r;
}

async function loadModel(){
  const key = els.modelSelect.value;
  if(session && loadedModel === key) return;
  els.loadModel.disabled = true;
  els.preview.disabled = true;
  els.generate.disabled = true;
  try{
    setStatus("Sprachmodell wird geladen …", .03);
    const [modelResp, configResp] = await Promise.all([
      cachedFetch(MODELS[key].model),
      cachedFetch(MODELS[key].config)
    ]);
    setStatus("Modell wird vorbereitet …", .30);
    const [modelBytes, cfg] = await Promise.all([modelResp.arrayBuffer(), configResp.json()]);
    config = cfg;
    session = await window.ort.InferenceSession.create(modelBytes, {
      executionProviders:["wasm"],
      graphOptimizationLevel:"all"
    });
    loadedModel = key;
    setStatus("Stimme ist bereit.", 1);
    els.preview.disabled = false;
    els.generate.disabled = !els.text.value.trim();
  }catch(err){
    console.error(err);
    setStatus("Fehler: " + (err?.message || err), 0);
    session = null; config = null; loadedModel = null;
  }finally{
    els.loadModel.disabled = false;
  }
}

function addId(ids, map, key){
  const v = map[key];
  if(v === undefined) return;
  if(Array.isArray(v)) ids.push(...v);
  else ids.push(v);
}

async function textToIds(text){
  const voice = config.espeak?.voice || "de";
  const out = await phonemize(text, voice);
  let p = Array.isArray(out) ? out.join(" ") : String(out);
  p = p.normalize("NFD");
  const ids = [];
  const map = config.phoneme_id_map;
  addId(ids,map,"^"); addId(ids,map,"_");
  for(const ch of Array.from(p)){
    addId(ids,map,ch);
    addId(ids,map,"_");
  }
  addId(ids,map,"$");
  return ids;
}

async function synthesize(text, speed){
  const ids = await textToIds(text);
  const ort = window.ort;
  const input = new ort.Tensor("int64", BigInt64Array.from(ids, x=>BigInt(x)), [1, ids.length]);
  const lengths = new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]);
  const lengthScale = 1 / speed;
  const scales = new ort.Tensor("float32", Float32Array.from([0.667, lengthScale, 0.8]), [3]);
  const feeds = {input, input_lengths:lengths, scales};
  if((config.num_speakers || 1) > 1){
    feeds.sid = new ort.Tensor("int64", BigInt64Array.from([0n]), [1]);
  }
  const result = await session.run(feeds);
  return new Float32Array(result.output.data);
}

function cleanText(s){
  return s
    .replace(/\u00ad/g,"")
    .replace(/[‐‑‒–—]/g,"-")
    .replace(/[“”]/g,'"').replace(/[‘’]/g,"'")
    .replace(/\s+\n/g,"\n")
    .replace(/\n{3,}/g,"\n\n")
    .trim();
}

function splitLongSentence(s, maxLen){
  if(s.length <= maxLen) return [s];
  const parts = [];
  let rest = s;
  while(rest.length > maxLen){
    let cut = Math.max(rest.lastIndexOf(",",maxLen), rest.lastIndexOf(";",maxLen), rest.lastIndexOf(" ",maxLen));
    if(cut < maxLen*0.55) cut = maxLen;
    parts.push(rest.slice(0,cut).trim());
    rest = rest.slice(cut).trim();
  }
  if(rest) parts.push(rest);
  return parts;
}

function makeChunks(text, maxLen=330){
  const paragraphs = cleanText(text).split(/\n\s*\n/).filter(Boolean);
  const chunks = [];
  for(let p=0;p<paragraphs.length;p++){
    const para = paragraphs[p].replace(/\s*\n\s*/g," ").trim();
    const sentences = para.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) || [para];
    let buffer = "";
    for(const raw of sentences){
      const sentence = raw.trim();
      if(!sentence) continue;
      for(const piece of splitLongSentence(sentence,maxLen)){
        if((buffer+" "+piece).trim().length <= maxLen){
          buffer = (buffer+" "+piece).trim();
        }else{
          if(buffer) chunks.push({text:buffer, paragraphEnd:false});
          buffer = piece;
        }
      }
    }
    if(buffer) chunks.push({text:buffer, paragraphEnd:true});
    else if(chunks.length) chunks[chunks.length-1].paragraphEnd = true;
  }
  return chunks;
}

function floatToInt16(f32){
  const out = new Int16Array(f32.length);
  for(let i=0;i<f32.length;i++){
    const s = Math.max(-1,Math.min(1,f32[i]));
    out[i] = s < 0 ? s*32768 : s*32767;
  }
  return out;
}

function encodePCM(encoder, pcm, mp3Parts){
  const block = 1152;
  for(let i=0;i<pcm.length;i+=block){
    const buf = encoder.encodeBuffer(pcm.subarray(i,Math.min(i+block,pcm.length)));
    if(buf.length) mp3Parts.push(new Uint8Array(buf));
  }
}

function silence(sampleRate, ms){
  return new Int16Array(Math.floor(sampleRate * ms / 1000));
}

async function preview(){
  try{
    if(!session) await loadModel();
    if(!session) return;
    els.preview.disabled = true;
    setStatus("Vorschau wird erzeugt …", .3);
    const sample = "Die Philosophie des Mittelalters ist vielfältiger, als das bekannte Vorurteil von der Magd der Theologie vermuten lässt.";
    const f32 = await synthesize(sample, Number(els.speed.value));
    const sr = config.audio.sample_rate;
    const pcm = floatToInt16(f32);
    const encoder = new window.lamejs.Mp3Encoder(1,sr,96);
    const parts = [];
    encodePCM(encoder,pcm,parts);
    const tail = encoder.flush(); if(tail.length) parts.push(new Uint8Array(tail));
    const blob = new Blob(parts,{type:"audio/mpeg"});
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    a.onended = ()=>URL.revokeObjectURL(url);
    await a.play();
    setStatus("Vorschau läuft.",1);
  }catch(err){
    console.error(err); setStatus("Vorschau-Fehler: "+(err?.message||err),0);
  }finally{els.preview.disabled=false}
}

async function generate(){
  const txt = els.text.value.trim();
  if(!txt) return;
  try{
    if(!session) await loadModel();
    if(!session) return;
    cancelRequested = false;
    els.generate.disabled = true; els.cancel.disabled = false;
    els.preview.disabled = true; els.result.classList.add("hidden");

    const chunks = makeChunks(txt);
    if(!chunks.length) throw new Error("Kein lesbarer Text gefunden.");
    const sr = config.audio.sample_rate;
    const encoder = new window.lamejs.Mp3Encoder(1,sr,96);
    const mp3Parts = [];
    const sentenceMs = Number(els.sentencePause.value);
    const paragraphMs = Number(els.paragraphPause.value);
    const speed = Number(els.speed.value);

    for(let i=0;i<chunks.length;i++){
      if(cancelRequested) throw new Error("Abgebrochen");
      const c = chunks[i];
      const pct = i/chunks.length;
      setStatus(`Abschnitt ${i+1} von ${chunks.length} …`, pct, `${Math.round(pct*100)} %`);
      const f32 = await synthesize(c.text, speed);
      encodePCM(encoder,floatToInt16(f32),mp3Parts);
      const pause = c.paragraphEnd ? paragraphMs : sentenceMs;
      encodePCM(encoder,silence(sr,pause),mp3Parts);
      await new Promise(r=>setTimeout(r,0));
    }
    const tail = encoder.flush();
    if(tail.length) mp3Parts.push(new Uint8Array(tail));

    const blob = new Blob(mp3Parts,{type:"audio/mpeg"});
    if(resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = URL.createObjectURL(blob);
    els.audio.src = resultUrl;
    els.download.href = resultUrl;
    els.download.download = `German_Reader_${new Date().toISOString().slice(0,10)}.mp3`;
    els.result.classList.remove("hidden");
    setStatus("Fertig. Die komplette MP3 ist bereit.",1,"100 %");
  }catch(err){
    console.error(err);
    if(String(err?.message||err)==="Abgebrochen") setStatus("Erzeugung abgebrochen.",0);
    else setStatus("Fehler: "+(err?.message||err),0);
  }finally{
    els.generate.disabled = !session || !els.text.value.trim();
    els.cancel.disabled = true; els.preview.disabled = !session;
  }
}

function updateTextState(){
  els.charCount.textContent = `${els.text.value.length.toLocaleString("de-DE")} Zeichen`;
  els.generate.disabled = !session || !els.text.value.trim();
}

els.speed.addEventListener("input",()=>els.speedOut.value=`${Number(els.speed.value).toFixed(2)}×`);
els.loadModel.addEventListener("click",loadModel);
els.preview.addEventListener("click",preview);
els.generate.addEventListener("click",generate);
els.cancel.addEventListener("click",()=>{cancelRequested=true; els.cancel.disabled=true});
els.text.addEventListener("input",updateTextState);
els.clearText.addEventListener("click",()=>{els.text.value=""; updateTextState();});
els.modelSelect.addEventListener("change",()=>{session=null;config=null;loadedModel=null;els.preview.disabled=true;els.generate.disabled=true;setStatus("Anderes Modell gewählt. Bitte neu laden.",0);});
els.fileInput.addEventListener("change",async(e)=>{
  const f=e.target.files?.[0]; if(!f)return;
  els.text.value=await f.text(); updateTextState();
});
els.loadBundled.addEventListener("click",async()=>{
  try{
    const r=await fetch("./Mittelalter_Vorlesetext.txt");
    if(!r.ok) throw new Error("Datei nicht gefunden");
    els.text.value=await r.text(); updateTextState();
    setStatus("Mittelalter-Text geladen.",els.progress.value);
  }catch(err){setStatus("Konnte den gebündelten Text nicht laden. Nutze „TXT auswählen“.",0)}
});

updateTextState();
