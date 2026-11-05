// =====================================================================
//  MRS Produktion – SERVEUR (un seul fichier)
//  Démarrage :  npm run build   (une fois, crée le dossier dist)
//               npm start       → http://localhost:3000
//  Service Windows (PowerShell en administrateur) :
//               node server.js dienst installieren | status | log | neustart | stoppen | starten | entfernen
//  Données créées par l'application : dossier « daten » (comptes, actions, commentaires, sauvegardes, journal)
//
//  Contenu :
//   1. Configuration (.env)
//   2. Connexion SQL Server
//   3. Lecture (SELECT uniquement, transaction toujours annulée)
//   4. Données Produktion + Energie
//   5. Modification de lignes (optionnel, avec mot de passe)
//   6. Assistant IA (Claude)
//   7. Routes API + démarrage
// =====================================================================

import express from "express";
import sql from "mssql";
import Anthropic from "@anthropic-ai/sdk";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------
// 1. Configuration (.env à côté de ce fichier)
// ---------------------------------------------------------------------
const DOSSIER = path.dirname(fileURLToPath(import.meta.url));
const ENV = path.join(DOSSIER, ".env");
if (fs.existsSync(ENV)) process.loadEnvFile(ENV);

// --- Dossier « daten » : tout ce que l'application crée elle-même ---
// (les fichiers d'une version précédente, posés à côté de server.js, y sont déplacés automatiquement)
const DATEN = path.join(DOSSIER, "daten");
try {
  fs.mkdirSync(DATEN, { recursive: true });
  for (const d of ["benutzer.json", "massnahmen.json", "kommentare.json", "einstellungen.json", "benachrichtigungen.json", "aenderungen.log", "logs", "sicherungen"]) {
    const alt = path.join(DOSSIER, d), neu = path.join(DATEN, d);
    if (fs.existsSync(alt) && !fs.existsSync(neu)) fs.renameSync(alt, neu);
  }
} catch (err) { console.error("[Daten] Ordner daten konnte nicht vorbereitet werden:", err.message); }

// --- Journal : tout ce qui s'affiche dans la console va aussi dans daten/logs/server-AAAA-MM.log ---
const LOG_ORDNER = path.join(DATEN, "logs");
try { fs.mkdirSync(LOG_ORDNER, { recursive: true }); } catch { /* lecture seule */ }
const logDatei = () => path.join(LOG_ORDNER, `server-${new Date().toISOString().slice(0, 7)}.log`);
for (const art of ["log", "warn", "error"]) {
  const original = console[art].bind(console);
  console[art] = (...teile) => {
    original(...teile);
    try { fs.appendFileSync(logDatei(), `${new Date().toISOString()} ${art.toUpperCase().padEnd(5)} ${teile.map(x => (typeof x === "string" ? x : x instanceof Error ? x.stack : JSON.stringify(x))).join(" ")}\n`); }
    catch { /* le journal ne doit jamais arrêter le serveur */ }
  };
}
// journaux de plus de 12 mois supprimés au démarrage
try {
  const grenze = new Date(); grenze.setMonth(grenze.getMonth() - 12);
  for (const d of fs.readdirSync(LOG_ORDNER)) {
    const m = d.match(/^server-(\d{4}-\d{2})\.log$/);
    if (m && new Date(`${m[1]}-01`) < grenze) fs.unlinkSync(path.join(LOG_ORDNER, d));
  }
} catch { /* rien à nettoyer */ }
process.on("unhandledRejection", (e) => console.error("[Unbehandelter Fehler]", e?.stack || e?.message || e));
process.on("uncaughtException", (e) => console.error("[Absturz abgefangen]", e?.stack || e?.message || e));
const GESTARTET = new Date();
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(DOSSIER, "package.json"), "utf8")).version; } catch { return "?"; } })();

// --- Calculs (EnPI, prévision, alertes) : lus dans la section « BEGIN RECHNEN … END RECHNEN » de App.jsx ---
const RECHNEN_NAMEN = ["berechne", "energieKennzahlen", "prognoseBerechnen", "warnungenBerechnen", "abschaumWarnungen", "istUeberfaellig",
  "zahl", "dez", "prozent", "MONATE", "ANLAGE_NAME", "datumDE"];
async function rechnenLaden() {
  try {
    const quelle = fs.readFileSync(path.join(DOSSIER, "App.jsx"), "utf8");
    const a = quelle.indexOf("// ===== BEGIN RECHNEN ====="), b = quelle.indexOf("// ===== END RECHNEN =====");
    if (a < 0 || b < a) throw new Error("Abschnitt BEGIN RECHNEN … END RECHNEN in App.jsx nicht gefunden");
    const code = `${quelle.slice(a, b)}\nexport { ${RECHNEN_NAMEN.join(", ")} };`;
    return await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  } catch (err) {
    console.error("[Rechnen] Berechnungen aus App.jsx nicht geladen, E-Mail-Berichte sind ausgeschaltet:", err.message);
    const fehlt = () => { throw new Error("Berechnungen nicht verfügbar (siehe Protokoll beim Start)."); };
    return Object.fromEntries(RECHNEN_NAMEN.map(n => [n, fehlt]));
  }
}
const R = await rechnenLaden();
const { berechne, energieKennzahlen, prognoseBerechnen, warnungenBerechnen, abschaumWarnungen, istUeberfaellig,
        zahl: zahlDE, dez, prozent, MONATE, ANLAGE_NAME, datumDE } = R;

const env = (k, d) => process.env[k] ?? d;
const oui = (v) => ["1", "true", "yes", "ja", "oui"].includes(String(v).toLowerCase());

// ---------------------------------------------------------------------
// Service Windows :  node server.js dienst installieren | status | log | neustart | stoppen | starten | entfernen
// (une tâche planifiée Windows : démarre avec le PC, surveillée toutes les 5 minutes, relancée si arrêtée)
// ---------------------------------------------------------------------
const DIENST_SKRIPT = `$ErrorActionPreference = "Stop"
$Name = "MRS Produktion"

function Admin-Pruefen {
  $ich = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $ich.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Bitte PowerShell als Administrator starten (Rechtsklick > Als Administrator ausführen)." -ForegroundColor Red
    exit 1
  }
}
function Port-Lesen {
  $port = 3000
  $envDatei = Join-Path $Ordner ".env"
  if (Test-Path $envDatei) {
    $z = Select-String -Path $envDatei -Pattern '^\\s*WEB_PORT\\s*=\\s*(\\d+)' | Select-Object -First 1
    if ($z) { $port = [int]$z.Matches[0].Groups[1].Value }
  }
  return $port
}
function Status-Zeigen {
  $t = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
  if (-not $t) { Write-Host "Der Dienst '$Name' ist nicht eingerichtet." -ForegroundColor Yellow; return }
  $info = Get-ScheduledTaskInfo -TaskName $Name
  $port = Port-Lesen
  $antwortet = $false
  try { $antwortet = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/api/auth/status" -TimeoutSec 5).StatusCode -eq 200 } catch { }
  Write-Host ""
  Write-Host "  Dienst        : $Name"
  Write-Host "  Zustand       : $($t.State)" -ForegroundColor $(if ($t.State -eq "Running") { "Green" } else { "Yellow" })
  Write-Host "  Letzter Start : $($info.LastRunTime)"
  Write-Host "  Erreichbar    : $(if ($antwortet) { "ja, http://localhost:$port" } else { "nein (Port $port)" })" -ForegroundColor $(if ($antwortet) { "Green" } else { "Red" })
  Write-Host "  Protokoll     : $(Join-Path $Ordner 'daten\\logs')"
  Write-Host ""
}

switch ($Befehl) {
  "installieren" {
    Admin-Pruefen
    $node = $NodePfad
    if (-not (Test-Path (Join-Path $Ordner "dist\\index.html"))) { throw "Der Ordner dist fehlt: zuerst 'npm run build' ausführen." }
    if (-not (Test-Path (Join-Path $Ordner ".env"))) { Write-Host "Hinweis: keine .env gefunden (Datenbankzugang fehlt)." -ForegroundColor Yellow }

    $aktion = New-ScheduledTaskAction -Execute $node -Argument "server.js" -WorkingDirectory $Ordner
    $beimStart = New-ScheduledTaskTrigger -AtStartup
    # Überwachung: alle 5 Minuten starten, falls nicht mehr aktiv (läuft er schon, passiert nichts)
    $waechter = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
    $einst = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable \`
             -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    $konto = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $Name -Action $aktion -Trigger @($beimStart, $waechter) -Settings $einst -Principal $konto \`
      -Description "MRS Produktion (node server.js in $Ordner). Startet mit Windows, Neustart bei Absturz." -Force | Out-Null
    Start-ScheduledTask -TaskName $Name
    Write-Host "Dienst '$Name' eingerichtet und gestartet." -ForegroundColor Green
    Start-Sleep -Seconds 4
    Status-Zeigen
  }
  "entfernen" {
    Admin-Pruefen
    Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Dienst '$Name' entfernt. Die Daten im Ordner bleiben erhalten." -ForegroundColor Green
  }
  "stoppen"  { Admin-Pruefen; Stop-ScheduledTask -TaskName $Name; Write-Host "Gestoppt (der Wächter startet ihn nach spätestens 5 Minuten wieder; dauerhaft: 'entfernen')." }
  "starten"  { Admin-Pruefen; Start-ScheduledTask -TaskName $Name; Start-Sleep -Seconds 4; Status-Zeigen }
  "neustart" { Admin-Pruefen; Stop-ScheduledTask -TaskName $Name; Start-Sleep -Seconds 2; Start-ScheduledTask -TaskName $Name; Start-Sleep -Seconds 4; Status-Zeigen }
  "log" {
    $datei = Get-ChildItem (Join-Path $Ordner "daten\\logs") -Filter "server-*.log" -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1
    if ($datei) { Get-Content $datei.FullName -Tail 40 -Encoding UTF8 } else { Write-Host "Noch kein Protokoll vorhanden." }
  }
  "status" { Status-Zeigen }
}
`;
if (process.argv[2] === "dienst") {
  const befehl = process.argv[3] || "status";
  const erlaubt = ["installieren", "entfernen", "status", "neustart", "stoppen", "starten", "log"];
  if (process.platform !== "win32") { console.log("Der Dienst kann nur unter Windows eingerichtet werden."); process.exit(1); }
  if (!erlaubt.includes(befehl)) { console.log(`Unbekannter Befehl. Möglich: ${erlaubt.join(", ")}`); process.exit(1); }
  const q = (t) => `'${String(t).replace(/'/g, "''")}'`;
  const skript = `$Befehl = ${q(befehl)}\n$Ordner = ${q(DOSSIER)}\n$NodePfad = ${q(process.execPath)}\n${DIENST_SKRIPT}`;
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(skript, "utf16le").toString("base64")], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

const PORT = parseInt(env("WEB_PORT", "3000"), 10);
const HOST = env("WEB_HOST", "127.0.0.1");            // uniquement ce PC (pas de connexion)
const MAX_ZEILEN = parseInt(env("MAX_ROWS_READ", "200"), 10);
const MODELL = env("ANTHROPIC_MODEL", "claude-sonnet-5-5");
const claude = env("ANTHROPIC_API_KEY") ? new Anthropic() : null;

const DB = {
  server: env("DB_SERVER", "localhost"),
  port: parseInt(env("DB_PORT", "1433"), 10),
  database: env("DB_DATABASE"),
  user: env("DB_USER"),
  password: env("DB_PASSWORD"),
  options: { encrypt: oui(env("DB_ENCRYPT", "true")), trustServerCertificate: oui(env("DB_TRUST_CERT", "true")) },
  pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
  requestTimeout: 30000
};
const DB_INFO = `${DB.server}:${DB.port}/${DB.database}`;
const MONATSNAMEN = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

// Modification (désactivée par défaut)
const BEARBEITEN_AKTIV = oui(env("ALLOW_WRITE"));   // qui peut modifier : rôle « bearbeiter » ou « admin »
const EDIT_TABELLEN = env("EDIT_TABELLEN", "").split(",").map(t => t.trim().toLowerCase()).filter(Boolean);

// ---------------------------------------------------------------------
// 2. Connexion SQL Server
// ---------------------------------------------------------------------
let poolPromise = null;
function pool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(DB).connect().catch(err => {
      poolPromise = null;
      throw new Error(`Keine Verbindung zum SQL Server (${DB_INFO}): ${err.message}`);
    });
  }
  return poolPromise;
}

const qi = (s) => `[${String(s).replace(/]/g, "]]")}]`;   // nom SQL entre crochets
function teileName(name) {
  const p = String(name).replace(/[[\]]/g, "").split(".");
  return p.length === 2 ? p : ["dbo", p[0]];
}

// ---------------------------------------------------------------------
// 3. Lecture : SELECT uniquement, dans une transaction toujours annulée
// ---------------------------------------------------------------------
const VERBOTEN = /\b(DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|DENY|EXEC|EXECUTE|BACKUP|RESTORE|SHUTDOWN|DBCC|OPENROWSET|OPENDATASOURCE|OPENQUERY|BULK|RECONFIGURE|USE|xp_\w+|sp_\w+)\b/i;
const SCHREIBEN = /\b(INSERT|UPDATE|DELETE|MERGE|INTO)\b/i;

function pruefeSelect(abfrage) {
  const t = String(abfrage)
    .replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/'(?:''|[^'])*'/g, "''")
    .trim().replace(/;\s*$/, "");
  if (t.includes(";")) throw new Error("Nur eine Abfrage auf einmal erlaubt.");
  if (!/^(SELECT|WITH)\b/i.test(t)) throw new Error("Nur SELECT-Abfragen sind erlaubt.");
  if (VERBOTEN.test(t)) throw new Error(`Unzulässiges Schlüsselwort: ${t.match(VERBOTEN)[0]}`);
  if (SCHREIBEN.test(t)) throw new Error(`Änderungen sind nicht erlaubt: ${t.match(SCHREIBEN)[0]}`);
}

async function nurLesen(fn) {
  const tx = new sql.Transaction(await pool());
  await tx.begin();
  try { return await fn(tx); }
  finally { await tx.rollback().catch(() => {}); }
}

async function sqlLesen(abfrage) {
  pruefeSelect(abfrage);
  return nurLesen(async (tx) => {
    const rows = (await new sql.Request(tx).query(abfrage)).recordset ?? [];
    return { zeilen_gesamt: rows.length, gekuerzt: rows.length > MAX_ZEILEN, ergebnis: rows.slice(0, MAX_ZEILEN) };
  });
}

