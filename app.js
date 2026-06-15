'use strict';

// Endereço do agente. Em modo servidor, outras máquinas apontam para o IP do servidor.
let AGENT = localStorage.getItem('isapaes-agente') || 'http://localhost:7890';
let TOKEN = localStorage.getItem('isapaes-token') || '';
// link direto (DANFE/XML) já com a senha de acesso quando houver
function linkAgente(path) { return AGENT + path + (TOKEN ? (path.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(TOKEN) : ''); }

const $ = (id) => document.getElementById(id);

// Aviso rápido de atualização
let toastTimer = null;
function toast(msg, tipo) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (tipo === true ? ' ok' : tipo === false ? ' erro' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), tipo === false ? 2600 : 1100);
}

// Datas são compartilhadas entre Notas e Dashboard
function syncDates() {
  $('dataDe').value = state.dataDe; $('dataAte').value = state.dataAte;
  $('dashDe').value = state.dataDe; $('dashAte').value = state.dataAte;
}
function aplicarData(de, ate) {
  if (de && ate && ate < de) {
    toast('A data final não pode ser menor que a inicial', false);
    syncDates(); // reverte o campo para o valor válido anterior
    return;
  }
  state.dataDe = de; state.dataAte = ate; state.pagina = 1;
  syncDates();
  renderizar();
  if (typeof renderDashboard === 'function') renderDashboard();
  toast('Atualizado ✓', true);
}
let state = {
  documentos: [], filtro: '', dataDe: '', dataAte: '',
  grupoFiltro: '', resumoTab: 'grupo', destFiltro: '', opFiltro: '',
  view: 'notas', dashDe: '', dashAte: '',
  pagina: 1, porPagina: 100, soHoje: false, dashGrupos: [], ultimaConsulta: null,
  classificacao: { grupos: [], fornecedores: {} },
  cnpjProprio: null, autenticado: false,
};

// ---------- Comunicação com o agente ----------
async function api(path, opts = {}) {
  const res = await fetch(AGENT + path, {
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { 'x-isapaes-token': TOKEN } : {}), ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.erro || `Erro ${res.status}`);
  return data;
}

