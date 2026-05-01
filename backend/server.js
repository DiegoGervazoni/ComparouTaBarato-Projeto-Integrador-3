/* server.js – Backend Comparou Tá Barato
   Stack: Node + Express + PostgreSQL
   Executa no Render com PORT e DATABASE_URL
*/

// Carrega variáveis de ambiente localmente (ignorado no Render)
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");
const { calcularDistanciaKm, resumirIot, promotionIdentityKey } = require("./src/utils");


// ===== Configurações de ambiente
const PORT = Number(process.env.PORT) || 8081;
const HOST = "0.0.0.0";
const IOT_DATA_PATH = path.join(__dirname, "data", "iot_readings.json");
const STORE_DATA_PATHS = [
  path.join(__dirname, "stores", "stores.json"),
  path.join(__dirname, "stores.json"),
];
const stores = readStores();

// Conexão PostgreSQL (Render fornece DATABASE_URL)
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.warn("DATABASE_URL não definida nas variáveis de ambiente. Rotas de banco ficarão indisponíveis.");
}

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : null;
let databaseReady = false;

// ===== Aplicação Express
const app = express();
app.use(cors());
app.use(express.json());

// ===== Login simples (admin)
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "1234";
const activeTokens = new Set();

function genToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ===== Rotas de autenticação
app.post("/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = genToken();
    activeTokens.add(token);
    return res.json({ ok: true, token });
  }
  return res.status(401).json({ ok: false, error: "Credenciais inválidas" });
});

app.post("/auth/logout", (req, res) => {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (token && activeTokens.has(token)) {
    activeTokens.delete(token);
  }
  res.json({ ok: true });
});

app.get("/auth/check", (req, res) => {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  res.json({ logged: token ? activeTokens.has(token) : false });
});

// ===== Middleware de autenticação
function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (token && activeTokens.has(token)) return next();
  return res.status(401).json({ error: "Não autorizado" });
}

// ===== Healthcheck (Render)
app.get("/healthz", async (req, res) => {
  try {
    if (!pool) return res.json({ ok: true, database: false });
    await pool.query("select 1");
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: true, database: false, error: e.message });
  }
});

// ===== Criação automática da tabela
// ===== Inicialização do banco e carga automática do CSV =====

async function ensureSchema() {
  const sql = [
    "create table if not exists promotions (",
    "  id serial primary key,",
    "  product text not null,",
    "  brand text,",
    "  store text,",
    "  price numeric(12,2) not null,",
    "  unit text,",
    "  category text,",
    "  region text,",
    "  updated_at timestamp not null default now()",
    ");",
    "create index if not exists idx_promotions_region on promotions(region);",
    "create index if not exists idx_promotions_product on promotions(product);"
  ].join("\n");

  await pool.query(sql);
  console.log("Estrutura da tabela garantida.");

  try {
    await syncPromotionsFromCsv();
  } catch (e) {
    console.error("Erro ao sincronizar CSV:", e.message);
  }
}

function parseCsvLine(line, delim) {
  const cols = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delim && !inQuotes) {
      cols.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }

  cols.push(current.trim());
  return cols;
}

function normalizeCsvCategory(s = "") {
  s = s.trim().toLowerCase();
  if (s.includes("cesta")) return "cesta_basica";
  if (s.includes("horti")) return "hortifruti";
  if (s.includes("limp")) return "limpeza";
  return "outras";
}

