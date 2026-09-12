const ORT_JS="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.min.js";
const ORT_WASM="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
let ortReady=false;
let session=null;
let config=null;
let loadedModelUrl=null;
let loadedConfigUrl=null;
let busy=false;
let sessionRunCount=0;
const SESSION_RECYCLE_EVERY=6;

function ensureOrt(){
  if(ortReady) return;
  importScripts(ORT_JS);
  self.ort.env.wasm.wasmPaths=ORT_WASM;
  self.ort.env.wasm.numThreads=1;
  self.ort.env.wasm.simd=true;
  ortReady=true;
}

function stage(requestId,stageName,data={}){
  try{
    self.postMessage({
      type:"stage",
      requestId,
      stage:stageName,
      at:Date.now(),
      ...data
    });
  }catch(_){}
}

async function cachedFetch(url){
  if(!("caches" in self)) return await fetch(url,{mode:"cors",cache:"force-cache"});
  const cache=await caches.open("german-neural-reader-v03");
  let r=await cache.match(url);
  if(r) return r.clone();
  r=await fetch(url,{mode:"cors",cache:"force-cache"});
  if(!r.ok) throw new Error("Download failed ("+r.status+")");
  try{ await cache.put(url,r.clone()); }catch(_){}
  return r;
}

async function ensureSession(modelUrl,configUrl,requestId){
  stage(requestId,"ensureOrt:start");
  ensureOrt();
  stage(requestId,"ensureOrt:done");
  if(session && loadedModelUrl===modelUrl && loadedConfigUrl===configUrl) return false;

  if(session){
    try{ await session.release(); }catch(_){}
    session=null;
  }

  stage(requestId,"modelFetch:start");
  const [modelResp,configResp]=await Promise.all([
    cachedFetch(modelUrl),
    cachedFetch(configUrl)
  ]);
  stage(requestId,"modelFetch:done",{
    modelContentLength:Number(modelResp.headers.get("content-length"))||null,
    configContentLength:Number(configResp.headers.get("content-length"))||null
  });
  stage(requestId,"modelRead:start");
  const [bytes,cfg]=await Promise.all([modelResp.arrayBuffer(),configResp.json()]);
  stage(requestId,"modelRead:done",{modelBytes:bytes.byteLength});

  stage(requestId,"sessionCreate:start",{modelBytes:bytes.byteLength});
  session=await self.ort.InferenceSession.create(bytes,{
    executionProviders:["wasm"],
    graphOptimizationLevel:"basic",
    enableCpuMemArena:false,
    enableMemPattern:false,
    extra:{session:{disable_prepacking:"1"}}
  });
  stage(requestId,"sessionCreate:done");
  config=cfg;
  loadedModelUrl=modelUrl;
  loadedConfigUrl=configUrl;
  sessionRunCount=0;
  return true;
}

async function synthesize(msg){
  const {requestId,modelUrl,configUrl,ids,speed=1}=msg;
  let feeds=null;
  let result=null;
  try{
    const t0=performance.now();
    const initialized=await ensureSession(modelUrl,configUrl,requestId);
    const afterInit=performance.now();

    const idArray=Array.isArray(ids)?ids:Array.from(ids||[]);
    stage(requestId,"feedsCreate:start",{ids:idArray.length});
    feeds={
      input:new self.ort.Tensor("int64",BigInt64Array.from(idArray,x=>BigInt(x)),[1,idArray.length]),
      input_lengths:new self.ort.Tensor("int64",BigInt64Array.from([BigInt(idArray.length)]),[1]),
      scales:new self.ort.Tensor("float32",Float32Array.from([0.667,1/Number(speed||1),0.8]),[3])
    };
    if((config?.num_speakers||1)>1){
      feeds.sid=new self.ort.Tensor("int64",BigInt64Array.from([0n]),[1]);
    }

    stage(requestId,"feedsCreate:done",{ids:idArray.length});
    const runStart=performance.now();
    stage(requestId,"sessionRun:start",{ids:idArray.length,sessionRunCount:sessionRunCount+1});
    result=await session.run(feeds);
    stage(requestId,"sessionRun:done",{runMs:Math.round(performance.now()-runStart)});
    const data=result.output?.data;
    if(!data?.length) throw new Error("Das Modell hat kein Audio ausgegeben.");

    // Copy output away from ORT-owned memory before tensors/session are released.
    stage(requestId,"audioCopy:start",{samples:data.length,bytes:data.byteLength||data.length*4});
    const audio=new Float32Array(data);
    stage(requestId,"audioCopy:done",{samples:audio.length,bytes:audio.byteLength});
    sessionRunCount+=1;
    const recycleNow=sessionRunCount>=SESSION_RECYCLE_EVERY;

    stage(requestId,"tensorDispose:start");
    try{ for(const t of Object.values(feeds||{})) t?.dispose?.(); }catch(_){}
    feeds=null;
    try{ for(const t of Object.values(result||{})) t?.dispose?.(); }catch(_){}
    result=null;
    stage(requestId,"tensorDispose:done");

    let recycleMs=0;
    if(recycleNow && session){
      const recycleStart=performance.now();
      stage(requestId,"sessionRelease:start",{reason:"periodic",afterRuns:sessionRunCount});
      try{ await session.release(); }catch(_){}
      session=null;
      stage(requestId,"sessionRelease:done",{reason:"periodic"});
      // Keep the worker/WASM runtime, but force a fresh ONNX session next request.
      await new Promise(r=>setTimeout(r,900));
      recycleMs=Math.round(performance.now()-recycleStart);
      stage(requestId,"sessionRecycle:idleDone",{recycleMs});
    }

    stage(requestId,"resultPost:start",{samples:audio.length,bytes:audio.byteLength});
    self.postMessage({
      type:"result",
      requestId,
      audio,
      sampleRate:config?.audio?.sample_rate||22050,
      initialized,
      initMs:Math.round(afterInit-t0),
      runMs:Math.round(performance.now()-runStart),
      sessionRunCount:recycleNow ? SESSION_RECYCLE_EVERY : sessionRunCount,
      sessionRecycled:recycleNow,
      recycleMs
    },[audio.buffer]);
  }catch(err){
    self.postMessage({
      type:"error",
      requestId,
      name:err?.name||"Error",
      message:err?.message||String(err),
      stack:err?.stack||null
    });
  }finally{
    try{ for(const t of Object.values(feeds||{})) t?.dispose?.(); }catch(_){}
    try{ for(const t of Object.values(result||{})) t?.dispose?.(); }catch(_){}
  }
}

self.onmessage=async(e)=>{
  const msg=e.data||{};

  if(msg.type==="close"){
    try{ await session?.release?.(); }catch(_){}
    session=null;
    sessionRunCount=0;
    self.postMessage({type:"closed"});
    self.close();
    return;
  }

  if(msg.type!=="synthesize") return;

  if(busy){
    self.postMessage({
      type:"error",
      requestId:msg.requestId,
      name:"BusyError",
      message:"ONNX worker is already processing another request."
    });
    return;
  }

  busy=true;
  try{
    await synthesize(msg);
  }finally{
    busy=false;
  }
};