async function verificarAgente() {
  $('agentText').textContent = 'Verificando servidor…';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(AGENT + '/status', {
      headers: { 'Content-Type': 'application/json', ...(TOKEN ? { 'x-isapaes-token': TOKEN } : {}) },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error('http ' + res.status);
    const st = await res.json();
    marcarAgente(true, st.versao);
    if (st.autenticado) {
      state.autenticado = true;
      mostrarMain(st);
      await carregarDocumentos();
    } else {
      mostrarLogin();
    }
    return true;
  } catch {
    marcarAgente(false);
    mostrarOffline();
    return false;
  }
}

function marcarAgente(online, versao) {
  $('agentDot').className = 'dot ' + (online ? 'online' : 'offline');
  $('agentText').textContent = online ? 'Conectado' : 'Desconectado';
}

// ---------- Navegação entre telas ----------
function esconderTudo() {
  ['loginView', 'mainView', 'offlineView'].forEach((v) => $(v).classList.add('hidden'));
}
function mostrarLogin() { esconderTudo(); $('loginView').classList.remove('hidden'); }
function mostrarOffline() { esconderTudo(); $('offlineView').classList.remove('hidden'); const c = $('agenteUrl'); if (c && !c.value) c.value = AGENT; const t = $('agenteToken'); if (t && !t.value) t.value = TOKEN; }
function mostrarMain(st) {
  esconderTudo();
  $('mainView').classList.remove('hidden');
  $('voltarBtn').classList.add('hidden');
  $('logoutBtn').classList.remove('hidden');
  $('trocarBtn').classList.remove('hidden');
  $('ambienteBadge').classList.remove('hidden');
  if (st.certInfo) {
    $('certNome').textContent = st.certInfo.razaoSocial || 'Certificado';
    $('certCnpj').textContent = 'CNPJ ' + formatarCNPJ(st.certInfo.cnpj);
    if (st.certInfo.validoAte) {
      const d = new Date(st.certInfo.validoAte);
      $('certValidade').textContent = ' · Válido até ' + d.toLocaleDateString('pt-BR');
    }
  }
  const badge = $('ambienteBadge');
  if (st.ambiente === 'homologacao') {
    badge.textContent = 'HOMOLOGAÇÃO'; badge.classList.add('homolog');
  } else {
    badge.textContent = 'PRODUÇÃO'; badge.classList.remove('homolog');
  }
}

// ---------- Login ----------
$('loginBtn').addEventListener('click', async () => {
  const file = $('pfxInput').files[0];
  const senha = $('senhaInput').value;
  const erro = $('loginError');
  erro.classList.add('hidden');

  if (!file) return mostrarErroLogin('Selecione o arquivo .pfx.');
  if (!senha) return mostrarErroLogin('Informe a senha do certificado.');

  $('loginBtn').disabled = true;
  $('loginBtn').textContent = 'Conectando…';
  try {
    const pfxBase64 = await fileToBase64(file);
    const st = await api('/login', {
      method: 'POST',
      body: JSON.stringify({
        pfxBase64, senha,
        ambiente: $('ambienteInput').value,
        cUF: $('ufInput').value,
      }),
    });
    state.autenticado = true;
    $('senhaInput').value = '';
    mostrarMain(st);
    setTimeout(carregarDocumentos, 1500); // dá tempo da 1ª consulta iniciar
  } catch (e) {
    mostrarErroLogin(e.message);
  } finally {
    $('loginBtn').disabled = false;
    $('loginBtn').textContent = 'Conectar';
  }
});

function mostrarErroLogin(msg) {
  const erro = $('loginError');
  erro.textContent = msg; erro.classList.remove('hidden');
}

$('logoutBtn').addEventListener('click', () => {
  if (confirm('Sair? Para usar outra empresa, entre com o certificado dela.')) sairConta();
});
$('trocarBtn').addEventListener('click', () => {
  // não desconecta ainda — só abre a tela para trocar, com opção de voltar
  mostrarLogin();
  $('voltarBtn').classList.remove('hidden');
});
$('voltarBtn').addEventListener('click', () => {
  $('voltarBtn').classList.add('hidden');
  esconderTudo();
  $('mainView').classList.remove('hidden');
});
$('logoBtn').addEventListener('click', () => {
  if (!state.autenticado) return;
  $('voltarBtn').classList.add('hidden');
  esconderTudo();
  $('mainView').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
async function sairConta() {
  await api('/logout', { method: 'POST' }).catch(() => {});
  state.autenticado = false;
  state.documentos = [];
  $('certNome').textContent = 'Consulta de NF-e · SEFAZ';
  $('certCnpj').textContent = '';
  $('certValidade').textContent = '';
  $('logoutBtn').classList.add('hidden');
  $('trocarBtn').classList.add('hidden');
  $('ambienteBadge').classList.add('hidden');
  $('voltarBtn').classList.add('hidden');
  mostrarLogin();
}

// ---------- Consulta manual ----------
$('consultarBtn').addEventListener('click', async () => {
  const btn = $('consultarBtn');
  btn.disabled = true; btn.textContent = 'Consultando…';
  try {
    const r = await api('/consultar', { method: 'POST', body: JSON.stringify({}) });
    await carregarDocumentos();
    btn.textContent = r.novos > 0 ? `+${r.novos} novas` : 'Sem novidades';
    setTimeout(() => (btn.textContent = 'Consultar agora'), 2500);
  } catch (e) {
    btn.textContent = 'Consultar agora';
    alert(e.message);
  } finally {
    btn.disabled = false;
  }
});

// ---------- Documentos ----------
async function carregarDocumentos() {
  try {
    const data = await api('/documentos');
    state.documentos = data.documentos || [];
    if (data.classificacao) state.classificacao = data.classificacao;
    if (data.cnpjProprio) state.cnpjProprio = data.cnpjProprio;
    atualizarGrupoFiltro();
    atualizarOpFiltro();
    renderizar();
    if (state.view === 'dashboard') renderDashboard();
    if (data.ultimaConsulta) {
      state.ultimaConsulta = data.ultimaConsulta;
      atualizarRelogioConsulta();
    }
  } catch (e) {
    console.error(e);
  }
}

// Mantém "última consulta" e "próxima automática" sempre atualizados (com contagem regressiva)
function atualizarRelogioConsulta() {
  if (!state.ultimaConsulta) return;
  const d = new Date(state.ultimaConsulta);
  $('ultimaConsulta').textContent = 'Última consulta: ' + d.toLocaleString('pt-BR');
  const prox = new Date(d.getTime() + 65 * 60000);
  const faltaMin = Math.max(0, Math.round((prox.getTime() - Date.now()) / 60000));
  const hhmm = prox.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  $('proximaConsulta').textContent = faltaMin > 0
    ? `Próxima automática: ${hhmm} (em ${faltaMin} min)`
    : 'Próxima automática: a qualquer momento…';
}

$('filtroInput').addEventListener('input', (e) => {
  state.filtro = e.target.value.toLowerCase();
  state.pagina = 1;
  renderizar();
});

$('dataDe').addEventListener('change', (e) => aplicarData(e.target.value, state.dataAte));
$('dataAte').addEventListener('change', (e) => aplicarData(state.dataDe, e.target.value));
$('limparDatas').addEventListener('click', () => {
  state.grupoFiltro = ''; state.destFiltro = ''; state.opFiltro = ''; state.soHoje = false;
  $('grupoFiltro').value = ''; $('destFiltro').value = ''; $('opFiltro').value = '';
  aplicarData('', '');
});
$('grupoFiltro').addEventListener('change', (e) => { state.grupoFiltro = e.target.value; state.pagina = 1; renderizar(); toast('Atualizado ✓', true); });
$('destFiltro').addEventListener('change', (e) => { state.destFiltro = e.target.value; state.pagina = 1; renderizar(); toast('Atualizado ✓', true); });
$('opFiltro').addEventListener('change', (e) => { state.opFiltro = e.target.value; state.pagina = 1; renderizar(); toast('Atualizado ✓', true); });

// Classifica a operação a partir da natureza da operação (texto) e do CFOP
function classificarOperacao(d) {
  const n = (d.natOp || '').toUpperCase();
  if (n) {
    if (/DEVOLU|TROCA/.test(n)) return 'Devolução';
    if (/TRANSFER/.test(n)) return 'Transferência';
    if (/INDUSTRIALIZ|BENEFICIAMENTO/.test(n)) return 'Industrialização';
    if (/SERVI[CÇ]O/.test(n)) return 'Prestação de serviço';
    if (/RETORNO/.test(n)) return 'Retorno';
    if (/REMESSA/.test(n)) return 'Remessa';
    if (/BONIFICA/.test(n)) return 'Bonificação';
    if (/AMOSTRA/.test(n)) return 'Amostra';
    if (/COMODATO|LOCA[CÇ]/.test(n)) return 'Comodato/Locação';
    if (/VENDA|COMPRA/.test(n)) return 'Venda/Compra';
  }
  const c = d.cfop ? String(d.cfop).slice(-3) : '';
  if (!c) return null;
  if (['122', '124', '125', '901', '902', '903', '904', '924', '925'].includes(c)) return 'Industrialização';
  if (['151', '152', '153', '155', '156', '157', '159'].includes(c)) return 'Transferência';
  if (['933', '934'].includes(c)) return 'Prestação de serviço';
  if (String(d.cfop).startsWith('1') || String(d.cfop).startsWith('2')) {
    if (c[0] === '2' || ['201', '202', '208', '209', '210', '411'].includes(c)) return 'Devolução';
  }
  if (['101', '102', '111', '113', '116', '117', '118', '119', '120'].includes(c)) return 'Venda/Compra';
  return 'Outras';
}

function atualizarOpFiltro() {
  const sel = $('opFiltro');
  const atual = sel.value;
  const ops = new Set();
  let temSemOp = false;
  for (const d of state.documentos) {
    if ((d.tipo === 'resumo' || d.tipo === 'nfe_completa') && d.chave) {
      const o = classificarOperacao(d);
      if (o) ops.add(o); else temSemOp = true;
    }
  }
  let opts = '<option value="">Todas as operações</option>';
  opts += [...ops].sort().map((o) => `<option value="${escapar(o)}">${escapar(o)}</option>`).join('');
  if (temSemOp) opts += '<option value="__sem__">Operação não identificada</option>';
  sel.innerHTML = opts;
  sel.value = atual;
}

// Popula o filtro de destinatário com os CNPJs encontrados (só notas com XML completo trazem destinatário)
function atualizarDestFiltro() {
  const sel = $('destFiltro');
  const atual = sel.value;
  const dests = new Set();
  let temSemDest = false;
  for (const d of state.documentos) {
    if ((d.tipo === 'resumo' || d.tipo === 'nfe_completa') && d.chave) {
      if (d.cnpjDest) dests.add(d.cnpjDest); else temSemDest = true;
    }
  }
  const rotulo = (c) => {
    const f = formatarCNPJ(c);
    if (c === state.cnpjProprio) return `Fábrica (${f})`;
    return f;
  };
  let opts = '<option value="">Todos os destinatários</option>';
  opts += [...dests].sort().map((c) => `<option value="${c}">${rotulo(c)}</option>`).join('');
  if (temSemDest) opts += '<option value="__sem__">Destinatário não identificado</option>';
  sel.innerHTML = opts;
  sel.value = atual;
}

// Delegação de eventos da tabela (um listener só, mesmo com milhares de linhas)
$('tbody').addEventListener('click', (e) => {
  const manif = e.target.closest('.manifestar');
  if (manif) return manifestarNota(manif);
});
$('tbody').addEventListener('change', (e) => {
  const sel = e.target.closest('.grupo-select');
  if (sel) { classificarFornecedor(sel.dataset.cnpj, { grupo: sel.value || null, subgrupo: null }); return; }
  const sub = e.target.closest('.subgrupo-select');
  if (sub) { classificarFornecedor(sub.dataset.cnpj, { subgrupo: sub.value || null }); }
});

// Abas do resumo
document.querySelectorAll('.resumo-tab').forEach((b) => {
  b.addEventListener('click', () => {
    state.resumoTab = b.dataset.tab;
    document.querySelectorAll('.resumo-tab').forEach((x) => x.classList.toggle('active', x === b));
    renderResumo(documentosFiltrados());
  });
});

// Gerenciar grupos
$('gerenciarGrupos').addEventListener('click', () => {
  $('gruposPanel').classList.toggle('hidden');
  renderGruposPanel();
});
$('addGrupoBtn').addEventListener('click', adicionarGrupo);
$('novoGrupo').addEventListener('keydown', (e) => { if (e.key === 'Enter') adicionarGrupo(); });
$('addSubgrupoBtn').addEventListener('click', adicionarSubgrupo);
$('novoSubgrupo').addEventListener('keydown', (e) => { if (e.key === 'Enter') adicionarSubgrupo(); });

async function adicionarGrupo() {
  const nome = $('novoGrupo').value.trim();
  if (!nome) return;
  try {
    const r = await api('/classificacao/grupo', { method: 'POST', body: JSON.stringify({ nome }) });
    state.classificacao = r.classificacao;
    $('novoGrupo').value = '';
    atualizarGrupoFiltro();
    renderGruposPanel();
    renderizar();
  } catch (e) { alert(e.message); }
}

async function removerGrupo(nome) {
  if (!confirm(`Remover o grupo "${nome}"? Os fornecedores nele ficarão sem grupo.`)) return;
  try {
    const r = await api('/classificacao/grupo/remover', { method: 'POST', body: JSON.stringify({ nome }) });
    state.classificacao = r.classificacao;
    atualizarGrupoFiltro();
    renderGruposPanel();
    renderizar();
  } catch (e) { alert(e.message); }
}

async function adicionarSubgrupo() {
  const nome = $('novoSubgrupo').value.trim();
  const grupo = $('subgrupoGrupoSel').value;
  if (!nome || !grupo) { toast('Escolha o grupo e digite o subgrupo', false); return; }
  try {
    const r = await api('/classificacao/subgrupo', { method: 'POST', body: JSON.stringify({ nome, grupo }) });
    state.classificacao = r.classificacao;
    $('novoSubgrupo').value = '';
    renderGruposPanel();
    renderizar();
  } catch (e) { alert(e.message); }
}

async function removerSubgrupo(nome, grupo) {
  if (!confirm(`Remover o subgrupo "${nome}" de "${grupo}"?`)) return;
  try {
    const r = await api('/classificacao/subgrupo/remover', { method: 'POST', body: JSON.stringify({ nome, grupo }) });
    state.classificacao = r.classificacao;
    renderGruposPanel();
    renderizar();
  } catch (e) { alert(e.message); }
}

async function classificarFornecedor(cnpj, dados) {
  if (!cnpj) return;
  try {
    const r = await api('/classificacao/fornecedor', { method: 'POST', body: JSON.stringify({ cnpj, ...dados }) });
    state.classificacao = r.classificacao;
    renderizar();
  } catch (e) { alert(e.message); }
}

function grupoDoFornecedor(cnpj) {
  return state.classificacao.fornecedores[cnpj]?.grupo || '';
}
function subgrupoDoFornecedor(cnpj) {
  return state.classificacao.fornecedores[cnpj]?.subgrupo || '';
}
function flagDoFornecedor(cnpj) {
  return !!state.classificacao.fornecedores[cnpj]?.flag;
}

function atualizarGrupoFiltro() {
  const sel = $('grupoFiltro');
  const atual = sel.value;
  sel.innerHTML = '<option value="">Todos os grupos</option>' +
    '<option value="__sem__">— Sem grupo —</option>' +
    state.classificacao.grupos.map((g) => `<option value="${escapar(g)}">${escapar(g)}</option>`).join('');
  sel.value = atual;
}

function renderGruposPanel() {
  $('gruposLista').innerHTML = state.classificacao.grupos
    .map((g) => `<span class="grupo-chip">${escapar(g)} <button data-g="${escapar(g)}" title="Remover">×</button></span>`)
    .join('') || '<span class="muted">Nenhum grupo ainda.</span>';
  $('gruposLista').querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => removerGrupo(b.dataset.g));
  });

  // seletor de grupo para o novo subgrupo
  $('subgrupoGrupoSel').innerHTML = state.classificacao.grupos
    .map((g) => `<option value="${escapar(g)}">${escapar(g)}</option>`).join('');

  // lista de subgrupos
  const subs = state.classificacao.subgrupos || [];
  $('subgruposLista').innerHTML = subs.length
    ? subs.map((s) => `<span class="grupo-chip">${escapar(s.grupo)} · ${escapar(s.nome)} <button data-n="${escapar(s.nome)}" data-g="${escapar(s.grupo)}" title="Remover">×</button></span>`).join('')
    : '<span class="muted">Nenhum subgrupo ainda.</span>';
  $('subgruposLista').querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => removerSubgrupo(b.dataset.n, b.dataset.g));
  });
}