async function tabellenListe() {
  const r = await (await pool()).request().query(`
    SELECT t.TABLE_SCHEMA AS [schema], t.TABLE_NAME AS [tabelle], t.TABLE_TYPE AS [typ], SUM(p.rows) AS zeilen_ca
    FROM INFORMATION_SCHEMA.TABLES t
    LEFT JOIN sys.objects o ON o.name = t.TABLE_NAME AND SCHEMA_NAME(o.schema_id) = t.TABLE_SCHEMA
    LEFT JOIN sys.partitions p ON p.object_id = o.object_id AND p.index_id IN (0, 1)
    GROUP BY t.TABLE_SCHEMA, t.TABLE_NAME, t.TABLE_TYPE
    ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME`);
  return r.recordset;
}

async function tabelleBeschreiben(name) {
  const p = String(name).replace(/[[\]]/g, "").split(".");
  if (p.length > 2 || !p.every(x => /^[A-Za-z_][A-Za-z0-9_ ]*$/.test(x))) throw new Error(`Ungültiger Tabellenname: ${name}`);
  const [schema, table] = teileName(name);
  const r = await (await pool()).request()
    .input("schema", sql.NVarChar, schema).input("table", sql.NVarChar, table)
    .query(`SELECT COLUMN_NAME AS spalte, DATA_TYPE AS typ, CHARACTER_MAXIMUM_LENGTH AS laenge, IS_NULLABLE AS nullable
            FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table ORDER BY ORDINAL_POSITION`);
  if (!r.recordset.length) throw new Error(`Tabelle nicht gefunden: ${schema}.${table}`);
  return { tabelle: `${schema}.${table}`, spalten: r.recordset };
}

// --- Filtre par année / mois (détecté automatiquement dans chaque table) ---
// 1) colonnes « Jahr » (+ « Monat ») ou « Year » (+ « Month »)
// 2) sinon la première colonne date → YEAR(...) et MONTH(...)
const ZAHL_TYPEN = ["int", "bigint", "smallint", "tinyint", "decimal", "numeric", "money", "float", "real"];
const DATUM_TYPEN = ["date", "datetime", "datetime2", "smalldatetime"];

function zeitSpalten(spalten) {
  const finde = (re) => spalten.find(s => re.test(s.spalte) && ZAHL_TYPEN.includes(s.typ));
  const jahr = finde(/^(jahr|year)$/i);
  if (jahr) return { art: "spalten", jahr: jahr.spalte, monat: finde(/^(monat|month)$/i)?.spalte || null };
  const datum = spalten.find(s => DATUM_TYPEN.includes(s.typ));
  return datum ? { art: "datum", datum: datum.spalte } : null;
}
function zeitAusdruck(z) {
  if (!z) return null;
  if (z.art === "spalten") return { jahr: qi(z.jahr), monat: z.monat ? qi(z.monat) : null };
  return { jahr: `YEAR(${qi(z.datum)})`, monat: `MONTH(${qi(z.datum)})` };
}
function zeitWhere(z, req, jahr, monat) {
  const a = zeitAusdruck(z);
  const teile = [];
  if (a && jahr) { req.input("fj", sql.Int, jahr); teile.push(`${a.jahr} = @fj`); }
  if (a?.monat && monat) { req.input("fm", sql.Int, monat); teile.push(`${a.monat} = @fm`); }
  return teile.length ? `WHERE ${teile.join(" AND ")}` : "";
}
const zahlParam = (v, min, max) => { const n = parseInt(v, 10); return Number.isInteger(n) && n >= min && n <= max ? n : null; };

// Aperçu d'une table : le nom est vérifié dans INFORMATION_SCHEMA (pas d'injection possible)
async function tabellenVorschau(name, limit = 200, jahr = null, monat = null) {
  const struktur = await tabelleBeschreiben(name);
  const [schema, table] = teileName(name);
  const ziel = `${qi(schema)}.${qi(table)}`;
  const n = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
  const meta = await tabellenMeta(`${schema}.${table}`).catch(() => null);   // vues : non modifiables
  const zeit = zeitSpalten(struktur.spalten);
  return nurLesen(async (tx) => {
    const r1 = new sql.Request(tx);
    const r = await r1.query(`SELECT TOP (${n}) * FROM ${ziel} ${zeitWhere(zeit, r1, jahr, monat)} ORDER BY 1 DESC`);
    const r2 = new sql.Request(tx);
    const c = await r2.query(`SELECT COUNT_BIG(*) AS n FROM ${ziel} ${zeitWhere(zeit, r2, jahr, monat)}`);
    let jahre = [];
    if (zeit) {
      const a = zeitAusdruck(zeit);
      jahre = (await new sql.Request(tx).query(`SELECT DISTINCT ${a.jahr} AS j FROM ${ziel} WHERE ${a.jahr} IS NOT NULL ORDER BY j DESC`))
        .recordset.map(x => Number(x.j)).filter(Number.isFinite);
    }
    return { ...struktur, zeilen_gesamt: Number(c.recordset[0].n), zeilen: r.recordset, meta, zeit, jahre };
  });
}

// Übersicht d'une table : totaux, moyennes, min, max des colonnes numériques,
// regroupés par mois (si une année est choisie) ou par année (toutes les années)
const istKennung = (n) => /^id$/i.test(n) || /^id_/i.test(n) || /(_id|ID|Id)$/.test(n) || /(nr|nummer)$/i.test(n);

async function tabellenUebersicht(name, jahr = null, monat = null) {
  const struktur = await tabelleBeschreiben(name);
  const [schema, table] = teileName(name);
  const ziel = `${qi(schema)}.${qi(table)}`;
  const zeit = zeitSpalten(struktur.spalten);
  const a = zeitAusdruck(zeit);
  const zeitNamen = new Set([zeit?.jahr, zeit?.monat].filter(Boolean));
  const alleZahlen = struktur.spalten.filter(s => ZAHL_TYPEN.includes(s.typ) && !zeitNamen.has(s.spalte) && !istKennung(s.spalte));
  const zahlen = alleZahlen.slice(0, 30);

  const f = (s) => `CAST(${qi(s.spalte)} AS float)`;
  const agg = zahlen.map((s, i) => `, SUM(${f(s)}) AS s${i}, AVG(${f(s)}) AS a${i}, MIN(${f(s)}) AS mi${i}, MAX(${f(s)}) AS ma${i}`).join("");
  const gruppierung = !a ? null : (jahr && a.monat) ? "monat" : "jahr";
  const gruppe = gruppierung === "monat" ? a.monat : gruppierung === "jahr" ? a.jahr : null;
  const zahl = (v) => (v === null || v === undefined ? null : Number(v));

  return nurLesen(async (tx) => {
    const r1 = new sql.Request(tx);
    const g = (await r1.query(`SELECT COUNT_BIG(*) AS n${agg} FROM ${ziel} ${zeitWhere(zeit, r1, jahr, monat)}`)).recordset[0];
    // valeurs par mois (ou par année) pour une année donnée (ou toutes)
    async function gruppenLesen(j) {
      const r2 = new sql.Request(tx);
      const w = zeitWhere(zeit, r2, j, monat);
      const rows = (await r2.query(`SELECT ${gruppe} AS gruppe, COUNT_BIG(*) AS n${agg} FROM ${ziel}
        ${w ? `${w} AND` : "WHERE"} ${gruppe} IS NOT NULL GROUP BY ${gruppe} ORDER BY ${gruppe}`)).recordset;
      return rows.map(r => ({
        gruppe: Number(r.gruppe), n: Number(r.n),
        summe: Object.fromEntries(zahlen.map((s, i) => [s.spalte, zahl(r[`s${i}`])])),
        schnitt: Object.fromEntries(zahlen.map((s, i) => [s.spalte, zahl(r[`a${i}`])]))
      }));
    }
    const gruppen = gruppe ? await gruppenLesen(jahr) : [];
    const vorjahr = gruppe && jahr ? await gruppenLesen(jahr - 1) : [];   // pour la comparaison avec l'année précédente
    return {
      tabelle: `${schema}.${table}`, zeit, gruppierung, jahr, monat, zeilen: Number(g.n), vorjahr,
      spalten: zahlen.map((s, i) => ({ spalte: s.spalte, summe: zahl(g[`s${i}`]), schnitt: zahl(g[`a${i}`]), min: zahl(g[`mi${i}`]), max: zahl(g[`ma${i}`]) })),
      weitere: alleZahlen.length - zahlen.length,
      gruppen
    };
  });
}

// ---------------------------------------------------------------------
// 4. Données du tableau de bord
// ---------------------------------------------------------------------
async function jahre() {
  const r = await (await pool()).request()
    .query(`SELECT DISTINCT Jahr FROM dbo.ProduktionMonat WHERE Jahr IS NOT NULL ORDER BY Jahr DESC`);
  return r.recordset.map(x => x.Jahr);
}

async function produktion(jahr) {
  const r = await (await pool()).request().input("jahr", sql.Int, jahr).query(`
    SELECT Jahr, Monat, Monatname, Arbeitstage,
           [Durchsatz Presse I] AS presse1, [Durchsatz Presse II] AS presse2,
           [Input UBC-Aufbereitung] AS ubc, [Material verarbeitet gesamt] AS gesamt,
           [Menge Bewegungen Abschaum] AS abschaum
    FROM dbo.ProduktionMonat WHERE Jahr IN (@jahr, @jahr - 1) ORDER BY Jahr, Monat`);
  return { jahr, aktuell: r.recordset.filter(x => x.Jahr === jahr), vorjahr: r.recordset.filter(x => x.Jahr === jahr - 1) };
}

async function energieJahre() {
  const r = await (await pool()).request()
    .query(`SELECT DISTINCT Jahr FROM dbo.SEUWerte WHERE Jahr IS NOT NULL ORDER BY Jahr DESC`);
  return r.recordset.map(x => x.Jahr);
}

async function energie(jahr) {
  const r = await (await pool()).request().input("jahr", sql.Int, jahr).query(`
    SELECT Jahr, Monat, Manatname AS Monatname,
           P1_Verbrauch, P2_Verbrauch, UB_Verbrauch, ME_Verbrauch,
           P1_Verarbeitung, P2_Verarbeitung, UB_Verarbeitung, Gesamtmenge,
           ME_Stunden, P1_Wert, P2_Wert, UB_Wert,
           ME_ProTonne, ME_ProStunde, ME_ProTonneGesamtmenge, ME_Wert
    FROM dbo.SEUWerte WHERE Jahr IN (@jahr, @jahr - 1) ORDER BY Jahr, Monat`);
  // decimal → nombre
  const rows = r.recordset.map(z => Object.fromEntries(Object.entries(z).map(([k, v]) =>
    [k, typeof v === "string" && k !== "Monatname" && v !== "" && !isNaN(v) ? Number(v) : v])));
  return { jahr, aktuell: rows.filter(x => x.Jahr === jahr), vorjahr: rows.filter(x => x.Jahr === jahr - 1) };
}

// ---------------------------------------------------------------------
// 4b. KPI des SEU (tables KeyPerformanceIndicators / ...Month + KPIType)
// ---------------------------------------------------------------------
const KPI_TABELLEN = { monat: "KeyPerformanceIndicatorsMonth", gesamt: "KeyPerformanceIndicators" };

// Noms des SEU : table dbo.SignificantEnergyUsers si elle existe (colonne de nom détectée automatiquement)
async function seuNamen() {
  const p = await pool();
  const spalten = (await p.request().query(`
    SELECT COLUMN_NAME AS spalte, DATA_TYPE AS typ FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'SignificantEnergyUsers' ORDER BY ORDINAL_POSITION`)).recordset;
  if (!spalten.length) return { quelle: null, namen: {} };
  const id = spalten.find(s => /^SignificantEnergyUsersID$/i.test(s.spalte)) || spalten.find(s => /id$/i.test(s.spalte));
  const texte = spalten.filter(s => /char/i.test(s.typ));
  const name = texte.find(s => /^(bezeichnung|name|seu|anlage|beschreibung)$/i.test(s.spalte)) || texte[0];
  if (!id || !name) return { quelle: null, namen: {} };
  const r = await p.request().query(`SELECT ${qi(id.spalte)} AS id, ${qi(name.spalte)} AS name FROM dbo.SignificantEnergyUsers`);
  return { quelle: `dbo.SignificantEnergyUsers.${name.spalte}`, namen: Object.fromEntries(r.recordset.map(x => [x.id, x.name])) };
}

async function kpiDaten(jahr, quelle = "monat") {
  const tabelle = KPI_TABELLEN[quelle] || KPI_TABELLEN.monat;
  const p = await pool();
  const zahl = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
  const [rows, typen, jahre, seu] = await Promise.all([
    p.request().input("jahr", sql.Int, jahr).query(`
      SELECT SignificantEnergyUsersID AS seu, Jahr, Monat, Manatname AS Monatname, Zaehler, Nenner, KPITyp AS typ, KPI, Prozent
      FROM dbo.${qi(tabelle)} WHERE Jahr IN (@jahr, @jahr - 1) ORDER BY Jahr, Monat`),
    p.request().query(`SELECT KPITypeID AS id, Bezeichnung AS name FROM dbo.KPIType ORDER BY KPITypeID`),
    p.request().query(`SELECT DISTINCT Jahr FROM dbo.${qi(tabelle)} WHERE Jahr IS NOT NULL ORDER BY Jahr DESC`),
    seuNamen().catch(() => ({ quelle: null, namen: {} }))
  ]);
  const zeilen = rows.recordset.map(r => ({
    seu: r.seu, jahr: r.Jahr, monat: r.Monat, monatName: r.Monatname, typ: r.typ,
    zaehler: zahl(r.Zaehler), nenner: zahl(r.Nenner), kpi: zahl(r.KPI), prozent: zahl(r.Prozent)
  }));
  const seuIds = [...new Set(zeilen.map(z => z.seu).filter(x => x != null))].sort((a, b) => a - b);
  return {
    jahr, quelle, tabelle: `dbo.${tabelle}`, namenQuelle: seu.quelle,
    jahre: jahre.recordset.map(x => x.Jahr),
    typen: typen.recordset.map(t => ({ id: t.id, name: t.name || `KPI-Typ ${t.id}` })),
    seus: seuIds.map(id => ({ id, name: seu.namen[id] || `SEU ${id}` })),
    zeilen
  };
}

