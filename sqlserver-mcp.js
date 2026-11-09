// ==================== SERVEUR MCP SQL SERVER ====================
// Permet à une IA (Claude Desktop, Claude Code…) de LIRE et MODIFIER une base
// SQL Server, avec des garde-fous :
//   - Lecture  : uniquement SELECT, exécuté dans une transaction annulée
//                (impossible de modifier quoi que ce soit par ce chemin).
//   - Écriture : INSERT / UPDATE / DELETE uniquement, jamais DROP/ALTER/…
//                UPDATE et DELETE doivent avoir un WHERE.
//                D'abord un APERÇU (annulé), puis exécution réelle seulement
//                avec confirmer = true. Nombre de lignes modifiables limité.
//
// ⚠️ Transport "stdio" : ne JAMAIS utiliser console.log() (ça casse le
//    protocole). Pour les logs : console.error().

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import sql from "mssql";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

// ---------- Lecture du fichier .env (à côté de ce script) ----------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const env = (k, d) => (process.env[k] ?? d);
const bool = (v) => ["1", "true", "yes", "oui"].includes(String(v).toLowerCase());

const CONFIG = {
  server:   env("DB_SERVER", "185.80.92.91"),
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

const ALLOW_WRITE       = bool(env("ALLOW_WRITE", "false"));
const MAX_ROWS_READ     = parseInt(env("MAX_ROWS_READ", "200"), 10);
const MAX_ROWS_MODIFIED = parseInt(env("MAX_ROWS_MODIFIED", "50"), 10);

// ---------- Connexion (créée au premier appel) ----------
let poolPromise = null;
function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(CONFIG).connect().catch(err => {
      poolPromise = null; // on réessaiera au prochain appel
      throw new Error(`Connexion SQL Server impossible (${CONFIG.server}:${CONFIG.port}/${CONFIG.database}) : ${err.message}`);
    });
  }
  return poolPromise;
}

// ---------- Vérification des requêtes ----------
// Retire commentaires et textes entre apostrophes avant d'analyser les mots-clés
function stripForAnalysis(query) {
  return query
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:''|[^'])*'/g, "''")
    .trim();
}

const FORBIDDEN_ALWAYS = /\b(DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|DENY|EXEC|EXECUTE|BACKUP|RESTORE|SHUTDOWN|DBCC|OPENROWSET|OPENDATASOURCE|OPENQUERY|BULK|RECONFIGURE|USE|xp_\w+|sp_\w+)\b/i;
const WRITE_WORDS      = /\b(INSERT|UPDATE|DELETE|MERGE|INTO)\b/i;

function checkSingleStatement(clean) {
  const withoutTrailing = clean.replace(/;\s*$/, "");
  if (withoutTrailing.includes(";")) throw new Error("Une seule requête à la fois (pas de « ; » au milieu).");
  return withoutTrailing;
}

function validateRead(query) {
  const clean = checkSingleStatement(stripForAnalysis(query));
  if (!/^(SELECT|WITH)\b/i.test(clean)) throw new Error("Seules les requêtes SELECT (ou WITH … SELECT) sont autorisées ici.");
  if (FORBIDDEN_ALWAYS.test(clean)) throw new Error(`Mot-clé interdit : ${clean.match(FORBIDDEN_ALWAYS)[0]}`);
  if (WRITE_WORDS.test(clean)) throw new Error(`Mot-clé de modification interdit en lecture : ${clean.match(WRITE_WORDS)[0]}`);
}

function validateWrite(query) {
  const clean = checkSingleStatement(stripForAnalysis(query));
  const m = clean.match(/^(INSERT|UPDATE|DELETE)\b/i);
  if (!m) throw new Error("Seules les requêtes INSERT, UPDATE ou DELETE sont autorisées ici.");
  if (FORBIDDEN_ALWAYS.test(clean)) throw new Error(`Mot-clé interdit : ${clean.match(FORBIDDEN_ALWAYS)[0]}`);
  // T-SQL accepte plusieurs ordres sans « ; » → un seul INSERT/UPDATE/DELETE/MERGE autorisé
  const writeCount = (clean.match(/\b(INSERT|UPDATE|DELETE|MERGE)\b/gi) || []).length;
  if (writeCount > 1) throw new Error("Une seule opération INSERT/UPDATE/DELETE à la fois.");
  const kind = m[1].toUpperCase();
  if ((kind === "UPDATE" || kind === "DELETE") && !/\bWHERE\b/i.test(clean)) {
    throw new Error(`${kind} sans WHERE refusé : précisez quelles lignes modifier.`);
  }
  return kind;
}