// Aplica todos os filtros e devolve só compras (exclui notas emitidas pela própria empresa)
function documentosFiltrados() {
  // só notas fiscais reais (resumo ou XML completo, com chave) — exclui eventos e lixo
  let docs = state.documentos.filter((d) =>
    (d.tipo === 'resumo' || d.tipo === 'nfe_completa') && d.chave);
  // exclui as próprias notas de venda (emitente = CNPJ próprio) → sobram só compras
  if (state.cnpjProprio) docs = docs.filter((d) => d.cnpjEmitente !== state.cnpjProprio);

  if (state.filtro) {
    docs = docs.filter((d) =>
      [(d.emitente || ''), (d.cnpjEmitente || ''), (d.chave || '')]
        .join(' ').toLowerCase().includes(state.filtro));
  }
  if (state.dataDe || state.dataAte) {
    docs = docs.filter((d) => {
      const dia = (d.dataEmissao || '').slice(0, 10);
      if (!dia) return false;
      if (state.dataDe && dia < state.dataDe) return false;
      if (state.dataAte && dia > state.dataAte) return false;
      return true;
    });
  }
  if (state.grupoFiltro) {
    docs = docs.filter((d) => {
      const g = grupoDoFornecedor(d.cnpjEmitente);
      return state.grupoFiltro === '__sem__' ? !g : g === state.grupoFiltro;
    });
  }
  if (state.destFiltro) {
    docs = docs.filter((d) => {
      const dest = (d.cnpjDest === '14485211000176' || d.cnpjDest === '14485211000257') ? d.cnpjDest : '__sem__';
      return dest === state.destFiltro;
    });
  }
  if (state.opFiltro) {
    docs = docs.filter((d) => {
      const o = classificarOperacao(d) || '__sem__';
      return o === state.opFiltro;
    });
  }
  if (state.soHoje) {
    const hoje = new Date().toISOString().slice(0, 10);
    docs = docs.filter((d) => (d.dataEmissao || '').slice(0, 10) === hoje);
  }
  return docs;
}