// --- KPI calculés directement depuis dbo.SEUWerte (même format que les tables KPI) ---
//  Typ 1  Spezifischer Energieverbrauch (EnPI) = Verbrauch ÷ Bezugsgröße
//         (Presse/UBC: Verarbeitung, ME: Betriebsstunden, Standort: Gesamtmenge), mis à l'échelle comme *_Wert
//  Typ 2  Anteil am Gesamtverbrauch            = Verbrauch ÷ Verbrauch aller Anlagen × 100
//  Typ 3  Verbrauch je Gesamtmenge             = Verbrauch ÷ Gesamtmenge
//  Typ 4  Durchsatz je ME-Stunde               = Gesamtmenge ÷ ME_Stunden
//  Prozent = Veränderung des KPI ggü. dem gleichen Monat des Vorjahres
const BERECHNET_SEU = [
  { id: 1, name: "Presse I", v: "P1_Verbrauch", m: "P1_Verarbeitung", w: "P1_Wert" },
  { id: 2, name: "Presse II", v: "P2_Verbrauch", m: "P2_Verarbeitung", w: "P2_Wert" },
  { id: 3, name: "UBC-Aufbereitung", v: "UB_Verbrauch", m: "UB_Verarbeitung", w: "UB_Wert" },
  { id: 4, name: "ME", v: "ME_Verbrauch", m: "ME_Stunden", w: "ME_Wert" },
  { id: 5, name: "Standort gesamt", v: null, m: "Gesamtmenge", w: null }
];
const BERECHNET_TYPEN = [
  { id: 1, name: "Spezifischer Energieverbrauch (EnPI)" },
  { id: 2, name: "Anteil am Gesamtverbrauch (%)" },
  { id: 3, name: "Verbrauch je Gesamtmenge" },
  { id: 4, name: "Durchsatz je ME-Stunde" }
];

function skalierung(rows, a) {
  if (!a.w) return 1;
  const f = rows.filter(r => Number(r[a.m]) && Number(r[a.v]) && Number(r[a.w])).map(r => Number(r[a.w]) / (Number(r[a.v]) / Number(r[a.m])));
  if (!f.length) return 1;
  const mi = f.reduce((s, x) => s + x, 0) / f.length;
  if (!f.every(x => Math.abs(x / mi - 1) < 0.01)) return 1;
  const p = 10 ** Math.round(Math.log10(mi));
  return Math.abs(mi / p - 1) < 0.01 ? p : mi;
}

async function kpiBerechnet(jahr) {
  const [jetzt, davor, jahreListe] = await Promise.all([energie(jahr), energie(jahr - 1), energieJahre()]);
  const alle = [...davor.vorjahr, ...jetzt.vorjahr, ...jetzt.aktuell];
  const n = (x) => Number(x) || 0;
  const faktor = Object.fromEntries(BERECHNET_SEU.map(a => [a.id, skalierung(alle, a)]));
  const fs = [1, 2, 3].map(id => faktor[id]);
  faktor[5] = fs.every(x => Math.abs(x / fs[0] - 1) < 0.01) ? fs[0] : 1;
  const verbrauch = (r, a) => (a.v ? n(r[a.v]) : BERECHNET_SEU.filter(x => x.v).reduce((s, x) => s + n(r[x.v]), 0));

  const zeilenVon = (r) => {
    const gesamtV = verbrauch(r, BERECHNET_SEU[4]);
    const out = [];
    const neu = (seu, typ, zaehler, nenner, f = 1) => {
      if (!nenner) return;
      out.push({ seu, jahr: r.Jahr, monat: r.Monat, monatName: r.Monatname, typ, zaehler, nenner, kpi: (zaehler / nenner) * f, prozent: null });
    };
    for (const a of BERECHNET_SEU) {
      const v = verbrauch(r, a);
      neu(a.id, 1, v, n(r[a.m]), faktor[a.id]);
      if (a.v) { neu(a.id, 2, v, gesamtV, 100); neu(a.id, 3, v, n(r.Gesamtmenge), faktor[5]); }
      if (a.id === 4) neu(a.id, 4, n(r.Gesamtmenge), n(r.ME_Stunden));
    }
    return out;
  };
  const vorvorjahr = davor.vorjahr.flatMap(zeilenVon);
  const vorjahr = jetzt.vorjahr.flatMap(zeilenVon);
  const aktuell = jetzt.aktuell.flatMap(zeilenVon);
  // Prozent = Veränderung ggü. dem gleichen Monat des Vorjahres
  const prozent = (rows, basis) => rows.forEach(z => {
    const b = basis.find(x => x.seu === z.seu && x.typ === z.typ && x.monat === z.monat);
    if (b?.kpi) z.prozent = Math.round(((z.kpi - b.kpi) / Math.abs(b.kpi)) * 10000) / 100;
  });
  prozent(aktuell, vorjahr); prozent(vorjahr, vorvorjahr);

  return {
    jahr, quelle: "berechnet", tabelle: "dbo.SEUWerte (berechnet)", namenQuelle: "intern",
    prozentText: "Δ Vorjahresmonat", jahre: jahreListe,
    typen: BERECHNET_TYPEN, seus: BERECHNET_SEU.map(({ id, name }) => ({ id, name, gesamt: id === 5 })),
    faktoren: faktor, zeilen: [...vorjahr, ...aktuell]
  };
}

// ---------------------------------------------------------------------
// 5. Modification de lignes
//    - seulement tables existantes avec clé primaire, colonnes vérifiées
//    - valeurs en paramètres (pas d'injection SQL)
//    - exactement UNE ligne par opération, sinon tout est annulé
//    - chaque changement est noté dans aenderungen.log
// ---------------------------------------------------------------------
async function tabellenMeta(name) {
  const [schema, table] = teileName(name);
  const r = await (await pool()).request()
    .input("schema", sql.NVarChar, schema).input("table", sql.NVarChar, table)
    .query(`
      SELECT c.name AS spalte, t.name AS typ, c.max_length, c.precision, c.scale,
             c.is_nullable, c.is_identity, c.is_computed,
             CASE WHEN ic.column_id IS NOT NULL THEN 1 ELSE 0 END AS ist_schluessel,
             CASE WHEN dc.object_id IS NOT NULL THEN 1 ELSE 0 END AS hat_standard
      FROM sys.columns c
      JOIN sys.types t ON t.user_type_id = c.user_type_id
      JOIN sys.objects o ON o.object_id = c.object_id AND o.type = 'U'
      LEFT JOIN sys.indexes i ON i.object_id = c.object_id AND i.is_primary_key = 1
      LEFT JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.column_id = c.column_id
      LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
      WHERE o.object_id = OBJECT_ID(QUOTENAME(@schema) + '.' + QUOTENAME(@table))
      ORDER BY c.column_id`);
  if (!r.recordset.length) throw new Error(`Tabelle nicht gefunden oder nicht bearbeitbar: ${schema}.${table}`);
  const spalten = r.recordset.map(c => ({
    spalte: c.spalte, typ: c.typ,
    laenge: ["nvarchar", "nchar"].includes(c.typ) && c.max_length > 0 ? c.max_length / 2 : c.max_length,
    precision: c.precision, scale: c.scale,
    nullable: !!c.is_nullable, identity: !!c.is_identity, berechnet: !!c.is_computed,
    schluessel: !!c.ist_schluessel, standard: !!c.hat_standard
  }));
  return { schema, table, voll: `${schema}.${table}`, spalten, schluessel: spalten.filter(s => s.schluessel).map(s => s.spalte) };
}

function sqlTyp(s) {
  const n = s.laenge === -1 ? sql.MAX : s.laenge;
  return {
    int: sql.Int, bigint: sql.BigInt, smallint: sql.SmallInt, tinyint: sql.TinyInt, bit: sql.Bit,
    decimal: sql.Decimal(s.precision, s.scale), numeric: sql.Decimal(s.precision, s.scale),
    money: sql.Money, float: sql.Float, real: sql.Real,
    date: sql.Date, datetime: sql.DateTime, datetime2: sql.DateTime2, smalldatetime: sql.SmallDateTime, time: sql.Time,
    uniqueidentifier: sql.UniqueIdentifier, varchar: sql.VarChar(n), char: sql.Char(n), nchar: sql.NChar(n)
  }[s.typ] ?? sql.NVarChar(n || sql.MAX);
}

function wandle(s, v) {
  if (v === null || v === undefined || v === "") {
    if (!s.nullable) throw new Error(`„${s.spalte}“ darf nicht leer sein.`);
    return null;
  }
  const alsZahl = (x) => typeof x === "number" ? x : Number(String(x).replace(/\./g, "").replace(",", "."));
  if (["int", "bigint", "smallint", "tinyint"].includes(s.typ)) {
    const z = alsZahl(v);
    if (!Number.isInteger(z)) throw new Error(`„${s.spalte}“ muss eine ganze Zahl sein.`);
    return z;
  }
  if (["decimal", "numeric", "money", "float", "real"].includes(s.typ)) {
    const z = alsZahl(v);
    if (!Number.isFinite(z)) throw new Error(`„${s.spalte}“ muss eine Zahl sein.`);
    return z;
  }
  if (s.typ === "bit") return v === true || v === 1 || v === "1" || v === "true";
  if (["date", "datetime", "datetime2", "smalldatetime"].includes(s.typ)) {
    const d = new Date(v);
    if (isNaN(d)) throw new Error(`„${s.spalte}“ ist kein gültiges Datum.`);
    return d;
  }
  const t = String(v);
  if (s.laenge > 0 && t.length > s.laenge) throw new Error(`„${s.spalte}“ ist zu lang (max. ${s.laenge} Zeichen).`);
  return t;
}

function protokoll(eintrag) {
  try { fs.appendFileSync(path.join(DATEN, "aenderungen.log"), JSON.stringify({ zeit: new Date().toISOString(), ...eintrag }) + "\n"); }
  catch (err) { console.error("Protokoll konnte nicht geschrieben werden:", err.message); }
}

function schluesselBedingung(meta, req, schluessel) {
  if (!meta.schluessel.length) throw new Error("Diese Tabelle hat keinen Primärschlüssel und kann nicht bearbeitet werden.");
  return meta.schluessel.map((k, i) => {
    const s = meta.spalten.find(x => x.spalte === k);
    if (schluessel?.[k] === undefined || schluessel[k] === null) throw new Error(`Schlüssel „${k}“ fehlt.`);
    req.input(`k${i}`, sqlTyp(s), wandle(s, schluessel[k]));
    return `${qi(k)} = @k${i}`;
  }).join(" AND ");
}

const anzahl = (r) => Number(r.recordsets?.at(-1)?.[0]?.n ?? -1);   // résultat de SELECT @@ROWCOUNT

async function inTransaktion(fn) {
  const tx = new sql.Transaction(await pool());
  await tx.begin();
  try { const e = await fn(tx); await tx.commit(); return e; }
  catch (err) { await tx.rollback().catch(() => {}); throw err; }
}

async function alteZeile(tx, meta, schluessel) {
  const req = new sql.Request(tx);
  const bed = schluesselBedingung(meta, req, schluessel);
  const alt = (await req.query(`SELECT * FROM ${qi(meta.schema)}.${qi(meta.table)} WITH (UPDLOCK) WHERE ${bed}`)).recordset;
  if (alt.length !== 1) throw new Error("Die Zeile wurde nicht gefunden (vielleicht inzwischen gelöscht).");
  return alt[0];
}

async function zeileEinfuegen(name, werte, wer) {
  const meta = await tabellenMeta(name);
  if (!meta.schluessel.length) throw new Error("Diese Tabelle hat keinen Primärschlüssel und kann nicht bearbeitet werden.");
  return inTransaktion(async (tx) => {
    const req = new sql.Request(tx);
    const spalten = meta.spalten.filter(s => !s.identity && !s.berechnet && werte?.[s.spalte] !== undefined && !(werte[s.spalte] === "" && s.standard));
    spalten.forEach((s, i) => req.input(`w${i}`, sqlTyp(s), wandle(s, werte[s.spalte])));
    const fehlend = meta.spalten.find(s => !s.nullable && !s.identity && !s.berechnet && !s.standard && !spalten.includes(s));
    if (fehlend) throw new Error(`„${fehlend.spalte}“ muss ausgefüllt werden.`);

    const ziel = `${qi(meta.schema)}.${qi(meta.table)}`;
    const r = await req.query(spalten.length
      ? `INSERT INTO ${ziel} (${spalten.map(s => qi(s.spalte)).join(", ")}) VALUES (${spalten.map((_, i) => `@w${i}`).join(", ")}); SELECT SCOPE_IDENTITY() AS neue_id;`
      : `INSERT INTO ${ziel} DEFAULT VALUES; SELECT SCOPE_IDENTITY() AS neue_id;`);
    if (r.rowsAffected[0] !== 1) throw new Error("Einfügen fehlgeschlagen.");

    const identity = meta.spalten.find(s => s.identity);
    const schluessel = Object.fromEntries(meta.schluessel.map(k => [k,
      identity?.spalte === k ? Number(r.recordset?.[0]?.neue_id) : wandle(meta.spalten.find(s => s.spalte === k), werte[k])]));
    protokoll({ aktion: "EINFÜGEN", wer, tabelle: meta.voll, schluessel, neu: werte });
    return { schluessel };
  });
}

async function zeileAendern(name, schluessel, werte, wer) {
  const meta = await tabellenMeta(name);
  return inTransaktion(async (tx) => {
    const alt = await alteZeile(tx, meta, schluessel);
    const req = new sql.Request(tx);
    const bed = schluesselBedingung(meta, req, schluessel);
    const spalten = meta.spalten.filter(s => !s.identity && !s.berechnet && !s.schluessel && werte?.[s.spalte] !== undefined);
    if (!spalten.length) throw new Error("Keine Änderungen übergeben.");
    spalten.forEach((s, i) => req.input(`w${i}`, sqlTyp(s), wandle(s, werte[s.spalte])));
    const r = await req.query(`SET NOCOUNT ON; UPDATE ${qi(meta.schema)}.${qi(meta.table)} SET ${spalten.map((s, i) => `${qi(s.spalte)} = @w${i}`).join(", ")} WHERE ${bed}; SELECT @@ROWCOUNT AS n;`);
    const n = anzahl(r);
    if (n !== 1) throw new Error(`Abgebrochen: ${n} Zeilen wären geändert worden.`);
    protokoll({ aktion: "ÄNDERN", wer, tabelle: meta.voll, schluessel, alt: Object.fromEntries(spalten.map(s => [s.spalte, alt[s.spalte]])), neu: werte });
    return { geaendert: 1 };
  });
}

