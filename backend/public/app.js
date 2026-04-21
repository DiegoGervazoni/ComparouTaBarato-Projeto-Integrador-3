// ===== Config/estado
const API = window.location.origin;
const itensPorPagina = 10;
const REGIOES = ["Todas","Campinas","Americana","Monte Mor","Itapira"];
let regiaoSel = localStorage.getItem("regiaoCTB") || "Monte Mor";

let token = localStorage.getItem("token") || null; // login só habilita cadastro/edição
let dadosOriginais = [];
let paginaAtual = 1;
let editingId = null;
let indicadoresVisiveis = false;

// A11y helpers
let lastFocusedBeforeModal = null;

const qs = s => document.querySelector(s);
const moeda = v => (Number(v)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const leg   = { cesta_basica:"Cesta básica", hortifruti:"Hortifruti", limpeza:"Limpeza", outras:"Outras" };
const authedHeaders = () => token ? { "Authorization":"Bearer " + token, "Content-Type":"application/json" } : { "Content-Type":"application/json" };

// Charts refs
let chartRegioes = null, chartLojas = null, chartCategorias = null;
const destroyIf = (c) => { if(c){ c.destroy(); } };

// ===== Helpers de UI
function updateSubmitLabel(){
  const btn = document.querySelector('#form button[type="submit"]');
  if (!btn) return;
  if (regiaoSel === "Todas") {
    btn.textContent = "Escolha uma região para cadastrar";
    btn.disabled = true;
  } else {
    btn.textContent = `Cadastrar promoção (${regiaoSel})`;
    btn.disabled = false;
  }
}
function updateFormRegionState(){
  const form = qs("#form");
  const alert = qs("#formBlocked");
  const logged = !!token;

  if (regiaoSel === "Todas") {
    if (form) form.style.display = "none";
    if (alert) alert.style.display = "block";
  } else {
    if (alert) alert.style.display = "none";
    if (form) form.style.display = logged ? "block" : "none";
  }
  updateSubmitLabel();
}

// ===== Auth/UI
function updateAuthUI(){
  const logged = !!token;
  qs("#authStatus").style.display = logged ? "inline-block" : "none";
  qs("#btnLogin").style.display  = logged ? "none" : "inline-block";
  qs("#btnLogout").style.display = logged ? "inline-block" : "none";

  const fReg = qs("#f_region");
  if (fReg) fReg.value = regiaoSel;

  updateFormRegionState();
  popularLojasFormulario();

  render(aplicarFiltrosRet());
  if (indicadoresVisiveis) renderIndicadoresPreco();
}

async function checkLogin(){
  if(!token) return false;
  try{
    const r = await fetch(`${API}/auth/check`, { headers:{ Authorization:`Bearer ${token}` } });
    const d = await r.json();
    if(!d.logged){ token=null; localStorage.removeItem("token"); }
    return d.logged;
  }catch{ token=null; localStorage.removeItem("token"); return false; }
}

// ===== KPIs
function calcularIndicadores(lista){
  const total=lista.length;
  const cats=["cesta_basica","hortifruti","limpeza","outras"];
  const porCat=Object.fromEntries(cats.map(c=>[c,0]));
  for(const p of lista){ porCat[p.category||"outras"]++; }
  return {total,porCat};
}
function renderStats(lista){
  const regList = filtrarRegiao(dadosOriginais, regiaoSel);
  const avgReg  = media(regList);

  const {total,porCat}=calcularIndicadores(lista);
  const blocos = [
    `<div class="kpi"><div class="label">Total</div><div class="value">${total}</div></div>`,
    `<div class="kpi"><div class="label">Cesta básica</div><div class="value">${porCat.cesta_basica||0}</div></div>`,
    `<div class="kpi"><div class="label">Hortifruti</div><div class="value">${porCat.hortifruti||0}</div></div>`,
    `<div class="kpi"><div class="label">Limpeza</div><div class="value">${porCat.limpeza||0}</div></div>`,
    `<div class="kpi"><div class="label">Outras</div><div class="value">${porCat.outras||0}</div></div>`,
    `<div class="kpi"><div class="label">Preço médio (região)</div><div class="value" style="color:#0a7a28;">${moeda(avgReg)}</div></div>`
  ];
  qs("#stats").innerHTML = `<div class="kpi-wrap">${blocos.join("")}</div>`;
}

// ===== Helpers de dados
function media(arr){ const v=arr.map(x=>+x.price).filter(Number.isFinite); return v.length ? v.reduce((a,b)=>a+b,0)/v.length : 0; }
function filtrarRegiao(lista, r){
  if (!r || r === "Todas") return [...lista];
  return lista.filter(p => (p.region||"").toLowerCase() === String(r).toLowerCase());
}
function porChave(lista, chave){
  const map = new Map();
  for(const p of lista){
    const k = (p[chave]||"").trim();
    if(!k) continue;
    if(!map.has(k)) map.set(k, []);
    map.get(k).push(p);
  }
  return map;
}
function topNBaratosPorCategoria(lista, n=3){
  const porCat = porChave(lista, "category");
  const out = {};
  for(const [cat, itens] of porCat.entries()){
    const ord = [...itens].filter(i=>Number.isFinite(+i.price)).sort((a,b)=>a.price-b.price).slice(0,n);
    out[cat] = ord;
  }
  return out;
}

// ===== Indicadores e Gráficos
function limparIndicadores(){
  ["cmpRegioes","cmpLojas","cmpCategorias","top3","stats"].forEach(id=>{
    const el = qs("#"+id); if(el) el.innerHTML = "";
  });
  destroyIf(chartRegioes); chartRegioes=null;
  destroyIf(chartLojas);   chartLojas=null;
  destroyIf(chartCategorias); chartCategorias=null;
}

/* ====== Top 3 + gráficos ====== */
function renderIndicadoresPreco(){
  const listaAtual = aplicarFiltrosRet();
  renderStats(listaAtual);

  const regList = filtrarRegiao(dadosOriginais, regiaoSel);

  // Top 3 (linhas)
  const top3 = topNBaratosPorCategoria(regList, 3);
  const ordem = ["cesta_basica","hortifruti","limpeza","outras"];
  qs("#top3").innerHTML = ordem.map(cat=>{
    const itens = top3[cat]||[];
    const header = `
      <div class="t3section">
        <div class="t3head">${leg[cat]}</div>
        <div class="t3hdr"><div>#</div><div>Produto</div><div class="t3price">Preço</div></div>`;
    const rows = itens.map((p,i)=>`
      <div class="t3row" title="${(p.product+' ('+p.store+')').replace(/"/g,'&quot;')}">
        <div class="t3rank">${i+1}º</div>
        <div class="t3prod">
          <div class="t3prod-name">${p.product}</div>
          <div class="t3store">(${p.store}${p.brand ? " • " + p.brand : ""})</div>
        </div>
        <div class="t3price">${moeda(p.price)}</div>
      </div>`).join("") || `
      <div class="t3row empty"><div class="t3rank">-</div><div class="t3prod small">Sem dados</div><div class="t3price">-</div></div>`;
    return `${header}${rows}</div>`;
  }).join("");

  // Tabelas comparativas
  // a) Região
  const porReg = porChave(dadosOriginais, "region");
  const regLabels = [], regData = [];
  Array.from(porReg.entries()).forEach(([reg, arr])=>{
    regLabels.push(reg); regData.push(media(arr));
  });
  qs("#cmpRegioes").innerHTML =
    `<table class="table"><thead><tr><th>Região</th><th class="price">Média</th></tr></thead><tbody>${
      regLabels.map((r,i)=>`<tr><td>${r}</td><td class="price">${moeda(regData[i])}</td></tr>`).join("")
    }</tbody></table>`;

  // b) Lojas (na região)
  const porLoja = porChave(regList, "store");
  const lojaLabels = [], lojaData = [];
  Array.from(porLoja.entries()).forEach(([loja, arr])=>{
    lojaLabels.push(loja); lojaData.push(media(arr));
  });
  qs("#cmpLojas").innerHTML =
    (lojaLabels.length
      ? `<table class="table"><thead><tr><th>Loja</th><th class="price">Média</th></tr></thead><tbody>${
          lojaLabels.map((l,i)=>`<tr><td>${l}</td><td class="price">${moeda(lojaData[i])}</td></tr>`).join("")
        }</tbody></table>`
      : `<table class="table"><tbody><tr><td class="small" colspan="2">Sem lojas para ${regiaoSel}</td></tr></tbody></table>`
    );

  // c) Categoria (na região)
  const porCat = porChave(regList, "category");
  const catLabels = [], catData = [];
  ["cesta_basica","hortifruti","limpeza","outras"].forEach(cat=>{
    const arr = porCat.get(cat)||[];
    catLabels.push(leg[cat]); catData.push(media(arr));
  });
  qs("#cmpCategorias").innerHTML =
    `<table class="table"><thead><tr><th>Categoria</th><th class="price">Média</th></tr></thead><tbody>${
      catLabels.map((c,i)=>`<tr><td>${c}</td><td class="price">${moeda(catData[i])}</td></tr>`).join("")
    }</tbody></table>`;

  // Gráficos
  // 1) Preço Médio por Região -> LINHA
  drawLineSimple('chartRegioes', regLabels, regData, (ref)=>chartRegioes=ref, chartRegioes);

  // 2) Preço Médio por Loja -> BARRA
  drawBars('chartLojas', lojaLabels, lojaData, (ref)=>chartLojas=ref, chartLojas, true);

  // 3) Preço Médio por Categoria -> PIZZA
  drawPie('chartCategorias', catLabels, catData, (ref)=>chartCategorias=ref, chartCategorias);
}

// ==== Chart helpers
function drawBars(canvasId, labels, data, setRef, prev, rotateX=false){
  destroyIf(prev);
  const el = document.getElementById(canvasId); if(!el) return;
  const ctx = el.getContext('2d');
  const inst = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data, borderWidth: 1 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) } },
        x: { ticks: rotateX ? { maxRotation: 60, minRotation: 30 } : {} }
      },
      plugins: { legend: { display:false }, tooltip: { callbacks: { label: ctx => moeda(ctx.raw) } } }
    }
  });
  setRef(inst);
}
function drawPie(canvasId, labels, data, setRef, prev){
  destroyIf(prev);
  const el = document.getElementById(canvasId); if(!el) return;
  const ctx = el.getContext('2d');
  const inst = new Chart(ctx, {
    type: 'pie',
    data: { labels, datasets: [{ data }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position:'bottom' },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${moeda(ctx.raw)}` } }
      }
    }
  });
  setRef(inst);
}

// LINHA SIMPLES
function drawLineSimple(canvasId, labels, data, setRef, prev){
  destroyIf(prev);
  const el = document.getElementById(canvasId); if(!el) return;
  const ctx = el.getContext('2d');

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Preço médio',
        data,
        tension: 0.35,
        pointRadius: 3,
        borderWidth: 2,
        fill: false,
        borderColor: '#ef4444',
        pointBackgroundColor: '#ef4444'
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) } },
        x: { ticks: { autoSkip:false, maxRotation: 45, minRotation: 0 } }
      },
      plugins: {
        legend: { display: true },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ (ctx.parsed.y||0).toLocaleString('pt-BR',{style:'currency','currency':'BRL'}) }` } }
      }
    }
  });
  setRef(chart);
}

