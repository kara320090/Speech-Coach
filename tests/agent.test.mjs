import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { generateKeyPairSync } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { createAgentVerifier, signAgentRequest } from "../server/agent-auth.js"
import { createAgentBroker } from "../server/agent-broker.js"
import { createAgentClient, backendUrl } from "../local-ai/agent-client.mjs"
import { createServer } from "../server.js"

const pair = () => generateKeyPairSync("ed25519", { publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } })
async function serve(server) { await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); return `http://127.0.0.1:${server.address().port}` }
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
const lower = h => Object.fromEntries(Object.entries(h).map(([k,v]) => [k.toLowerCase(),v]))
const body = value => Buffer.from(JSON.stringify(value))
async function signed(origin, key, pathname, value) {
  const data = body(value)
  return fetch(origin+pathname,{method:"POST",headers:{"Content-Type":"application/json",...signAgentRequest(key,"POST",pathname,data)},body:data})
}
async function brokerServer(options={}) {
  const keys=pair(),broker=createAgentBroker(keys.publicKey,{claimMs:30,...options})
  const server=http.createServer((req,res)=>broker.handle(req,res,new URL(req.url,'http://local').pathname))
  const origin=await serve(server)
  return {keys,broker,origin,async stop(){broker.close();await close(server)}}
}
test("agent signature binds body, path and time and rejects replay",()=>{
  const {privateKey,publicKey}=pair(),data=body({textReady:true}),now=Date.now(),headers=signAgentRequest(privateKey,"POST","/a",data,now)
  const check=createAgentVerifier(publicKey,{now:()=>now})
  assert.equal(check("POST","/wrong",lower(headers),data),false)
  assert.equal(check("POST","/a",lower(headers),body({textReady:false})),false)
  assert.equal(check("POST","/a",lower(headers),data),true)
  assert.equal(check("POST","/a",lower(headers),data),false)
  assert.equal(createAgentVerifier(publicKey,{now:()=>now+60000})("POST","/a",lower(headers),data),false)
})
test("unpaired keys and unsigned requests cannot claim or submit inference",async()=>{
  const x=await brokerServer()
  try {
    assert.equal((await fetch(x.origin+'/api/runtime/claim',{method:'POST',body:'{}'})).status,401)
    assert.equal((await signed(x.origin,pair().privateKey,'/api/runtime/heartbeat',{textReady:true,transcriptionReady:true})).status,401)
    assert.equal(x.broker.snapshot().agentConnected,false)
  }finally{await x.stop()}
})
test("agent readiness expires and offline dispatch does not enqueue work",async()=>{
  let at=Date.now();const x=await brokerServer({now:()=>at,heartbeatMs:50})
  try{
    const r=await signed(x.origin,x.keys.privateKey,'/api/runtime/heartbeat',{textReady:true,transcriptionReady:false});assert.equal(r.status,200)
    assert.equal(x.broker.snapshot().textReady,true);assert.equal(x.broker.snapshot().transcriptionReady,false)
    at+=60;assert.equal(x.broker.snapshot().textReady,false)
    assert.equal((await x.broker.fetch('http://127.0.0.1:8088/v1/chat/completions',{body:'{}'})).status,503)
  }finally{await x.stop()}
})
test("signed claim and result return the real model response to its pending request",async()=>{
  const x=await brokerServer()
  try{
    await signed(x.origin,x.keys.privateKey,'/api/runtime/heartbeat',{textReady:true,transcriptionReady:true})
    const pending=x.broker.fetch('http://127.0.0.1:8088/v1/chat/completions',{body:'{"input":"fixture"}'})
    const job=await(await signed(x.origin,x.keys.privateKey,'/api/runtime/claim',{kind:'text'})).json()
    assert.equal(Buffer.from(job.body,'base64').toString(),' {"input":"fixture"}'.trim())
    const output=Buffer.from('{"choices":[{"message":{"content":"actual response"}}]}')
    assert.equal((await signed(x.origin,x.keys.privateKey,'/api/runtime/result',{id:job.id,lease:'wrong',status:200,body:output.toString('base64')})).status,409)
    assert.equal((await signed(x.origin,x.keys.privateKey,'/api/runtime/result',{id:job.id,lease:job.lease,status:200,body:output.toString('base64')})).status,200)
    assert.equal(await(await pending).text(),output.toString())
  }finally{await x.stop()}
})
test("cancelled and expired jobs cannot be completed later",async()=>{
  const x=await brokerServer({requestMs:40})
  try{
    await signed(x.origin,x.keys.privateKey,'/api/runtime/heartbeat',{textReady:true,transcriptionReady:true})
    const controller=new AbortController()
    const a=x.broker.fetch('http://127.0.0.1:8088/v1/chat/completions',{body:'{}',signal:controller.signal});controller.abort();assert.equal((await a).status,499)
    const b=x.broker.fetch('http://127.0.0.1:8088/v1/chat/completions',{body:'{}'})
    const job=await(await signed(x.origin,x.keys.privateKey,'/api/runtime/claim',{kind:'text'})).json()
    assert.equal((await b).status,504)
    assert.equal((await signed(x.origin,x.keys.privateKey,'/api/runtime/result',{id:job.id,lease:job.lease,status:200,body:'e30='})).status,409)
  }finally{await x.stop()}
})
test("agent permits HTTPS backend and loopback development targets only",()=>{
  assert.equal(backendUrl('https://example.com'),'https://example.com')
  for(const value of ['http://example.com','https://u:p@example.com','https://example.com/path','https://example.com/?key=x'])assert.throws(()=>backendUrl(value))
})
test("legacy Gemini configuration on Render still uses the self-hosted coaching agent",async()=>{
  const keys=pair();let calls=0
  const server=createServer({env:{RENDER:'true',AI_PROVIDER:'gemini',GEMINI_MODEL:'gemini-2.5-flash',GEMINI_API_KEY:'fake-unit-test-only'},agentPublicKey:keys.publicKey,fetchImpl:async()=>{calls++;throw Error('unexpected')}})
  const origin=await serve(server)
  try{
    const state=await(await fetch(origin+'/api/model-status')).json()
    assert.equal(state.provider,'local');assert.equal(state.processing,'self-hosted');assert.equal(calls,0)
    const generation=await(await fetch(origin+'/api/scripts/generation-status')).json()
    assert.equal(generation.provider,'gemini');assert.equal(generation.model,'gemini-2.5-flash');assert.equal(generation.keyConfigured,true)
    assert.equal(state.runtime.mode,'self-hosted-agent')
  }finally{await close(server)}
})
test("backend-to-agent-to-loopback inference works without provider APIs",async()=>{
  const keys=pair(),model=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk)
    JSON.parse(Buffer.concat(chunks).toString())
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({concepts:[{term:'캐시',quote:'캐시는 결과를 저장한다.',explanation:'이전 결과를 보관해요.',sourceQuote:'캐시는 결과를 저장한다.'}]})}}]}))
  })
  const modelOrigin=await serve(model),backend=createServer({env:{AI_EXECUTION_MODE:'agent',AI_PROVIDER:'gemini',GEMINI_API_KEY:'fake-unit-test-only'},agentPublicKey:keys.publicKey,fetchImpl:async()=>{throw Error('External provider must not be called for coaching')}}),origin=await serve(backend)
  const agent=createAgentClient({backend:origin,privateKey:keys.privateKey,config:{textPort:Number(new URL(modelOrigin).port),voicePort:Number(new URL(modelOrigin).port)},runtime:{snapshot:()=>({textReady:true,transcriptionReady:true})}})
  try{
    agent.start()
    for(let i=0;i<100;i++){
      const s=await(await fetch(origin+'/api/model-status')).json()
      if(s.ready){assert.equal(s.runtime.mode,'self-hosted-agent');break}
      if(i===99)assert.fail('agent did not connect');await delay(20)
    }
    // The transport is exercised by the actual signed agent and a local fixture model.
    const check=await(await fetch(origin+'/api/model-status')).json();assert.equal(check.ready,true)
    const result=await fetch(origin+'/api/coach',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://speech-coach-public.vercel.app'},body:JSON.stringify({task:'concepts',requestId:'x',versionId:'x',script:'캐시는 결과를 저장한다.',sources:'캐시는 결과를 저장한다.'})})
    assert.equal(result.status,200);assert.equal((await result.json()).result.concepts[0].term,'캐시')
  }finally{await agent.stop();await close(backend);await close(model)}
})