function renderizar() {
  const filtrados = documentosFiltrados();
  const tbody = $('tbody');
  $('vazio').classList.toggle('hidden', filtrados.length > 0);

  const totalValor = filtrados.reduce((s, d) => s + (d.valor || 0), 0);
  $('stats').innerHTML = `
    <div class="stat"><div class="v">${filtrados.length}</div><div class="l">Notas emitidas</div></div>
    <div class="stat"><div class="v">${formatarMoeda(totalValor)}</div><div class="l">Valor total das notas emitidas</div></div>
    <div class="stat clickable ${state.soHoje ? 'ativo' : ''}" id="statHoje" title="Clique para ver só as recebidas hoje"><div class="v">${contarHoje(state.documentos.filter(d => (d.tipo==='resumo'||d.tipo==='nfe_completa') && d.chave))}</div><div class="l">Recebidas hoje ${state.soHoje ? '✓' : ''}</div></div>
  `;

  // Paginação
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / state.porPagina));
  if (state.pagina > totalPaginas) state.pagina = totalPaginas;
  const ini = (state.pagina - 1) * state.porPagina;
  const pagina = filtrados.slice(ini, ini + state.porPagina);

  const opcoesGrupo = (sel) =>
    '<option value="">—</option>' +
    state.classificacao.grupos.map((g) =>
      `<option value="${escapar(g)}" ${g === sel ? 'selected' : ''}>${escapar(g)}</option>`).join('');

  const opcoesSubgrupo = (grupo, sel) => {
    const subs = (state.classificacao.subgrupos || []).filter((s) => s.grupo === grupo);
    return '<option value="">— subgrupo —</option>' +
      subs.map((s) => `<option value="${escapar(s.nome)}" ${s.nome === sel ? 'selected' : ''}>${escapar(s.nome)}</option>`).join('');
  };

  // Monta o HTML de uma vez (muito mais rápido que appendChild em loop)
  let html = '';
  for (const d of pagina) {
    const cnpj = d.cnpjEmitente;
    const grupo = grupoDoFornecedor(cnpj);
    const subgrupo = subgrupoDoFornecedor(cnpj);
    const operacao = classificarOperacao(d);
    const semClassificar = operacao === 'Remessa' || operacao === 'Retorno';
    const permiteSubgrupo = operacao === 'Industrialização' || operacao === 'Prestação de serviço'
      || (!operacao && grupo === 'Serviços');
    let acoes;
    if (d.xmlDisponivel) {
      acoes = `<a class="acao-btn" href="${linkAgente('/danfe/' + d.chave)}" target="_blank">DANFE</a>
         <a class="acao-btn" href="${linkAgente('/xml/' + d.chave)}">XML</a>`;
    } else if (d.situacao === '3' || d.situacao === '2') {
      // cancelada/denegada sem XML ainda → permite buscar para visualizar
      acoes = `<button class="acao-btn manifestar" data-chave="${d.chave}" title="Buscar XML para visualizar">Ver DANFE/XML</button>`;
    } else {
      acoes = `<button class="acao-btn manifestar" data-chave="${d.chave}">Manifestar</button>`;
    }
    const grupoCel = semClassificar
      ? `<span class="muted" style="font-size:0.74rem">${escapar(operacao)}</span>`
      : `<div class="grupo-cell">
          <select class="grupo-select ${grupo ? '' : 'sem'}" data-cnpj="${cnpj}">${opcoesGrupo(grupo)}</select>
          ${grupo && permiteSubgrupo ? `<select class="subgrupo-select" data-cnpj="${cnpj}">${opcoesSubgrupo(grupo, subgrupo)}</select>` : ''}
        </div>`;
    html += `<tr${ehRecente(d.recebidoEm) ? ' class="nova"' : ''}>
      <td><span class="emit-nome">${escapar(d.emitente || '—')}</span></td>
      <td>${formatarCNPJ(cnpj)}</td>
      <td>${grupoCel}</td>
      <td class="num">${d.valor != null ? formatarMoeda(d.valor) : '—'}</td>
      <td>${formatarData(d.dataEmissao)}</td>
      <td>${situacaoBadge(d.situacao)}</td>
      <td class="acoes">${acoes}</td>
      <td class="chave">${d.chave || '—'}</td>
    </tr>`;
  }
  tbody.innerHTML = html;

  // Controles de paginação
  if (filtrados.length > state.porPagina) {
    $('paginacao').innerHTML = `
      <button id="pgPrev" ${state.pagina <= 1 ? 'disabled' : ''}>← Anterior</button>
      <span>Página ${state.pagina} de ${totalPaginas} · ${filtrados.length} notas</span>
      <button id="pgNext" ${state.pagina >= totalPaginas ? 'disabled' : ''}>Próxima →</button>`;
    $('pgPrev')?.addEventListener('click', () => { state.pagina--; renderizar(); window.scrollTo(0, 0); });
    $('pgNext')?.addEventListener('click', () => { state.pagina++; renderizar(); window.scrollTo(0, 0); });
  } else {
    $('paginacao').innerHTML = '';
  }

  renderResumo(filtrados);
}