// ===== Lojas dinâmicas
function lojasDaRegiao(region) {
  const set = new Set();
  const r = String(region || "").toLowerCase();
  if (!r || r === "todas") {
    for (const p of dadosOriginais) if (p.store) set.add(p.store);
  } else {
    for (const p of dadosOriginais) {
      if ((p.region||"").toLowerCase() === r && p.store) set.add(p.store);
    }
  }
  return Array.from(set).sort((a,b)=>a.localeCompare(b,'pt-BR',{sensitivity:'base'}));
}

// Para edição inline mantém select
function optionsLojasHTML(region, current=null) {
  const lojas = lojasDaRegiao(region);
  if (current && !lojas.includes(current)) lojas.unshift(current);
  return ['<option value="">Loja * (selecione)</option>']
    .concat(lojas.map(l=>`<option value="${l.replace(/"/g,'&quot;')}" ${current===l?'selected':''}>${l}</option>`))
    .join("");
}

// NOVO: popular datalist do formulário de cadastro
function popularLojasFormulario() {
  const dataList = document.getElementById('d_lojas'); // <datalist>
  if (!dataList) return;
  const lojas = lojasDaRegiao(regiaoSel);
  dataList.innerHTML = lojas.map(l => `<option value="${l.replace(/"/g,'&quot;')}">`).join("");
}

