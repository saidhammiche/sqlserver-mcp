// ==================== ACCÈS SQL SERVER (pour l'interface web) ====================
// Lecture seule : toutes les requêtes passent par une transaction annulée.
// Utilisé par web-server.js (Dashboard + KI-Assistent).

import sql from "mssql";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

// ---------- .env (à côté de ce fichier) ----------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const env  = (k, d) => (process.env[k] ?? d);
const bool = (v) => ["1", "true", "yes", "oui", "ja"].includes(String(v).toLowerCase());

export const MAX_ROWS_READ = parseInt(env("MAX_ROWS_READ", "200"), 10);

const CONFIG = {
  server:   env("DB_SERVER", "localhost"),
  port:     parseInt(env("DB_PORT", "1433"), 10),
  database: env("DB_DATABASE"),
  user:     env("DB_USER"),
  password: env("DB_PASSWORD"),
  options: {
    encrypt:                bool(env("DB_ENCRYPT", "true")),
    trustServerCertificate: bool(env("DB_TRUST_CERT", "true")),
  },
  pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
  requestTimeout: 30000,
};
export const DB_INFO = `${CONFIG.server}:${CONFIG.port}/${CONFIG.database}`;

// ---------- Connexion ----------
let poolPromise = null;
export function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(CONFIG).connect().catch(err => {
      poolPromise = null;
      throw new Error(`Keine Verbindung zum SQL Server (${DB_INFO}): ${err.message}`);
    });
  }
  return poolPromise;
}

// ---------- Vérification des requêtes (SELECT uniquement) ----------
function stripForAnalysis(query) {
  return query
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:''|[^'])*'/g, "''")
    .trim();
}
const FORBIDDEN = /\b(DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|DENY|EXEC|EXECUTE|BACKUP|RESTORE|SHUTDOWN|DBCC|OPENROWSET|OPENDATASOURCE|OPENQUERY|BULK|RECONFIGURE|USE|xp_\w+|sp_\w+)\b/i;
const WRITE     = /\b(INSERT|UPDATE|DELETE|MERGE|INTO)\b/i;

export function validateRead(query) {
  const clean = stripForAnalysis(String(query)).replace(/;\s*$/, "");
  if (clean.includes(";"))               throw new Error("Nur eine Abfrage auf einmal erlaubt.");
  if (!/^(SELECT|WITH)\b/i.test(clean))  throw new Error("Nur SELECT-Abfragen sind erlaubt.");
  if (FORBIDDEN.test(clean))             throw new Error(`Unzulässiges Schlüsselwort: ${clean.match(FORBIDDEN)[0]}`);
  if (WRITE.test(clean))                 throw new Error(`Änderungen sind nicht erlaubt: ${clean.match(WRITE)[0]}`);
}

// Exécute un SELECT dans une transaction toujours annulée
export async function runRead(query) {
  validateRead(query);
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const r = await new sql.Request(tx).query(query);
    const rows = r.recordset ?? [];
    return {
      zeilen_gesamt: rows.length,
      gekuerzt: rows.length > MAX_ROWS_READ,
      ergebnis: rows.slice(0, MAX_ROWS_READ)
    };
  } finally {
    await tx.rollback().catch(() => {});
  }
}