// Troca de visão Notas / Dashboard
document.querySelectorAll('.vs-btn').forEach((b) => {
  b.addEventListener('click', () => {
    state.view = b.dataset.view;
    document.querySelectorAll('.vs-btn').forEach((x) => x.classList.toggle('active', x === b));
    $('notasView').classList.toggle('hidden', state.view !== 'notas');
    $('dashboardView').classList.toggle('hidden', state.view !== 'dashboard');
    syncDates();
    if (state.view === 'dashboard') renderDashboard();
  });
});
$('dashDe').addEventListener('change', (e) => aplicarData(e.target.value, state.dataAte));
$('dashAte').addEventListener('change', (e) => aplicarData(state.dataDe, e.target.value));
$('dashLimpar').addEventListener('click', () => aplicarData('', ''));

// Documentos de compra (exclui eventos e notas próprias), filtrados pelo período do dashboard
function comprasDashboard() {
  let docs = state.documentos.filter((d) =>
    (d.tipo === 'resumo' || d.tipo === 'nfe_completa') && d.chave);
  if (state.cnpjProprio) docs = docs.filter((d) => d.cnpjEmitente !== state.cnpjProprio);
  if (state.dataDe || state.dataAte) {
    docs = docs.filter((d) => {
      const dia = (d.dataEmissao || '').slice(0, 10);
      if (!dia) return false;
      if (state.dataDe && dia < state.dataDe) return false;
      if (state.dataAte && dia > state.dataAte) return false;
      return true;
    });
  }
  return docs;
}

