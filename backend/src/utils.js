// ===== Funções utilitárias do projeto Comparou Tá Barato =====
// Este arquivo serve para rodar testes unitários (Vitest).

function media(arr) {
  const v = arr.map(x => +x.price).filter(Number.isFinite);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

function filtrarRegiao(lista, r) {
  if (!r || r === "Todas") return [...lista];
  return lista.filter(p => (p.region || "").toLowerCase() === String(r).toLowerCase());
}

function porChave(lista, chave) {
  const map = new Map();
  for (const p of lista) {
    const k = (p[chave] || "").trim();
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(p);
  }
  return map;
}

function ordenar(lista, modo) {
  const arr = [...lista];
  switch (modo) {
    case "preco_desc":
      return arr.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
    case "loja_az":
      return arr.sort((a, b) =>
        (a.store || "").localeCompare(b.store || "", "pt-BR", { sensitivity: "base" })
      );
    case "loja_za":
      return arr.sort((a, b) =>
        (b.store || "").localeCompare(a.store || "", "pt-BR", { sensitivity: "base" })
      );
    default:
      return arr.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  }
}

function topNBaratosPorCategoria(lista, n = 3) {
  const mapa = new Map();
  for (const p of lista) {
    const cat = (p.category || "").trim();
    if (!cat) continue;
    if (!mapa.has(cat)) mapa.set(cat, []);
    mapa.get(cat).push(p);
  }
  const out = {};
  for (const [cat, itens] of mapa.entries()) {
    const ord = itens
      .filter(i => Number.isFinite(+i.price))
      .sort((a, b) => a.price - b.price)
      .slice(0, n);
    out[cat] = ord;
  }
  return out;
}

function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
  const coords = [lat1, lon1, lat2, lon2].map(Number);
  if (coords.some(v => !Number.isFinite(v))) return null;

  const [aLat, aLon, bLat, bLon] = coords;
  const R = 6371;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLon = (bLon - aLon) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function resumirIot(readings = []) {
  const total = readings.length;
  const critical = readings.filter(r => r.status === "critical").length;
  const attention = readings.filter(r => r.status === "attention").length;
  const ok = readings.filter(r => r.status === "ok").length;
  const avgQueue = total
    ? readings.reduce((sum, r) => sum + (Number(r.queueMinutes) || 0), 0) / total
    : 0;

  return { total, ok, attention, critical, avgQueue };
}

module.exports = {
  media,
  filtrarRegiao,
  porChave,
  ordenar,
  topNBaratosPorCategoria,
  calcularDistanciaKm,
  resumirIot
};