// ---------- Réponses pour l'IA ----------
const text = (obj) => ({
  content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }]
});
async function safe(fn) {
  try { return await fn(); }
  catch (err) { return { ...text(`Erreur : ${err.message}`), isError: true }; }
}

// Valide un nom "schema.table" ou "table" (évite l'injection dans les noms)
function parseTableName(name) {
  const parts = String(name).replace(/[\[\]]/g, "").split(".");
  if (parts.length > 2 || !parts.every(p => /^[A-Za-z_][A-Za-z0-9_ ]*$/.test(p))) {
    throw new Error(`Nom de table invalide : ${name}`);
  }
  return parts.length === 2 ? { schema: parts[0], table: parts[1] } : { schema: "dbo", table: parts[0] };
}

// ---------- Serveur MCP ----------
const server = new McpServer({ name: "sqlserver", version: "1.0.0" });

// 1) Liste des tables
server.registerTool(
  "lister_tables",
  {
    title: "Lister les tables",
    description: "Liste toutes les tables et vues de la base, avec leur schéma et un nombre approximatif de lignes. " +
                 "À utiliser en premier pour découvrir la base.",
    annotations: { readOnlyHint: true }
  },
  async () => safe(async () => {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT t.TABLE_SCHEMA AS [schema], t.TABLE_NAME AS [table], t.TABLE_TYPE AS [type],
             SUM(p.rows) AS lignes_approx
      FROM INFORMATION_SCHEMA.TABLES t
      LEFT JOIN sys.objects o ON o.name = t.TABLE_NAME AND SCHEMA_NAME(o.schema_id) = t.TABLE_SCHEMA
      LEFT JOIN sys.partitions p ON p.object_id = o.object_id AND p.index_id IN (0, 1)
      GROUP BY t.TABLE_SCHEMA, t.TABLE_NAME, t.TABLE_TYPE
      ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME`);
    return text({ base: CONFIG.database, tables: r.recordset });
  })
);

// 2) Structure d'une table
server.registerTool(
  "decrire_table",
  {
    title: "Décrire une table",
    description: "Donne les colonnes d'une table (nom, type, NULL autorisé, clé primaire, clés étrangères). " +
                 "À utiliser avant d'écrire une requête sur cette table.",
    inputSchema: { table: z.string().describe("Nom de la table, ex. \"Clients\" ou \"dbo.Clients\"") },
    annotations: { readOnlyHint: true }
  },
  async ({ table }) => safe(async () => {
    const { schema, table: name } = parseTableName(table);
    const pool = await getPool();
    const cols = await pool.request()
      .input("schema", sql.NVarChar, schema)
      .input("table", sql.NVarChar, name)
      .query(`
        SELECT c.COLUMN_NAME AS colonne, c.DATA_TYPE AS type, c.CHARACTER_MAXIMUM_LENGTH AS longueur,
               c.IS_NULLABLE AS nullable, c.COLUMN_DEFAULT AS defaut,
               CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS cle_primaire
        FROM INFORMATION_SCHEMA.COLUMNS c
        LEFT JOIN (
          SELECT ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME
          FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
          JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
          WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        ) pk ON pk.TABLE_SCHEMA = c.TABLE_SCHEMA AND pk.TABLE_NAME = c.TABLE_NAME AND pk.COLUMN_NAME = c.COLUMN_NAME
        WHERE c.TABLE_SCHEMA = @schema AND c.TABLE_NAME = @table
        ORDER BY c.ORDINAL_POSITION`);
    if (!cols.recordset.length) throw new Error(`Table introuvable : ${schema}.${name}`);

    const fks = await pool.request()
      .input("schema", sql.NVarChar, schema)
      .input("table", sql.NVarChar, name)
      .query(`
        SELECT COL_NAME(fc.parent_object_id, fc.parent_column_id) AS colonne,
               OBJECT_SCHEMA_NAME(fc.referenced_object_id) + '.' + OBJECT_NAME(fc.referenced_object_id) AS table_liee,
               COL_NAME(fc.referenced_object_id, fc.referenced_column_id) AS colonne_liee
        FROM sys.foreign_key_columns fc
        WHERE fc.parent_object_id = OBJECT_ID(@schema + '.' + @table)`);

    return text({ table: `${schema}.${name}`, colonnes: cols.recordset, cles_etrangeres: fks.recordset });
  })
);

// 3) Lecture (SELECT)
server.registerTool(
  "executer_lecture",
  {
    title: "Lire des données (SELECT)",
    description: `Exécute une requête SELECT et renvoie au maximum ${MAX_ROWS_READ} lignes. ` +
                 "Lecture seule : aucune modification n'est possible avec cet outil.",
    inputSchema: { requete: z.string().describe("Requête SQL SELECT (syntaxe T-SQL SQL Server)") },
    annotations: { readOnlyHint: true }
  },
  async ({ requete }) => safe(async () => {
    validateRead(requete);
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const r = await new sql.Request(tx).query(requete);
      const rows = r.recordset ?? [];
      return text({
        lignes_total: rows.length,
        lignes_affichees: Math.min(rows.length, MAX_ROWS_READ),
        tronque: rows.length > MAX_ROWS_READ,
        resultat: rows.slice(0, MAX_ROWS_READ)
      });
    } finally {
      await tx.rollback().catch(() => {}); // garantie : rien n'est jamais enregistré
    }
  })
);

// 4) Modification (INSERT / UPDATE / DELETE)
server.registerTool(
  "executer_modification",
  {
    title: "Modifier des données (INSERT / UPDATE / DELETE)",
    description:
      "Modifie des données. Fonctionne en 2 temps : " +
      "1) appeler avec confirmer = false → APERÇU : la requête est exécutée puis annulée, on voit combien de lignes seraient touchées ; " +
      "2) montrer l'aperçu à l'utilisateur et, SEULEMENT s'il est d'accord, rappeler avec confirmer = true pour enregistrer. " +
      `UPDATE/DELETE doivent avoir un WHERE. Maximum ${MAX_ROWS_MODIFIED} lignes par requête.`,
    inputSchema: {
      requete:   z.string().describe("Requête INSERT, UPDATE ou DELETE (T-SQL)"),
      confirmer: z.boolean().default(false).describe("false = aperçu sans rien enregistrer ; true = enregistrer pour de vrai")
    },
    annotations: { readOnlyHint: false, destructiveHint: true }
  },
  async ({ requete, confirmer }) => safe(async () => {
    if (!ALLOW_WRITE) throw new Error("Les modifications sont désactivées (ALLOW_WRITE=false dans le .env).");
    const kind = validateWrite(requete);

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    let committed = false;
    try {
      const r = await new sql.Request(tx).query(requete);
      const touched = (r.rowsAffected ?? []).reduce((s, n) => s + n, 0);

      if (touched > MAX_ROWS_MODIFIED) {
        return text(`❌ Refusé et annulé : ${touched} lignes seraient touchées (maximum autorisé : ${MAX_ROWS_MODIFIED}). ` +
                    "Rendez le WHERE plus précis.");
      }
      if (!confirmer) {
        return text({
          mode: "APERÇU (rien n'a été enregistré)",
          operation: kind,
          lignes_touchees: touched,
          prochaine_etape: "Demander l'accord de l'utilisateur, puis rappeler avec confirmer = true."
        });
      }
      await tx.commit();
      committed = true;
      console.error(`[SQL] ${kind} enregistré (${touched} lignes) : ${requete}`);
      return text({ mode: "ENREGISTRÉ", operation: kind, lignes_touchees: touched });
    } finally {
      if (!committed) await tx.rollback().catch(() => {});
    }
  })
);

// ---------- Démarrage ----------
await server.connect(new StdioServerTransport());
console.error(`✅ MCP SQL Server prêt → ${CONFIG.server}:${CONFIG.port} / ${CONFIG.database} | écriture: ${ALLOW_WRITE ? "OUI" : "NON"}`);

process.on("SIGINT", async () => { try { (await poolPromise)?.close(); } catch {} process.exit(0); });