async function zeileLoeschen(name, schluessel, wer) {
  const meta = await tabellenMeta(name);
  return inTransaktion(async (tx) => {
    const alt = await alteZeile(tx, meta, schluessel);
    const req = new sql.Request(tx);
    const bed = schluesselBedingung(meta, req, schluessel);
    const n = anzahl(await req.query(`SET NOCOUNT ON; DELETE FROM ${qi(meta.schema)}.${qi(meta.table)} WHERE ${bed}; SELECT @@ROWCOUNT AS n;`));
    if (n !== 1) throw new Error(`Abgebrochen: ${n} Zeilen wären gelöscht worden.`);
    protokoll({ aktion: "LÖSCHEN", wer, tabelle: meta.voll, schluessel, alt });
    return { geloescht: 1 };
  });
}

// ---------------------------------------------------------------------
// 5b. Plan d'actions (Maßnahmenplan, ISO 50001 §6.2)
//     Enregistré dans le fichier massnahmen.json à côté de ce fichier (aucune modification de la base).
//     Créer / modifier / supprimer : rôle « bearbeiter » ou « admin ».
// ---------------------------------------------------------------------
const MASSNAHMEN_DATEI = path.join(DATEN, "massnahmen.json");
const M_ANLAGEN = ["P1", "P2", "UB", "ME", "ST", "SO"];
const M_STATUS = ["geplant", "umsetzung", "umgesetzt", "abgebrochen"];
const M_PRIO = ["hoch", "mittel", "niedrig"];
const darfSchreiben = (req) => ["bearbeiter", "admin"].includes(req.benutzer?.rolle);

