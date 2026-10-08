import test from 'node:test';
import assert from 'node:assert/strict';
import {createSignupHandler} from '../supabase/functions/portal-cadastro/handler.mjs';
test('clientes antigos não criam contas de diaristas',async()=>{let clients=0;const handler=createSignupHandler({},()=>{clients++;throw Error('Auth proibido');});const r=await handler(new Request('https://example.invalid',{method:'POST',headers:{Origin:'https://sistemadirectpromocoes-zeta.vercel.app'},body:JSON.stringify({senha:'nunca processar'})}));assert.equal(r.status,410);assert.match((await r.json()).error,/sem conta/);assert.equal(clients,0);assert.equal(r.headers.get('Cache-Control'),'no-store');});
test('origem desconhecida não recebe CORS',async()=>{const r=await createSignupHandler()(new Request('https://example.invalid',{headers:{Origin:'https://example.invalid'}}));assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);});
