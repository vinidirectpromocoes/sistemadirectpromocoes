/* Leitura local de mensagens de cadastro e pedidos. Sem chamadas a modelos pagos. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DirectReadingParser = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  const normal = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const digits = value => String(value || '').replace(/\D/g, '');
  const pad = value => String(value).padStart(2, '0');
  const iso = date => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const dateUTC = (year, month, day) => { const d = new Date(Date.UTC(year, month - 1, day)); return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month && d.getUTCDate() === day ? d : null; };
  const nextDay = date => new Date(date.getTime() + 86400000);
  const daysBetween = (a, b) => Math.round((b - a) / 86400000);
  const field = (text, labels) => {
    const wanted = labels.map(normal);
    for (const line of text.split(/\n/)) {
      const match = /^\s*\*?\s*([^:]{2,48}?)\s*\*?\s*:\s*(.*?)\s*$/.exec(line);
      if (match && wanted.includes(normal(match[1]))) return match[2].replace(/^\*|[\\*]+$/g, '').trim();
    }
    return '';
  };
  const nameLabels = ['Nome Completo', 'Nome do operador', 'Nome da diarista', 'Nome', 'Diarista', 'Diarista escalado', 'Escalado'];
  const cpfLine = line => /^\s*\*?\s*CPF\s*\*?\s*:/i.test(line);
  function plainName(line) {
    const value = String(line || '').trim().replace(/^[*_]+|[\\*_]+$/g, '').trim();
    if (!/^[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)+$/u.test(value)) return '';
    if (/^(?:nova solicitacao|novo pedido|dados para cadastro|dados do diarista|nome completo|quantidade de dias|informacoes|observacoes)\b/.test(normal(value))) return '';
    return value;
  }
  function identityNames(text) {
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    const names = lines.filter(line => /^\s*\*?\s*(?:nome completo|nome do operador|nome da diarista|nome|diarista|diarista escalado|escalado)\s*\*?\s*:/i.test(line))
      .map(line => field(line, nameLabels)).filter(Boolean);
    for (let i = 1; i < lines.length; i++) {
      if (cpfLine(lines[i])) { const name = plainName(lines[i - 1]); if (name) names.push(name); }
    }
    return names;
  }
  function validCpf(value) {
    const cpf = digits(value);
    if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
    for (const size of [9, 10]) {
      const sum = [...cpf.slice(0, size)].reduce((n, digit, i) => n + Number(digit) * (size + 1 - i), 0);
      const check = (sum * 10) % 11;
      if ((check === 10 ? 0 : check) !== Number(cpf[size])) return false;
    }
    return true;
  }
  function split(text) {
    const result = []; let current = [];
    const flush = () => { const value = current.join('\n').trim(); if (value) result.push(value); current = []; };
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const bareName = plainName(line);
      const next = bareName ? lines.slice(index + 1).find(value => value.trim()) : '';
      const startsWorker = /^\s*\*?\s*(?:nome completo|nome do operador|nome da diarista|nome|diarista|diarista escalado|escalado)\s*\*?\s*:/i.test(line) || (!!bareName && cpfLine(next || ''));
      const startsOrder = /^\s*\*?\s*(?:loja|unidade|regi[aã]o|rede|supermercado)\s*\*?\s*:/i.test(line);
      const hasWorker = current.some(item => /^\s*\*?\s*(?:nome completo|nome do operador|nome da diarista|nome|diarista|diarista escalado|escalado|cpf)\s*\*?\s*:/i.test(item));
      const hasStore = current.some(item => /^\s*\*?\s*(?:loja|unidade|regi[aã]o)\s*\*?\s*:/i.test(item));
      const hasNetwork = current.some(item => /^\s*\*?\s*(?:rede|supermercado)\s*\*?\s*:/i.test(item));
      const hasDetails = current.some(item => /^\s*\*?\s*(?:hor[aá]rio|fun[cç][aã]o|setor|data(?: de in[ií]cio)?)\s*\*?\s*:/i.test(item));
      const hasOrder = hasStore || hasNetwork;
      // A name following an order belongs to that order. A new store/network starts another record.
      const isNetwork = /^\s*\*?\s*(?:rede|supermercado)\s*\*?\s*:/i.test(line);
      const beginsNewOrder = startsOrder && (isNetwork ? hasNetwork || (hasStore && hasDetails) || hasWorker : hasStore || (hasWorker && !hasOrder));
      if (beginsNewOrder || (startsWorker && hasWorker && !hasOrder)) flush();
      current.push(line);
    }
    flush();
    return result;
  }
  function classify(text) {
    const value = normal(text);
    const worker = /\bcpf\b/.test(value) || /^\s*\*?\s*(?:nome(?: completo)?|diarista(?: escalado)?)\s*\*?\s*:/im.test(text);
    const order = /^\s*\*?\s*(?:loja|unidade|regi[aã]o|supermercado|rede)\s*\*?\s*:/im.test(text) && /\bhorario\b|\bdata\b|\bfuncao\b|\bsetor\b/.test(value);
    return order ? 'pedido' : worker ? 'diarista' : 'indefinido';
  }
  function sector(value, known) {
    const key = normal(value);
    const aliases = { flv: 'Repositor de FLV', caixa: 'Operador de caixa', 'op caixa': 'Operador de caixa', 'operadora de caixa': 'Operador de caixa', 'operador de caixa': 'Operador de caixa', asg: 'ASG', 'auxiliar de servicos gerais': 'ASG', deposito: 'Auxiliar de depósito', acougueiro: 'Açougueiro' };
    if (aliases[key]) return aliases[key];
    return known.find(item => normal(item) === key) || value.trim();
  }
  function parseClock(value) {
    const match = /(?:^|\D)([01]?\d|2[0-3])\s*(?:[:hH])\s*([0-5]\d)(?!\d)/.exec(value);
    return match ? `${pad(match[1])}:${match[2]}` : '';
  }
  function clocks(value) {
    const matches = [...String(value).matchAll(/(?:^|\D)([01]?\d|2[0-3])\s*(?:[:hH])\s*([0-5]\d)(?!\d)/g)];
    return matches.slice(0, 2).map(match => `${pad(match[1])}:${match[2]}`);
  }
  function readDate(raw, today, recentDays = 31) {
    const match = /^(\d{1,2})(?:\/(\d{1,2}))?(?:\/(\d{4}))?$/.exec(raw);
    if (!match) return null;
    const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
    if (month && year) return dateUTC(year, month, day);
    if (month) {
      const candidates = Array.from({length: 6}, (_, i) => dateUTC(today.getUTCFullYear() - 1 + i, month, day)).filter(Boolean);
      const recent = candidates.filter(date => date <= today && daysBetween(date, today) <= recentDays).at(-1);
      return recent || candidates.find(date => date >= today) || null;
    }
    for (let step = 0; step < 14; step++) {
      const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + step, day));
      if (cursor.getUTCDate() === day && cursor >= today) return cursor;
    }
    return null;
  }
  function range(raw, todayIso, startClock, endClock) {
    const today = dateUTC(...todayIso.split('-').map(Number));
    const match = /(\d{1,2}(?:\/\d{1,2}(?:\/\d{4})?)?)\s*(?:a|[àá]|ate|até|-)\s*(\d{1,2}(?:\/\d{1,2}(?:\/\d{4})?)?)/i.exec(raw);
    if (!match || !today || !startClock || !endClock || startClock >= endClock) return [];
    let start = readDate(match[1], today); if (!start) return [];
    const finish = first => {
      if (!/^\d{1,2}$/.test(match[2])) return readDate(match[2], first, 0);
      const finalDay = Number(match[2]);
      const offset = finalDay >= first.getUTCDate() ? 0 : 1;
      for (let step = offset; step < offset + 4; step++) {
        const month = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + step, 1));
        const candidate = dateUTC(month.getUTCFullYear(), month.getUTCMonth() + 1, finalDay);
        if (candidate && candidate >= first) return candidate;
      }
      return null;
    };
    // An abbreviated range may already be in progress across the month boundary.
    if (/^\d{1,2}$/.test(match[1])) {
      const previousMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const recentStart = dateUTC(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth() + 1, Number(match[1]));
      const recentEnd = recentStart && finish(recentStart);
      if (recentStart && recentEnd && recentStart <= today && recentEnd >= today && daysBetween(recentStart, today) <= 31) start = recentStart;
    }
    const end = finish(start);
    if (!end || end < start || daysBetween(start, end) > 89) return [];
    const shifts = [];
    for (let cursor = start; cursor <= end; cursor = nextDay(cursor)) shifts.push({ data: iso(cursor), inicio: startClock, fim: endClock });
    return shifts;
  }
  function worker(text, sectors) {
    const names = identityNames(text);
    const nome = field(text, nameLabels) || names[0] || '';
    const cpf = digits(field(text, ['CPF']));
    const cep = digits(field(text, ['CEP']));
    const street = field(text, ['Rua/Nº', 'Rua/No', 'Rua', 'Endereço', 'Endereco', 'Logradouro']);
    const streetMatch = /^(.*?)(?:,|\s+n[º°o.]?\s*)\s*(\d+[a-z]?)(?:\s*[-,]\s*(.*))?$/i.exec(street);
    const logradouro = streetMatch ? streetMatch[1].trim() : street;
    const numero = field(text, ['Número', 'Numero']) || (streetMatch ? streetMatch[2] : '');
    const setorText = field(text, ['Setor', 'Setores', 'Função', 'Funcao', 'Experiência', 'Experiencia']);
    const known = sectors || [];
    const setores = setorText ? [...new Set(setorText.split(/[,;]+/).map(item => sector(item, known)).filter(Boolean))] : [];
    const job = normal(field(text, ['Trabalhando atualmente', 'Está trabalhando', 'Esta trabalhando', 'Trabalhando']));
    const trabalhando = /^(sim|s|estou|trabalho)\b/.test(job) ? true : /^(nao|n|desempregado)\b/.test(job) ? false : null;
    const local_trabalho = field(text, ['Local de trabalho', 'Onde trabalha', 'Trabalha em']);
    const locomocao = field(text, ['Meios de locomoção', 'Meios de locomocao', 'Locomoção', 'Locomocao', 'Transporte']);
    const mobility = normal(locomocao);
    const transporte = ['Ônibus', 'Moto', 'Carro', 'Bicicleta', 'A pé', 'Aplicativo'].find(item => mobility.includes(normal(item))) || '';
    const pode_se_deslocar = /qualquer regiao|toda fortaleza|sem restricao/.test(mobility) || !!transporte ? true : /nao posso me deslocar|nao pode se deslocar/.test(mobility) ? false : null;
    const available = field(text, ['Disponibilidade', 'Dias e horários', 'Dias e horarios']);
    const times = clocks(available);
    const weekdays = [['segunda','segunda'],['terca','terca'],['quarta','quarta'],['quinta','quinta'],['sexta','sexta'],['sabado','sabado'],['domingo','domingo']];
    const availableNormal = normal(available);
    const selected = /todos os dias|semana inteira/.test(availableNormal) ? weekdays : /fim de semana/.test(availableNormal) ? weekdays.slice(5) : /durante a semana|dias de semana|segunda a sexta/.test(availableNormal) ? weekdays.slice(0, 5) : weekdays.filter(([key]) => availableNormal.includes(key));
    const disponibilidade = times.length === 2 && times[0] < times[1] ? selected.map(([dia]) => ({ dia, inicio: times[0], fim: times[1] })) : [];
    const data = { nome, cpf, setores, cep, logradouro, numero, complemento: field(text, ['Complemento']), bairro: field(text, ['Bairro']), trabalhando, local_trabalho, disponibilidade, pode_se_deslocar, transporte, observacoes_locomocao: locomocao };
    const missing = [];
    if (!nome) missing.push('nome');
    if (names.length > 1 || text.split('\n').filter(cpfLine).length > 1) missing.push('revisar mais de um diarista informado no mesmo cadastro');
    if (!validCpf(cpf)) missing.push(cpf ? 'CPF válido' : 'CPF');
    if (cep && !/^\d{8}$/.test(cep)) missing.push('CEP válido');
    const completar = [];
    if (!setores.length) completar.push('setor de experiência');
    if (!cep) completar.push('CEP');
    if (!logradouro || !numero) completar.push('rua e número');
    if (!data.bairro) completar.push('bairro');
    if (trabalhando === null || (trabalhando && !local_trabalho)) completar.push('trabalho atual');
    if (!disponibilidade.length) completar.push('dias e horários exatos');
    if (pode_se_deslocar === null || (pode_se_deslocar && !transporte)) completar.push('locomoção e transporte');
    return { tipo: 'diarista', dados: data, faltando: missing, completar, texto: text,
      avisos: completar.length ? [`Cadastro parcial: completar depois ${completar.join(', ')}.`] : [] };
  }

  function order(text, stores, sectors, today) {
    let unit = field(text, ['Loja', 'Unidade', 'Região', 'Regiao']);
    const storeName = value => normal(value).replace(/^loja /, '');
    let market = field(text, ['Rede', 'Supermercado']);
    const matches = (stores || []).filter(item => storeName(item.nome) === storeName(unit));
    if (!market && matches.length === 1) market = matches[0].rede;
    const selectedStore = matches.find(item => normal(item.rede) === normal(market));
    if (selectedStore) { market = selectedStore.rede; unit = selectedStore.nome; }
    const validStore = !unit || (stores || []).some(item => storeName(item.nome) === storeName(unit) && normal(item.rede) === normal(market));
    const setor = sector(field(text, ['Função', 'Funcao', 'Setor', 'Cargo']), sectors || []);
    const [inicio, fim] = clocks(field(text, ['Horário', 'Horario', 'Turno']));
    const period = field(text, ['Data de inicio', 'Data de início', 'Datas', 'Período', 'Periodo', 'Data']) || text;
    let turnos = range(period, today, inicio, fim);
    if (!turnos.length && inicio && fim && inicio < fim) {
      const match = /\b(\d{1,2}\/\d{1,2}(?:\/\d{4})?)\b/.exec(period);
      const when = match && readDate(match[1], dateUTC(...today.split('-').map(Number)));
      if (when) turnos = [{ data: iso(when), inicio, fim }];
    }
    const reported = Number(digits(field(text, ['Quantidade de dias', 'Número de dias', 'Numero de dias'])) || 0);
    if (turnos.length === 1 && reported > 1 && reported <= 90 && !range(period, today, inicio, fim).length) {
      const first = dateUTC(...turnos[0].data.split('-').map(Number));
      turnos = Array.from({length:reported}, (_, index) => ({data:iso(new Date(first.getTime()+index*86400000)), inicio, fim}));
    }
    const peopleField = field(text, ['Quantidade de diaristas', 'Diaristas por dia', 'Quantidade de pessoas', 'Vagas']);
    const people = Number(digits(peopleField) || 1);
    const data = { supermercado: market, unidade: unit, contato: field(text, ['Contato']), setor, quantidade_diaristas: people, turnos, situacao: 'novo', observacoes: field(text, ['Observações', 'Observacoes']) };
    const missing = [];
    if (!market) missing.push('rede');
    if (!unit || (market && !validStore)) missing.push('loja conhecida da rede');
    if (!setor) missing.push('função');
    if (!turnos.length) missing.push('datas e horário');
    if (reported && reported !== turnos.length) missing.push('confirmar quantidade de dias');
    if (people < 1 || people > 100) missing.push('quantidade de diaristas');
    const avisos = peopleField ? [] : ['Padrão aplicado: 1 diarista por dia.'];
    if (turnos.length && !/\b\d{1,2}\/\d{1,2}\/\d{4}\b/.test(period)) {
      avisos.push(`Período identificado: ${turnos[0].data.split('-').reverse().join('/')} a ${turnos.at(-1).data.split('-').reverse().join('/')}.`);
      if (daysBetween(dateUTC(...today.split('-').map(Number)), dateUTC(...turnos[0].data.split('-').map(Number))) > 90) missing.push('confirmar ano das datas');
    }
    if (!market && matches.length > 1) avisos.unshift(`A loja ${unit} pertence a ${[...new Set(matches.map(item => item.rede))].join(' ou ')}. Informe a rede.`);
    return { tipo: 'pedido', dados: data, faltando: missing, texto: text, avisos };
  }
  function textKey(text) {
    let hash = 2166136261;
    for (const char of normal(text)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return `texto:${(hash >>> 0).toString(16)}`;
  }
  function fingerprint(item) {
    if (item.tipo === 'diarista' && item.dados.cpf) return `cpf:${item.dados.cpf}`;
    if (item.tipo === 'pedido' && item.dados.turnos.length) {
      const p = item.dados;
      return `pedido:${normal(p.supermercado)}:${normal(p.unidade)}:${normal(p.setor)}:${p.quantidade_diaristas}:${p.turnos.map(t => `${t.data}/${t.inicio}/${t.fim}`).join(',')}`;
    }
    return textKey(item.texto);
  }
  function prepareText(text) {
    // WhatsApp labels may share a line, use '=' or '-' and contain emphasis.
    return String(text || '').replace(/\r/g, '').replace(/\\(?=\n|$)/g, '')
      .replace(/[;|]\s*(?=\*?(?:CPF|Nome|Rede|Loja|Região|Função|Horário|Data|Quantidade|Bairro|CEP)\b)/gi, '\n')
      .replace(/([\p{L}\p{M}*])\s+(?=\*?CPF\*?\s*[:=])/gu, '$1\n')
      .replace(/^(\s*\*?(?:Nome(?: Completo)?|Diarista(?: escalado)?|CPF|Rede|Loja|Região|Função|Horário|Data(?: de início)?|Quantidade de dias|Bairro|CEP)\*?)\s*[=–-]\s*/gim, '$1: ');
  }
  function parse(text, context = {}) {
    text = prepareText(text);
    const today = context.today || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return split(text).map(part => {
      const kind = classify(part);
      const item = kind === 'diarista' ? worker(part, context.sectors) : kind === 'pedido' ? order(part, context.stores, context.sectors, today) : { tipo: 'indefinido', dados: {}, faltando: ['identificar cadastro ou pedido'], texto: part };
      if (kind === 'pedido') {
        const names = identityNames(part);
        let nome = field(part, nameLabels) || names[0] || '';
        let cpf = digits(field(part, ['CPF']));
        if (nome || cpf) {
          const known = context.workers || [];
          if (!cpf && nome) { const matches = known.filter(w => normal(w.nome) === normal(nome)); if (matches.length === 1) cpf = matches[0].cpf; }
          if (!nome && cpf) nome = known.find(w => w.cpf === cpf)?.nome || '';
          item.dados.diarista_escalado = {nome, cpf};
          if (!nome) item.faltando.push('nome do diarista escalado');
          if (!validCpf(cpf)) item.faltando.push('CPF válido do diarista escalado');
          if (names.length > 1 || part.split('\n').filter(cpfLine).length > 1) item.faltando.push('revisar mais de um diarista informado no mesmo pedido');
          item.avisos.push('A pessoa informada será escalada em todos os dias deste pedido. A disponibilidade vale apenas para estas datas e horários.');
        }
      }
      item.chave = fingerprint(item);
      return item;
    });
  }
  return { parse, split, classify, range, validCpf, fingerprint, textKey, prepareText };
});