function massnahmenLesen() {
  try { return JSON.parse(fs.readFileSync(MASSNAHMEN_DATEI, "utf8")); }
  catch (err) { if (err.code === "ENOENT") return []; throw new Error(`massnahmen.json ist beschädigt: ${err.message}`); }
}
function massnahmenSchreiben(liste) {
  const tmp = MASSNAHMEN_DATEI + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(liste, null, 2), "utf8");
  fs.renameSync(tmp, MASSNAHMEN_DATEI);              // écriture atomique
}
function massnahmePruefen(e) {
  const fehler = (t) => { const x = new Error(t); x.status = 400; throw x; };
  const text = (v, max) => (v == null || v === "" ? null : String(v).trim().slice(0, max));
  const datum = (v, feld) => {
    if (v == null || v === "") return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || isNaN(new Date(v))) fehler(`„${feld}“ ist kein gültiges Datum.`);
    return String(v);
  };
  const zahl = (v, feld) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) fehler(`„${feld}“ muss eine positive Zahl sein.`);
    return n;
  };
  const titel = text(e?.titel, 200);
  if (!titel) fehler("Bitte einen Titel eingeben.");
  if (!M_ANLAGEN.includes(e.anlage)) fehler("Bitte eine gültige Anlage wählen.");
  const status = M_STATUS.includes(e.status) ? e.status : "geplant";
  return {
    titel, anlage: e.anlage, status,
    prioritaet: M_PRIO.includes(e.prioritaet) ? e.prioritaet : "mittel",
    beschreibung: text(e.beschreibung, 2000), verantwortlich: text(e.verantwortlich, 120),
    start: datum(e.start, "Start"), frist: datum(e.frist, "Frist"),
    umgesetztAm: status === "umgesetzt" ? (datum(e.umgesetztAm, "Umgesetzt am") || new Date().toISOString().slice(0, 10)) : datum(e.umgesetztAm, "Umgesetzt am"),
    einsparung: zahl(e.einsparung, "Erwartete Einsparung"), kosten: zahl(e.kosten, "Kosten"),
    notiz: text(e.notiz, 2000)
  };
}
function darfPlanen(req, res) {
  if (!darfSchreiben(req)) {
    res.status(403).json({ fehler: "Keine Berechtigung: Ihre Rolle erlaubt nur das Lesen." });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------
// 6. Assistant IA (Claude) – lecture seule
// ---------------------------------------------------------------------
async function produktionJahr(jahr) {
  const { aktuell } = await produktion(jahr);
  if (!aktuell.length) return { jahr, hinweis: `Keine Daten für ${jahr}.` };
  const summe = (k) => aktuell.reduce((s, r) => s + (r[k] || 0), 0);
  const gesamt = summe("gesamt");
  const sortiert = [...aktuell].sort((a, b) => b.gesamt - a.gesamt);
  const pct = (v) => Math.round((v / gesamt) * 1000) / 10;
  return {
    jahr,
    monate_mit_daten: aktuell.length,
    summe: { presse_1: summe("presse1"), presse_2: summe("presse2"), ubc: summe("ubc"), gesamt },
    anteil_prozent: { presse_1: pct(summe("presse1")), presse_2: pct(summe("presse2")), ubc: pct(summe("ubc")) },
    durchschnitt_pro_monat: Math.round(gesamt / aktuell.length),
    staerkster_monat: { monat: sortiert[0].Monatname, gesamt: sortiert[0].gesamt },
    schwaechster_monat: { monat: sortiert.at(-1).Monatname, gesamt: sortiert.at(-1).gesamt },
    monate: aktuell.map(r => ({ monat: r.Monatname, presse_1: r.presse1, presse_2: r.presse2, ubc: r.ubc, gesamt: r.gesamt, abschaum_bewegungen: r.abschaum }))
  };
}

const jahrParam = { type: "object", properties: { jahr: { type: "integer", description: "z. B. 2026" } }, required: ["jahr"] };
const WERKZEUGE = [
  { name: "verfuegbare_jahre", description: "Gibt die Jahre zurück, für die Produktionsdaten vorhanden sind.",
    input_schema: { type: "object", properties: {} }, run: () => jahre() },
  { name: "produktion_jahr", description: "Monatswerte und fertig berechnete Kennzahlen (Summen, Anteile, Durchschnitt, stärkster/schwächster Monat) " +
      "der Produktion für ein Jahr. Für fast alle Fragen zur Produktion zuerst dieses Werkzeug benutzen.",
    input_schema: jahrParam, run: (a) => produktionJahr(parseInt(a.jahr, 10)) },
  { name: "energie_jahr", description: "Monatswerte der Tabelle SEUWerte (Energieverbrauch, verarbeitete Menge und spezifischer Verbrauch " +
      "je Anlage: Presse I, Presse II, UBC-Aufbereitung, ME) für ein Jahr.",
    input_schema: jahrParam, run: async (a) => (await energie(parseInt(a.jahr, 10))).aktuell },
  { name: "seu_kpi_jahr", description: "KPI der wesentlichen Energieeinsätze (Tabelle KeyPerformanceIndicatorsMonth, Typen aus KPIType, " +
      "Namen aus SignificantEnergyUsers) für ein Jahr und das Vorjahr: je Zeile SEU, Monat, KPI-Typ, Zähler, Nenner, KPI, Prozent.",
    input_schema: jahrParam, run: async (a) => {
      const d = await kpiDaten(parseInt(a.jahr, 10), "monat");
      const typ = Object.fromEntries(d.typen.map(t => [t.id, t.name])), seu = Object.fromEntries(d.seus.map(s => [s.id, s.name]));
      return d.zeilen.map(z => ({ ...z, typ: typ[z.typ] ?? z.typ, seu: seu[z.seu] ?? z.seu }));
    } },
  { name: "massnahmen", description: "Liste der Energieeinsparmaßnahmen (Maßnahmenplan): Titel, Anlage (P1, P2, UB, ME, ST = Standort, SO = sonstige), " +
      "Status (geplant, umsetzung, umgesetzt, abgebrochen), Priorität, Verantwortlich, Frist, umgesetzt am, erwartete Einsparung je Jahr.",
    input_schema: { type: "object", properties: {} }, run: () => massnahmenLesen() },
  { name: "sql_lesen", description: "Führt eine SELECT-Abfrage (T-SQL, SQL Server) aus. Nur Lesen. Nur verwenden, wenn produktion_jahr nicht reicht.",
    input_schema: { type: "object", properties: { abfrage: { type: "string" } }, required: ["abfrage"] },
    run: (a, abfragen) => { abfragen.push(a.abfrage); return sqlLesen(a.abfrage); } },
  { name: "tabellen_auflisten", description: "Listet alle Tabellen der Datenbank MRS_BI.",
    input_schema: { type: "object", properties: {} }, run: () => tabellenListe() },
  { name: "tabelle_beschreiben", description: "Zeigt die Spalten einer Tabelle.",
    input_schema: { type: "object", properties: { tabelle: { type: "string" } }, required: ["tabelle"] }, run: (a) => tabelleBeschreiben(a.tabelle) }
];

const systemPrompt = (jahr) => `Du bist der Datenassistent der Produktion der Firma MRS (Aluminium-Recycling).
Heute ist der ${new Date().toLocaleDateString("de-DE")}. In der Oberfläche ist das Jahr ${jahr} gewählt:
Wenn die Frage kein Jahr nennt, beziehe dich auf ${jahr}.

Wichtigste Tabelle: dbo.ProduktionMonat, eine Zeile pro Monat.
- Presse I, Presse II: Durchsatz der zwei Pressen
- UBC: Input der Dosen-Aufbereitung (Used Beverage Cans)
- Gesamt = Presse I + Presse II + UBC
- Arbeitstage werden nicht gepflegt (0 oder leer): keine Werte pro Arbeitstag berechnen.
- Die Einheit ist nicht hinterlegt (vermutlich kg).
Spaltennamen für SQL: [Jahr], [Monat], [Monatname], [Durchsatz Presse I], [Durchsatz Presse II],
[Input UBC-Aufbereitung], [Material verarbeitet gesamt], [Menge Bewegungen Abschaum].

Energie: Tabelle dbo.SEUWerte (SEU = wesentliche Energieeinsätze nach ISO 50001), eine Zeile pro Monat.
- Präfixe: P1 = Presse I, P2 = Presse II, UB = UBC-Aufbereitung, ME = weitere Anlage mit Betriebsstunden.
- *_Verbrauch = Energieverbrauch, *_Verarbeitung = verarbeitete Menge, *_Wert = spezifischer Verbrauch (Verbrauch je Menge).
- ME_Stunden, ME_ProTonne, ME_ProStunde, ME_ProTonneGesamtmenge, ME_Wert: Kennzahlen der Anlage ME.
- Der Monatsname heißt in dieser Tabelle [Manatname] (Schreibfehler in der Datenbank).
- Einheiten sind nicht hinterlegt (vermutlich kWh und Tonnen).
Energiekennzahlen (ISO 50001 / ISO 50006):
- EnPI über mehrere Monate IMMER gewichtet: Summe Verbrauch ÷ Summe Verarbeitung (ME: ÷ Summe ME_Stunden, Standort: ÷ Summe Gesamtmenge),
  nie den Mittelwert der Monatswerte *_Wert bilden.
- SEU-Bewertung: Anlagen nach Verbrauch sortieren; die Anlagen bis ca. 80 % kumuliertem Anteil sind wesentliche Energieeinsätze.
- Vergleich mit einem Basisjahr immer über die gleichen Monate. Ein sinkender EnPI ist eine Verbesserung.
- Baseline-Modell: lineare Regression Verbrauch = a + b × Verarbeitung über die Monate des Basisjahres (a = Grundlast);
  Einsparung = erwarteter − tatsächlicher Verbrauch, CUSUM = kumulierte Einsparung. R² unter 0,75 als eingeschränkt belastbar nennen.
SEU-KPI: Tabellen dbo.KeyPerformanceIndicatorsMonth (Monatswerte) und dbo.KeyPerformanceIndicators, Spalten
SignificantEnergyUsersID, Jahr, Monat, Manatname, Zaehler, Nenner, KPITyp, KPI, Prozent; Namen der KPI-Typen in dbo.KPIType (KPITypeID, Bezeichnung).
Für Fragen dazu zuerst seu_kpi_jahr benutzen. KPI über mehrere Monate gewichtet: Summe Zaehler ÷ Summe Nenner.
Die Datenbank enthält weitere Tabellen: bei Fragen dazu zuerst tabellen_auflisten und tabelle_beschreiben benutzen.

Regeln:
- Benutze IMMER zuerst ein Werkzeug, bevor du Zahlen nennst. Erfinde niemals Zahlen.
- Übernimm fertig berechnete Kennzahlen aus produktion_jahr, statt selbst zu rechnen.
- Antworte auf Deutsch, kurz und klar. Zahlen im deutschen Format (1.234.567).
- Keine Markdown-Tabellen oder Überschriften; kurze Absätze und Aufzählungen mit "- ".
- Für Ursachen ("warum") vergleiche die Quellen mit ihrem Durchschnitt und sag klar, was die Daten zeigen und was nicht.
- Wenn die Daten eine Frage nicht beantworten können, sag das ehrlich.`;

async function frageClaude(verlauf, jahr) {
  const messages = verlauf
    .filter(m => (m.rolle === "nutzer" || m.rolle === "assistent") && typeof m.text === "string" && m.text.trim())
    .slice(-12)
    .map(m => ({ role: m.rolle === "nutzer" ? "user" : "assistant", content: m.text.slice(0, 4000) }));
  if (!messages.length || messages.at(-1).role !== "user") { const e = new Error("Keine Frage erhalten."); e.eigen = true; throw e; }

  const abfragen = [];
  const tools = WERKZEUGE.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  for (let runde = 0; runde < 8; runde++) {
    const a = await claude.messages.create({ model: MODELL, max_tokens: 2000, system: systemPrompt(jahr), tools, messages });
    if (a.stop_reason !== "tool_use") {
      return { antwort: a.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim() || "(keine Antwort)", abfragen };
    }
    messages.push({ role: "assistant", content: a.content });
    const ergebnisse = [];
    for (const b of a.content.filter(b => b.type === "tool_use")) {
      const w = WERKZEUGE.find(x => x.name === b.name);
      let inhalt, fehler = false;
      try {
        if (!w) throw new Error(`Unbekanntes Werkzeug: ${b.name}`);
        inhalt = JSON.stringify(await w.run(b.input || {}, abfragen));
      } catch (err) { inhalt = `Fehler: ${err.message}`; fehler = true; }
      ergebnisse.push({ type: "tool_result", tool_use_id: b.id, content: inhalt.slice(0, 20000), is_error: fehler });
    }
    messages.push({ role: "user", content: ergebnisse });
  }
  return { antwort: "Die Frage war zu komplex. Bitte einfacher oder genauer formulieren.", abfragen };
}

// ---------------------------------------------------------------------
// 7. Routes API + démarrage
// ---------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(DOSSIER, "dist")));   // interface React construite par « npm run build »

// ---------------------------------------------------------------------
// Connexion et rôles
//   leser      : tout voir, rien modifier
//   bearbeiter : en plus modifier les tables (si ALLOW_WRITE=true) et le plan d'actions
//   admin      : en plus gérer les utilisateurs et voir le protocole des modifications
// Comptes dans benutzer.json (mots de passe chiffrés avec scrypt), sessions en mémoire (8 h).
// Au tout premier démarrage, le compte administrateur se crée depuis le PC du serveur.
// ---------------------------------------------------------------------
const BENUTZER_DATEI = path.join(DATEN, "benutzer.json");
const ROLLEN = ["leser", "bearbeiter", "admin"];
const SITZUNG_MS = 8 * 3600 * 1000;
const sitzungen = new Map();                 // jeton → { login, ablauf }
const fehlversuche = new Map();              // ip → { n, bis }

function benutzerLesen() {
  try { return JSON.parse(fs.readFileSync(BENUTZER_DATEI, "utf8")); }
  catch (err) { if (err.code === "ENOENT") return []; throw new Error(`benutzer.json ist beschädigt: ${err.message}`); }
}
function benutzerSchreiben(liste) {
  const tmp = BENUTZER_DATEI + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(liste, null, 2), "utf8");
  fs.renameSync(tmp, BENUTZER_DATEI);
}
function pwHash(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(String(pw), salt, 64).toString("hex")}`;
}
function pwStimmt(pw, gespeichert) {
  const [salt, h] = String(gespeichert || "").split(":");
  if (!salt || !h) return false;
  const a = crypto.scryptSync(String(pw ?? ""), salt, 64), b = Buffer.from(h, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const oeffentlich = (b) => ({ login: b.login, name: b.name, rolle: b.rolle, aktiv: b.aktiv !== false, letzteAnmeldung: b.letzteAnmeldung ?? null, erstellt: b.erstellt ?? null,
  email: b.email ?? null, abo: { woche: !!b.abo?.woche, kritisch: !!b.abo?.kritisch, fristen: !!b.abo?.fristen } });
// adresse et abonnements (création / modification par l'admin)
function emailUndAbo(ziel, d) {
  if (d.email !== undefined) {
    const e = String(d.email ?? "").trim();
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { const x = new Error("Bitte eine gültige E-Mail-Adresse eingeben."); x.status = 400; throw x; }
    ziel.email = e || null;
  }
  if (d.abo) ziel.abo = { woche: !!d.abo.woche, kritisch: !!d.abo.kritisch, fristen: !!d.abo.fristen };
}
const istLokal = (req) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
const kekse = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map(x => x.trim()).filter(Boolean)
  .map(x => { const i = x.indexOf("="); return [x.slice(0, i), decodeURIComponent(x.slice(i + 1))]; }));
const fehler400 = (t, status = 400) => { const e = new Error(t); e.status = status; return e; };

function sitzungVon(req) {
  const t = kekse(req).mrs_sitzung;
  const s = t && sitzungen.get(t);
  if (!s || s.ablauf < Date.now()) { if (t) sitzungen.delete(t); return null; }
  const b = benutzerLesen().find(x => x.login === s.login && x.aktiv !== false);
  if (!b) { sitzungen.delete(t); return null; }
  s.ablauf = Date.now() + SITZUNG_MS;        // la session se prolonge tant qu'on travaille
  return { token: t, benutzer: b };
}
function sitzungStarten(res, login) {
  const t = crypto.randomBytes(32).toString("hex");
  sitzungen.set(t, { login, ablauf: Date.now() + SITZUNG_MS });
  res.setHeader("Set-Cookie", `mrs_sitzung=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SITZUNG_MS / 1000}`);
}
const sitzungenBeenden = (login) => { for (const [t, s] of sitzungen) if (s.login === login) sitzungen.delete(t); };
function pruefeNeu(d, liste, neu = true) {
  const login = String(d.login ?? "").trim().toLowerCase();
  const name = String(d.name ?? "").trim().slice(0, 80);
  if (neu && !/^[a-z0-9._-]{3,32}$/.test(login)) throw fehler400("Benutzername: 3 bis 32 Zeichen, nur Buchstaben, Ziffern, Punkt, Bindestrich, Unterstrich.");
  if (neu && liste.some(x => x.login === login)) throw fehler400("Diesen Benutzernamen gibt es schon.");
  if (!name) throw fehler400("Bitte einen Namen eingeben.");
  if (d.rolle !== undefined && !ROLLEN.includes(d.rolle)) throw fehler400("Ungültige Rolle.");
  if ((neu || d.passwort) && String(d.passwort ?? "").length < 8) throw fehler400("Das Passwort muss mindestens 8 Zeichen haben.");
  return { login, name };
}

app.get("/api/auth/status", (req, res) => {
  const liste = benutzerLesen(), s = sitzungVon(req);
  res.json({ eingerichtet: liste.length > 0, einrichtungErlaubt: istLokal(req), benutzer: s ? oeffentlich(s.benutzer) : null });
});
app.post("/api/auth/einrichten", (req, res) => {
  try {
    const liste = benutzerLesen();
    if (liste.length) throw fehler400("Die Anmeldung ist bereits eingerichtet.", 409);
    if (!istLokal(req)) throw fehler400("Die Einrichtung ist nur direkt am Server-PC möglich.", 403);
    const { login, name } = pruefeNeu(req.body, liste);
    const jetzt = new Date().toISOString();
    benutzerSchreiben([{ login, name, rolle: "admin", aktiv: true, hash: pwHash(req.body.passwort), erstellt: jetzt, letzteAnmeldung: jetzt }]);
    protokoll({ aktion: "BENUTZER EINRICHTEN", wer: login, tabelle: "benutzer.json", neu: { login, name, rolle: "admin" } });
    sitzungStarten(res, login);
    res.json({ benutzer: oeffentlich({ login, name, rolle: "admin" }) });
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.post("/api/auth/anmelden", (req, res) => {
  const ip = req.socket.remoteAddress, f = fehlversuche.get(ip);
  if (f && f.bis > Date.now()) return res.status(429).json({ fehler: `Zu viele Fehlversuche. Bitte in ${Math.ceil((f.bis - Date.now()) / 1000)} Sekunden erneut versuchen.` });
  const liste = benutzerLesen();
  const b = liste.find(x => x.login === String(req.body?.login ?? "").trim().toLowerCase());
  if (!b || b.aktiv === false || !pwStimmt(req.body?.passwort, b.hash)) {
    const n = (f?.n || 0) + 1;
    fehlversuche.set(ip, { n, bis: n >= 5 ? Date.now() + 60000 : 0 });
    return res.status(401).json({ fehler: "Benutzername oder Passwort ist falsch." });
  }
  fehlversuche.delete(ip);
  b.letzteAnmeldung = new Date().toISOString();
  benutzerSchreiben(liste);
  sitzungStarten(res, b.login);
  res.json({ benutzer: oeffentlich(b) });
});
app.post("/api/auth/abmelden", (req, res) => {
  const t = kekse(req).mrs_sitzung;
  if (t) sitzungen.delete(t);
  res.setHeader("Set-Cookie", "mrs_sitzung=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
  res.json({ ok: true });
});

// toutes les autres routes /api demandent une session
app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/auth/")) return next();
  const s = sitzungVon(req);
  if (!s) return res.status(401).json({ fehler: "Bitte anmelden.", anmeldung: true });
  req.benutzer = s.benutzer;
  next();
});
const nurAdmin = (req) => { if (req.benutzer.rolle !== "admin") throw fehler400("Nur für Administratoren.", 403); };

app.post("/api/auth/passwort", (req, res) => {
  const s = sitzungVon(req);
  if (!s) return res.status(401).json({ fehler: "Bitte anmelden.", anmeldung: true });
  try {
    const liste = benutzerLesen(), b = liste.find(x => x.login === s.benutzer.login);
    if (!pwStimmt(req.body?.alt, b.hash)) throw fehler400("Das bisherige Passwort ist falsch.");
    if (String(req.body?.neu ?? "").length < 8) throw fehler400("Das neue Passwort muss mindestens 8 Zeichen haben.");
    b.hash = pwHash(req.body.neu);
    benutzerSchreiben(liste);
    protokoll({ aktion: "PASSWORT GEÄNDERT", wer: b.login, tabelle: "benutzer.json" });
    res.json({ ok: true });
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});

// --- gestion des utilisateurs (admin) ---
app.get("/api/benutzer", (req, res) => { try { nurAdmin(req); res.json(benutzerLesen().map(oeffentlich)); } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); } });
app.post("/api/benutzer", (req, res) => {
  try {
    nurAdmin(req);
    const liste = benutzerLesen();
    const { login, name } = pruefeNeu(req.body, liste);
    const neu = { login, name, rolle: req.body.rolle || "leser", aktiv: true, hash: pwHash(req.body.passwort), erstellt: new Date().toISOString(), letzteAnmeldung: null };
    emailUndAbo(neu, req.body);
    benutzerSchreiben([...liste, neu]);
    protokoll({ aktion: "BENUTZER NEU", wer: req.benutzer.login, tabelle: "benutzer.json", neu: oeffentlich(neu) });
    res.json(oeffentlich(neu));
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.put("/api/benutzer/:login", (req, res) => {
  try {
    nurAdmin(req);
    const liste = benutzerLesen(), b = liste.find(x => x.login === req.params.login);
    if (!b) throw fehler400("Benutzer nicht gefunden.", 404);
    const { name } = pruefeNeu({ ...req.body, name: req.body.name ?? b.name }, liste, false);
    const rolle = req.body.rolle ?? b.rolle, aktiv = req.body.aktiv ?? (b.aktiv !== false);
    const adminsDanach = liste.filter(x => (x.login === b.login ? rolle === "admin" && aktiv : x.rolle === "admin" && x.aktiv !== false)).length;
    if (!adminsDanach) throw fehler400("Es muss mindestens ein aktiver Administrator bleiben.");
    const alt = oeffentlich(b);
    Object.assign(b, { name, rolle, aktiv });
    emailUndAbo(b, req.body);
    if (req.body.passwort) b.hash = pwHash(req.body.passwort);
    benutzerSchreiben(liste);
    if (!aktiv || req.body.passwort || rolle !== alt.rolle) sitzungenBeenden(b.login);
    protokoll({ aktion: "BENUTZER ÄNDERN", wer: req.benutzer.login, tabelle: "benutzer.json", alt, neu: { ...oeffentlich(b), passwortNeu: !!req.body.passwort } });
    res.json(oeffentlich(b));
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.delete("/api/benutzer/:login", (req, res) => {
  try {
    nurAdmin(req);
    if (req.params.login === req.benutzer.login) throw fehler400("Sie können sich nicht selbst löschen.");
    const liste = benutzerLesen(), b = liste.find(x => x.login === req.params.login);
    if (!b) throw fehler400("Benutzer nicht gefunden.", 404);
    benutzerSchreiben(liste.filter(x => x.login !== b.login));
    sitzungenBeenden(b.login);
    protokoll({ aktion: "BENUTZER LÖSCHEN", wer: req.benutzer.login, tabelle: "benutzer.json", alt: oeffentlich(b) });
    res.json({ geloescht: 1 });
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
// ---------------------------------------------------------------------
// Sauvegardes automatiques (chaque nuit + au démarrage si la dernière a plus de 24 h)
//   BACKUP_ORDNER  dossier des sauvegardes (défaut : ./sicherungen)
//   BACKUP_ZIEL    deuxième copie, par ex. un partage réseau \\server\\freigabe\\mrs (optionnel)
//   BACKUP_ANZAHL  nombre de sauvegardes gardées (défaut : 30)
//   BACKUP_STUNDE  heure de la sauvegarde nocturne (défaut : 2)
// La .env n'est PAS sauvegardée (elle contient des mots de passe) : la garder à part.
// ---------------------------------------------------------------------
const SICHERUNG_DATEIEN = ["benutzer.json", "massnahmen.json", "kommentare.json", "einstellungen.json", "aenderungen.log"];
const WIEDERHERSTELLBAR = ["benutzer.json", "massnahmen.json", "kommentare.json", "einstellungen.json"];
const BACKUP_ORDNER = path.resolve(DATEN, env("BACKUP_ORDNER", "sicherungen"));
const BACKUP_ZIEL = env("BACKUP_ZIEL", "") ? path.resolve(env("BACKUP_ZIEL")) : null;
const BACKUP_ANZAHL = Math.max(3, parseInt(env("BACKUP_ANZAHL", "30"), 10) || 30);
const BACKUP_STUNDE = Math.min(23, Math.max(0, parseInt(env("BACKUP_STUNDE", "2"), 10) || 2));
const SICHERUNG_NAME = /^\d{4}-\d{2}-\d{2}_\d{6}(_[a-z]+)?$/;

function sicherungenListe() {
  try {
    return fs.readdirSync(BACKUP_ORDNER).filter(n => SICHERUNG_NAME.test(n)).sort().reverse().map(name => {
      const dateien = fs.readdirSync(path.join(BACKUP_ORDNER, name));
      const groesse = dateien.reduce((s, d) => s + fs.statSync(path.join(BACKUP_ORDNER, name, d)).size, 0);
      const [d, t, art] = name.split("_");
      return { name, zeit: new Date(`${d}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`).toISOString(), art: art || "auto", dateien, groesse };
    });
  } catch { return []; }
}
function sichern(art = "auto") {
  const jetzt = new Date(), z = (n) => String(n).padStart(2, "0");
  const name = `${jetzt.getFullYear()}-${z(jetzt.getMonth() + 1)}-${z(jetzt.getDate())}_${z(jetzt.getHours())}${z(jetzt.getMinutes())}${z(jetzt.getSeconds())}${art === "auto" ? "" : `_${art}`}`;
  const ziel = path.join(BACKUP_ORDNER, name);
  fs.mkdirSync(ziel, { recursive: true });
  const kopiert = [];
  for (const d of SICHERUNG_DATEIEN) {
    const quelle = path.join(DATEN, d);
    if (fs.existsSync(quelle)) { fs.copyFileSync(quelle, path.join(ziel, d)); kopiert.push(d); }
  }
  if (!kopiert.length && art === "auto") { fs.rmSync(ziel, { recursive: true, force: true }); return null; }   // rien à sauvegarder encore
  if (BACKUP_ZIEL) {
    try { fs.cpSync(ziel, path.join(BACKUP_ZIEL, name), { recursive: true }); }
    catch (err) { console.error(`[Sicherung] Zweite Kopie nach ${BACKUP_ZIEL} fehlgeschlagen:`, err.message); }
  }
  // seules les sauvegardes automatiques sont supprimées au-delà de BACKUP_ANZAHL
  const auto = sicherungenListe().filter(x => x.art === "auto");
  for (const alt of auto.slice(BACKUP_ANZAHL)) fs.rmSync(path.join(BACKUP_ORDNER, alt.name), { recursive: true, force: true });
  console.log(`[Sicherung] ${name}: ${kopiert.join(", ") || "keine Dateien"}`);
  return name;
}
function naechtlicheSicherung() {
  const letzte = sicherungenListe().find(x => x.art === "auto");
  if (!letzte || Date.now() - new Date(letzte.zeit) > 24 * 3600 * 1000) { try { sichern("auto"); } catch (err) { console.error("[Sicherung]", err.message); } }
  const n = new Date(), next = new Date(n); next.setHours(BACKUP_STUNDE, 0, 0, 0);
  if (next <= n) next.setDate(next.getDate() + 1);
  setTimeout(() => { try { sichern("auto"); } catch (err) { console.error("[Sicherung]", err.message); } naechtlicheSicherung(); }, next - n);
}

app.get("/api/system", async (req, res) => {
  try {
    nurAdmin(req);
    let db = { ok: true };
    try { await (await pool()).request().query("SELECT 1 AS ok"); } catch (err) { db = { ok: false, fehler: err.message }; }
    res.json({
      version: VERSION, node: process.version, gestartet: GESTARTET.toISOString(), laufzeitSek: Math.round(process.uptime()),
      speicherMB: Math.round(process.memoryUsage().rss / 1048576), host: HOST, port: PORT, datenbank: DB_INFO, db,
      ki: !!claude, bearbeiten: BEARBEITEN_AKTIV, benutzer: benutzerLesen().length, sitzungen: sitzungen.size,
      log: logDatei(), sicherung: { ordner: BACKUP_ORDNER, zweitesZiel: BACKUP_ZIEL, anzahl: BACKUP_ANZAHL, stunde: BACKUP_STUNDE },
      sicherungen: sicherungenListe()
    });
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.post("/api/sicherungen", (req, res) => {
  try { nurAdmin(req); const name = sichern("manuell"); protokoll({ aktion: "SICHERUNG", wer: req.benutzer.login, tabelle: name }); res.json({ name }); }
  catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.post("/api/sicherungen/:name/wiederherstellen", (req, res) => {
  try {
    nurAdmin(req);
    if (!SICHERUNG_NAME.test(req.params.name)) throw fehler400("Ungültige Sicherung.");
    const ordner = path.join(BACKUP_ORDNER, req.params.name);
    if (!fs.existsSync(ordner)) throw fehler400("Sicherung nicht gefunden.", 404);
    const davor = sichern("vorher");                          // état actuel gardé avant de restaurer
    const zurueck = [];
    for (const d of WIEDERHERSTELLBAR) {
      const q = path.join(ordner, d);
      if (fs.existsSync(q)) { JSON.parse(fs.readFileSync(q, "utf8")); fs.copyFileSync(q, path.join(DATEN, d)); zurueck.push(d); }
    }
    if (zurueck.includes("benutzer.json")) {
      const logins = new Set(benutzerLesen().filter(b => b.aktiv !== false).map(b => b.login));
      for (const [t, s] of sitzungen) if (!logins.has(s.login)) sitzungen.delete(t);
    }
    protokoll({ aktion: "WIEDERHERSTELLUNG", wer: req.benutzer.login, tabelle: req.params.name, neu: { dateien: zurueck, sicherungDavor: davor } });
    res.json({ dateien: zurueck, sicherungDavor: davor });
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.get("/api/sicherungen/:name/download", (req, res) => {
  try {
    nurAdmin(req);
    if (!SICHERUNG_NAME.test(req.params.name)) throw fehler400("Ungültige Sicherung.");
    const ordner = path.join(BACKUP_ORDNER, req.params.name);
    if (!fs.existsSync(ordner)) throw fehler400("Sicherung nicht gefunden.", 404);
    const inhalt = Object.fromEntries(fs.readdirSync(ordner).map(d => [d, fs.readFileSync(path.join(ordner, d), "utf8")]));
    res.setHeader("Content-Disposition", `attachment; filename="MRS_Sicherung_${req.params.name}.json"`);
    res.json({ sicherung: req.params.name, version: VERSION, dateien: inhalt });
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});

// protocole des modifications (les 500 dernières lignes, la plus récente en premier)
app.get("/api/protokoll", (req, res) => {
  try {
    nurAdmin(req);
    let text = "";
    try { text = fs.readFileSync(path.join(DATEN, "aenderungen.log"), "utf8"); } catch { /* pas encore de fichier */ }
    const zeilen = text.split("\n").filter(Boolean).slice(-500).reverse().map((z, i) => { try { return { nr: i, ...JSON.parse(z) }; } catch { return { nr: i, aktion: "?", roh: z }; } });
    res.json(zeilen);
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});

// Petit raccourci : exécute la fonction et renvoie le JSON (ou l'erreur)
const route = (fn, code = 500) => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (err) { res.status(err.status || code).json({ fehler: err.message }); }
};
const jahrAus = (req) => {
  const j = parseInt(req.query.jahr, 10);
  if (!Number.isInteger(j) || j < 2000 || j > 2100) { const e = new Error("Ungültiges Jahr"); e.status = 400; throw e; }
  return j;
};

app.get("/api/jahre", route(() => jahre()));
app.get("/api/produktion", route((req) => produktion(jahrAus(req))));
app.get("/api/energie/jahre", route(() => energieJahre()));
app.get("/api/kpi", route((req) => req.query.quelle === "berechnet" ? kpiBerechnet(jahrAus(req))
  : kpiDaten(jahrAus(req), req.query.quelle === "gesamt" ? "gesamt" : "monat")));
app.get("/api/energie", route((req) => energie(jahrAus(req))));
app.get("/api/status", (req, res) => res.json({ ki: !!claude, modell: claude ? MODELL : null }));
app.get("/api/tabellen", route(() => tabellenListe()));
app.get("/api/tabellen/:name/uebersicht", async (req, res) => {
  try { res.json(await tabellenUebersicht(req.params.name, zahlParam(req.query.jahr, 1900, 2100), zahlParam(req.query.monat, 1, 12))); }
  catch (err) { res.status(/nicht gefunden/.test(err.message) ? 404 : 500).json({ fehler: err.message }); }
});
app.get("/api/tabellen/:name", async (req, res) => {
  try { res.json(await tabellenVorschau(req.params.name, req.query.limit, zahlParam(req.query.jahr, 1900, 2100), zahlParam(req.query.monat, 1, 12))); }
  catch (err) { res.status(/nicht gefunden/.test(err.message) ? 404 : 500).json({ fehler: err.message }); }
});

// --- Modification des tables (ALLOW_WRITE=true dans .env + rôle bearbeiter/admin) ---
const tabelleErlaubt = (name) => {
  if (!EDIT_TABELLEN.length) return true;
  const n = String(name).toLowerCase();
  return EDIT_TABELLEN.includes(n) || EDIT_TABELLEN.includes(n.replace(/^dbo\./, ""));
};
function darfBearbeiten(req, res) {
  if (!BEARBEITEN_AKTIV) return res.status(403).json({ fehler: "Bearbeiten ist ausgeschaltet (ALLOW_WRITE=true in .env nötig)." }), false;
  if (!darfSchreiben(req)) return res.status(403).json({ fehler: "Keine Berechtigung: Ihre Rolle erlaubt nur das Lesen." }), false;
  if (req.params.name && !tabelleErlaubt(req.params.name)) return res.status(403).json({ fehler: "Diese Tabelle darf nicht bearbeitet werden (siehe EDIT_TABELLEN in .env)." }), false;
  return true;
}
const bearbeiten = (fn) => async (req, res) => {
  if (!darfBearbeiten(req, res)) return;
  try { res.json(await fn(req)); }
  catch (err) { console.error(`[Bearbeiten] ${req.method} ${req.params.name}:`, err.message); res.status(400).json({ fehler: err.message }); }
};

app.get("/api/bearbeiten/status", (req, res) => res.json({ aktiv: BEARBEITEN_AKTIV && darfSchreiben(req), passwort: false, tabellen: EDIT_TABELLEN.length ? EDIT_TABELLEN : null }));
app.post("/api/bearbeiten/pruefen", (req, res) => { if (darfBearbeiten(req, res)) res.json({ ok: true }); });
app.post("/api/tabellen/:name/zeilen", bearbeiten((req) => zeileEinfuegen(req.params.name, req.body?.werte, req.benutzer.login)));
app.put("/api/tabellen/:name/zeilen", bearbeiten((req) => zeileAendern(req.params.name, req.body?.schluessel, req.body?.werte, req.benutzer.login)));
app.delete("/api/tabellen/:name/zeilen", bearbeiten((req) => zeileLoeschen(req.params.name, req.body?.schluessel, req.benutzer.login)));

// --- Plan d'actions ---
app.get("/api/massnahmen", route((req) => ({ liste: massnahmenLesen(), schutz: false, darf: darfSchreiben(req) })));
app.post("/api/massnahmen", (req, res) => {
  if (!darfPlanen(req, res)) return;
  try {
    const liste = massnahmenLesen();
    const jetzt = new Date().toISOString();
    const neu = { id: crypto.randomUUID(), ...massnahmePruefen(req.body), erstellt: jetzt, geaendert: jetzt };
    massnahmenSchreiben([...liste, neu]);
    protokoll({ aktion: "MASSNAHME NEU", wer: req.benutzer.login, tabelle: "massnahmen.json", neu });
    res.json(neu);
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.put("/api/massnahmen/:id", (req, res) => {
  if (!darfPlanen(req, res)) return;
  try {
    const liste = massnahmenLesen();
    const i = liste.findIndex(x => x.id === req.params.id);
    if (i < 0) return res.status(404).json({ fehler: "Maßnahme nicht gefunden." });
    const alt = liste[i];
    liste[i] = { ...alt, ...massnahmePruefen({ ...alt, ...req.body }), geaendert: new Date().toISOString() };
    massnahmenSchreiben(liste);
    protokoll({ aktion: "MASSNAHME ÄNDERN", wer: req.benutzer.login, tabelle: "massnahmen.json", alt, neu: liste[i] });
    res.json(liste[i]);
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.delete("/api/massnahmen/:id", (req, res) => {
  if (!darfPlanen(req, res)) return;
  try {
    const liste = massnahmenLesen();
    const alt = liste.find(x => x.id === req.params.id);
    if (!alt) return res.status(404).json({ fehler: "Maßnahme nicht gefunden." });
    massnahmenSchreiben(liste.filter(x => x.id !== req.params.id));
    protokoll({ aktion: "MASSNAHME LÖSCHEN", wer: req.benutzer.login, tabelle: "massnahmen.json", alt });
    res.json({ geloescht: 1 });
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.post("/api/massnahmen/pruefen", (req, res) => { if (darfPlanen(req, res)) res.json({ ok: true }); });

// --- Commentaire mensuel (rédigé par Claude, relu et enregistré par une personne) ---
// Les chiffres sont calculés par l'interface et envoyés ici ; Claude ne fait que rédiger.
// Commentaires enregistrés dans kommentare.json : { "2026-10": { text, quelle, modell, wer, zeit } }
const KOMMENTAR_DATEI = path.join(DATEN, "kommentare.json");
function kommentareLesen() {
  try { return JSON.parse(fs.readFileSync(KOMMENTAR_DATEI, "utf8")); }
  catch (err) { if (err.code === "ENOENT") return {}; throw new Error(`kommentare.json ist beschädigt: ${err.message}`); }
}
function kommentareSchreiben(alle) {
  const tmp = KOMMENTAR_DATEI + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(alle, null, 2), "utf8");
  fs.renameSync(tmp, KOMMENTAR_DATEI);
}
const KOMMENTAR_PROMPT = `Du bist Energie- und Produktionscontroller der Firma MRS (Aluminium-Recycling) und schreibst den Monatskommentar
für die Geschäftsführung. Du bekommst die Kennzahlen als JSON; sie sind bereits berechnet.