function normalizeCsvHeader(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function findCsvIndex(headers, ...cands) {
  const i = headers.findIndex(h => cands.some(c => h === c || h.includes(c)));
  return i === -1 ? null : i;
}

function promotionFromCsvLine(line, delim, indexes) {
  const cols = parseCsvLine(line, delim);
  const get = (i) => (i == null || i >= cols.length) ? "" : cols[i];

  const product = get(indexes.product);
  const brand = get(indexes.brand) || null;
  const store = get(indexes.store);
  const priceStr = get(indexes.price);
  const qtd = get(indexes.quantity);
  const unid = get(indexes.unit);
  const category = normalizeCsvCategory(get(indexes.category));
  const region = get(indexes.region) || null;
  const unit = [qtd, unid].filter(Boolean).join(" ").trim() || "un";
  const price = Number(String(priceStr).replace(",", "."));

  return { product, brand, store, price, unit, category, region };
}

async function syncPromotionsFromCsv() {
  const csvPath = path.join(__dirname, "produtos_utf8.csv");
  if (!fs.existsSync(csvPath)) {
    console.log("produtos_utf8.csv nao encontrado; pulando sincronizacao.");
    return;
  }

  const raw = fs.readFileSync(csvPath, "utf8");
  const nonEmpty = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l.length);
  const headerIdx = nonEmpty.findIndex(l => {
    const normalized = normalizeCsvHeader(l);
    return normalized.includes("produto") && normalized.includes("preco");
  });
  if (headerIdx === -1) {
    console.log("Nao encontrei cabecalho com colunas Produto e Preco. Verifique o CSV.");
    return;
  }

  const headerLine = nonEmpty[headerIdx];
  const dataLines = nonEmpty.slice(headerIdx + 1);
  const delim = headerLine.includes(";") ? ";" : ",";
  const headers = parseCsvLine(headerLine, delim).map(normalizeCsvHeader);
  const indexes = {
    product: findCsvIndex(headers, "produto"),
    brand: findCsvIndex(headers, "marca"),
    store: findCsvIndex(headers, "loja/supermercado", "loja", "supermercado"),
    price: findCsvIndex(headers, "preco"),
    quantity: findCsvIndex(headers, "quantidade", "qtd"),
    unit: findCsvIndex(headers, "unidade", "uni"),
    category: findCsvIndex(headers, "categoria"),
    region: findCsvIndex(headers, "regiao"),
  };

  const insertIfMissingSql = [
    "insert into promotions (product, brand, store, price, unit, category, region)",
    "select $1,$2,$3,$4,$5,$6,$7",
    "where not exists (",
    "  select 1 from promotions",
    "  where lower(trim(product)) = lower(trim($1::text))",
    "    and lower(trim(coalesce(brand, ''))) = lower(trim(coalesce($2::text, '')))",
    "    and lower(trim(coalesce(store, ''))) = lower(trim($3::text))",
    "    and lower(trim(coalesce(unit, ''))) = lower(trim($5::text))",
    "    and lower(trim(coalesce(category, ''))) = lower(trim($6::text))",
    "    and lower(trim(coalesce(region, ''))) = lower(trim(coalesce($7::text, '')))",
    ")"
  ].join("\n");

  let inserted = 0;
  let existing = 0;
  let skipped = 0;
  const seenCsvKeys = new Set();

  for (const line of dataLines) {
    const promotion = promotionFromCsvLine(line, delim, indexes);

    if (!promotion.product || !promotion.store || !Number.isFinite(promotion.price)) {
      skipped++;
      continue;
    }

    const csvKey = promotionIdentityKey(promotion);
    if (seenCsvKeys.has(csvKey)) {
      existing++;
      continue;
    }
    seenCsvKeys.add(csvKey);

    try {
      const { rowCount } = await pool.query(insertIfMissingSql, [
        promotion.product,
        promotion.brand,
        promotion.store,
        promotion.price,
        promotion.unit,
        promotion.category,
        promotion.region,
      ]);
      if (rowCount) inserted++;
      else existing++;
    } catch (e) {
      console.log("linha pulada por erro:", e.message);
      skipped++;
    }
  }

  console.log("CSV sincronizado. Inseridos: " + inserted + ", existentes: " + existing + ", puladas: " + skipped + ", total lidas: " + dataLines.length + ".");
}




// ===== Utilidades
function sanitizePromotion(p) {
  return {
    product: String(p.product || "").trim(),
    brand: p.brand ? String(p.brand).trim() : null,
    store: String(p.store || "").trim(),
    price: Number(p.price),
    unit: String(p.unit || "").trim(),
    category: String(p.category || "").trim(),
    region: String(p.region || "").trim(),
  };
}

function validPromotion(p) {
  return p.product && Number.isFinite(p.price);
}

function calcularDistancia(lat1, lon1, lat2, lon2) {
  return calcularDistanciaKm(lat1, lon1, lat2, lon2);
}