// ---------- Métadonnées ----------
export async function listTables() {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT t.TABLE_SCHEMA AS [schema], t.TABLE_NAME AS [tabelle], t.TABLE_TYPE AS [typ],
           SUM(p.rows) AS zeilen_ca
    FROM INFORMATION_SCHEMA.TABLES t
    LEFT JOIN sys.objects o ON o.name = t.TABLE_NAME AND SCHEMA_NAME(o.schema_id) = t.TABLE_SCHEMA
    LEFT JOIN sys.partitions p ON p.object_id = o.object_id AND p.index_id IN (0, 1)
    GROUP BY t.TABLE_SCHEMA, t.TABLE_NAME, t.TABLE_TYPE
    ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME`);
  return r.recordset;
}

export async function describeTable(name) {
  const parts = String(name).replace(/[\[\]]/g, "").split(".");
  if (parts.length > 2 || !parts.every(p => /^[A-Za-z_][A-Za-z0-9_ ]*$/.test(p))) {
    throw new Error(`Ungültiger Tabellenname: ${name}`);
  }
  const [schema, table] = parts.length === 2 ? parts : ["dbo", parts[0]];
  const pool = await getPool();
  const r = await pool.request()
    .input("schema", sql.NVarChar, schema)
    .input("table", sql.NVarChar, table)
    .query(`
      SELECT COLUMN_NAME AS spalte, DATA_TYPE AS typ, CHARACTER_MAXIMUM_LENGTH AS laenge, IS_NULLABLE AS nullable
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
      ORDER BY ORDINAL_POSITION`);
  if (!r.recordset.length) throw new Error(`Tabelle nicht gefunden: ${schema}.${table}`);
  return { tabelle: `${schema}.${table}`, spalten: r.recordset };
}

// ---------- Aperçu générique d'une table (page « Tabellen ») ----------
// Le nom est d'abord vérifié dans INFORMATION_SCHEMA : seules des tables
// existantes peuvent être lues (pas d'injection possible par le nom).
export async function tabellenVorschau(name, limit = 200) {
  const parts = String(name).replace(/[\[\]]/g, "").split(".");
  const [schema, table] = parts.length === 2 ? parts : ["dbo", parts[0]];
  const pool = await getPool();
  const check = await pool.request()
    .input("schema", sql.NVarChar, schema)
    .input("table", sql.NVarChar, table)
    .query(`SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table`);
  if (!check.recordset.length) throw new Error(`Tabelle nicht gefunden: ${schema}.${table}`);

  const q = (s) => `[${s.replace(/]/g, "]]")}]`;
  const n = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
  const struktur = await describeTable(`${schema}.${table}`);

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const r = await new sql.Request(tx).query(`SELECT TOP (${n}) * FROM ${q(schema)}.${q(table)} ORDER BY 1 DESC`);
    const anzahl = await new sql.Request(tx).query(`SELECT COUNT_BIG(*) AS n FROM ${q(schema)}.${q(table)}`);
    return { ...struktur, zeilen_gesamt: Number(anzahl.recordset[0].n), zeilen: r.recordset };
  } finally {
    await tx.rollback().catch(() => {});
  }
}

// ---------- Energie (dbo.SEUWerte) ----------
export async function getSEU(jahr) {
  const pool = await getPool();
  const r = await pool.request()
    .input("jahr", sql.Int, jahr)
    .query(`
      SELECT Jahr, Monat, Manatname AS Monatname,
             P1_Verbrauch, P2_Verbrauch, UB_Verbrauch, ME_Verbrauch,
             P1_Verarbeitung, P2_Verarbeitung, UB_Verarbeitung, Gesamtmenge,
             ME_Stunden, P1_Wert, P2_Wert, UB_Wert,
             ME_ProTonne, ME_ProStunde, ME_ProTonneGesamtmenge, ME_Wert
      FROM dbo.SEUWerte
      WHERE Jahr IN (@jahr, @jahr - 1)
      ORDER BY Jahr, Monat`);
  // decimal → Zahl
  const rows = r.recordset.map(z => Object.fromEntries(Object.entries(z).map(([k, v]) =>
    [k, typeof v === "string" && k !== "Monatname" && v !== "" && !isNaN(v) ? Number(v) : v])));
  return { jahr, aktuell: rows.filter(x => x.Jahr === jahr), vorjahr: rows.filter(x => x.Jahr === jahr - 1) };
}

// ---------- Données du dashboard (ProduktionMonat) ----------
export async function getJahre() {
  const pool = await getPool();
  const r = await pool.request().query(
    `SELECT DISTINCT Jahr FROM dbo.ProduktionMonat WHERE Jahr IS NOT NULL ORDER BY Jahr DESC`);
  return r.recordset.map(x => x.Jahr);
}

export async function getProduktion(jahr) {
  const pool = await getPool();
  const r = await pool.request()
    .input("jahr", sql.Int, jahr)
    .query(`
      SELECT Jahr, Monat, Monatname, Arbeitstage,
             [Durchsatz Presse I]          AS presse1,
             [Durchsatz Presse II]         AS presse2,
             [Input UBC-Aufbereitung]      AS ubc,
             [Material verarbeitet gesamt] AS gesamt,
             [Menge Bewegungen Abschaum]   AS abschaum
      FROM dbo.ProduktionMonat
      WHERE Jahr IN (@jahr, @jahr - 1)
      ORDER BY Jahr, Monat`);
  return {
    jahr,
    aktuell: r.recordset.filter(x => x.Jahr === jahr),
    vorjahr: r.recordset.filter(x => x.Jahr === jahr - 1)
  };
}