Regeln:
- Verwende NUR Zahlen aus den Daten. Erfinde keine Zahlen, Ursachen oder Ereignisse. Wo die Daten eine Ursache nicht zeigen, sag das.
- Deutsch, sachlich, klar; deutsches Zahlenformat (1.234.567 und 12,3 %). Einheiten sind nicht hinterlegt: keine Einheiten erfinden.
- Ein sinkender EnPI ist eine Verbesserung. Positive normalisierte Einsparung = weniger Verbrauch als erwartet.
- Länge 150 bis 250 Wörter. Keine Überschriften, keine Tabellen. **Fett** nur für 2 bis 4 Schlüsselzahlen.
- Aufbau: ein Absatz Produktion, ein Absatz Energie (EnPI, Einsparung, Prognose zum Jahresziel), ein Absatz Auffälligkeiten und Maßnahmen,
  dann die Zeile "Empfehlungen:" mit 1 bis 3 Punkten, jeweils mit "- " am Zeilenanfang.`;

app.get("/api/kommentare", route((req) => {
  const alle = kommentareLesen(), jahr = parseInt(req.query.jahr, 10);
  return Number.isInteger(jahr) ? Object.fromEntries(Object.entries(alle).filter(([k]) => k.startsWith(`${jahr}-`))) : alle;
}));
app.post("/api/kommentar/entwurf", async (req, res) => {
  if (!claude) return res.status(503).json({ fehler: "Claude ist nicht eingerichtet (ANTHROPIC_API_KEY fehlt in .env)." });
  const { jahr, monat, daten } = req.body || {};
  const text = JSON.stringify(daten ?? null);
  if (!Number.isInteger(jahr) || !Number.isInteger(monat) || monat < 1 || monat > 12 || !daten) return res.status(400).json({ fehler: "Jahr, Monat und Daten fehlen." });
  if (text.length > 60000) return res.status(400).json({ fehler: "Zu viele Daten für einen Kommentar." });
  try {
    const a = await claude.messages.create({
      model: MODELL, max_tokens: 1200, system: KOMMENTAR_PROMPT,
      messages: [{ role: "user", content: `Monatskommentar für ${MONATSNAMEN[monat - 1]} ${jahr}. Daten:\n${text}` }]
    });
    res.json({ text: a.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim(), modell: MODELL });
  } catch (err) {
    console.error("[Kommentar]", err.message);
    const keinGuthaben = /credit balance/i.test(err.message);
    if (err.status === 401 || keinGuthaben) return res.status(503).json({ fehler: keinGuthaben
      ? "Im Claude-Konto ist kein Guthaben (Billing → Guthaben aufladen). Sie können einen Entwurf ohne KI erstellen."
      : "Der ANTHROPIC_API_KEY in .env ist ungültig." });
    res.status(502).json({ fehler: `Claude ist gerade nicht erreichbar: ${err.message}` });
  }
});
app.put("/api/kommentare/:schluessel", (req, res) => {
  try {
    if (!darfSchreiben(req)) throw fehler400("Keine Berechtigung: Ihre Rolle erlaubt nur das Lesen.", 403);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(req.params.schluessel)) throw fehler400("Ungültiger Monat.");
    const text = String(req.body?.text ?? "").trim();
    if (!text) throw fehler400("Der Kommentar ist leer.");
    if (text.length > 8000) throw fehler400("Der Kommentar ist zu lang (max. 8.000 Zeichen).");
    const alle = kommentareLesen(), alt = alle[req.params.schluessel] ?? null;
    alle[req.params.schluessel] = { text, quelle: ["ki", "regel", "manuell"].includes(req.body?.quelle) ? req.body.quelle : "manuell",
      modell: req.body?.modell ?? null, wer: req.benutzer.name, login: req.benutzer.login, zeit: new Date().toISOString() };
    kommentareSchreiben(alle);
    protokoll({ aktion: alt ? "KOMMENTAR ÄNDERN" : "KOMMENTAR NEU", wer: req.benutzer.login, tabelle: "kommentare.json", schluessel: { monat: req.params.schluessel } });
    res.json(alle[req.params.schluessel]);
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.delete("/api/kommentare/:schluessel", (req, res) => {
  try {
    if (!darfSchreiben(req)) throw fehler400("Keine Berechtigung: Ihre Rolle erlaubt nur das Lesen.", 403);
    const alle = kommentareLesen();
    if (!alle[req.params.schluessel]) throw fehler400("Kommentar nicht gefunden.", 404);
    delete alle[req.params.schluessel];
    kommentareSchreiben(alle);
    protokoll({ aktion: "KOMMENTAR LÖSCHEN", wer: req.benutzer.login, tabelle: "kommentare.json", schluessel: { monat: req.params.schluessel } });
    res.json({ geloescht: 1 });
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});

// ---------------------------------------------------------------------
// Réglages énergie communs à tous (année de référence, objectif, CO₂, prix)
// Avant : dans chaque navigateur. Maintenant : einstellungen.json (aussi utilisé pour les e-mails).
// ---------------------------------------------------------------------
const EINSTELLUNGEN_DATEI = path.join(DATEN, "einstellungen.json");
function einstellungenLesen() {
  try { return JSON.parse(fs.readFileSync(EINSTELLUNGEN_DATEI, "utf8")); }
  catch (err) { if (err.code === "ENOENT") return {}; throw new Error(`einstellungen.json ist beschädigt: ${err.message}`); }
}
function einstellungenSchreiben(e) {
  const tmp = EINSTELLUNGEN_DATEI + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(e, null, 2), "utf8");
  fs.renameSync(tmp, EINSTELLUNGEN_DATEI);
}
app.get("/api/einstellungen", route(() => einstellungenLesen()));
app.put("/api/einstellungen/energie", (req, res) => {
  try {
    if (!darfSchreiben(req)) throw fehler400("Keine Berechtigung: Ihre Rolle erlaubt nur das Lesen.", 403);
    const z = (v, max) => { if (v == null || v === "") return null; const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > max) throw fehler400("Ungültiger Wert."); return n; };
    const neu = { basisJahr: req.body?.basisJahr ? parseInt(req.body.basisJahr, 10) : null, ziel: z(req.body?.ziel, 50), co2: z(req.body?.co2, 100), preis: z(req.body?.preis, 1000) };
    const alle = einstellungenLesen(), alt = alle.energie ?? null;
    alle.energie = neu;
    einstellungenSchreiben(alle);
    protokoll({ aktion: "EINSTELLUNGEN ENERGIE", wer: req.benutzer.login, tabelle: "einstellungen.json", alt, neu });
    res.json(neu);
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});

// ---------------------------------------------------------------------
// E-mails automatiques
//   SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (false ; true pour le port 465), SMTP_USER, SMTP_PASS
//   MAIL_FROM   expéditeur, ex. "MRS Produktion <produktion@firma.de>"
//   APP_URL     adresse de l'application pour les liens, ex. http://srv-produktion:3000
//   MAIL_STUNDE heure d'envoi (défaut 7) : rapport du lundi + rappels d'échéances
// Abonnements par personne (benutzer.json) : woche (lundi), kritisch (immédiat), fristen (échéances)
// ---------------------------------------------------------------------
const SMTP = { host: env("SMTP_HOST", ""), port: parseInt(env("SMTP_PORT", "587"), 10), secure: oui(env("SMTP_SECURE", "false")),
               user: env("SMTP_USER", ""), pass: env("SMTP_PASS", "") };
const MAIL_FROM = env("MAIL_FROM", SMTP.user || "MRS Produktion <noreply@localhost>");
const APP_URL = env("APP_URL", `http://localhost:${PORT}`).replace(/\/$/, "");
const MAIL_STUNDE = Math.min(23, Math.max(0, parseInt(env("MAIL_STUNDE", "7"), 10) || 7));
const mailer = SMTP.host ? nodemailer.createTransport({
  host: SMTP.host, port: SMTP.port, secure: SMTP.secure,
  auth: SMTP.user ? { user: SMTP.user, pass: SMTP.pass } : undefined,
  tls: { rejectUnauthorized: !oui(env("SMTP_ZERTIFIKAT_IGNORIEREN", "false")) }
}) : null;
const BENACHRICHTIGUNG_DATEI = path.join(DATEN, "benachrichtigungen.json");
const MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function zustandLesen() {
  try { return JSON.parse(fs.readFileSync(BENACHRICHTIGUNG_DATEI, "utf8")); }
  catch { return { woche: null, kritisch: {}, fristen: {}, verlauf: [], ersterLauf: true }; }
}
function zustandSchreiben(z) {
  z.verlauf = (z.verlauf || []).slice(0, 100);
  const tmp = BENACHRICHTIGUNG_DATEI + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(z, null, 2), "utf8");
  fs.renameSync(tmp, BENACHRICHTIGUNG_DATEI);
}
const abonnenten = (art) => benutzerLesen().filter(b => b.aktiv !== false && b.email && b.abo?.[art]).map(b => b.email);