function readStores() {
  const filePath = STORE_DATA_PATHS.find((candidate) => fs.existsSync(candidate));
  if (!filePath) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readIotPayload() {
  if (!fs.existsSync(IOT_DATA_PATH)) {
    return {
      generatedAt: null,
      source: null,
      readings: [],
    };
  }

  const raw = fs.readFileSync(IOT_DATA_PATH, "utf8");
  const payload = JSON.parse(raw);
  return {
    generatedAt: payload.generatedAt || null,
    source: payload.source || null,
    readings: Array.isArray(payload.readings) ? payload.readings : [],
  };
}

function addDistance(reading, lat, lng) {
  const distanceKm = calcularDistancia(reading.lat, reading.lng, lat, lng);
  if (distanceKm == null) return reading;
  return {
    ...reading,
    distanceKm: Number(distanceKm.toFixed(2)),
  };
}

// ===== Rotas principais
// Listagem com filtros opcionais
app.get("/promotions", async (req, res) => {
  try {
    if (!databaseReady) {
      return res.json([]);
    }

    const { region, q } = req.query;

    const params = [];
    const whereParts = [
      "trim(product) <> ''",
      "trim(store) <> ''",
      "price is not null",
      "price > 0"
    ];

    if (region && region !== "Todas") {
      params.push(String(region).toLowerCase());
      whereParts.push(`lower(region) = $${params.length}`);
    }

    if (q && String(q).trim()) {
      params.push(`%${String(q).toLowerCase()}%`);
      // Busca em produto e marca (pode adicionar store se quiser)
      whereParts.push(`(
        lower(product) LIKE $${params.length}
        OR lower(COALESCE(brand,'')) LIKE $${params.length}
      )`);
      // alternativa usando ILIKE (sem lower):
      // params.push(`%${q}%`);
      // whereParts.push(`(product ILIKE $${params.length} OR COALESCE(brand,'') ILIKE $${params.length})`);
    }

    const sql = `
      SELECT
        id, product, brand, store, price::float8 AS price,
        unit, category, region, updated_at
      FROM promotions
      ${whereParts.length ? "WHERE " + whereParts.join(" AND ") : ""}
      ORDER BY updated_at DESC, id DESC
      LIMIT 500
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao listar promoções" });
  }
});

app.get("/stores/near", (req, res) => {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: "Latitude e longitude obrigatórias" });
    }

    const userLat = Number(lat);
    const userLng = Number(lng);

    if (!Number.isFinite(userLat) || !Number.isFinite(userLng)) {
      return res.status(400).json({ error: "Latitude ou longitude inválidas" });
    }

    const result = stores.map((store) => ({
      ...store,
      distance: calcularDistancia(userLat, userLng, store.lat, store.lng)
    }));

    result.sort((a, b) => a.distance - b.distance);

    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao buscar lojas próximas" });
  }
});

app.get("/iot/status", (req, res) => {
  try {
    const { lat, lng, region } = req.query;
    const hasCoords = lat != null && lng != null;
    const userLat = Number(lat);
    const userLng = Number(lng);

    if (hasCoords && (!Number.isFinite(userLat) || !Number.isFinite(userLng))) {
      return res.status(400).json({ error: "Latitude ou longitude inválidas" });
    }

    const payload = readIotPayload();
    let readings = payload.readings;

    if (region && region !== "Todas") {
      readings = readings.filter((item) =>
        String(item.region || "").toLowerCase() === String(region).toLowerCase()
      );
    }

    if (hasCoords) {
      readings = readings
        .map((item) => addDistance(item, userLat, userLng))
        .sort((a, b) => (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY));
    }

    res.json({
      generatedAt: payload.generatedAt,
      source: payload.source,
      summary: resumirIot(readings),
      readings,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao buscar status IoT" });
  }
});

// Criar
app.post("/promotions", auth, async (req, res) => {
  try {
    if (!databaseReady) return res.status(503).json({ error: "Banco de dados indisponível" });

    const p = sanitizePromotion(req.body || {});
    if (!validPromotion(p)) return res.status(400).json({ error: "Campos obrigatórios ausentes" });

    const sql = `
      insert into promotions (product, brand, store, price, unit, category, region)
      values ($1,$2,$3,$4,$5,$6,$7)
      returning id, product, brand, store, price::float8 as price, unit, category, region, updated_at
    `;
    const { rows } = await pool.query(sql, [
      p.product, p.brand, p.store, p.price, p.unit, p.category, p.region,
    ]);
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao criar promoção" });
  }
});

// Atualizar
app.put("/promotions/:id", auth, async (req, res) => {
  try {
    if (!databaseReady) return res.status(503).json({ error: "Banco de dados indisponível" });

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID inválido" });

    const p = sanitizePromotion(req.body || {});
    if (!validPromotion(p)) return res.status(400).json({ error: "Campos obrigatórios ausentes" });

    const sql = `
      update promotions
      set product=$1, brand=$2, store=$3, price=$4, unit=$5, category=$6, region=$7, updated_at=now()
      where id=$8
      returning id, product, brand, store, price::float8 as price, unit, category, region, updated_at
    `;
    const { rows } = await pool.query(sql, [
      p.product, p.brand, p.store, p.price, p.unit, p.category, p.region, id,
    ]);
    if (!rows.length) return res.status(404).json({ error: "Registro não encontrado" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao atualizar promoção" });
  }
});

// Deletar
app.delete("/promotions/:id", auth, async (req, res) => {
  try {
    if (!databaseReady) return res.status(503).json({ error: "Banco de dados indisponível" });

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID inválido" });

    const { rowCount } = await pool.query("delete from promotions where id=$1", [id]);
    if (!rowCount) return res.status(404).json({ error: "Registro não encontrado" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro ao remover promoção" });
  }
});

// ===== Servir o frontend estático
app.use(express.static(path.join(__dirname, "public")));

// ===== Iniciar servidor
(async () => {
  try {
    try {
      if (pool) {
        await ensureSchema();
        databaseReady = true;
      } else {
        databaseReady = false;
        console.warn("Banco de dados não configurado; iniciando apenas o frontend e rotas sem banco.");
      }
    } catch (e) {
      databaseReady = false;
      console.error("Banco de dados indisponível; iniciando apenas o frontend e rotas sem banco:", e.message);
    }

    app.listen(PORT, HOST, () => {
      console.log(`Servidor rodando em http://${HOST}:${PORT}`);
    });
  } catch (e) {
    console.error("Falha ao iniciar:", e);
    process.exit(1);
  }
})();