function popularLojasEdicao() {
  document.querySelectorAll('select.edit-store').forEach(sel=>{
    const region = sel.getAttribute('data-region') || regiaoSel;
    const current = sel.getAttribute('data-current') || sel.value || "";
    sel.innerHTML = optionsLojasHTML(region, current);
  });
}

// ===== Ordenação/Filtros/Render
function ordenar(lista, modo){
  const arr = [...lista];
  switch(modo){
    case "preco_desc": return arr.sort((a,b)=> (b.price??0)-(a.price??0));
    case "loja_az":    return arr.sort((a,b)=> (a.store||"").localeCompare(b.store||"", "pt-BR",{sensitivity:"base"}));
    case "loja_za":    return arr.sort((a,b)=> (b.store||"").localeCompare(a.store||"", "pt-BR",{sensitivity:"base"}));
    default:           return arr.sort((a,b)=> (a.price??0)-(b.price??0));
  }
}
function aplicarFiltrosRet(){
  const q = (qs("#busca").value||"").trim().toLowerCase();
  const cat = qs("#categoria").value;
  let lista = filtrarRegiao(dadosOriginais, regiaoSel);
  if(q)   lista = lista.filter(p => (p.product||"").toLowerCase().includes(q) || (p.store||"").toLowerCase().includes(q));
  if(cat) lista = lista.filter(p => p.category===cat);
  return lista;
}
function aplicarFiltros(){ paginaAtual=1; render(aplicarFiltrosRet()); }