async function mailSenden(an, betreff, html, text, art = "info") {
  if (!mailer) throw fehler400("E-Mail ist nicht eingerichtet (SMTP_HOST in .env).", 503);
  const liste = [...new Set([].concat(an).filter(Boolean))];
  if (!liste.length) return { an: [] };
  const z = zustandLesen();
  try {
    // une adresse par e-mail : personne ne voit les adresses des autres
    for (const a of liste) await mailer.sendMail({ from: MAIL_FROM, to: a, subject: betreff, html, text });
    z.verlauf.unshift({ zeit: new Date().toISOString(), art, betreff, an: liste, ok: true });
    console.log(`[E-Mail] ${art}: „${betreff}“ an ${liste.join(", ")}`);
  } catch (err) {
    z.verlauf.unshift({ zeit: new Date().toISOString(), art, betreff, an: liste, ok: false, fehler: err.message });
    console.error(`[E-Mail] ${art} fehlgeschlagen:`, err.message);
    zustandSchreiben(z);
    throw fehler400(`E-Mail konnte nicht gesendet werden: ${err.message}`, 502);
  }
  zustandSchreiben(z);
  return { an: liste };
}

// --- état actuel, calculé avec les mêmes fonctions que l'interface (rechnen.js) ---
async function lageBerechnen() {
  const pj = await jahre();
  const jahr = pj[0];
  const k = jahr ? berechne(await produktion(jahr)) : null;
  const ej = await energieJahre();
  const eJahr = ej.includes(jahr) ? jahr : ej[0];
  const einst = einstellungenLesen().energie || {};
  let en = { kpi: null, daten: null, einst, basisJahr: null, prognose: null };
  if (eJahr) {
    const basisJahr = einst.basisJahr && einst.basisJahr < eJahr ? einst.basisJahr : eJahr - 1;
    const [d, b] = await Promise.all([energie(eJahr), energie(basisJahr)]);
    const kpi = d.aktuell.length ? energieKennzahlen(d.aktuell, b.aktuell, einst) : null;
    en = { kpi, daten: d, einst, basisJahr, prognose: kpi ? prognoseBerechnen(kpi, d.aktuell, d.vorjahr, b.aktuell, einst) : null };
  }
  const massnahmen = massnahmenLesen();
  const warnungen = [...warnungenBerechnen(en, massnahmen, eJahr || jahr), ...abschaumWarnungen(k)];
  const kommentare = kommentareLesen();
  const letzterKommentar = Object.keys(kommentare).sort().at(-1);
  return { jahr, eJahr, k, en, massnahmen, warnungen, kommentar: letzterKommentar ? { monat: letzterKommentar, ...kommentare[letzterKommentar] } : null };
}
const warnSchluessel = (w) => `${w.kategorie}|${w.anlage}|${w.monat ?? 0}|${w.titel}`;

// --- mise en page des e-mails (HTML simple, styles en ligne pour Outlook) ---
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function mailRahmen(titel, unterzeile, inhalt, knopf) {
  return `<!doctype html><html lang="de"><body style="margin:0;background:#F2F4F6;font-family:'Segoe UI',Arial,sans-serif;color:#1F2A33">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F4F6;padding:24px 0"><tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#fff;border-radius:10px;overflow:hidden">
<tr><td style="background:#14212B;padding:18px 24px;color:#fff"><b style="font-size:16px">MRS Produktion</b><br><span style="font-size:12px;color:#A9C8DC">Aluminium-Recycling · Energiemanagement nach ISO 50001</span></td></tr>
<tr><td style="padding:24px 24px 8px"><h1 style="margin:0 0 4px;font-size:22px">${esc(titel)}</h1><div style="font-size:13px;color:#5F6B76">${esc(unterzeile)}</div></td></tr>
<tr><td style="padding:8px 24px 16px;font-size:14px;line-height:1.55">${inhalt}</td></tr>
${knopf ? `<tr><td style="padding:0 24px 24px"><a href="${esc(knopf.url)}" style="display:inline-block;background:#2B5874;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px">${esc(knopf.text)}</a></td></tr>` : ""}
<tr><td style="padding:14px 24px;border-top:1px solid #E6EAEE;font-size:11px;color:#8C99A6">Automatische Nachricht der Anwendung MRS Produktion. Benachrichtigungen ändern: in der Anwendung oben rechts auf Ihren Namen klicken, dann „Benachrichtigungen“.</td></tr>
</table></td></tr></table></body></html>`;
}
const kachel = (titel, wert, unter, farbe = "#1F2A33") => `<td width="25%" valign="top" style="padding:4px"><div style="background:#F4F6F8;border-top:3px solid #2B5874;border-radius:6px;padding:10px 12px">
<div style="font-size:11px;color:#5F6B76">${esc(titel)}</div><div style="font-size:19px;font-weight:700;color:${farbe};margin:2px 0">${esc(wert)}</div><div style="font-size:11px;color:#5F6B76">${esc(unter ?? "")}</div></div></td>`;
const pz = (v) => (v == null ? "" : `${v >= 0 ? "+" : "−"}${prozent(Math.abs(v))}`);
const STUFE_MAIL = { kritisch: ["Kritisch", "#CF4B3B"], warnung: ["Warnung", "#E39A2D"], info: ["Hinweis", "#4F83AA"] };
const liste = (eintraege) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${eintraege.join("")}</table>`;
const zeile = (farbe, titel, text) => `<tr><td style="border-left:4px solid ${farbe};padding:6px 10px;background:#FAFBFC"><b style="font-size:13px">${esc(titel)}</b><br><span style="font-size:12px;color:#5F6B76">${esc(text)}</span></td></tr><tr><td height="6"></td></tr>`;

function wochenbericht(lage) {
  const { k, en, massnahmen, warnungen, kommentar, jahr } = lage;
  const letzte = k?.aktuell?.filter(r => r.gesamt).at(-1);
  const vj = letzte && k.vorjahr.find(r => r.Monat === letzte.Monat);
  const st = en.kpi?.standort, p = en.prognose?.find(x => x.key === "ST");
  const offen = massnahmen.filter(x => x.status === "geplant" || x.status === "umsetzung"), ueber = offen.filter(istUeberfaellig);
  const wichtig = warnungen.filter(x => x.stufe !== "info");
  const status = p?.status ? { sicher: ["Ziel sicher", "#2F9E8F"], knapp: ["Ziel knapp", "#E39A2D"], verfehlt: ["Ziel verfehlt", "#CF4B3B"] }[p.status] : null;
  let html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    ${kachel(letzte ? `Produktion ${MONATE[letzte.Monat - 1]}` : "Produktion", letzte ? zahlDE(letzte.gesamt) : "–", vj?.gesamt ? `${pz(letzte.gesamt / vj.gesamt - 1)} ggü. Vorjahr` : "")}
    ${kachel("EnPI Standort", st ? dez(st.enpiAkt, 2) : "–", st?.veraenderung != null ? `${pz(st.veraenderung)} ggü. ${en.basisJahr}` : "", st?.veraenderung != null ? (st.veraenderung <= 0 ? "#2F9E8F" : "#CF4B3B") : undefined)}
    ${kachel("Jahresziel (Prognose)", status ? status[0] : "–", p?.zielJahr ? `EnPI ${dez(p.enpiJahr, 2)} / Ziel ${dez(p.zielJahr, 2)}` : "kein Ziel festgelegt", status?.[1])}
    ${kachel("Maßnahmen", `${offen.length} offen`, ueber.length ? `${ueber.length} überfällig` : "keine überfällig", ueber.length ? "#CF4B3B" : undefined)}
  </tr></table>`;
  if (k?.zeitraum) html += `<p style="margin:16px 0 4px">Seit Jahresbeginn (${esc(k.zeitraum)}) wurden <b>${zahlDE(k.gesamt)}</b> verarbeitet${k.veraenderung != null ? ` (${pz(k.veraenderung)} ggü. Vorjahr)` : ""}.${st?.einsparung != null ? ` Bereinigt um die Menge ergibt sich beim Energieverbrauch ${st.einsparung >= 0 ? `eine Einsparung von <b>${zahlDE(st.einsparung)}</b>` : `ein Mehrverbrauch von <b>${zahlDE(-st.einsparung)}</b>`}.` : ""}</p>`;
  html += `<h3 style="font-size:15px;margin:18px 0 8px">Auffälligkeiten (${wichtig.length})</h3>`;
  html += wichtig.length ? liste(wichtig.slice(0, 8).map(w => zeile(STUFE_MAIL[w.stufe][1], `${STUFE_MAIL[w.stufe][0]}: ${w.titel}`, w.text)))
    + (wichtig.length > 8 ? `<p style="font-size:12px;color:#5F6B76">und ${wichtig.length - 8} weitere in der Anwendung.</p>` : "")
    : `<p style="color:#2F9E8F">Keine Auffälligkeiten.</p>`;
  if (ueber.length || offen.length) {
    const naechste = [...offen].sort((a, b) => (a.frist || "9999").localeCompare(b.frist || "9999")).slice(0, 6);
    html += `<h3 style="font-size:15px;margin:18px 0 8px">Nächste Fristen im Maßnahmenplan</h3>` + liste(naechste.map(x =>
      zeile(istUeberfaellig(x) ? "#CF4B3B" : "#2B5874", x.titel, `${ANLAGE_NAME[x.anlage] ?? x.anlage}${x.verantwortlich ? ` · ${x.verantwortlich}` : ""} · ${x.frist ? `Frist ${datumDE(x.frist)}` : "ohne Frist"}${istUeberfaellig(x) ? " (überfällig)" : ""}`)));
  }
  if (kommentar) {
    const t = kommentar.text.replace(/\*\*/g, "");
    html += `<h3 style="font-size:15px;margin:18px 0 8px">Monatskommentar ${esc(MONATE[Number(kommentar.monat.slice(5)) - 1])} ${esc(kommentar.monat.slice(0, 4))}</h3>
      <div style="background:#F4F6F8;border-left:3px solid #E39A2D;padding:10px 12px;font-size:13px;white-space:pre-line">${esc(t.length > 900 ? `${t.slice(0, 900)} …` : t)}</div>`;
  }
  return { betreff: `MRS Wochenbericht: ${wichtig.filter(w => w.stufe === "kritisch").length ? "⚠ kritische Auffälligkeit · " : ""}${letzte ? `${MONATE[letzte.Monat - 1]} ${jahr}` : jahr}`,
           html: mailRahmen("Wochenbericht", `Stand ${new Date().toLocaleDateString("de-DE")} · Basisjahr Energie ${en.basisJahr ?? "–"}`, html, { text: "Dashboard öffnen", url: `${APP_URL}/#uebersicht` }) };
}