function barras(elId, dados, max, opts = {}) {
  const el = $(elId);
  if (!dados.length) { el.innerHTML = '<div class="dash-empty">Sem dados no período.</div>'; return; }
  const maior = max || Math.max(...dados.map((d) => d.valor), 1);
  el.innerHTML = dados.map((d) => {
    const selecionado = opts.selecionados ? opts.selecionados.includes(d.nome) : (opts.selecionado === d.nome);
    const sel = selecionado ? ' sel' : '';
    const attr = opts.clicavel ? ` data-grupo="${escapar(d.nome)}"` : '';
    const cls = opts.clicavel ? 'bar-row clicavel' + sel : 'bar-row';
    return `<div class="${cls}"${attr}>
      <span class="bar-label" title="${escapar(d.nome)}">${escapar(d.nome)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${Math.max(2, (d.valor / maior) * 100)}%"></span></span>
      <span class="bar-val">${formatarMoeda(d.valor)}</span>
    </div>`;
  }).join('');
}

// Rótulo completo do fornecedor para o dashboard (grupo · subgrupo, ou operação Remessa)
function rotuloDash(d) {
  const op = classificarOperacao(d);
  if (op === 'Remessa') return 'Remessa (operação)';
  const g = grupoDoFornecedor(d.cnpjEmitente);
  if (!g) return 'Sem grupo';
  const s = subgrupoDoFornecedor(d.cnpjEmitente);
  return s ? `${g} · ${s}` : g;
}