// ===== CRUD protegido
async function excluir(id){
  if(!token) return alert("Entre para excluir.");
  if(!confirm("Tem certeza que deseja excluir esta promoção?")) return;
  const r=await fetch(`${API}/promotions/${id}`,{method:"DELETE", headers:{Authorization:`Bearer ${token}`}} );
  const d=await r.json();
  if(!r.ok) return alert(d.error||"Erro ao excluir");
  await carregar();
}
function startEditById(id){
  if(!token) return alert("Entre para editar.");
  if (regiaoSel === "Todas") return alert("Selecione uma região específica para editar.");
  editingId=id; render(aplicarFiltrosRet()); popularLojasEdicao();
}
function cancelEdit(){ editingId=null; render(aplicarFiltrosRet()); }
async function saveEdit(id){
  if(!token) return alert("Entre para salvar.");
  const box = document.getElementById(`edit-${id}`); if(!box) return;
  const get = (n) => box.querySelector(`[name="${n}"]`);
  const body = {
    product:  get("product").value.trim(),
    brand:    get("brand").value.trim() || null,
    store:    get("store").value,
    price:    Number(get("price").value.replace(",", ".")),
    unit:     get("unit").value.trim(),
    category: get("category").value,
    region:   regiaoSel
  };
  if(!body.product||!body.store||!body.unit||!body.category||Number.isNaN(body.price))
    return alert("Preencha os campos obrigatórios.");
  const r = await fetch(`${API}/promotions/${id}`, {
    method:"PUT", headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" }, body:JSON.stringify(body)
  });
  const d = await r.json();
  if(!r.ok) return alert(d.error||"Erro ao salvar edição");
  editingId=null; await carregar();
}