const textVersion = (html) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<br\s*\/?>/g, "\n").replace(/<\/(p|tr|h1|h3|div)>/g, "\n").replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\n\s*\n\s*\n+/g, "\n\n").trim();

// --- contrôle toutes les heures ---
let pruefungLaeuft = false;
async function benachrichtigungenPruefen(erzwingen = false) {
  if (!mailer || pruefungLaeuft) return;
  pruefungLaeuft = true;
  try {
    const z = zustandLesen(), jetzt = new Date();
    const anKritisch = abonnenten("kritisch"), anFristen = abonnenten("fristen"), anWoche = abonnenten("woche");
    if (!anKritisch.length && !anFristen.length && !anWoche.length && !erzwingen) return;
    const lage = await lageBerechnen();

    // 1. alertes critiques : immédiatement, une seule fois par alerte
    const kritisch = lage.warnungen.filter(w => w.stufe === "kritisch");
    const neu = kritisch.filter(w => !z.kritisch[warnSchluessel(w)]);
    for (const w of neu) z.kritisch[warnSchluessel(w)] = jetzt.toISOString();
    if (neu.length && anKritisch.length && !z.ersterLauf) {   // au tout premier contrôle, l'existant est seulement noté
      await mailSenden(anKritisch, `MRS: ${neu.length === 1 ? neu[0].titel : `${neu.length} kritische Auffälligkeiten`}`,
        mailRahmen("Kritische Auffälligkeit", `Erkannt am ${jetzt.toLocaleString("de-DE")}`,
          liste(neu.map(w => zeile("#CF4B3B", w.titel, w.text))) + `<p style="font-size:13px">Bitte Ursache klären und bei Bedarf eine Maßnahme anlegen.</p>`,
          { text: "Warnungen öffnen", url: `${APP_URL}/#warnungen` }), null, "kritisch");
    }

    // 2. échéances (à l'heure d'envoi) : 7 jours avant et au dépassement, une fois chacun
    if (jetzt.getHours() === MAIL_STUNDE || erzwingen) {
      const heute = new Date().toLocaleDateString("sv-SE");
      const in7 = new Date(Date.now() + 7 * 86400000).toLocaleDateString("sv-SE");
      const faellig = [];
      for (const x of lage.massnahmen.filter(m => (m.status === "geplant" || m.status === "umsetzung") && m.frist)) {
        const stufe = x.frist < heute ? "ueberfaellig" : x.frist <= in7 ? "bald" : null;
        if (stufe && !z.fristen[`${x.id}|${stufe}`]) { faellig.push({ ...x, stufe }); z.fristen[`${x.id}|${stufe}`] = jetzt.toISOString(); }
      }
      if (faellig.length && anFristen.length) {
        await mailSenden(anFristen, `MRS Maßnahmen: ${faellig.filter(x => x.stufe === "ueberfaellig").length ? "überfällige und " : ""}anstehende Fristen`,
          mailRahmen("Fristen im Maßnahmenplan", `${faellig.length} Maßnahme(n)`, liste(faellig.map(x => zeile(x.stufe === "ueberfaellig" ? "#CF4B3B" : "#E39A2D",
            x.titel, `${x.stufe === "ueberfaellig" ? "Überfällig seit" : "Fällig am"} ${datumDE(x.frist)} · ${ANLAGE_NAME[x.anlage] ?? x.anlage}${x.verantwortlich ? ` · ${x.verantwortlich}` : ""}`))),
            { text: "Maßnahmenplan öffnen", url: `${APP_URL}/#massnahmen` }), null, "fristen");
      }
    }

    // 3. rapport hebdomadaire : le lundi à l'heure d'envoi
    const kw = `${jetzt.getFullYear()}-${Math.ceil(((jetzt - new Date(jetzt.getFullYear(), 0, 1)) / 86400000 + new Date(jetzt.getFullYear(), 0, 1).getDay() + 1) / 7)}`;
    if (jetzt.getDay() === 1 && jetzt.getHours() === MAIL_STUNDE && z.woche !== kw && anWoche.length) {
      const w = wochenbericht(lage);
      await mailSenden(anWoche, w.betreff, w.html, textVersion(w.html), "woche");
      z.woche = kw;
    }
    // l'état peut avoir été modifié par mailSenden : on fusionne
    const aktuell = zustandLesen();
    zustandSchreiben({ ...aktuell, woche: z.woche, kritisch: z.kritisch, fristen: z.fristen, ersterLauf: false });
  } catch (err) { console.error("[E-Mail-Prüfung]", err.message); }
  finally { pruefungLaeuft = false; }
}
function benachrichtigungenPlanen() {
  if (!mailer) return;
  setTimeout(() => benachrichtigungenPruefen(), 60 * 1000);                 // une minute après le démarrage
  setInterval(() => benachrichtigungenPruefen(), 60 * 60 * 1000);           // puis toutes les heures
}

// --- API ---
app.put("/api/auth/profil", (req, res) => {
  const sitzung = sitzungVon(req);                       // les routes /api/auth/* ne passent pas par le contrôle de session
  if (!sitzung) return res.status(401).json({ fehler: "Bitte anmelden.", anmeldung: true });
  try {
    const liste = benutzerLesen(), b = liste.find(x => x.login === sitzung.benutzer.login);
    const email = String(req.body?.email ?? "").trim();
    if (email && !MAIL_RE.test(email)) throw fehler400("Bitte eine gültige E-Mail-Adresse eingeben.");
    b.email = email || null;
    b.abo = { woche: !!req.body?.abo?.woche, kritisch: !!req.body?.abo?.kritisch, fristen: !!req.body?.abo?.fristen };
    benutzerSchreiben(liste);
    res.json(oeffentlich(b));
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.get("/api/benachrichtigungen", (req, res) => {
  try {
    nurAdmin(req);
    const z = zustandLesen(), jetzt = new Date();
    const naechsterMontag = new Date(jetzt); naechsterMontag.setHours(MAIL_STUNDE, 0, 0, 0);
    while (naechsterMontag.getDay() !== 1 || naechsterMontag <= jetzt) naechsterMontag.setDate(naechsterMontag.getDate() + 1);
    res.json({
      eingerichtet: !!mailer, smtp: { host: SMTP.host || null, port: SMTP.port, secure: SMTP.secure, user: SMTP.user || null }, absender: MAIL_FROM,
      appUrl: APP_URL, stunde: MAIL_STUNDE, naechsterWochenbericht: naechsterMontag.toISOString(), verlauf: z.verlauf || [],
      empfaenger: benutzerLesen().filter(b => b.email).map(oeffentlich)
    });
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.get("/api/benachrichtigungen/vorschau", async (req, res) => {
  try { nurAdmin(req); res.json(wochenbericht(await lageBerechnen())); }
  catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.post("/api/benachrichtigungen/test", async (req, res) => {
  try {
    nurAdmin(req);
    const ich = benutzerLesen().find(b => b.login === req.benutzer.login);
    if (!ich?.email) throw fehler400("Bitte zuerst bei „Benachrichtigungen“ Ihre E-Mail-Adresse eintragen.");
    const html = mailRahmen("Test-E-Mail", new Date().toLocaleString("de-DE"), `<p>Der E-Mail-Versand von MRS Produktion funktioniert.</p><p style="font-size:12px;color:#5F6B76">Server ${esc(SMTP.host)}:${SMTP.port}, Absender ${esc(MAIL_FROM)}</p>`, { text: "Anwendung öffnen", url: APP_URL });
    res.json(await mailSenden(ich.email, "MRS Produktion: Test-E-Mail", html, textVersion(html), "test"));
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.post("/api/benachrichtigungen/wochenbericht", async (req, res) => {
  try {
    nurAdmin(req);
    const ich = benutzerLesen().find(b => b.login === req.benutzer.login);
    const an = req.body?.an === "alle" ? abonnenten("woche") : [ich?.email];
    if (!an.filter(Boolean).length) throw fehler400(req.body?.an === "alle" ? "Niemand hat den Wochenbericht abonniert." : "Bitte zuerst Ihre E-Mail-Adresse eintragen.");
    const w = wochenbericht(await lageBerechnen());
    res.json(await mailSenden(an, w.betreff, w.html, textVersion(w.html), "woche"));
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});

// --- Assistant IA ---
app.post("/api/chat", async (req, res) => {
  if (!claude) return res.status(503).json({ fehler: "Claude ist nicht eingerichtet (ANTHROPIC_API_KEY fehlt in .env)." });
  try {
    const jahr = parseInt(req.body?.jahr, 10) || new Date().getFullYear();
    res.json(await frageClaude(Array.isArray(req.body?.verlauf) ? req.body.verlauf : [], jahr));
  } catch (err) {
    if (err.eigen) return res.status(400).json({ fehler: err.message });
    console.error("[Claude]", err.message);
    const keinGuthaben = /credit balance/i.test(err.message);
    if (err.status === 401 || keinGuthaben) {
      // 503 → l'interface répond alors sans IA
      return res.status(503).json({ fehler: keinGuthaben
        ? "Im Claude-Konto ist kein Guthaben (Billing → Guthaben aufladen)."
        : "Der ANTHROPIC_API_KEY in .env ist ungültig." });
    }
    res.status(502).json({ fehler: `Claude ist gerade nicht erreichbar: ${err.message}` });
  }
});

const server = app.listen(PORT, HOST, () => {
  naechtlicheSicherung();
  benachrichtigungenPlanen();
  console.log("=".repeat(60));
  console.log(` MRS Produktion ${VERSION} läuft: http://localhost:${PORT}`);
  console.log(` Datenbank: ${DB_INFO}`);
  console.log(claude ? ` KI-Assistent: Claude aktiv (${MODELL})` : " KI-Assistent: ohne KI (ANTHROPIC_API_KEY fehlt in .env)");
  console.log(BEARBEITEN_AKTIV
    ? ` Bearbeiten: AKTIV für Rollen Bearbeiter/Admin${EDIT_TABELLEN.length ? ` (nur ${EDIT_TABELLEN.join(", ")})` : " (alle Tabellen mit Primärschlüssel)"} – Protokoll: aenderungen.log`
    : " Bearbeiten: aus (nur Lesen)");
  const nb = benutzerLesen().length;
  console.log(nb ? ` Anmeldung: aktiv (${nb} Benutzer)` : " Anmeldung: noch nicht eingerichtet – zuerst am Server-PC öffnen und Administrator anlegen");
  if (!fs.existsSync(path.join(DOSSIER, "dist"))) console.log(" ⚠️  Ordner dist fehlt: zuerst « npm run build » ausführen.");
  if (HOST !== "127.0.0.1") console.log(` Im Netzwerk erreichbar (${HOST}), Anmeldung erforderlich`);
  console.log(` Sicherungen: ${BACKUP_ORDNER} (täglich ${BACKUP_STUNDE}:00 Uhr, ${BACKUP_ANZAHL} behalten)${BACKUP_ZIEL ? ` + Kopie nach ${BACKUP_ZIEL}` : ""}`);
  console.log(` Protokoll: ${logDatei()}`);
  console.log(mailer ? ` E-Mail: ${SMTP.host}:${SMTP.port} als ${MAIL_FROM} (Versand ${MAIL_STUNDE}:00 Uhr, Links auf ${APP_URL})` : " E-Mail: nicht eingerichtet (SMTP_HOST in .env)");
  console.log("=".repeat(60));
});
server.on("error", (err) => {
  console.error(err.code === "EADDRINUSE"
    ? `[Start] Port ${PORT} ist schon belegt: läuft die Anwendung bereits (z. B. als Dienst)? Anderen Port mit WEB_PORT in .env wählen.`
    : `[Start] ${err.message}`);
  process.exit(1);
});