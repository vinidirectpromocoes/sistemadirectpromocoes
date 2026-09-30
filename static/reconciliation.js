/* Estado de cada vaga e diária. Nunca atribui recebimento parcial a um item individual. */
(() => {
  function build(orders, scalesByOrder, financeRows, invoices, month = '', today = '') {
    const daily = new Map((financeRows || []).filter(item => item.origem === 'diaria').map(item => [item.pedido_escala_id, item]));
    const billed = new Map();
    for (const invoice of invoices || []) {
      if (invoice.status === 'cancelada') continue;
      for (const item of invoice.itens || []) billed.set(item.diaria_id, invoice);
    }
    const rows = [];
    for (const order of orders || []) {
      const scales = scalesByOrder?.[order.id] || [];
      for (const shift of order.turnos || []) {
        if (typeof month === 'string' ? month && !shift.data.startsWith(month)
          : (month.start && shift.data < month.start) || (month.end && shift.data > month.end)) continue;
        const dayScales = scales.filter(item => item.data === shift.data);
        const active = dayScales.filter(item => item.status !== 'falta');
        const present = dayScales.filter(item => item.status === 'presente');
        const absent = dayScales.filter(item => item.status === 'falta');
        const requested = order.situacao === 'cancelado' ? present.length : Number(order.quantidade_diaristas) || 0;
        if (!requested && !absent.length) continue;
        const issues = [];
        if (active.length < requested && (!today || shift.data <= today)) issues.push(`${requested - active.length} vaga(s) sem diarista`);
        if (active.length > requested) issues.push('Escala acima da quantidade solicitada');
        for (const scale of absent) {
          if (!scale.falta_motivo) issues.push(`Falta de ${scale.diarista_nome}: motivo não registrado`);
          if (!scale.substituida_por_escala_id) issues.push(`Falta de ${scale.diarista_nome}: sem substituta`);
        }
        const workers = active.map(scale => {
          const record = daily.get(scale.id) || null;
          const invoice = record ? billed.get(record.id) || null : null;
          const collected = invoice && invoice.valor_recebido_centavos >= invoice.valor_centavos;
          if (scale.status === 'escalada' && today && shift.data <= today)
            issues.push(`${scale.diarista_nome}: presença ainda não confirmada`);
          if (scale.status === 'presente' && !record) issues.push(`${scale.diarista_nome}: presença sem diária financeira`);
          if (record && record.valor_centavos == null) issues.push(`${scale.diarista_nome}: pagamento sem valor`);
          if (record && record.valor_recebido_centavos == null) issues.push(`${scale.diarista_nome}: faturamento sem valor`);
          if (record && !invoice) issues.push(`${scale.diarista_nome}: diária ainda não cobrada`);
          if (invoice && !collected) issues.push(`${scale.diarista_nome}: cobrança ${invoice.valor_recebido_centavos ? 'parcial' : 'não recebida'}`);
          if (record && !record.data_pagamento && today && record.vencimento && record.vencimento < today)
            issues.push(`${scale.diarista_nome}: pagamento vencido`);
          return { id: scale.id, name: scale.diarista_nome, status: scale.status,
            dailyId: record?.id || null, billed: Boolean(invoice), collected: Boolean(collected),
            paid: Boolean(record?.data_pagamento), invoiceId: invoice?.id || null };
        });
        rows.push({ orderId: order.id, network: order.supermercado, unit: order.unidade || '',
          sector: order.setor, date: shift.data, requested, assigned: active.length,
          present: present.length, absent: absent.length, workers, issues });
      }
    }
    return { rows, issues: rows.flatMap(row => row.issues.map(message => ({ ...row, message }))),
      summary: { requested: rows.reduce((sum, row) => sum + row.requested, 0),
        present: rows.reduce((sum, row) => sum + row.present, 0),
        billed: rows.reduce((sum, row) => sum + row.workers.filter(worker => worker.billed).length, 0),
        collected: rows.reduce((sum, row) => sum + row.workers.filter(worker => worker.collected).length, 0),
        paid: rows.reduce((sum, row) => sum + row.workers.filter(worker => worker.paid).length, 0) } };
  }
  if (typeof window !== 'undefined') window.DirectReconciliation = { build };
  if (typeof module !== 'undefined') module.exports = { build };
})();
