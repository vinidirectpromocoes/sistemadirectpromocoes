const handler = require('../api/ler');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', async () => {
  try {
    const input = JSON.parse(raw);
    const req = { method: 'POST', headers: {}, body: input.body, _localTrusted: true, _stores: input.stores };
    const res = {
      statusCode: 200,
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(body) { process.stdout.write(JSON.stringify({ status: this.statusCode, body })); return this; },
    };
    await handler(req, res);
  } catch {
    process.stdout.write(JSON.stringify({ status: 502, body: { erro: 'Não foi possível concluir a leitura.' } }));
  }
});