function render(lista){
  const el=qs("#lista"), vazio=qs("#vazio");
  const modo=qs("#ordenacao").value;
  const ordenado=ordenar(lista,modo);

  const totalPaginas=Math.ceil(ordenado.length/itensPorPagina) || 1;
  if(paginaAtual>totalPaginas) paginaAtual=totalPaginas;
  const inicio=(paginaAtual-1)*itensPorPagina;
  const visiveis=ordenado.slice(inicio,inicio+itensPorPagina);

  qs("#pageInfo").textContent=`Página ${paginaAtual} de ${totalPaginas}`;
  qs("#prevPage").disabled=paginaAtual<=1;
  qs("#nextPage").disabled=paginaAtual>=totalPaginas;

  if(!visiveis.length){ el.innerHTML=""; vazio.style.display="block"; return; }
  vazio.style.display="none";

  const logged = !!token;

  el.innerHTML = visiveis.map((p,i)=>{
    const normal = `
      <div class="title">${p.product}</div>
      <div class="price">${moeda(p.price)} / ${p.unit}</div>
      <div class="sub">${p.store}${p.brand ? " • " + p.brand : ""}</div>
      <div class="sub">Categoria: ${(leg[p.category] || p.category)} • ${p.region || regiaoSel}</div>
      ${i===0 && modo==="preco_asc" ? '<div style="color:#0a7a28;font-weight:bold;">✅ Mais barato (página)</div>' : ""}
      ${logged && regiaoSel!=="Todas" ? `
        <div class="actions">
          <button class="btn edit" onclick="startEditById(${p.id})">Editar</button>
          <button class="btn delete" onclick="excluir(${p.id})">Excluir</button>
        </div>` : ""}`;

    const edit = `
      <div id="edit-${p.id}" class="editbox">
        <div class="row">
          <input name="product"  value="${p.product||""}" placeholder="Produto *" aria-label="Produto">
          <input name="brand"    value="${p.brand||""}"   placeholder="Marca" aria-label="Marca">
          <select name="store" class="edit-store" data-region="${p.region || regiaoSel}" data-current="${(p.store||"").replace(/"/g,'&quot;')}" aria-label="Loja">
            ${optionsLojasHTML(p.region || regiaoSel, p.store || null)}
          </select>
          <input name="price"    value="${p.price}"       placeholder="Preço *" aria-label="Preço">
          <input name="unit"     value="${p.unit||""}"    placeholder="Unidade *" aria-label="Unidade">
          <select name="category" aria-label="Categoria">
            <option value="cesta_basica" ${p.category==='cesta_basica'?'selected':''}>Cesta básica</option>
            <option value="hortifruti"   ${p.category==='hortifruti'?'selected':''}>Hortifruti</option>
            <option value="limpeza"      ${p.category==='limpeza'?'selected':''}>Limpeza</option>
            <option value="outras"       ${p.category==='outras'?'selected':''}>Outras</option>
          </select>
          <input value="${p.region || regiaoSel}" disabled aria-label="Região" />
        </div>
        <div class="actions" style="margin-top:10px;">
          <button class="btn edit" onclick="saveEdit(${p.id})">Salvar</button>
          <button class="btn" onclick="cancelEdit()">Cancelar</button>
        </div>
      </div>`;

    return `<div class="card">${editingId===p.id ? edit : normal}</div>`;
  }).join("");

  popularLojasEdicao();
  if (indicadoresVisiveis) renderIndicadoresPreco();
}

// ===== Carregar
async function carregar(){
  const r=await fetch(`${API}/promotions`);
  dadosOriginais=await r.json();
  popularLojasFormulario();
  aplicarFiltros();
  if (indicadoresVisiveis) renderIndicadoresPreco();
}

// ===== Login modal
function openLogin(){
  lastFocusedBeforeModal = document.activeElement;
  const modalBg = qs("#loginModal");
  modalBg.style.display="flex";
  modalBg.setAttribute("aria-hidden","false");
  const first = qs("#loginUser");
  setTimeout(()=> first && first.focus(), 0);
  enableFocusTrap();
}
function closeLogin(){
  const modalBg = qs("#loginModal");
  modalBg.style.display="none";
  modalBg.setAttribute("aria-hidden","true");
  disableFocusTrap();
  if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === "function") {
    lastFocusedBeforeModal.focus();
  }
}
async function doLogin(){
  const username = qs("#loginUser").value.trim();
  const password = qs("#loginPass").value.trim();
  try{
    const r = await fetch(`${API}/auth/login`, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ username, password }) });
    const d = await r.json();
    if(!r.ok) return alert(d.error || "Falha no login");
    token = d.token; localStorage.setItem("token", token);
    closeLogin(); updateAuthUI(); await carregar();
  }catch{ alert("Erro no login"); }
}
async function doLogout(){
  try{ await fetch(`${API}/auth/logout`, { method:"POST", headers: token ? { Authorization:`Bearer ${token}` } : {} }); }catch{}
  token=null; localStorage.removeItem("token"); updateAuthUI(); await carregar();
}

