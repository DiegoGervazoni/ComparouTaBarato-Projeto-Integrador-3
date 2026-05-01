import { describe, it, expect } from "vitest";
import utils from "../src/utils.js";

const {
  media,
  filtrarRegiao,
  porChave,
  ordenar,
  topNBaratosPorCategoria,
  calcularDistanciaKm,
  resumirIot
} = utils;

const dados = [
  { id: 1, product: "Arroz 5 kg", brand: "Tio João", store: "GoodBom", price: 24.90, unit: "un", category: "cesta_basica", region: "Itapira" },
  { id: 2, product: "Banana prata", brand: null,      store: "GoodBom", price: 4.99,  unit: "kg", category: "hortifruti",   region: "Itapira" },
  { id: 3, product: "Detergente",   brand: "Ypê",     store: "Sevan",   price: 2.99,  unit: "un", category: "limpeza",      region: "Campinas" },
  { id: 4, product: "Feijão 1 kg",  brand: "Kicaldo", store: "Sevan",   price: 8.50,  unit: "un", category: "cesta_basica", region: "Itapira" },
  { id: 5, product: "Sabão em pó",  brand: "OMO",     store: "Dia",     price: 29.90, unit: "un", category: "limpeza",      region: "Americana" },
  { id: 6, product: "Maçã",         brand: null,      store: "Dia",     price: 7.00,  unit: "kg", category: "hortifruti",   region: "Americana" }
];

describe("media", () => {
  it("calcula a média de preços corretamente", () => {
    const itapira = media(dados.filter(d => d.region === "Itapira"));
    expect(Number(itapira.toFixed(2))).toBe(12.80);
  });
  it("retorna 0 para lista vazia", () => {
    expect(media([])).toBe(0);
  });
});

describe("filtrarRegiao", () => {
  it("retorna todos quando região é Todas", () => {
    const r = filtrarRegiao(dados, "Todas");
    expect(r.length).toBe(dados.length);
  });
  it("filtra ignorando maiúsculas e minúsculas", () => {
    const r = filtrarRegiao(dados, "itapira");
    expect(r.every(x => x.region === "Itapira")).toBe(true);
  });
});

describe("porChave", () => {
  it("agrupa por loja", () => {
    const m = porChave(dados, "store");
    expect(m.has("GoodBom")).toBe(true);
    expect(m.get("GoodBom").length).toBe(2);
  });
  it("ignora valores vazios", () => {
    const m = porChave([{ store: "" }, { store: "Dia" }], "store");
    expect(m.has("")).toBe(false);
    expect(m.get("Dia").length).toBe(1);
  });
});

describe("ordenar", () => {
  it("ordena por preço ascendente", () => {
    const r = ordenar(dados, "preco_asc");
    expect(r[0].price <= r[1].price).toBe(true);
  });
  it("ordena por preço descendente", () => {
    const r = ordenar(dados, "preco_desc");
    expect(r[0].price >= r[1].price).toBe(true);
  });
  it("ordena lojas A Z e Z A", () => {
    const a = ordenar(dados, "loja_az").map(x => x.store);
    const z = ordenar(dados, "loja_za").map(x => x.store);
    expect(a[0]).toBe("Dia");
    expect(z[0]).toBe("Sevan");
  });
});

describe("topNBaratosPorCategoria", () => {
  it("retorna até N itens mais baratos por categoria", () => {
    const top = topNBaratosPorCategoria(dados, 2);
    expect(top["cesta_basica"].length).toBeLessThanOrEqual(2);
    expect(top["hortifruti"].length).toBeLessThanOrEqual(2);
    expect(top["limpeza"].length).toBeLessThanOrEqual(2);
  });
  it("itens de cada categoria estão ordenados por preço ascendente", () => {
    const top = topNBaratosPorCategoria(dados, 3);
    for (const cat of Object.keys(top)) {
      const arr = top[cat];
      for (let i = 1; i < arr.length; i++) {
        expect(arr[i - 1].price <= arr[i].price).toBe(true);
      }
    }
  });
});

describe("calcularDistanciaKm", () => {
  it("calcula distancia aproximada entre duas coordenadas", () => {
    const km = calcularDistanciaKm(-22.435, -46.823, -22.431, -46.822);
    expect(Number(km.toFixed(2))).toBeGreaterThan(0);
    expect(Number(km.toFixed(2))).toBeLessThan(1);
  });

  it("retorna null para coordenadas invalidas", () => {
    expect(calcularDistanciaKm("abc", -46.823, -22.431, -46.822)).toBe(null);
  });
});

describe("resumirIot", () => {
  it("resume leituras por status e fila media", () => {
    const summary = resumirIot([
      { status: "ok", queueMinutes: 2 },
      { status: "attention", queueMinutes: 8 },
      { status: "critical", queueMinutes: 12 },
    ]);

    expect(summary.total).toBe(3);
    expect(summary.ok).toBe(1);
    expect(summary.attention).toBe(1);
    expect(summary.critical).toBe(1);
    expect(Number(summary.avgQueue.toFixed(1))).toBe(7.3);
  });
});