function renderDashboard() {
  const docsTodos = comprasDashboard();
  // aplica a seleção de grupos (multi) aos cartões e ao ranking
  const docs = state.dashGrupos.length
    ? docsTodos.filter((d) => state.dashGrupos.includes(rotuloDash(d)))
    : docsTodos;

  const total = docs.reduce((s, d) => s + (d.valor || 0), 0);
  const fornecedores = new Set(docs.map((d) => d.cnpjEmitente)).size;
  const ticket = docs.length ? total / docs.length : 0;

  $('dashCards').innerHTML = `
    <div class="dash-card"><div class="v">${formatarMoeda(total)}</div><div class="l">Valor total das notas emitidas</div></div>
    <div class="dash-card"><div class="v">${docs.length}</div><div class="l">Notas emitidas</div></div>
    <div class="dash-card"><div class="v">${fornecedores}</div><div class="l">Fornecedores</div></div>
    <div class="dash-card"><div class="v">${formatarMoeda(ticket)}</div><div class="l">Ticket médio</div></div>
  `;

  // Compras por grupo (nome completo grupo · subgrupo + Remessa como exceção) — clicável
  const grupos = {};
  for (const d of docsTodos) {
    const k = rotuloDash(d);
    grupos[k] = (grupos[k] || 0) + (d.valor || 0);
  }
  const gArr = Object.entries(grupos).map(([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor);
  barras('chartGrupo', gArr, null, { clicavel: true, selecionados: state.dashGrupos });

  // Ranking de fornecedores (já filtrado por docs)
  const forn = {};
  for (const d of docs) {
    const c = d.cnpjEmitente || '—';
    if (!forn[c]) forn[c] = { nome: d.emitente || c, valor: 0 };
    forn[c].valor += d.valor || 0;
  }
  barras('chartFornecedor', Object.values(forn).sort((a, b) => b.valor - a.valor).slice(0, 15));
  $('rankTitulo').innerHTML = 'Ranking de fornecedores' +
    (state.dashGrupos.length ? ` · ${escapar(state.dashGrupos.join(', '))} <span class="muted" style="font-weight:400;font-size:0.78rem">(clique p/ alternar)</span>` : '');

  // Compras por mês — somente os grupos Aviamentos, Tecidos e Material de uso e consumo
  const GRUPOS_MES = ['Aviamentos', 'Tecidos', 'Material de uso e consumo'];
  const meses = {};
  for (const d of docsTodos) {
    if (!GRUPOS_MES.includes(grupoDoFornecedor(d.cnpjEmitente))) continue;
    const m = (d.dataEmissao || '').slice(0, 7);
    if (!m) continue;
    meses[m] = (meses[m] || 0) + (d.valor || 0);
  }
  const mesNomes = { '01': 'Jan', '02': 'Fev', '03': 'Mar', '04': 'Abr', '05': 'Mai', '06': 'Jun', '07': 'Jul', '08': 'Ago', '09': 'Set', '10': 'Out', '11': 'Nov', '12': 'Dez' };
  barras('chartMes', Object.entries(meses).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([m, valor]) => ({ nome: `${mesNomes[m.slice(5, 7)]}/${m.slice(2, 4)}`, valor })));
}

async function manifestarNota(btn) {
  const chave = btn.dataset.chave;
  btn.disabled = true; btn.textContent = 'Manifestando…';
  try {
    const r = await api('/manifestar', { method: 'POST', body: JSON.stringify({ chNFe: chave }) });
    if (r.ok) {
      btn.textContent = 'OK ✓';
      await carregarDocumentos(); // o XML completo já deve estar disponível
    } else {
      btn.textContent = 'Manifestar';
      btn.disabled = false;
      alert(`SEFAZ ${r.cStat || ''}: ${r.motivo || 'não foi possível manifestar.'}`);
    }
  } catch (e) {
    btn.textContent = 'Manifestar'; btn.disabled = false;
    alert(e.message);
  }
}

// Resumos: por grupo ou por fornecedor
function renderResumo(docs) {
  const cont = $('resumoConteudo');
  const fmt = (v) => formatarMoeda(v);

  if (state.resumoTab === 'grupo') {
    const acc = {};
    let semGrupo = { valor: 0, qtd: 0 };
    for (const d of docs) {
      const g = grupoDoFornecedor(d.cnpjEmitente);
      if (!g) { semGrupo.valor += d.valor || 0; semGrupo.qtd++; continue; }
      if (!acc[g]) acc[g] = { valor: 0, qtd: 0 };
      acc[g].valor += d.valor || 0; acc[g].qtd++;
    }
    const linhas = Object.entries(acc).sort((a, b) => b[1].valor - a[1].valor);
    const totalGeral = docs.reduce((s, d) => s + (d.valor || 0), 0);
    let html = linhas.map(([g, v]) =>
      `<div class="resumo-linha"><span class="nome">${escapar(g)} <span class="qtd">(${v.qtd})</span></span><span class="valor">${fmt(v.valor)}</span></div>`).join('');
    if (semGrupo.qtd) {
      html += `<div class="resumo-linha"><span class="nome" style="color:var(--muted)">Sem grupo <span class="qtd">(${semGrupo.qtd})</span></span><span class="valor">${fmt(semGrupo.valor)}</span></div>`;
    }
    html += `<div class="resumo-linha total"><span class="nome">Total</span><span class="valor">${fmt(totalGeral)}</span></div>`;
    cont.innerHTML = html || '<div class="resumo-linha"><span class="muted">Sem dados.</span></div>';
  } else {
    const acc = {};
    for (const d of docs) {
      const c = d.cnpjEmitente || '—';
      if (!acc[c]) acc[c] = { nome: d.emitente || '—', valor: 0, qtd: 0 };
      acc[c].valor += d.valor || 0; acc[c].qtd++;
    }
    const linhas = Object.entries(acc).sort((a, b) => b[1].valor - a[1].valor);
    cont.innerHTML = linhas.map(([c, v]) =>
      `<div class="resumo-linha"><span class="nome">${escapar(v.nome)} <span class="qtd">${formatarCNPJ(c)} · (${v.qtd})</span></span><span class="valor">${fmt(v.valor)}</span></div>`).join('')
      || '<div class="resumo-linha"><span class="muted">Sem dados.</span></div>';
  }
}

// ---------- Helpers ----------
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = () => rej(new Error('Falha ao ler o arquivo'));
    r.readAsDataURL(file);
  });
}
function formatarCNPJ(c) {
  if (!c) return '—';
  if (c.length === 14) return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return c;
}
function formatarMoeda(v) {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function formatarData(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return iso; }
}
function situacaoBadge(s) {
  if (s === '1') return '<span class="sit ok">Autorizada</span>';
  if (s === '3') return '<span class="sit cancel">Cancelada</span>';
  if (s === '2') return '<span class="sit den">Denegada</span>';
  return '—';
}
function contarHoje(docs) {
  const hoje = new Date().toISOString().slice(0, 10);
  return docs.filter((d) => (d.dataEmissao || '').slice(0, 10) === hoje).length;
}
function ehRecente(iso) {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < 5 * 60000;
}
function escapar(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

$('retryBtn').addEventListener('click', verificarAgente);

// Mostrar/ocultar senha (olho)
document.addEventListener('click', (e) => {
  const eye = e.target.closest('.pw-eye');
  if (!eye) return;
  const inp = $(eye.dataset.target);
  if (!inp) return;
  const ver = inp.type === 'password';
  inp.type = ver ? 'text' : 'password';
  eye.textContent = ver ? '🙈' : '👁';
});

$('salvarAgente').addEventListener('click', async () => {
  let url = $('agenteUrl').value.trim().replace(/\/+$/, '');
  if (!url) return;
  if (!/^https?:\/\//.test(url)) url = 'http://' + url;
  AGENT = url;
  TOKEN = $('agenteToken').value;
  localStorage.setItem('isapaes-agente', url);
  localStorage.setItem('isapaes-token', TOKEN);

  const btn = $('salvarAgente');
  const status = $('servStatus');
  btn.disabled = true; btn.textContent = 'Conectando…';
  status.className = 'serv-status'; status.textContent = '';

  // testa com timeout curto para não ficar "travado"
  let ok = false, motivo = '';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 7000);
    const res = await fetch(AGENT + '/status', {
      headers: { 'Content-Type': 'application/json', ...(TOKEN ? { 'x-isapaes-token': TOKEN } : {}) },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.status === 401) motivo = 'senha';
    else if (res.ok) ok = true;
    else motivo = 'http' + res.status;
  } catch (e) { motivo = e.name === 'AbortError' ? 'timeout' : 'rede'; }

  btn.disabled = false; btn.textContent = 'Salvar e conectar';
  if (ok) { verificarAgente(); return; }

  status.className = 'serv-status erro';
  if (motivo === 'senha') {
    status.textContent = '❌ Senha de acesso incorreta. Confira a senha que aparece no CMD do servidor.';
  } else {
    status.textContent = `❌ Não consegui falar com ${url}. Verifique: 1) use o IP do Radmin (26.x.x.x) se as máquinas não estão na mesma rede; 2) o agente está aberto no servidor (janela do .bat); 3) o Firewall do Windows liberou o Node no servidor.`;
  }
});

// ---------- Tema claro/escuro ----------
function aplicarTema(tema) {
  document.documentElement.setAttribute('data-theme', tema);
  $('themeToggle').textContent = tema === 'light' ? 'Tema escuro' : 'Tema claro';
  try { localStorage.setItem('isapaes-tema', tema); } catch (e) {}
}
$('themeToggle').addEventListener('click', () => {
  const atual = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  aplicarTema(atual === 'light' ? 'dark' : 'light');
});
(function () { let t = 'dark'; try { t = localStorage.getItem('isapaes-tema') || 'dark'; } catch (e) {} aplicarTema(t); })();

// ---------- Clique nos grupos do dashboard (multi-seleção) ----------
$('chartGrupo').addEventListener('click', (e) => {
  const row = e.target.closest('[data-grupo]');
  if (!row) return;
  const g = row.getAttribute('data-grupo');
  const i = state.dashGrupos.indexOf(g);
  if (i >= 0) state.dashGrupos.splice(i, 1); else state.dashGrupos.push(g);
  renderDashboard();
});

// ---------- "Recebidas hoje" clicável ----------
$('stats').addEventListener('click', (e) => {
  if (!e.target.closest('#statHoje')) return;
  state.soHoje = !state.soHoje;
  state.pagina = 1;
  if (state.view !== 'notas') {
    state.view = 'notas';
    document.querySelectorAll('.vs-btn').forEach((x) => x.classList.toggle('active', x.dataset.view === 'notas'));
    $('notasView').classList.remove('hidden');
    $('dashboardView').classList.add('hidden');
  }
  renderizar();
  if (state.soHoje) {
    document.querySelector('.table-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  toast(state.soHoje ? 'Mostrando recebidas hoje' : 'Filtro de hoje removido', true);
});

// ---------- Init + service worker ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
verificarAgente();
setInterval(() => { if (state.autenticado) carregarDocumentos(); }, 60000); // busca novas notas a cada min
setInterval(atualizarRelogioConsulta, 20000); // mantém o relógio/contagem regressiva vivo
