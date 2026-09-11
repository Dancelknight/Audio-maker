const ORT_JS="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.min.js";
const ORT_WASM="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
let ortReady=false;

function ensureOrt(){
  if(ortReady) return;
  importScripts(ORT_JS);
  self.ort.env.wasm.wasmPaths=ORT_WASM;
  self.ort.env.wasm.numThreads=1;
  self.ort.env.wasm.simd=true;
  ortReady=true;
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

self.onmessage=async(e)=>{
  const msg=e.data||{};
  if(msg.type==="close"){ self.close(); return; }
  const {requestId,modelUrl,configUrl,ids,speed=1}=msg;
  let session=null;
  let feeds=null;
  let result=null;
  try{
    ensureOrt();
    const t0=performance.now();
    const [modelResp,configResp]=await Promise.all([
      cachedFetch(modelUrl),
      cachedFetch(configUrl)
    ]);
    const [bytes,cfg]=await Promise.all([modelResp.arrayBuffer(),configResp.json()]);

    session=await self.ort.InferenceSession.create(bytes,{
      executionProviders:["wasm"],
      graphOptimizationLevel:"basic",
      enableCpuMemArena:false,
      enableMemPattern:false,
      extra:{session:{disable_prepacking:"1"}}
    });

    const idArray=Array.isArray(ids)?ids:Array.from(ids||[]);
    feeds={
      input:new self.ort.Tensor("int64",BigInt64Array.from(idArray,x=>BigInt(x)),[1,idArray.length]),
      input_lengths:new self.ort.Tensor("int64",BigInt64Array.from([BigInt(idArray.length)]),[1]),
      scales:new self.ort.Tensor("float32",Float32Array.from([0.667,1/Number(speed||1),0.8]),[3])
    };
    if((cfg.num_speakers||1)>1){
      feeds.sid=new self.ort.Tensor("int64",BigInt64Array.from([0n]),[1]);
    }

    result=await session.run(feeds);
    const data=result.output?.data;
    if(!data?.length) throw new Error("Das Modell hat kein Audio ausgegeben.");

    const audio=new Float32Array(data);
    self.postMessage({
      type:"result",
      requestId,
      audio,
      sampleRate:cfg?.audio?.sample_rate||22050,
      modelInitAndRunMs:Math.round(performance.now()-t0)
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
    try{ await session?.release?.(); }catch(_){}
  }
};