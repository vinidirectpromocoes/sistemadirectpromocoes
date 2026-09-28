const { test } = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/ler');
const { inferShortRange, filePart, normalizeResult } = handler._test;

function response() {
  return {
    statusCode: 200, body: null,
    setHeader() {},
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

test('deduz 29/09 a 05/10 com sete datas consecutivas', () => {
  const shifts = inferShortRange('Data de inicio: 29 á 05', '2026-09-28', '07:00', '15:20');
  assert.equal(shifts.length, 7);
  assert.deepEqual(shifts[0], { data: '2026-09-29', inicio: '07:00', fim: '15:20' });
  assert.deepEqual(shifts.at(-1), { data: '2026-10-05', inicio: '07:00', fim: '15:20' });
});

test('associa Meireles à rede única e preserva quantidade de pessoas não informada', () => {
  const result = { tipo: 'pedido', pedido: {
    supermercado: '', unidade: 'Meireles', quantidade_diaristas: 0, quantidade_dias_reportada: 7,
    turnos: [{ data: '2026-12-01', inicio: '07:00', fim: '15:20' }],
  }, avisos: [] };
  normalizeResult(result, [{ rede: 'Super do Povo', nome: 'Meireles' }], 'Loja: Meireles\n29 á 05\n07:00 as 15:20', '2026-09-28');
  assert.equal(result.pedido.supermercado, 'Super do Povo');
  assert.equal(result.pedido.quantidade_diaristas, 0);
  assert.equal(result.pedido.turnos.length, 7);
  assert.equal(result.pedido.turnos.at(-1).data, '2026-10-05');
});

test('recusa anexos não permitidos', () => {
  assert.throws(() => filePart({ mime: 'text/html', base64: 'PGgxPg==' }), /foto|PDF/);
  assert.equal(filePart({ mime: 'application/pdf', base64: 'JVBERg==' }).type, 'input_file');
});

test('API exige sessão antes de chamar a OpenAI', async () => {
  const res = response();
  await handler({ method: 'POST', headers: {}, body: { texto: 'teste' } }, res);
  assert.equal(res.statusCode, 401);
});

test('API informa falta de créditos sem expor a chave', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'chave-de-teste';
  global.fetch = async url => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ email: 'admin@direct.test' }), { status: 200 });
    if (url.includes('/rest/v1/direct_admins')) return new Response(JSON.stringify([{ email: 'admin@direct.test' }]), { status: 200 });
    if (url.includes('/rest/v1/lojas')) return new Response(JSON.stringify([]), { status: 200 });
    return new Response(JSON.stringify({ error: { code: 'credit_balance_exhausted' } }), { status: 429 });
  };
  try {
    const res = response();
    await handler({ method: 'POST', headers: { authorization: 'Bearer sessao-de-teste' }, body: { texto: 'Pedido para amanhã' } }, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body.erro, /sem créditos/);
    assert.doesNotMatch(JSON.stringify(res.body), /chave-de-teste/);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test('API envia PDF com store=false e retorna pedido estruturado para revisão', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'chave-de-teste';
  let upstreamPayload;
  global.fetch = async (url, options) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ email: 'admin@direct.test' }), { status: 200 });
    if (url.includes('/rest/v1/direct_admins')) return new Response(JSON.stringify([{ email: 'admin@direct.test' }]), { status: 200 });
    if (url.includes('/rest/v1/lojas')) return new Response(JSON.stringify([{ rede: 'Super do Povo', nome: 'Meireles' }]), { status: 200 });
    upstreamPayload = JSON.parse(options.body);
    const modelResult = { tipo: 'pedido', diarista: {}, pedido: {
      supermercado: '', unidade: 'Meireles', contato: '', setor: 'Repositor de FLV',
      quantidade_diaristas: 0, quantidade_dias_reportada: 7, turnos: [{ data: '2026-09-29', inicio: '07:00', fim: '15:20' }], observacoes: '',
    }, avisos: [] };
    return new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(modelResult) }] }] }), { status: 200 });
  };
  try {
    const res = response();
    await handler({ method: 'POST', headers: { authorization: 'Bearer sessao-de-teste' }, body: {
      tipo: 'pedido', texto: 'Loja: Meireles, 29 á 05, 07:00 as 15:20, quantidade de dias: 7',
      arquivo: { mime: 'application/pdf', base64: 'JVBERg==' },
    } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(upstreamPayload.store, false);
    assert.equal(upstreamPayload.input[0].content[1].type, 'input_file');
    assert.equal(res.body.pedido.supermercado, 'Super do Povo');
    assert.equal(res.body.pedido.turnos.length, 7);
    assert.equal(res.body.pedido.quantidade_diaristas, 0);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});