// ===== Focus trap no modal e tecla Esc
function handleKeydown(e){
  const modalBg = qs("#loginModal");
  const isOpen = modalBg && modalBg.style.display === "flex";
  if (!isOpen) return;
  if (e.key === "Escape") {
    e.preventDefault();
    closeLogin();
    return;
  }
  if (e.key === "Tab") {
    const focusables = modalBg.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const list = Array.from(focusables).filter(el=>!el.disabled && el.offsetParent !== null);
    if (!list.length) return;
    const first = list[0];
    const last  = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }
}
function enableFocusTrap(){ document.addEventListener("keydown", handleKeydown); }
function disableFocusTrap(){ document.removeEventListener("keydown", handleKeydown); }

// ===== Listeners
document.addEventListener("DOMContentLoaded", async ()=>{
  const sel = qs("#regiaoSel");
  if (sel) {
    sel.value = regiaoSel;
    sel.addEventListener("change", (e)=>{
      regiaoSel = e.target.value;
      localStorage.setItem("regiaoCTB", regiaoSel);
      const fReg = qs("#f_region"); if (fReg) fReg.value = regiaoSel;
      updateFormRegionState();
      popularLojasFormulario();
      aplicarFiltros();
      if (indicadoresVisiveis) renderIndicadoresPreco();
    });
  }

  // Toggle indicadores com aria-expanded
  qs("#btnToggleIndicadores").addEventListener("click", ()=>{
    indicadoresVisiveis = !indicadoresVisiveis;
    const wrap = qs("#indicadoresWrap");
    const btn  = qs("#btnToggleIndicadores");
    if (indicadoresVisiveis){
      wrap.style.display = "block";
      btn.textContent = "📊 Ocultar Indicadores";
      btn.setAttribute("aria-expanded","true");
      renderIndicadoresPreco();
    } else {
      wrap.style.display = "none";
      btn.textContent = "📊 Mostrar Indicadores";
      btn.setAttribute("aria-expanded","false");
      limparIndicadores();
    }
  });

  await checkLogin();
  updateAuthUI();
  await carregar();

  const fRegBoot = qs("#f_region"); if (fRegBoot) fRegBoot.value = regiaoSel;
  updateSubmitLabel();

  // Cadastro
  qs("#form").addEventListener("submit", async (e)=>{
    e.preventDefault();
    if (regiaoSel === "Todas") return alert("Escolha uma região específica para cadastrar.");
    if(!token) return alert("Entre para cadastrar.");
    const body={
      product:  f_product.value.trim(),
      brand:    f_brand.value.trim()||null,
      store:    f_store.value, // agora é input com datalist
      price:    Number(f_price.value.replace(",", ".")),
      unit:     f_unit.value.trim(),
      category: f_category.value,
      region:   regiaoSel
    };
    if(!body.product||!body.store||!body.unit||!body.category||Number.isNaN(body.price))
      return alert("Preencha os campos obrigatórios.");
    const r=await fetch(`${API}/promotions`,{method:"POST",headers:authedHeaders(),body:JSON.stringify(body)});
    const d=await r.json();
    if(!r.ok) return alert(d.error||"Erro ao salvar");
    alert("Promoção cadastrada com sucesso!");
    e.target.reset();
    updateSubmitLabel();
    await carregar();
  });

  // Filtros/paginação
  qs("#ordenacao").addEventListener("change", aplicarFiltros);
  qs("#categoria").addEventListener("change", aplicarFiltros);
  qs("#busca").addEventListener("input", aplicarFiltros);
  qs("#prevPage").addEventListener("click", ()=>{ paginaAtual--; render(aplicarFiltrosRet()); });
  qs("#nextPage").addEventListener("click", ()=>{ paginaAtual++; render(aplicarFiltrosRet()); });

  // Login UI
  qs("#btnLogin").addEventListener("click", openLogin);
  qs("#btnLogout").addEventListener("click", doLogout);
  qs("#doLogin").addEventListener("click", doLogin);
  qs("#cancelLogin").addEventListener("click", closeLogin);
  qs("#loginModal").addEventListener("click", (e)=>{ if(e.target.id==="loginModal") closeLogin(); });
});
