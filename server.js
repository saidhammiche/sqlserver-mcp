// =====================================================================
//  MRS Produktion – SERVEUR (un seul fichier)
//  Démarrage :  npm run build   (une fois, crée le dossier dist)
//               npm start       → http://185.80.92.91:3000
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
// MRS_ENV : autre fichier de configuration (ex. un 2e site : MRS_ENV=.env.werk2) ; les variables déjà définies (Docker) restent prioritaires
const ENV = process.env.MRS_ENV ? path.resolve(DOSSIER, process.env.MRS_ENV) : path.join(DOSSIER, ".env");
if (fs.existsSync(ENV)) process.loadEnvFile(ENV);

// --- Dossier « daten » : tout ce que l'application crée elle-même ---
// (les fichiers d'une version précédente, posés à côté de server.js, y sont déplacés automatiquement)
// DATEN_DIR : dossier de données propre à chaque site (utilisateurs, mesures, compteurs, ISO 50001 …)
const DATEN = process.env.DATEN_DIR ? path.resolve(DOSSIER, process.env.DATEN_DIR) : path.join(DOSSIER, "daten");
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
  Write-Host "  Erreichbar    : $(if ($antwortet) { "ja, http://185.80.92.91:$port" } else { "nein (Port $port)" })" -ForegroundColor $(if ($antwortet) { "Green" } else { "Red" })
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
// Produktname und Firma (für Oberfläche, Berichte und E-Mails), z. B. APP_NAME="Energie Cockpit" FIRMA="Muster GmbH"
const APP_NAME = env("APP_NAME", "MRS Produktion");
const APP_UNTERTITEL = env("APP_UNTERTITEL", "Aluminium-Recycling");
const FIRMA = env("FIRMA", "MRS");
// Plusieurs sites : chaque site tourne comme une installation à part (sa base, son dossier DATEN_DIR, son port).
// STANDORT = nom de ce site ; STANDORTE = liste pour le sélecteur dans l'en-tête, par ex.
// STANDORTE=[{"name":"Werk Nord","url":"http://server:3000"},{"name":"Werk Süd","url":"http://server:3001"}]
const STANDORT = env("STANDORT", "");
const STANDORTE = (() => {
  try {
    const l = JSON.parse(env("STANDORTE", "[]"));
    return Array.isArray(l) ? l.filter(x => x && typeof x.name === "string" && /^https?:\/\//.test(x.url || "")).slice(0, 50).map(x => ({ name: x.name.slice(0, 60), url: x.url.replace(/\/$/, "") })) : [];
  } catch { console.error("[Standorte] STANDORTE in .env ist kein gültiges JSON und wird ignoriert."); return []; }
})();
const HOST = env("WEB_HOST", "127.0.0.1");            // uniquement ce PC (pas de connexion)
const MAX_ZEILEN = parseInt(env("MAX_ROWS_READ", "200"), 10);
const MODELL = env("ANTHROPIC_MODEL", "claude-sonnet-5-5");
const claude = env("ANTHROPIC_API_KEY") ? new Anthropic() : null;

const DB = {
  server: env("DB_SERVER", "185.80.92.91"),
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
// Colonnes de consommation / coûts (Übersicht : un onglet par table). Modifiable avec VERBRAUCH_MUSTER dans .env
// « energie » seul ne suffit plus : il faut une vraie grandeur de consommation (kWh, m³, Strom, Gas …) ou des coûts.
const VERBRAUCH_MUSTER = new RegExp(env("VERBRAUCH_MUSTER",
  "verbrauch|kwh|mwh|m3|m³|strom|gas|wasser|diesel|heizöl|heizoel|druckluft|kosten|betrag"), "i");
// tables et colonnes qui ne sont PAS de la consommation réelle (potentiels, objectifs, plans, KPI, compteurs …). Modifiable avec VERBRAUCH_AUSSCHLUSS
const VERBRAUCH_AUSSCHLUSS = new RegExp(env("VERBRAUCH_AUSSCHLUSS",
  "potenzial|potential|einspar|ziel|plan|budget|prognose|forecast|kpi|keyperformance|faktor|co2|emission|anteil|prozent|quote|z(ae|ä)hlerstand|stand$"), "i");
const istVerbrauchSpalte = (c) => VERBRAUCH_MUSTER.test(c) && !VERBRAUCH_AUSSCHLUSS.test(c);

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
// nurVerbrauch = true : seulement les colonnes de consommation / coûts (VERBRAUCH_MUSTER)
const istKennung = (n) => /^id$/i.test(n) || /^id_/i.test(n) || /(_id|ID|Id)$/.test(n) || /(nr|nummer)$/i.test(n);

async function tabellenUebersicht(name, jahr = null, monat = null, nurVerbrauch = false) {
  const struktur = await tabelleBeschreiben(name);
  const [schema, table] = teileName(name);
  const ziel = `${qi(schema)}.${qi(table)}`;
  const zeit = zeitSpalten(struktur.spalten);
  const a = zeitAusdruck(zeit);
  const zeitNamen = new Set([zeit?.jahr, zeit?.monat].filter(Boolean));
  const alleZahlen = struktur.spalten.filter(s => ZAHL_TYPEN.includes(s.typ) && !zeitNamen.has(s.spalte) && !istKennung(s.spalte)
    && (!nurVerbrauch || istVerbrauchSpalte(s.spalte)));
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

// Toutes les tables avec des colonnes de consommation / coûts (gardé 5 minutes en mémoire)
let verbrauchCache = null;
async function verbrauchsTabellen() {
  if (verbrauchCache && Date.now() - verbrauchCache.t < 5 * 60000) return verbrauchCache.liste;
  const r = await (await pool()).request().query(`
    SELECT c.TABLE_SCHEMA AS [schema], c.TABLE_NAME AS tabelle, c.COLUMN_NAME AS spalte, c.DATA_TYPE AS typ, t.TABLE_TYPE AS art
    FROM INFORMATION_SCHEMA.COLUMNS c
    JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
    ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`);
  const proTabelle = new Map();
  for (const z of r.recordset) {
    const key = `${z.schema}.${z.tabelle}`;
    if (!proTabelle.has(key)) proTabelle.set(key, { schema: z.schema, table: z.tabelle, tabelle: key, view: z.art === "VIEW", spalten: [] });
    proTabelle.get(key).spalten.push({ spalte: z.spalte, typ: z.typ });
  }
  const liste = [];
  for (const t of proTabelle.values()) {
    if (VERBRAUCH_AUSSCHLUSS.test(t.table)) continue;                     // z. B. Energiepotential, Ziele, KPI-Tabellen
    const zeit = zeitSpalten(t.spalten);
    if (!zeitAusdruck(zeit)?.monat) continue;                            // nur Tabellen mit Monatswerten (Jahr + Monat oder Datum)
    const zeitNamen = new Set([zeit?.jahr, zeit?.monat, zeit?.datum].filter(Boolean));
    const treffer = t.spalten.filter(s => ZAHL_TYPEN.includes(s.typ) && !zeitNamen.has(s.spalte) && !istKennung(s.spalte) && istVerbrauchSpalte(s.spalte));
    if (!treffer.length) continue;
    let jahre = [];
    if (zeit) {
      try {
        const a = zeitAusdruck(zeit);
        jahre = await nurLesen(async (tx) => (await new sql.Request(tx).query(
          `SELECT DISTINCT ${a.jahr} AS j FROM ${qi(t.schema)}.${qi(t.table)} WHERE ${a.jahr} IS NOT NULL ORDER BY j DESC`))
          .recordset.map(x => Number(x.j)).filter(Number.isFinite));
      } catch (err) { console.warn(`[Verbrauch] ${t.tabelle}:`, err.message); }
    }
    liste.push({ tabelle: t.tabelle, view: t.view, zeit, spalten: treffer.map(s => s.spalte), jahre });
  }
  verbrauchCache = { t: Date.now(), liste };
  return liste;
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
  const k = await schluesselWaehlen(schema, table, spalten);
  for (const sp of spalten) sp.schluessel = k.spalten.includes(sp.spalte);
  return { schema, table, voll: `${schema}.${table}`, spalten, schluessel: k.spalten, schluesselArt: k.art };
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

// Comment une ligne est retrouvée pour la modifier ou la supprimer :
//   1. clé primaire   2. index unique (colonnes non vides)   3. colonne d'identité
//   4. sinon (« zeile ») : par la valeur de TOUTES ses colonnes comparables ; si plusieurs lignes sont identiques, une seule est touchée (TOP 1)
const NICHT_VERGLEICHBAR = ["text", "ntext", "image", "xml", "geography", "geometry", "hierarchyid", "sql_variant", "timestamp", "rowversion", "varbinary", "binary"];

async function schluesselWaehlen(schema, table, spalten) {
  const pk = spalten.filter(s => s.schluessel).map(s => s.spalte);
  if (pk.length) return { art: "primaer", spalten: pk };
  const r = await (await pool()).request()
    .input("schema", sql.NVarChar, schema).input("table", sql.NVarChar, table)
    .query(`SELECT i.index_id AS idx, c.name AS spalte, c.is_nullable AS leer
            FROM sys.indexes i
            JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
            JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
            WHERE i.object_id = OBJECT_ID(QUOTENAME(@schema) + '.' + QUOTENAME(@table)) AND i.is_unique = 1 AND i.has_filter = 0
            ORDER BY i.index_id, ic.key_ordinal`);
  const proIndex = new Map();
  for (const z of r.recordset) (proIndex.get(z.idx) || proIndex.set(z.idx, []).get(z.idx)).push(z);
  const eindeutig = [...proIndex.values()].find(cols => cols.every(c => !c.leer));
  if (eindeutig) return { art: "eindeutig", spalten: eindeutig.map(c => c.spalte) };
  const id = spalten.find(s => s.identity);
  if (id) return { art: "identity", spalten: [id.spalte] };
  return { art: "zeile", spalten: [] };
}

function schluesselBedingung(meta, req, schluessel) {
  return meta.schluessel.map((k, i) => {
    const s = meta.spalten.find(x => x.spalte === k);
    if (schluessel?.[k] === undefined || schluessel[k] === null) throw new Error(`Schlüssel „${k}“ fehlt.`);
    req.input(`k${i}`, sqlTyp(s), wandle(s, schluessel[k]));
    return `${qi(k)} = @k${i}`;
  }).join(" AND ");
}

// ligne sans clé : comparaison de toutes les colonnes (nombres à virgule et dates avec une petite tolérance)
function zeilenBedingung(meta, req, zeile) {
  if (!zeile || typeof zeile !== "object") throw new Error("Die ursprüngliche Zeile fehlt: bitte die Seite neu laden.");
  const teile = [];
  meta.spalten.forEach((s, i) => {
    if (NICHT_VERGLEICHBAR.includes(s.typ) || s.laenge === -1 || s.berechnet || !(s.spalte in zeile)) return;
    const v = zeile[s.spalte], n = `z${i}`, c = qi(s.spalte);
    if (v === null || v === undefined) { teile.push(`${c} IS NULL`); return; }
    req.input(n, sqlTyp(s), v === "" ? "" : wandle({ ...s, nullable: true }, v));
    if (["float", "real"].includes(s.typ)) teile.push(`ABS(${c} - @${n}) <= 1e-9 * (1 + ABS(@${n}))`);
    else if (s.typ === "smalldatetime") teile.push(`${c} BETWEEN DATEADD(second, -30, @${n}) AND DATEADD(second, 30, @${n})`);
    else if (["datetime", "datetime2"].includes(s.typ)) teile.push(`${c} BETWEEN DATEADD(millisecond, -5, @${n}) AND DATEADD(millisecond, 5, @${n})`);
    else teile.push(`${c} = @${n}`);
  });
  if (!teile.length) throw new Error("Diese Zeile kann nicht eindeutig erkannt werden (keine vergleichbaren Spalten).");
  return teile.join(" AND ");
}
const bedingung = (meta, req, b) => (meta.schluessel.length ? schluesselBedingung(meta, req, b?.schluessel) : zeilenBedingung(meta, req, b?.zeile));

const anzahl = (r) => Number(r.recordsets?.at(-1)?.[0]?.n ?? -1);   // résultat de SELECT @@ROWCOUNT

async function inTransaktion(fn) {
  const tx = new sql.Transaction(await pool());
  await tx.begin();
  try { const e = await fn(tx); await tx.commit(); return e; }
  catch (err) { await tx.rollback().catch(() => {}); throw err; }
}

async function alteZeile(tx, meta, b) {
  const req = new sql.Request(tx);
  const alt = (await req.query(`SELECT TOP (2) * FROM ${qi(meta.schema)}.${qi(meta.table)} WITH (UPDLOCK) WHERE ${bedingung(meta, req, b)}`)).recordset;
  if (!alt.length) throw new Error("Die Zeile wurde nicht gefunden (vielleicht inzwischen geändert oder gelöscht). Bitte neu laden.");
  if (alt.length > 1 && meta.schluessel.length) throw new Error("Der Schlüssel trifft mehrere Zeilen: abgebrochen.");
  return { alt: alt[0], mehrere: alt.length > 1 };
}

// insertion d'une ligne dans une transaction déjà ouverte
async function einfuegenIn(tx, meta, werte) {
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
  return Object.fromEntries(meta.schluessel.map(k => [k,
    identity?.spalte === k ? Number(r.recordset?.[0]?.neue_id) : wandle(meta.spalten.find(s => s.spalte === k), werte[k])]));
}

async function zeileEinfuegen(name, werte, wer) {
  const meta = await tabellenMeta(name);
  return inTransaktion(async (tx) => {
    const schluessel = await einfuegenIn(tx, meta, werte);
    protokoll({ aktion: "EINFÜGEN", wer, tabelle: meta.voll, schluessel, neu: werte });
    return { schluessel };
  });
}

// plusieurs lignes d'un coup (copier-coller depuis Excel) : tout ou rien
async function zeilenEinfuegen(name, liste, wer) {
  if (!Array.isArray(liste) || !liste.length) throw new Error("Keine Zeilen übergeben.");
  if (liste.length > 1000) throw new Error("Höchstens 1.000 Zeilen auf einmal.");
  const meta = await tabellenMeta(name);
  return inTransaktion(async (tx) => {
    for (let i = 0; i < liste.length; i++) {
      try { await einfuegenIn(tx, meta, liste[i]); }
      catch (err) { throw new Error(`Zeile ${i + 1}: ${err.message} Es wurde nichts gespeichert.`); }
    }
    protokoll({ aktion: `EINFÜGEN (${liste.length} Zeilen)`, wer, tabelle: meta.voll, neu: { zeilen: liste.slice(0, 200) } });
    return { eingefuegt: liste.length };
  });
}

async function zeileAendern(name, b, wer) {
  const meta = await tabellenMeta(name);
  const werte = b?.werte;
  return inTransaktion(async (tx) => {
    const { alt, mehrere } = await alteZeile(tx, meta, b);
    const req = new sql.Request(tx);
    const bed = bedingung(meta, req, b);
    const spalten = meta.spalten.filter(s => !s.identity && !s.berechnet && !s.schluessel && werte?.[s.spalte] !== undefined);
    if (!spalten.length) throw new Error("Keine Änderungen übergeben.");
    spalten.forEach((s, i) => req.input(`w${i}`, sqlTyp(s), wandle(s, werte[s.spalte])));
    const r = await req.query(`SET NOCOUNT ON; UPDATE TOP (1) ${qi(meta.schema)}.${qi(meta.table)} SET ${spalten.map((s, i) => `${qi(s.spalte)} = @w${i}`).join(", ")} WHERE ${bed}; SELECT @@ROWCOUNT AS n;`);
    const n = anzahl(r);
    if (n !== 1) throw new Error(`Abgebrochen: ${n} Zeilen wären geändert worden.`);
    protokoll({ aktion: "ÄNDERN", wer, tabelle: meta.voll, schluessel: meta.schluessel.length ? b.schluessel : { erkannt: "über alle Spalten", identischeZeilen: mehrere },
      alt: Object.fromEntries(spalten.map(s => [s.spalte, alt[s.spalte]])), neu: werte });
    return { geaendert: 1, identische: mehrere };
  });
}

async function zeileLoeschen(name, b, wer) {
  const meta = await tabellenMeta(name);
  return inTransaktion(async (tx) => {
    const { alt, mehrere } = await alteZeile(tx, meta, b);
    const req = new sql.Request(tx);
    const n = anzahl(await req.query(`SET NOCOUNT ON; DELETE TOP (1) FROM ${qi(meta.schema)}.${qi(meta.table)} WHERE ${bedingung(meta, req, b)}; SELECT @@ROWCOUNT AS n;`));
    if (n !== 1) throw new Error(`Abgebrochen: ${n} Zeilen wären gelöscht worden.`);
    protokoll({ aktion: "LÖSCHEN", wer, tabelle: meta.voll, schluessel: meta.schluessel.length ? b.schluessel : { erkannt: "über alle Spalten", identischeZeilen: mehrere }, alt });
    return { geloescht: 1, identische: mehrere };
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
    input_schema: { type: "object", properties: { tabelle: { type: "string" } }, required: ["tabelle"] }, run: (a) => tabelleBeschreiben(a.tabelle) },
  { name: "tabelle_auswerten", description: "Fertige Kennzahlen einer BELIEBIGEN Tabelle: Zeilenzahl sowie Summe, Durchschnitt, Minimum und Maximum je Zahlenspalte, " +
      "dazu die Werte je Monat (wenn ein Jahr angegeben ist) bzw. je Jahr (ohne Jahr) und dieselben Monate des Vorjahres. Die Jahr-/Monats- oder Datumsspalte wird " +
      "automatisch erkannt. Für Summen, Entwicklung, stärksten/schwächsten Monat, Anteile oder Vorjahresvergleich einer Tabelle zuerst dieses Werkzeug benutzen.",
    input_schema: { type: "object", properties: {
      tabelle: { type: "string", description: "z. B. dbo.SEUWerte" }, jahr: { type: "integer" }, monat: { type: "integer", description: "1 bis 12, optional" },
      nur_verbrauch: { type: "boolean", description: "true = nur Verbrauchs- und Kostenspalten" } }, required: ["tabelle"] },
    run: (a) => tabellenUebersicht(a.tabelle, zahlParam(a.jahr, 1900, 2100), zahlParam(a.monat, 1, 12), !!a.nur_verbrauch) },
  { name: "tabelle_zeilen", description: "Die neuesten Zeilen einer Tabelle (höchstens 50), optional gefiltert nach Jahr und Monat, mit Gesamtzahl und vorhandenen Jahren.",
    input_schema: { type: "object", properties: { tabelle: { type: "string" }, anzahl: { type: "integer", description: "Standard 10, höchstens 50" },
      jahr: { type: "integer" }, monat: { type: "integer" } }, required: ["tabelle"] },
    run: async (a) => {
      const d = await tabellenVorschau(a.tabelle, Math.min(50, Math.max(1, parseInt(a.anzahl, 10) || 10)), zahlParam(a.jahr, 1900, 2100), zahlParam(a.monat, 1, 12));
      return { tabelle: d.tabelle, zeilen_gesamt: d.zeilen_gesamt, zeitspalten: d.zeit, jahre: d.jahre, zeilen: d.zeilen };
    } },
  { name: "verbrauchs_tabellen", description: "Listet alle Tabellen mit Verbrauchs- oder Kostenspalten (Strom, Gas, Erdgas, Wasser, Energie, Kosten …), " +
      "jeweils mit diesen Spalten und den vorhandenen Jahren.",
    input_schema: { type: "object", properties: {} }, run: () => verbrauchsTabellen() },
  { name: "wartung_stoerungen", description: "Wartungspläne (Anlage, Aufgabe, Intervall, zuletzt, nächste Fälligkeit, Verantwortlich, Historie) und Störungen " +
      "(Anlage, Stillstand oder eingeschränkt, Beginn, Ende, offen, Dauer in Stunden, Ursache, Behebung) aus der Anwendung.",
    input_schema: { type: "object", properties: {} }, run: () => {
      const w = wartungLesen(), namen = Object.fromEntries(anlagenLesen().map(x => [x.id, x.name]));
      return {
        heute: heuteISO(),
        plaene: w.plaene.map(p => ({ ...p, anlage: namen[p.anlage] ?? p.anlage, naechste: wNaechste(p), historie: (p.historie || []).slice(0, 10) })),
        stoerungen: w.stoerungen.slice(0, 200).map(x => ({ ...x, anlage: namen[x.anlage] ?? x.anlage, offen: !x.ende,
          dauer_stunden: Math.round(((x.ende ? new Date(x.ende) : new Date()) - new Date(x.beginn)) / 36000) / 100 }))
      };
    } },
  { name: "werksplan", description: "Hallen und Anlagen des Standorts (Werksplan 3D): Name, Typ, Halle, verknüpfte Energiedaten (SEU P1/P2/UB/ME), " +
      "Beschreibung, technische Daten, Notizen, Namen der hinterlegten Dokumente, Links und Live-Datenquelle.",
    input_schema: { type: "object", properties: {} }, run: () => anlagenLesen().map(a => ({
      id: a.id, name: a.name, typ: a.typ, halle: a.halle, seu: a.seu, beschreibung: a.beschreibung, daten: a.daten, notizen: a.notizen,
      dokumente: (a.dokumente || []).map(d => d.name), links: (a.links || []).map(l => l.titel || l.url), live_tabelle: a.live?.tabelle ?? null })) },
  { name: "monatskommentare", description: "Gespeicherte Monatskommentare für die Geschäftsführung (Schlüssel JJJJ-MM, Text, Verfasser, Datum).",
    input_schema: { type: "object", properties: {} }, run: () => kommentareLesen() },
  { name: "energie_einstellungen", description: "Energie-Einstellungen der Anwendung: Basisjahr, Ziel (EnPI-Verbesserung in %), CO₂-Faktor (kg je Einheit), Energiepreis (€ je Einheit).",
    input_schema: { type: "object", properties: {} }, run: () => einstellungenLesen().energie || {} },
  { name: "energiekosten", description: "Energiekosten je Energieträger (Strom, Gas, Erdgas …) und Monat, automatisch aus allen Verbrauchs- und Kostentabellen der Datenbank, " +
      "für ein Jahr und das Vorjahr: Verbrauch, Kosten in €, Quelle (Tabelle und Spalten), dazu die verarbeitete Menge je Monat (ProduktionMonat, Einheit mengeEinheit) für Kosten je Tonne.",
    input_schema: jahrParam, run: (a) => kostenDaten(parseInt(a.jahr, 10)) }
];

const systemPrompt = (jahr) => `Du bist der Datenassistent der Produktion der Firma ${FIRMA} (${APP_UNTERTITEL}).
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
- Wenn die Daten eine Frage nicht beantworten können, sag das ehrlich.
- Nenne in der Antwort KEINE Datenbank-, Tabellen-, Spalten- oder Werkzeugnamen (also nicht MRS_BI, SEUWerte, ProduktionMonat, P1_Verbrauch …).
  Sprich von Produktionsdaten, Energiedaten, Verbrauchsdaten, Kosten, Wartungsdaten usw. und nenne Anlagen mit ihrem Namen (Presse I, UBC-Aufbereitung …).
  Nur wenn ausdrücklich nach einer Tabelle gefragt wird, darfst du ihren Namen nennen.
- Sag nie, welches KI-Modell oder welcher Anbieter du bist; du bist „der Assistent“.

Fragen zu ALLEN Tabellen und zur Anwendung:
- Tabellenname unklar: zuerst tabellen_auflisten (oder verbrauchs_tabellen für Verbrauch und Kosten), dann tabelle_beschreiben.
- Zahlen einer Tabelle (Summen, Monate, Vorjahr, Maximum, Anteile): zuerst tabelle_auswerten; einzelne Zeilen: tabelle_zeilen; sql_lesen nur, wenn das nicht reicht.
- Hat eine Tabelle für das gewählte Jahr keine Daten, sag das und nimm das neueste vorhandene Jahr.
- Strom, Gas, Erdgas, Wasser, Kosten: zuerst verbrauchs_tabellen, dann tabelle_auswerten mit nur_verbrauch = true.
- Wartung, Störungen, Stillstand, Reparaturzeit: wartung_stoerungen. Hallen, Anlagen, Dokumente: werksplan.
- Monatskommentar: monatskommentare. Basisjahr, Ziel, Preis, CO₂-Faktor: energie_einstellungen.
- Energiekosten, Preis je kWh, Kosten je Tonne, Kostenanteile je Energieträger: energiekosten. Kosten je Tonne = Kosten ÷ (Menge in kg ÷ 1000), wenn mengeEinheit "kg" ist.
  Vergleiche mit dem Vorjahr immer über die gleichen Monate.
- Mittlere Reparaturzeit (MTTR) = Durchschnitt der Dauer behobener Störungen. Stillstandsstunden nur aus Störungen mit Auswirkung „stillstand“.`;

async function frageClaude(verlauf, jahr) {
  const messages = verlauf
    .filter(m => (m.rolle === "nutzer" || m.rolle === "assistent") && typeof m.text === "string" && m.text.trim())
    .slice(-12)
    .map(m => ({ role: m.rolle === "nutzer" ? "user" : "assistant", content: m.text.slice(0, 4000) }));
  if (!messages.length || messages.at(-1).role !== "user") { const e = new Error("Keine Frage erhalten."); e.eigen = true; throw e; }

  const abfragen = [];
  const tools = WERKZEUGE.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  for (let runde = 0; runde < 10; runde++) {
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
app.use(express.json({ limit: "3mb" }));   // assez pour coller jusqu'à 1.000 lignes depuis Excel
app.use(express.static(path.join(DOSSIER, "dist")));   // interface React construite par « npm run build »

// ---------------------------------------------------------------------
// Application mobile (PWA) : manifeste, service hors ligne et icônes servis directement par le serveur
//   (aucun fichier à copier). Installation et mode hors ligne : uniquement en HTTPS (ou sur localhost).
// ---------------------------------------------------------------------
const PWA_ICONS = { "pwa-192.png": "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", "pwa-512.png": "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", "pwa-maskable-512.png": "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", "apple-touch-icon.png": "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" };
for (const [datei, b64] of Object.entries(PWA_ICONS)) {
  const bild = Buffer.from(b64, "base64");
  app.get(`/${datei}`, (req, res) => { res.type("png").set("Cache-Control", "public, max-age=604800").send(bild); });
}
app.get("/manifest.webmanifest", (req, res) => {
  res.type("application/manifest+json").send(JSON.stringify({
    name: process.env.STANDORT ? `${APP_NAME} · ${process.env.STANDORT}` : APP_NAME, short_name: APP_NAME.length > 12 ? APP_NAME.split(" ")[0] : APP_NAME,
    description: "Energie- und Produktionsdaten, Zählerablesung und Störmeldung", lang: "de", dir: "ltr",
    start_url: "/#unterwegs", scope: "/", display: "standalone", orientation: "any", background_color: "#14212B", theme_color: "#14212B",
    icons: [{ src: "/pwa-192.png", sizes: "192x192", type: "image/png" }, { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
            { src: "/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }],
    shortcuts: [{ name: "Zählerstand erfassen", url: "/#unterwegs", icons: [{ src: "/pwa-192.png", sizes: "192x192" }] },
                { name: "Cockpit", url: "/#cockpit", icons: [{ src: "/pwa-192.png", sizes: "192x192" }] }]
  }));
});
// service hors ligne : interface en cache (démarre sans réseau), dernières réponses GET de l'API en secours
app.get("/sw.js", (req, res) => {
  res.type("application/javascript").set("Cache-Control", "no-cache").send(`
const CACHE = "mrs-${VERSION}";
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(["/", "/manifest.webmanifest", "/pwa-192.png"])).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return;
  const merken = (antw) => { if (antw.ok) { const k = antw.clone(); caches.open(CACHE).then(c => c.put(r, k)); } return antw; };
  if (r.mode === "navigate") { e.respondWith(fetch(r).then(merken).catch(() => caches.match("/"))); return; }
  if (u.pathname.startsWith("/api/")) { e.respondWith(fetch(r).then(merken).catch(() => caches.match(r).then(x => x || new Response(JSON.stringify({ fehler: "Keine Verbindung zum Server." }), { status: 503, headers: { "Content-Type": "application/json" } })))); return; }
  e.respondWith(caches.match(r).then(x => x || fetch(r).then(merken)));
});`);
});

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
  email: b.email ?? null, abo: { woche: !!b.abo?.woche, monat: !!b.abo?.monat, kritisch: !!b.abo?.kritisch, fristen: !!b.abo?.fristen } , cockpit: Array.isArray(b.cockpit) ? b.cockpit : null });
// adresse et abonnements (création / modification par l'admin)
function emailUndAbo(ziel, d) {
  if (d.email !== undefined) {
    const e = String(d.email ?? "").trim();
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { const x = new Error("Bitte eine gültige E-Mail-Adresse eingeben."); x.status = 400; throw x; }
    ziel.email = e || null;
  }
  if (d.abo) ziel.abo = { woche: !!d.abo.woche, monat: !!d.abo.monat, kritisch: !!d.abo.kritisch, fristen: !!d.abo.fristen };
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
  res.json({ eingerichtet: liste.length > 0, einrichtungErlaubt: istLokal(req), benutzer: s ? oeffentlich(s.benutzer) : null, marke: { name: APP_NAME, untertitel: APP_UNTERTITEL, standort: STANDORT || null, standorte: STANDORTE } });
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
const SICHERUNG_DATEIEN = ["benutzer.json", "massnahmen.json", "kommentare.json", "einstellungen.json", "anlagen.json", "wartung.json", "zaehler.json", "iso50001.json", "aenderungen.log"];
const WIEDERHERSTELLBAR = ["benutzer.json", "massnahmen.json", "kommentare.json", "einstellungen.json", "anlagen.json", "wartung.json", "zaehler.json", "iso50001.json"];
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
    res.setHeader("Content-Disposition", `attachment; filename="Sicherung_${req.params.name}.json"`);
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
app.get("/api/status", (req, res) => res.json({ ki: !!claude, modell: claude ? MODELL : null, appUrl: APP_URL }));   // APP_URL : liens des codes QR
app.get("/api/tabellen", route(() => tabellenListe()));
app.get("/api/verbrauch/tabellen", route(() => verbrauchsTabellen()));   // Übersicht : tables de consommation / coûts
app.get("/api/tabellen/:name/uebersicht", async (req, res) => {
  try { res.json(await tabellenUebersicht(req.params.name, zahlParam(req.query.jahr, 1900, 2100), zahlParam(req.query.monat, 1, 12), req.query.nur === "verbrauch")); }
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
  if (!BEARBEITEN_AKTIV) return res.status(403).json({ fehler: "Das Bearbeiten ist nicht freigegeben. Bitte wenden Sie sich an Ihren Administrator." }), false;
  if (!darfSchreiben(req)) return res.status(403).json({ fehler: "Keine Berechtigung: Ihre Rolle erlaubt nur das Lesen." }), false;
  if (req.params.name && !tabelleErlaubt(req.params.name)) return res.status(403).json({ fehler: "Diese Tabelle ist nicht zum Bearbeiten freigegeben." }), false;
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
app.post("/api/tabellen/:name/zeilen/mehrere", bearbeiten((req) => zeilenEinfuegen(req.params.name, req.body?.zeilen, req.benutzer.login)));
app.put("/api/tabellen/:name/zeilen", bearbeiten((req) => zeileAendern(req.params.name, req.body, req.benutzer.login)));
app.delete("/api/tabellen/:name/zeilen", bearbeiten((req) => zeileLoeschen(req.params.name, req.body, req.benutzer.login)));

// ---------------------------------------------------------------------
// 5c. Werksplan 3D : halles et installations, avec leur documentation
//     daten/anlagen.json  : position, dimensions, description, données techniques, liens
//     daten/dokumente/<id>/ : fichiers téléversés (PDF, plans, photos …)
//     Lire : tout le monde. Modifier, téléverser, supprimer : rôle « bearbeiter » ou « admin ».
// ---------------------------------------------------------------------
const ANLAGEN_DATEI = path.join(DATEN, "anlagen.json");
const DOKU_ORDNER = path.join(DATEN, "dokumente");
const W_TYPEN = ["halle", "presse", "aufbereitung", "ofen", "lager", "sonstige"];
const W_SEU = ["P1", "P2", "UB", "ME"];
const DOKU_ENDUNGEN = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".txt", ".csv", ".dwg", ".dxf", ".step", ".stp", ".zip"];
const DOKU_INLINE = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".txt"];
// plan de départ (à adapter dans l'application : bouton « Bearbeiten »)
const W_START = [
  { id: "halle-1", name: "Halle 1", typ: "halle", x: -22, z: 0, breite: 38, tiefe: 26, hoehe: 12,
    beschreibung: "Pressenhalle mit Presse I, Presse II und Presse III. Fläche, Baujahr und Ansprechpartner hier ergänzen." },
  { id: "halle-2", name: "Halle 2", typ: "halle", x: 22, z: 0, breite: 38, tiefe: 26, hoehe: 12,
    beschreibung: "Halle mit UBC-Aufbereitung und der Anlage ME. Fläche, Baujahr und Ansprechpartner hier ergänzen." },
  { id: "presse-1", name: "Presse I", typ: "presse", halle: "halle-1", seu: "P1", x: -32, z: -3, breite: 6, tiefe: 5, hoehe: 7 },
  { id: "presse-2", name: "Presse II", typ: "presse", halle: "halle-1", seu: "P2", x: -22, z: -3, breite: 6, tiefe: 5, hoehe: 7 },
  { id: "presse-3", name: "Presse III", typ: "presse", halle: "halle-1", x: -12, z: -3, breite: 6, tiefe: 5, hoehe: 7 },
  { id: "ubc", name: "UBC-Aufbereitung", typ: "aufbereitung", halle: "halle-2", seu: "UB", x: 14, z: -3, breite: 11, tiefe: 6, hoehe: 6 },
  { id: "me", name: "ME", typ: "ofen", halle: "halle-2", seu: "ME", x: 31, z: -3, breite: 7, tiefe: 7, hoehe: 7,
    beschreibung: "Anlage mit erfassten Betriebsstunden. Genaue Bezeichnung mit der Fachabteilung klären." },
  { id: "lager", name: "Materiallager", typ: "lager", x: 0, z: 22, breite: 24, tiefe: 8, hoehe: 4 }
].map(a => ({ halle: null, seu: null, drehung: 0, beschreibung: "", daten: [], links: [], notizen: "", dokumente: [], ...a }));

function anlagenLesen() {
  try { return JSON.parse(fs.readFileSync(ANLAGEN_DATEI, "utf8")); }
  catch (err) {
    if (err.code === "ENOENT") return JSON.parse(JSON.stringify(W_START));
    throw new Error(`anlagen.json ist beschädigt: ${err.message}`);
  }
}
function anlagenSchreiben(liste) {
  const tmp = ANLAGEN_DATEI + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(liste, null, 2), "utf8");
  fs.renameSync(tmp, ANLAGEN_DATEI);
}
function anlagenPruefen(liste, bisher) {
  if (!Array.isArray(liste) || liste.length > 150) throw fehler400("Ungültige Liste der Elemente (höchstens 150).");
  const text = (v, max) => String(v ?? "").trim().slice(0, max);
  const zahl = (v, min, max, name) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw fehler400(`„${name}“ muss zwischen ${min} und ${max} liegen.`);
    return Math.round(n * 100) / 100;
  };
  const ids = new Set();
  const neu = liste.map(e => {
    const id = String(e?.id ?? "");
    if (!/^[a-z0-9-]{1,40}$/.test(id) || ids.has(id)) throw fehler400(`Ungültige oder doppelte Kennung: ${id}`);
    ids.add(id);
    const name = text(e.name, 80);
    if (!name) throw fehler400("Jedes Element braucht einen Namen.");
    if (!W_TYPEN.includes(e.typ)) throw fehler400(`Ungültiger Typ bei „${name}“.`);
    const links = (Array.isArray(e.links) ? e.links : []).slice(0, 30)
      .map(l => ({ titel: text(l?.titel, 120), url: text(l?.url, 500) })).filter(l => l.url);
    for (const l of links) if (!/^(https?:\/\/|\\\\)/i.test(l.url))
      throw fehler400(`Link bei „${name}“: nur http(s)://… oder ein Netzwerkpfad \\\\server\\freigabe ist erlaubt.`);
    return {
      id, name, typ: e.typ, halle: e.typ === "halle" ? null : (e.halle || null), seu: W_SEU.includes(e.seu) ? e.seu : null,
      x: zahl(e.x, -500, 500, "X"), z: zahl(e.z, -500, 500, "Z"),
      breite: zahl(e.breite, 0.5, 300, "Breite"), tiefe: zahl(e.tiefe, 0.5, 300, "Tiefe"), hoehe: zahl(e.hoehe, 0.5, 60, "Höhe"),
      drehung: zahl(e.drehung ?? 0, -360, 360, "Drehung"),
      beschreibung: text(e.beschreibung, 4000), notizen: text(e.notizen, 4000),
      kostenstelle: text(e.kostenstelle, 60),
      daten: (Array.isArray(e.daten) ? e.daten : []).slice(0, 40)
        .map(x => ({ name: text(x?.name, 60), wert: text(x?.wert, 200) })).filter(x => x.name || x.wert),
      links,
      live: livePruefen(e.live),
      dokumente: bisher.find(b => b.id === id)?.dokumente ?? []          // les fichiers ne se modifient que par leurs propres routes
    };
  });
  for (const a of neu) if (a.halle && !neu.some(h => h.id === a.halle && h.typ === "halle")) a.halle = null;
  return neu;
}
// ---------------------------------------------------------------------
// 5e. Données en temps réel (Live) pour le Werksplan 3D
//     Chaque élément peut être relié à une table de la base : la dernière ligne (colonne de temps la plus récente)
//     donne l'état (marche / arrêt / panne) et les valeurs affichées. Lecture seule, noms vérifiés dans INFORMATION_SCHEMA.
//     Le serveur garde le résultat 5 s en mémoire : beaucoup d'écrans ouverts ne chargent pas la base.
// ---------------------------------------------------------------------
function livePruefen(l) {
  if (!l || !l.tabelle) return null;
  const n = (v, max = 128) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));
  const tabelle = n(l.tabelle);
  if (!/^[A-Za-z_][A-Za-z0-9_ ]*(\.[A-Za-z_][A-Za-z0-9_ ]*)?$/.test(tabelle.replace(/[[\]]/g, ""))) throw fehler400("Live-Daten: ungültiger Tabellenname.");
  if (!n(l.zeitSpalte)) throw fehler400("Live-Daten: bitte die Zeitspalte wählen.");
  const schwelle = Number(l.schwelle);
  return {
    tabelle, zeitSpalte: n(l.zeitSpalte),
    filterSpalte: n(l.filterSpalte), filterWert: n(l.filterSpalte) ? String(l.filterWert ?? "").slice(0, 200) : null,
    statusSpalte: n(l.statusSpalte), laufWerte: n(l.laufWerte, 300), stoerWerte: n(l.stoerWerte, 300),
    schwelleSpalte: n(l.statusSpalte) ? null : n(l.schwelleSpalte), schwelle: Number.isFinite(schwelle) ? schwelle : 0,
    werte: (Array.isArray(l.werte) ? l.werte : []).slice(0, 4)
      .map(w => ({ spalte: n(w?.spalte), name: n(w?.name, 40), einheit: n(w?.einheit, 12) })).filter(w => w.spalte),
    maxAlterMin: Number(l.maxAlterMin) > 0 ? Math.min(10080, Math.round(Number(l.maxAlterMin))) : 15
  };
}
const liveWert = (v) => (v instanceof Date ? v.toISOString() : typeof v === "string" && v.trim() !== "" && !isNaN(v) ? Number(v) : v ?? null);
async function liveLesen(cfg) {
  const struktur = await tabelleBeschreiben(cfg.tabelle);               // existe ? (sinon erreur claire)
  const vorhanden = new Set(struktur.spalten.map(s => s.spalte));
  const pruef = (spalte, feld) => { if (spalte && !vorhanden.has(spalte)) throw new Error(`Die Spalte „${spalte}“ (${feld}) gibt es nicht in ${struktur.tabelle}.`); };
  pruef(cfg.zeitSpalte, "Zeit"); pruef(cfg.filterSpalte, "Filter"); pruef(cfg.statusSpalte, "Status"); pruef(cfg.schwelleSpalte, "Schwelle");
  cfg.werte.forEach(w => pruef(w.spalte, "Anzeige"));
  const [schema, table] = teileName(cfg.tabelle);
  const ziel = `${qi(schema)}.${qi(table)}`, z = qi(cfg.zeitSpalte);
  const spalten = [...new Set([cfg.statusSpalte, cfg.schwelleSpalte, ...cfg.werte.map(w => w.spalte)].filter(Boolean))];
  const filter = (req) => {
    if (!cfg.filterSpalte) return `WHERE ${z} IS NOT NULL`;
    req.input("f", sql.NVarChar(200), String(cfg.filterWert ?? ""));
    return `WHERE ${z} IS NOT NULL AND LTRIM(RTRIM(CAST(${qi(cfg.filterSpalte)} AS nvarchar(200)))) = @f`;
  };
  return nurLesen(async (tx) => {
    const r1 = new sql.Request(tx);
    // temps et âge calculés par SQL Server lui-même : pas de décalage de fuseau horaire
    const zeile = (await r1.query(`SELECT TOP (1) CONVERT(varchar(19), ${z}, 120) AS __zeit, DATEDIFF(SECOND, ${z}, GETDATE()) AS __alter
      ${spalten.map((s, i) => `, ${qi(s)} AS [c${i}]`).join("")} FROM ${ziel} ${filter(r1)} ORDER BY ${z} DESC`)).recordset[0];
    if (!zeile) return { status: "keine", werte: [], verlauf: [] };
    const wert = (spalte) => liveWert(zeile[`c${spalten.indexOf(spalte)}`]);
    const liste = (t) => String(t || "").split(/[,;]/).map(x => x.trim().toLowerCase()).filter(Boolean);
    let status = "daten", rohStatus = null;
    if (cfg.maxAlterMin && zeile.__alter > cfg.maxAlterMin * 60) status = "veraltet";
    else if (cfg.statusSpalte) {
      rohStatus = wert(cfg.statusSpalte);
      const v = String(rohStatus ?? "").trim().toLowerCase();
      status = liste(cfg.stoerWerte).includes(v) ? "stoerung" : liste(cfg.laufWerte).includes(v) ? "lauf" : "stopp";
    } else if (cfg.schwelleSpalte) status = Number(wert(cfg.schwelleSpalte)) > cfg.schwelle ? "lauf" : "stopp";
    // courbe des 60 dernières valeurs de la première colonne affichée
    let verlauf = [];
    const erste = cfg.werte[0]?.spalte;
    if (erste) {
      const r2 = new sql.Request(tx);
      verlauf = (await r2.query(`SELECT TOP (60) CONVERT(varchar(16), ${z}, 120) AS t, ${qi(erste)} AS v FROM ${ziel} ${filter(r2)} ORDER BY ${z} DESC`)).recordset
        .reverse().map(x => ({ t: x.t, v: Number(x.v) })).filter(x => Number.isFinite(x.v));
    }
    return { status, rohStatus, zeit: zeile.__zeit, alterSek: zeile.__alter,
             werte: cfg.werte.map(w => ({ name: w.name || w.spalte, einheit: w.einheit, wert: wert(w.spalte) })), verlauf };
  });
}
let liveCache = null, liveLaeuft = null;
function liveAlle() {
  if (liveCache && Date.now() - liveCache.t < 5000) return Promise.resolve(liveCache.daten);
  if (!liveLaeuft) liveLaeuft = (async () => {
    const anlagen = {};
    await Promise.all(anlagenLesen().filter(a => a.live?.tabelle).map(async a => {
      try { anlagen[a.id] = await liveLesen(a.live); }
      catch (err) { anlagen[a.id] = { status: "fehler", fehler: err.message, werte: [], verlauf: [] }; }
    }));
    const daten = { zeit: new Date().toISOString(), anlagen };
    liveCache = { t: Date.now(), daten };
    return daten;
  })().finally(() => { liveLaeuft = null; });
  return liveLaeuft;
}
app.get("/api/live", route(() => liveAlle()));
app.get("/api/live/spalten", route((req) => tabelleBeschreiben(String(req.query.tabelle || ""))));
app.post("/api/live/test", async (req, res) => {
  try {
    if (!darfSchreiben(req)) throw fehler400("Keine Berechtigung: Ihre Rolle erlaubt nur das Lesen.", 403);
    const cfg = livePruefen(req.body?.live);
    if (!cfg) throw fehler400("Bitte zuerst eine Tabelle wählen.");
    res.json(await liveLesen(cfg));
  } catch (err) { res.status(err.status || 400).json({ fehler: err.message }); }
});

const dokumentVon = (req) => {
  const a = anlagenLesen().find(x => x.id === req.params.id);
  const dok = a?.dokumente?.find(d => d.id === req.params.dok);
  return { a, dok };
};

app.get("/api/anlagen", route((req) => ({ liste: anlagenLesen(), darf: darfSchreiben(req) })));
app.put("/api/anlagen", (req, res) => {
  try {
    if (!darfSchreiben(req)) throw fehler400("Keine Berechtigung: Ihre Rolle erlaubt nur das Lesen.", 403);
    const bisher = anlagenLesen();
    const neu = anlagenPruefen(req.body?.liste, bisher);
    const entfernt = bisher.filter(a => !neu.some(n => n.id === a.id));
    for (const a of entfernt) fs.rmSync(path.join(DOKU_ORDNER, a.id), { recursive: true, force: true });
    anlagenSchreiben(neu);
    liveCache = null;                                       // configuration modifiée : relire tout de suite
    const geaendert = neu.filter(n => JSON.stringify(n) !== JSON.stringify(bisher.find(b => b.id === n.id))).map(n => n.name);
    protokoll({ aktion: "WERKSPLAN ÄNDERN", wer: req.benutzer.login, tabelle: "anlagen.json",
      alt: entfernt.length ? { name: `entfernt: ${entfernt.map(a => a.name).join(", ")}` } : undefined,
      neu: geaendert.length ? { name: geaendert.join(", ") } : undefined });
    res.json({ liste: neu, darf: true });
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.post("/api/anlagen/:id/dokumente", express.raw({ type: () => true, limit: "25mb" }), (req, res) => {
  try {
    if (!darfSchreiben(req)) throw fehler400("Keine Berechtigung: Ihre Rolle erlaubt nur das Lesen.", 403);
    const liste = anlagenLesen(), a = liste.find(x => x.id === req.params.id);
    if (!a) throw fehler400("Element nicht gefunden. Bitte zuerst den Werksplan speichern.", 404);
    let name = "";
    try { name = decodeURIComponent(String(req.headers["x-dateiname"] || "")); } catch { /* nom illisible */ }
    name = path.basename(name).replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").trim().slice(0, 150);
    const endung = path.extname(name).toLowerCase();
    if (!name || !DOKU_ENDUNGEN.includes(endung)) throw fehler400(`Dateityp nicht erlaubt. Erlaubt: ${DOKU_ENDUNGEN.join(" ")}`);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw fehler400("Die Datei ist leer.");
    if ((a.dokumente || []).length >= 100) throw fehler400("Höchstens 100 Dokumente je Element.");
    const dok = { id: crypto.randomUUID(), name, datei: `${crypto.randomUUID()}${endung}`, groesse: req.body.length,
                  zeit: new Date().toISOString(), wer: req.benutzer.name };
    fs.mkdirSync(path.join(DOKU_ORDNER, a.id), { recursive: true });
    fs.writeFileSync(path.join(DOKU_ORDNER, a.id, dok.datei), req.body);
    a.dokumente = [...(a.dokumente || []), dok];
    anlagenSchreiben(liste);
    protokoll({ aktion: "DOKUMENT NEU", wer: req.benutzer.login, tabelle: "anlagen.json", neu: { name: `${a.name}: ${name}` } });
    res.json({ liste, darf: true });
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.get("/api/anlagen/:id/dokumente/:dok", (req, res) => {
  try {
    const { a, dok } = dokumentVon(req);
    const datei = dok && path.join(DOKU_ORDNER, a.id, dok.datei);
    if (!dok || !fs.existsSync(datei)) return res.status(404).json({ fehler: "Dokument nicht gefunden." });
    const endung = path.extname(dok.datei).toLowerCase();
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `${DOKU_INLINE.includes(endung) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(dok.name)}`);
    res.sendFile(datei);
  } catch (err) { res.status(500).json({ fehler: err.message }); }
});
app.delete("/api/anlagen/:id/dokumente/:dok", (req, res) => {
  try {
    if (!darfSchreiben(req)) throw fehler400("Keine Berechtigung: Ihre Rolle erlaubt nur das Lesen.", 403);
    const liste = anlagenLesen(), a = liste.find(x => x.id === req.params.id);
    const dok = a?.dokumente?.find(d => d.id === req.params.dok);
    if (!dok) throw fehler400("Dokument nicht gefunden.", 404);
    fs.rmSync(path.join(DOKU_ORDNER, a.id, dok.datei), { force: true });
    a.dokumente = a.dokumente.filter(d => d.id !== dok.id);
    anlagenSchreiben(liste);
    protokoll({ aktion: "DOKUMENT LÖSCHEN", wer: req.benutzer.login, tabelle: "anlagen.json", alt: { name: `${a.name}: ${dok.name}` } });
    res.json({ liste, darf: true });
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});

// ---------------------------------------------------------------------
// 5d. Maintenance et pannes (Wartung & Störungen), liées aux éléments du Werksplan
//     daten/wartung.json : { plaene: [...], stoerungen: [...] }
//     Signaler une panne : tout utilisateur connecté (aussi depuis le téléphone via QR).
//     Plans, « erledigt », clôture et suppression : rôle « bearbeiter » ou « admin ».
// ---------------------------------------------------------------------
const WARTUNG_DATEI = path.join(DATEN, "wartung.json");
const W_EINHEITEN = ["tage", "wochen", "monate"];
function wartungLesen() {
  try { const d = JSON.parse(fs.readFileSync(WARTUNG_DATEI, "utf8")); return { plaene: d.plaene || [], stoerungen: d.stoerungen || [] }; }
  catch (err) { if (err.code === "ENOENT") return { plaene: [], stoerungen: [] }; throw new Error(`wartung.json ist beschädigt: ${err.message}`); }
}
function wartungSchreiben(d) {
  const tmp = WARTUNG_DATEI + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2), "utf8");
  fs.renameSync(tmp, WARTUNG_DATEI);
}
const heuteISO = () => new Date().toLocaleDateString("sv-SE");
// prochaine échéance = dernière exécution + intervalle (null si jamais faite)
function wNaechste(p) {
  if (!p.letzte) return null;
  const d = new Date(`${p.letzte}T12:00:00`);
  if (p.einheit === "monate") d.setMonth(d.getMonth() + p.intervall); else d.setDate(d.getDate() + p.intervall * (p.einheit === "wochen" ? 7 : 1));
  return d.toLocaleDateString("sv-SE");
}
const wText = (v, max) => (v == null || v === "" ? null : String(v).trim().slice(0, max) || null);
const wDatum = (v, feld) => {
  if (v == null || v === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || isNaN(new Date(v))) throw fehler400(`„${feld}“ ist kein gültiges Datum.`);
  return String(v);
};
const wZeit = (v, feld) => {
  if (v == null || v === "") return null;
  const d = new Date(v);
  if (isNaN(d)) throw fehler400(`„${feld}“ ist kein gültiger Zeitpunkt.`);
  return d.toISOString();
};
const wAnlage = (id) => {
  if (!anlagenLesen().some(a => a.id === id)) throw fehler400("Bitte eine Halle oder Anlage des Werksplans wählen.");
  return id;
};
function planPruefen(e) {
  const titel = wText(e?.titel, 150);
  if (!titel) throw fehler400("Bitte die Aufgabe eingeben.");
  const intervall = Number(e.intervall);
  if (!Number.isInteger(intervall) || intervall < 1 || intervall > 1000) throw fehler400("Das Intervall muss eine ganze Zahl zwischen 1 und 1000 sein.");
  const letzte = wDatum(e.letzte, "Zuletzt durchgeführt");
  if (letzte && letzte > heuteISO()) throw fehler400("„Zuletzt durchgeführt“ liegt in der Zukunft.");
  return { anlage: wAnlage(String(e.anlage || "")), titel, intervall, einheit: W_EINHEITEN.includes(e.einheit) ? e.einheit : "monate",
           verantwortlich: wText(e.verantwortlich, 120), beschreibung: wText(e.beschreibung, 2000), letzte };
}
function stoerungPruefen(e, alt) {
  const titel = wText(e?.titel, 150);
  if (!titel) throw fehler400("Bitte kurz beschreiben, was passiert ist.");
  const beginn = wZeit(e.beginn, "Seit") || alt?.beginn || new Date().toISOString();
  const ende = wZeit(e.ende, "Behoben am");
  if (new Date(beginn) > Date.now() + 5 * 60000) throw fehler400("Der Beginn liegt in der Zukunft.");
  if (ende && new Date(ende) < new Date(beginn) - 60000) throw fehler400("„Behoben am“ liegt vor dem Beginn der Störung.");   // 1 min de tolérance (saisie à la minute)
  return { anlage: wAnlage(String(e.anlage || "")), titel, stufe: ["stillstand", "eingeschraenkt"].includes(e.stufe) ? e.stufe : "stillstand",
           beschreibung: wText(e.beschreibung, 2000), beginn, ende, ursache: wText(e.ursache, 1000), behebung: wText(e.behebung, 1000) };
}
const wAntwort = (req, d) => ({ ...d, darf: darfSchreiben(req) });
const nurBearbeiter = (req) => { if (!darfSchreiben(req)) throw fehler400("Keine Berechtigung: Ihre Rolle erlaubt nur das Lesen.", 403); };

app.get("/api/wartung", route((req) => wAntwort(req, wartungLesen())));
app.post("/api/wartung/plaene", (req, res) => {
  try {
    nurBearbeiter(req);
    const d = wartungLesen();
    const neu = { id: crypto.randomUUID(), ...planPruefen(req.body), historie: [], erstellt: new Date().toISOString() };
    d.plaene.push(neu); wartungSchreiben(d);
    protokoll({ aktion: "WARTUNGSPLAN NEU", wer: req.benutzer.login, tabelle: "wartung.json", neu: { titel: neu.titel, anlage: neu.anlage } });
    res.json(wAntwort(req, d));
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.put("/api/wartung/plaene/:id", (req, res) => {
  try {
    nurBearbeiter(req);
    const d = wartungLesen(), i = d.plaene.findIndex(p => p.id === req.params.id);
    if (i < 0) throw fehler400("Wartungsplan nicht gefunden.", 404);
    const alt = d.plaene[i];
    d.plaene[i] = { ...alt, ...planPruefen({ ...alt, ...req.body }), geaendert: new Date().toISOString() };
    wartungSchreiben(d);
    protokoll({ aktion: "WARTUNGSPLAN ÄNDERN", wer: req.benutzer.login, tabelle: "wartung.json", alt: { titel: alt.titel }, neu: { titel: d.plaene[i].titel } });
    res.json(wAntwort(req, d));
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.delete("/api/wartung/plaene/:id", (req, res) => {
  try {
    nurBearbeiter(req);
    const d = wartungLesen(), alt = d.plaene.find(p => p.id === req.params.id);
    if (!alt) throw fehler400("Wartungsplan nicht gefunden.", 404);
    d.plaene = d.plaene.filter(p => p.id !== alt.id); wartungSchreiben(d);
    protokoll({ aktion: "WARTUNGSPLAN LÖSCHEN", wer: req.benutzer.login, tabelle: "wartung.json", alt: { titel: alt.titel, anlage: alt.anlage } });
    res.json(wAntwort(req, d));
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.post("/api/wartung/plaene/:id/erledigt", (req, res) => {
  try {
    nurBearbeiter(req);
    const d = wartungLesen(), p = d.plaene.find(x => x.id === req.params.id);
    if (!p) throw fehler400("Wartungsplan nicht gefunden.", 404);
    const datum = wDatum(req.body?.datum, "Durchgeführt am") || heuteISO();
    if (datum > heuteISO()) throw fehler400("Das Datum liegt in der Zukunft.");
    p.historie = [{ id: crypto.randomUUID(), datum, notiz: wText(req.body?.notiz, 1000), wer: req.benutzer.name, zeit: new Date().toISOString() },
                  ...(p.historie || [])].slice(0, 200);
    if (!p.letzte || datum > p.letzte) p.letzte = datum;
    wartungSchreiben(d);
    protokoll({ aktion: "WARTUNG ERLEDIGT", wer: req.benutzer.login, tabelle: "wartung.json", neu: { titel: p.titel, datum } });
    res.json(wAntwort(req, d));
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.post("/api/stoerungen", (req, res) => {
  try {
    const d = wartungLesen();
    const neu = { id: crypto.randomUUID(), ...stoerungPruefen(req.body), gemeldetVon: req.benutzer.name, erstellt: new Date().toISOString() };
    if (neu.ende) neu.behobenVon = req.benutzer.name;
    d.stoerungen.unshift(neu); wartungSchreiben(d);
    protokoll({ aktion: "STÖRUNG GEMELDET", wer: req.benutzer.login, tabelle: "wartung.json", neu: { titel: neu.titel, anlage: neu.anlage, stufe: neu.stufe } });
    // stillstand : e-mail immédiat aux abonnés « kritisch »
    if (mailer && neu.stufe === "stillstand" && !neu.ende) {
      const anlageName = anlagenLesen().find(a => a.id === neu.anlage)?.name ?? neu.anlage;
      const html = mailRahmen("Störung: Stillstand", `${anlageName}, gemeldet von ${req.benutzer.name} am ${new Date(neu.beginn).toLocaleString("de-DE")}`,
        liste([zeile("#CF4B3B", neu.titel, neu.beschreibung || "Keine Beschreibung.")]), { text: "Im Werksplan öffnen", url: `${APP_URL}/#werk/${neu.anlage}` });
      mailSenden(abonnenten("kritisch"), `${APP_NAME} – Störung: ${anlageName} steht (${neu.titel})`, html, textVersion(html), "kritisch").catch(() => {});
    }
    res.json(wAntwort(req, d));
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.put("/api/stoerungen/:id", (req, res) => {
  try {
    nurBearbeiter(req);
    const d = wartungLesen(), i = d.stoerungen.findIndex(s => s.id === req.params.id);
    if (i < 0) throw fehler400("Störung nicht gefunden.", 404);
    const alt = d.stoerungen[i];
    const neu = { ...alt, ...stoerungPruefen({ ...alt, ...req.body }, alt), geaendert: new Date().toISOString() };
    if (neu.ende && !alt.ende) neu.behobenVon = req.benutzer.name;
    if (!neu.ende) delete neu.behobenVon;
    d.stoerungen[i] = neu; wartungSchreiben(d);
    protokoll({ aktion: neu.ende && !alt.ende ? "STÖRUNG BEHOBEN" : "STÖRUNG ÄNDERN", wer: req.benutzer.login, tabelle: "wartung.json", neu: { titel: neu.titel, ende: neu.ende } });
    res.json(wAntwort(req, d));
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.delete("/api/stoerungen/:id", (req, res) => {
  try {
    nurBearbeiter(req);
    const d = wartungLesen(), alt = d.stoerungen.find(s => s.id === req.params.id);
    if (!alt) throw fehler400("Störung nicht gefunden.", 404);
    d.stoerungen = d.stoerungen.filter(s => s.id !== alt.id); wartungSchreiben(d);
    protokoll({ aktion: "STÖRUNG LÖSCHEN", wer: req.benutzer.login, tabelle: "wartung.json", alt: { titel: alt.titel, anlage: alt.anlage } });
    res.json(wAntwort(req, d));
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});

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
const KOMMENTAR_PROMPT = `Du bist Energie- und Produktionscontroller der Firma ${FIRMA} (${APP_UNTERTITEL}) und schreibst den Monatskommentar
für die Geschäftsführung. Du bekommst die Kennzahlen als JSON; sie sind bereits berechnet.

Regeln:
- Verwende NUR Zahlen aus den Daten. Erfinde keine Zahlen, Ursachen oder Ereignisse. Wo die Daten eine Ursache nicht zeigen, sag das.
- Deutsch, sachlich, klar; deutsches Zahlenformat (1.234.567 und 12,3 %). Einheiten sind nicht hinterlegt: keine Einheiten erfinden.
- Ein sinkender EnPI ist eine Verbesserung. Positive normalisierte Einsparung = weniger Verbrauch als erwartet.
- Keine Tabellen- oder Spaltennamen der Datenbank nennen.
- Länge 150 bis 250 Wörter. Keine Überschriften, keine Tabellen. **Fett** nur für 2 bis 4 Schlüsselzahlen.
- Aufbau: ein Absatz Produktion, ein Absatz Energie (EnPI, Einsparung, Prognose zum Jahresziel), ein Absatz Auffälligkeiten und Maßnahmen,
  dann die Zeile "Empfehlungen:" mit 1 bis 3 Punkten, jeweils mit "- " am Zeilenanfang.`;

app.get("/api/kommentare", route((req) => {
  const alle = kommentareLesen(), jahr = parseInt(req.query.jahr, 10);
  return Number.isInteger(jahr) ? Object.fromEntries(Object.entries(alle).filter(([k]) => k.startsWith(`${jahr}-`))) : alle;
}));
app.post("/api/kommentar/entwurf", async (req, res) => {
  if (!claude) return res.status(503).json({ fehler: "Der KI-Dienst ist nicht eingerichtet." });
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
      ? "Der KI-Dienst ist derzeit nicht verfügbar."
      : "Der KI-Dienst ist derzeit nicht verfügbar." });
    res.status(502).json({ fehler: "Der KI-Dienst ist gerade nicht erreichbar. Bitte später erneut versuchen." });
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
// ⑩ facteurs d'émission (kg CO₂ par unité) par énergie, communs à tous les utilisateurs
app.put("/api/einstellungen/co2", (req, res) => {
  try {
    if (!darfSchreiben(req)) throw fehler400("Keine Berechtigung: Ihre Rolle erlaubt nur das Lesen.", 403);
    const roh = req.body?.faktoren || {}, faktoren = {};
    for (const [k, v] of Object.entries(roh).slice(0, 40)) {
      if (v == null || v === "") continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100) throw fehler400(`Ungültiger CO₂-Faktor für ${k}.`);
      faktoren[String(k).slice(0, 60)] = n;
    }
    const alle = einstellungenLesen(), alt = alle.co2 ?? null;
    alle.co2 = { faktoren };
    einstellungenSchreiben(alle);
    protokoll({ aktion: "EINSTELLUNGEN CO2", wer: req.benutzer.login, tabelle: "einstellungen.json", alt, neu: alle.co2 });
    res.json(alle.co2);
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});

// ⑧ correction météo : degrés-jours de chauffage (VDI 3807, 20/15) à partir d'une température extérieure trouvée dans la base
async function witterung(jahr) {
  const { reihen } = await lastQuellen();
  const kandidaten = reihen.filter(r => r.art === "messwert" && (r.einheit === "°C" || /temp/i.test(r.wert)));
  const r = kandidaten.find(x => /au(ss|ß)en|outdoor|aussen/i.test(x.wert)) || kandidaten.find(x => /au(ss|ß)en|outdoor|wetter|klima/i.test(`${x.tabelle} ${x.wert}`));
  if (!r) return { reihe: null };
  const heute = new Date().toLocaleDateString("sv-SE");
  const hgt = async (j) => {
    const bis = `${j}-12-31` < heute ? `${j}-12-31` : heute;
    if (bis < `${j}-01-01` || `${j}-12-31` < r.von.slice(0, 10)) return Array(12).fill(null);
    const d = await lastDaten(r.id, r.gruppenWerte?.[0] ?? null, `${j}-01-01`, bis);
    const tage = new Map();
    for (const x of d.punkte) if (x.p != null) { const k = x.t.slice(0, 10), t = tage.get(k) || [0, 0]; t[0] += x.p; t[1]++; tage.set(k, t); }
    const m = Array(12).fill(null), n = Array(12).fill(0);
    for (const [k, [s, c]] of tage) { const i = Number(k.slice(5, 7)) - 1, tm = s / c; n[i]++; m[i] = (m[i] || 0) + (tm < 15 ? 20 - tm : 0); }
    return m.map((v, i) => (n[i] >= 20 ? v : null));          // mois avec au moins 20 jours de mesure
  };
  const [aktuell, vorjahr] = await Promise.all([hgt(jahr), hgt(jahr - 1)]);
  return { reihe: lesbarServer(r.wert), aktuell, vorjahr };
}
const lesbarServer = (t) => String(t).replace(/_/g, " ").replace(/([a-zäöü])([A-ZÄÖÜ])/g, "$1 $2");
app.get("/api/witterung", route((req) => witterung(jahrAus(req))));

// ⑤ Spitzenlast-Überwachung : seuil (kW) et prix de la puissance par série de mesures, enregistrés pour tous
//   Toutes les 5 minutes : dernière valeur ≥ 90 % du seuil → pré-alerte, ≥ seuil → alerte (e-mail « kritisch », au plus 1 par heure et par série)
app.put("/api/einstellungen/spitzen/:id", (req, res) => {
  try {
    if (!darfSchreiben(req)) throw fehler400("Keine Berechtigung: Ihre Rolle erlaubt nur das Lesen.", 403);
    const id = String(req.params.id).replace(/[^a-f0-9]/gi, "").slice(0, 20);
    const zahlOderNull = (v) => (v == null || v === "" ? null : Number(v));
    const e = { grenze: zahlOderNull(req.body?.grenze), preis: zahlOderNull(req.body?.preis), gruppe: req.body?.gruppe == null ? null : String(req.body.gruppe).slice(0, 200), alarm: !!req.body?.alarm };
    if (e.grenze != null && (!Number.isFinite(e.grenze) || e.grenze <= 0)) throw fehler400("Bitte einen gültigen Grenzwert eingeben.");
    if (e.preis != null && (!Number.isFinite(e.preis) || e.preis < 0)) throw fehler400("Ungültiger Leistungspreis.");
    if (e.alarm && e.grenze == null) throw fehler400("Für die Warnung bitte einen Grenzwert eingeben.");
    const alle = einstellungenLesen();
    alle.spitzen = { ...(alle.spitzen || {}), [id]: e };
    einstellungenSchreiben(alle);
    protokoll({ aktion: "SPITZENLAST-GRENZE", wer: req.benutzer.login, tabelle: "einstellungen.json", neu: { id, ...e } });
    spitzenPruefen().catch(() => {});
    res.json(alle.spitzen);
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});

const spitzenStatus = new Map(), spitzenLetzteMail = new Map();
async function spitzenPruefen() {
  const cfg = einstellungenLesen().spitzen || {};
  const aktiv = Object.entries(cfg).filter(([, c]) => c.alarm && c.grenze);
  for (const id of [...spitzenStatus.keys()]) if (!aktiv.some(([x]) => x === id)) spitzenStatus.delete(id);
  if (!aktiv.length) return;
  const { reihen } = await lastQuellen();
  const heute = new Date(), tag = (d) => d.toLocaleDateString("sv-SE");
  for (const [id, c] of aktiv) {
    const r = reihen.find(x => x.id === id);
    if (!r) continue;
    try {
      const d = await lastDaten(id, c.gruppe, tag(new Date(heute - 86400000)), tag(heute));
      const letzter = [...d.punkte].reverse().find(x => x.p != null);
      if (!letzter) continue;
      const alterMin = (Date.now() - new Date(letzter.t.replace(" ", "T"))) / 60000;
      const einheit = r.art === "leistung" ? r.einheit : ({ kWh: "kW", MWh: "MW", Wh: "W" }[r.einheit] || r.einheit);
      const status = alterMin > 120 ? "veraltet" : letzter.p >= c.grenze ? "ueber" : letzter.p >= 0.9 * c.grenze ? "nahe" : "ok";
      const name = `${lesbarServer(r.wert)}${c.gruppe ? ` (${c.gruppe})` : ""}`;
      spitzenStatus.set(id, { id, name, status, wert: letzter.p, zeit: letzter.t, grenze: c.grenze, einheit });
      if ((status === "ueber" || status === "nahe") && mailer) {
        const schluessel = `${id}-${status}`, zuletzt = spitzenLetzteMail.get(schluessel) || 0;
        const an = abonnenten("kritisch");
        if (an.length && Date.now() - zuletzt > 60 * 60000) {
          spitzenLetzteMail.set(schluessel, Date.now());
          const titel = status === "ueber" ? `Grenzwert überschritten: ${name}` : `Vorwarnung Lastspitze: ${name}`;
          const html = mailRahmen(titel, `Messwert ${letzter.t.slice(8, 10)}.${letzter.t.slice(5, 7)}. ${letzter.t.slice(11)} Uhr`,
            `<p style="font-size:15px">Aktuelle Leistung <b>${zahlDE(letzter.p)} ${esc(einheit)}</b>, Grenzwert <b>${zahlDE(c.grenze)} ${esc(einheit)}</b> (${prozent(letzter.p / c.grenze)}).</p>
             <p>${status === "ueber" ? "Der Grenzwert ist überschritten: bitte nicht dringende Verbraucher sofort abschalten oder verschieben." : "Die Leistung liegt über 90 % des Grenzwerts: bitte zusätzliche Verbraucher jetzt nicht zuschalten."}</p>
             ${c.preis ? `<p style="color:#5F6B76;font-size:13px">Jedes ${esc(einheit)} über der bisherigen Jahresspitze kostet etwa ${zahlDE(c.preis)} € Leistungspreis pro Jahr.</p>` : ""}`,
            { text: "Lastgang öffnen", url: `${APP_URL}/#last` });
          await mailSenden(an, `${APP_NAME} – ${titel}`, html, textVersion(html), "kritisch").catch(() => {});
        }
      }
    } catch (err) { console.error("[Spitzenlast]", err.message); }
  }
}
app.get("/api/spitzen/status", route(() => [...spitzenStatus.values()]));
if (process.env.NODE_ENV !== "test") {
  setTimeout(() => spitzenPruefen().catch(() => {}), 90 * 1000);
  setInterval(() => spitzenPruefen().catch(() => {}), 5 * 60 * 1000);
}
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
// 5f. Energiekosten : calculés DIRECTEMENT à partir des tables de la base, sans aucun réglage
//   1. toutes les tables avec une colonne de temps (Jahr + Monat, ou une date) et des colonnes de consommation / coûts sont analysées
//   2. le porteur d'énergie (Strom, Erdgas, Gas, Wasser …) est reconnu dans le nom des colonnes ou de la table,
//      ou dans une colonne texte « Energieträger / Medium / Art » (regroupement par ses valeurs)
//   3. coûts = colonne(s) de coûts ; sinon consommation × colonne de prix ; Strom des SEU (SEUWerte) × prix des réglages énergie
//   4. si plusieurs tables donnent le même porteur, une seule est comptée (vrais coûts d'abord, puis le plus de mois)
//   Colonnes ignorées : CO₂, parts, quotas, facteurs, relevés de compteur, plan/budget/prévision.
//   Lecture seule ; tous les noms viennent d'INFORMATION_SCHEMA.
// ---------------------------------------------------------------------
const SEU_VERBRAUCH = ["P1_Verbrauch", "P2_Verbrauch", "UB_Verbrauch", "ME_Verbrauch"];
const K_KOSTEN = /kosten|betrag|euro|€|rechnung/i;
const K_PREIS = /preis|tarif|je_?kwh|pro_?kwh|eur_?kwh|ct_?kwh/i;
const K_AUSSCHLUSS = /co2|co₂|emission|anteil|prozent|quote|faktor|z(ae|ä)hlerstand|stand$|ziel|plan|budget|prognose/i;
const K_GRUPPE = /^((energie)?tr(ae|ä)ger|medium|medien|energieart|energiequelle|energietyp|sorte|art)$/i;
const K_TRAEGER = [["Erdgas", /erdgas/i], ["Fernwärme", /fernw(ae|ä)rme/i], ["Gas", /gas(?!se)/i], ["Strom", /strom|elektr|wirkarbeit/i],
  ["Wasser", /wasser/i], ["Diesel", /diesel/i], ["Heizöl", /heiz(oe|ö)l/i], ["Druckluft", /druckluft/i], ["Stickstoff", /stickstoff/i], ["Propan", /propan/i]];
const traegerAus = (t) => K_TRAEGER.find(([, re]) => re.test(String(t ?? "")))?.[0] ?? null;
const einheitAus = (t) => { t = String(t ?? ""); return /mwh/i.test(t) ? "MWh" : /kwh/i.test(t) ? "kWh" : /m3|m³|kubik|cbm/i.test(t) ? "m³" : /liter|_l$/i.test(t) ? "l" : ""; };
const gesamtOderAlle = (cols) => { const g = cols.find(c => /gesamt|summe|total/i.test(c)); return g ? [g] : cols; };

// analyse de la structure (gardée 5 minutes)
let kostenQuellenCache = null;
async function kostenQuellen() {
  if (kostenQuellenCache && Date.now() - kostenQuellenCache.t < 5 * 60000) return kostenQuellenCache.d;
  const r = await (await pool()).request().query(`
    SELECT c.TABLE_SCHEMA AS [schema], c.TABLE_NAME AS tabelle, c.COLUMN_NAME AS spalte, c.DATA_TYPE AS typ, t.TABLE_TYPE AS art
    FROM INFORMATION_SCHEMA.COLUMNS c
    JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
    ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`);
  const proTabelle = new Map();
  for (const z of r.recordset) {
    const key = `${z.schema}.${z.tabelle}`;
    if (!proTabelle.has(key)) proTabelle.set(key, { schema: z.schema, table: z.tabelle, tabelle: key, view: z.art === "VIEW", spalten: [] });
    proTabelle.get(key).spalten.push({ spalte: z.spalte, typ: z.typ });
  }
  const quellen = [], ignoriert = [];
  let seu = false;
  for (const t of proTabelle.values()) {
    if (/^seuwerte$/i.test(t.table)) { seu = true; continue; }
    if (VERBRAUCH_AUSSCHLUSS.test(t.table)) continue;
    const zeit = zeitSpalten(t.spalten), a = zeitAusdruck(zeit);
    const zeitNamen = new Set([zeit?.jahr, zeit?.monat, zeit?.datum].filter(Boolean));
    const zahlen = t.spalten.filter(s => ZAHL_TYPEN.includes(s.typ) && !zeitNamen.has(s.spalte) && !istKennung(s.spalte) && !K_AUSSCHLUSS.test(s.spalte)).map(s => s.spalte);
    const kosten = zahlen.filter(c => K_KOSTEN.test(c) && !K_PREIS.test(c));
    const preise = zahlen.filter(c => K_PREIS.test(c) && !K_KOSTEN.test(c));
    const verbr = zahlen.filter(c => !K_KOSTEN.test(c) && !K_PREIS.test(c) && istVerbrauchSpalte(c));
    if (!kosten.length && !verbr.length) continue;
    if (!a?.monat) { ignoriert.push({ tabelle: t.tabelle, grund: "keine Monats- oder Datumsspalte" }); continue; }
    const basis = { tabelle: t.tabelle, schema: t.schema, table: t.table, view: t.view, a };
    const gruppe = t.spalten.find(s => /char/i.test(s.typ) && K_GRUPPE.test(s.spalte));
    if (gruppe) {
      quellen.push({ ...basis, gruppe: gruppe.spalte, verbrauch: gesamtOderAlle(verbr), kosten: gesamtOderAlle(kosten), preis: kosten.length ? null : preise[0] ?? null });
      continue;
    }
    const namen = [...new Set([...verbr, ...kosten].map(traegerAus).filter(Boolean))];
    if (namen.length > 1) {
      for (const n of namen) {
        const v = verbr.filter(c => traegerAus(c) === n), k = kosten.filter(c => traegerAus(c) === n);
        quellen.push({ ...basis, name: n, verbrauch: gesamtOderAlle(v), kosten: gesamtOderAlle(k), preis: k.length ? null : preise.find(c => traegerAus(c) === n) ?? null });
      }
    } else {
      const name = namen[0] || traegerAus(t.table);
      if (name || /energie|verbrauch|medien|z(ae|ä)hler/i.test(t.table)) {
        quellen.push({ ...basis, name: name || t.table, verbrauch: gesamtOderAlle(verbr), kosten: gesamtOderAlle(kosten), preis: kosten.length ? null : preise[0] ?? null });
      } else {
        ignoriert.push({ tabelle: t.tabelle, grund: `kein Energieträger erkennbar (Spalten ${[...kosten, ...verbr].slice(0, 4).join(", ")})` });
      }
    }
  }
  const d = { quellen, ignoriert, seu };
  kostenQuellenCache = { t: Date.now(), d };
  return d;
}

// sommes par mois (année et année précédente) d'une source
async function quelleMonate(q, jahr) {
  const summe = (cols) => (cols.length ? cols.map(c => `ISNULL(SUM(CAST(${qi(c)} AS float)), 0)`).join(" + ") : "NULL");
  const anzahl = (cols) => (cols.length ? cols.map(c => `COUNT(${qi(c)})`).join(" + ") : "0");
  const zeile = (cols) => cols.map(c => `ISNULL(CAST(${qi(c)} AS float), 0)`).join(" + ");
  const mitPreis = !q.kosten.length && q.preis && q.verbrauch.length;
  const k = q.kosten.length ? summe(q.kosten) : mitPreis ? `ISNULL(SUM(CAST(${qi(q.preis)} AS float) * (${zeile(q.verbrauch)})), 0)` : "NULL";
  const nk = q.kosten.length ? anzahl(q.kosten) : mitPreis ? `COUNT(${qi(q.preis)})` : "0";
  const g = q.gruppe ? `LTRIM(RTRIM(CAST(${qi(q.gruppe)} AS nvarchar(100))))` : null;
  return nurLesen(async (tx) => {
    const req = new sql.Request(tx);
    req.input("j", sql.Int, jahr);
    return (await req.query(`SELECT ${q.a.jahr} AS j, ${q.a.monat} AS m${g ? `, ${g} AS g` : ""},
      ${summe(q.verbrauch)} AS v, ${anzahl(q.verbrauch)} AS nv, ${k} AS k, ${nk} AS nk
      FROM ${qi(q.schema)}.${qi(q.table)} WHERE ${q.a.jahr} IN (@j, @j - 1)${g ? ` AND ${qi(q.gruppe)} IS NOT NULL` : ""}
      GROUP BY ${q.a.jahr}, ${q.a.monat}${g ? `, ${g}` : ""}`)).recordset;
  });
}

async function kostenDaten(jahr) {
  const { quellen, ignoriert, seu } = await kostenQuellen();
  const energiePreis = einstellungenLesen().energie?.preis ?? null;
  const leer = () => Array.from({ length: 12 }, () => null);
  const kandidaten = [], probleme = [...ignoriert];
  const neu = (name, quelle, preisQuelle, einheit) => ({ name, quelle, preisQuelle, einheit, aktuell: leer(), vorjahr: leer() });
  const eintragen = (t, j, m, v, k) => {
    const z = j === jahr ? t.aktuell : j === jahr - 1 ? t.vorjahr : null;
    if (!z || !(m >= 1 && m <= 12)) return;
    const alt = z[m - 1] || { verbrauch: null, kosten: null };
    z[m - 1] = { verbrauch: v == null ? alt.verbrauch : (alt.verbrauch || 0) + v, kosten: k == null ? alt.kosten : (alt.kosten || 0) + k };
  };

  await Promise.all(quellen.map(async (q) => {
    try {
      const rows = await quelleMonate(q, jahr);
      const pq = q.kosten.length ? "spalte" : q.preis && q.verbrauch.length ? "preisspalte" : null;
      const info = { tabelle: q.tabelle, verbrauch: q.verbrauch, kosten: q.kosten, preis: q.preis, gruppe: q.gruppe ?? null, view: q.view };
      const einheit = einheitAus(q.verbrauch.join(" ")) || einheitAus(q.tabelle);
      const proName = new Map();
      for (const r of rows) {
        const name = q.gruppe ? (traegerAus(r.g) || String(r.g)) : q.name;
        if (!name) continue;
        if (!proName.has(name)) proName.set(name, neu(name, { ...info, wert: q.gruppe ? r.g : null }, pq, einheit || einheitAus(r.g)));
        eintragen(proName.get(name), Number(r.j), Number(r.m), Number(r.nv) ? Number(r.v) : null, Number(r.nk) ? Number(r.k) : null);
      }
      kandidaten.push(...proName.values());
    } catch (err) { probleme.push({ tabelle: q.tabelle, grund: err.message }); }
  }));

  // Strom des installations SEU (pas de colonne de coûts dans SEUWerte : prix des réglages énergie)
  if (seu) {
    try {
      const d = await energie(jahr);
      const t = neu("Strom", { tabelle: "dbo.SEUWerte", verbrauch: SEU_VERBRAUCH, kosten: [], preis: null, gruppe: null, seu: true }, energiePreis != null ? "einstellung" : null, "kWh");
      for (const r of [...d.aktuell, ...d.vorjahr]) {
        const v = SEU_VERBRAUCH.reduce((s, c) => s + (Number(r[c]) || 0), 0);
        eintragen(t, r.Jahr, r.Monat, v, energiePreis != null ? v * energiePreis : null);
      }
      t.preisVerwendet = energiePreis;
      kandidaten.push(t);
    } catch (err) { probleme.push({ tabelle: "dbo.SEUWerte", grund: err.message }); }
  }

  // un seul porteur par nom : vrais coûts > prix × consommation > prix des réglages, puis le plus de mois, puis table plutôt que vue
  const rang = { spalte: 3, preisspalte: 2, einstellung: 1 };
  const punkte = (t) => [rang[t.preisQuelle] || 0, t.aktuell.filter(x => x?.kosten != null).length, t.aktuell.filter(x => x?.verbrauch != null).length, t.quelle.view ? 0 : 1];
  const besser = (a, b) => { const pa = punkte(a), pb = punkte(b); for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i]; return false; };
  const gewaehlt = new Map(), doppelt = [];
  for (const t of kandidaten) {
    const key = t.name.toLowerCase(), alt = gewaehlt.get(key);
    if (!alt) gewaehlt.set(key, t);
    else if (besser(t, alt)) { doppelt.push(alt); gewaehlt.set(key, t); }
    else doppelt.push(t);
  }
  const summeKosten = (t) => t.aktuell.reduce((s, x) => s + (x?.kosten || 0), 0);
  const traeger = [...gewaehlt.values()].filter(t => t.aktuell.some(Boolean) || t.vorjahr.some(Boolean))
    .sort((a, b) => summeKosten(b) - summeKosten(a) || a.name.localeCompare(b.name, "de"))
    .map((t, i) => ({ ...t, id: `t${i}` }));

  // production (€ par tonne) ; unité de ProduktionMonat estimée : grande moyenne mensuelle → kg
  const p = await produktion(jahr).catch(() => ({ aktuell: [], vorjahr: [] }));
  const proMonat = (rows) => Array.from({ length: 12 }, (_, i) => rows.find(r => r.Monat === i + 1)?.gesamt ?? null);
  const werte = [...p.aktuell, ...p.vorjahr].map(r => Number(r.gesamt)).filter(x => x > 0);
  const mengeEinheit = werte.length && werte.reduce((s, x) => s + x, 0) / werte.length < 200000 ? "t" : "kg";

  return { jahr, mengeEinheit, energiePreis, traeger,
           doppelt: doppelt.map(t => ({ name: t.name, quelle: t.quelle })), ignoriert: probleme,
           produktion: { aktuell: proMonat(p.aktuell), vorjahr: proMonat(p.vorjahr) } };
}

app.get("/api/kosten", route((req) => kostenDaten(jahrAus(req))));

// ---------------------------------------------------------------------
// 5g. Lastgang-Analyse : recherche AUTOMATIQUE de séries de mesures (15 min, 1 h …) dans toute la base
//   1. tables avec une colonne date-heure (datetime, datetime2 …) et des colonnes numériques
//   2. trame mesurée sur les 400 dernières valeurs (médiane des écarts) : retenue si ≤ 1 heure
//   3. type de chaque colonne d'après son nom : puissance (kW), énergie par intervalle (kWh), relevé de compteur (cumulé), autre mesure (V, A, °C …)
//   4. colonne de regroupement éventuelle (compteur, point de mesure, appareil …) : choix dans l'interface
//   Résultat gardé 30 minutes ; lecture seule ; noms issus d'INFORMATION_SCHEMA, valeurs en paramètres.
// ---------------------------------------------------------------------
const ZEIT_TYPEN_FEIN = ["datetime", "datetime2", "smalldatetime", "datetimeoffset"];
const R_ZEITNAME = /zeit|time|datum|date|stamp|^ts$|_ts$/i;
const R_ZAEHLERSTAND = /z(ae|ä)hlerstand|z(ae|ä)hlwerk|counter|stand$/i;
const R_ARBEIT = /kwh|mwh|wh$|arbeit|verbrauch|energie|m3|m³|menge/i;
const R_LEISTUNG = /leistung|power|(^|_)p(_|$)|kw$|_kw|kw_|watt/i;
const R_GRUPPE_LAST = /z(ae|ä)hler|messstelle|messpunkt|ger(ae|ä)t|device|meter|kanal|channel|anlage|signal|datenpunkt|bezeichnung|name/i;
const R_KEIN_MESSWERT = /jahr|monat|woche|stunde$|minute|quartal|status|flag|qualit|(^|_)id$|nr$|nummer|index|anzahl|count|^tag$/i;

function messArt(spalte) {
  if (R_ZAEHLERSTAND.test(spalte)) return { art: "zaehler", einheit: /mwh/i.test(spalte) ? "MWh" : /m3|m³/i.test(spalte) ? "m³" : "kWh" };
  if (R_ARBEIT.test(spalte)) return { art: "arbeit", einheit: /mwh/i.test(spalte) ? "MWh" : /m3|m³/i.test(spalte) ? "m³" : /(^|_)wh/i.test(spalte) ? "Wh" : "kWh" };
  if (R_LEISTUNG.test(spalte)) return { art: "leistung", einheit: /mw/i.test(spalte) ? "MW" : /watt/i.test(spalte) && !/kw/i.test(spalte) ? "W" : "kW" };
  const e = /spannung|volt/i.test(spalte) ? "V" : /strom|ampere/i.test(spalte) ? "A" : /frequenz|hz/i.test(spalte) ? "Hz" : /temp/i.test(spalte) ? "°C" : /druck|bar/i.test(spalte) ? "bar" : "";
  return { art: "messwert", einheit: e };
}
const dauerText = (sek) => (sek < 120 ? `${Math.round(sek)} s` : sek < 7200 ? `${Math.round(sek / 60)} min` : sek < 172800 ? `${Math.round(sek / 3600)} h` : `${Math.round(sek / 86400)} Tage`);

let lastQuellenCache = null, lastSuche = null;
async function lastQuellen(neu = false) {
  if (!neu && lastQuellenCache && Date.now() - lastQuellenCache.t < 30 * 60000) return lastQuellenCache.d;
  if (lastSuche) return lastSuche;
  lastSuche = (async () => {
    const p = await pool();
    const spaltenR = await p.request().query(`
      SELECT c.TABLE_SCHEMA AS [schema], c.TABLE_NAME AS tabelle, c.COLUMN_NAME AS spalte, c.DATA_TYPE AS typ
      FROM INFORMATION_SCHEMA.COLUMNS c
      JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
      ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`);
    const zeilenR = await p.request().query(`
      SELECT SCHEMA_NAME(o.schema_id) AS s, o.name AS t, SUM(pt.rows) AS n
      FROM sys.objects o JOIN sys.partitions pt ON pt.object_id = o.object_id AND pt.index_id IN (0, 1)
      WHERE o.type = 'U' GROUP BY o.schema_id, o.name`);
    const anzahlVon = new Map(zeilenR.recordset.map(z => [`${z.s}.${z.t}`, Number(z.n)]));
    const proTabelle = new Map();
    for (const z of spaltenR.recordset) {
      const key = `${z.schema}.${z.tabelle}`;
      if (!proTabelle.has(key)) proTabelle.set(key, { schema: z.schema, table: z.tabelle, tabelle: key, spalten: [] });
      proTabelle.get(key).spalten.push({ spalte: z.spalte, typ: z.typ });
    }
    const reihen = [], geprueft = [];
    for (const t of proTabelle.values()) {
      const zeitSp = t.spalten.filter(s => ZEIT_TYPEN_FEIN.includes(s.typ));
      if (!zeitSp.length) continue;
      const zeit = zeitSp.find(s => R_ZEITNAME.test(s.spalte)) || zeitSp[0];
      const n = anzahlVon.get(t.tabelle);
      if (n != null && n < 96) { geprueft.push({ tabelle: t.tabelle, grund: `nur ${n} Zeilen` }); continue; }
      const werte = t.spalten.filter(s => ZAHL_TYPEN.includes(s.typ) && !istKennung(s.spalte) && !R_KEIN_MESSWERT.test(s.spalte));
      if (!werte.length) { geprueft.push({ tabelle: t.tabelle, grund: "keine Messwert-Spalten" }); continue; }
      const gruppe = t.spalten.find(s => /char/i.test(s.typ) && R_GRUPPE_LAST.test(s.spalte))
        || t.spalten.find(s => ["int", "bigint", "smallint"].includes(s.typ) && istKennung(s.spalte) && R_GRUPPE_LAST.test(s.spalte));
      try {
        const ziel = `${qi(t.schema)}.${qi(t.table)}`, z = qi(zeit.spalte);
        const info = await nurLesen(async (tx) => {
          let gWerte = [];
          if (gruppe) {
            const g = qi(gruppe.spalte);
            gWerte = (await new sql.Request(tx).query(`SELECT TOP (200) LTRIM(RTRIM(CAST(x.g AS nvarchar(200)))) AS g, COUNT_BIG(*) AS n
              FROM (SELECT TOP (20000) ${g} AS g FROM ${ziel} WHERE ${z} IS NOT NULL ORDER BY ${z} DESC) x
              WHERE x.g IS NOT NULL GROUP BY LTRIM(RTRIM(CAST(x.g AS nvarchar(200)))) ORDER BY n DESC`)).recordset.map(r => r.g);
          }
          const req = new sql.Request(tx);
          let w = `${z} IS NOT NULL`;
          if (gruppe && gWerte.length) { req.input("g", sql.NVarChar(200), gWerte[0]); w += ` AND LTRIM(RTRIM(CAST(${qi(gruppe.spalte)} AS nvarchar(200)))) = @g`; }
          const probe = (await req.query(`SELECT TOP (400) DATEDIFF(SECOND, '2000-01-01', ${z}) AS s FROM ${ziel} WHERE ${w} ORDER BY ${z} DESC`)).recordset.map(r => Number(r.s));
          const grenzen = (await new sql.Request(tx).query(`SELECT CONVERT(varchar(19), MIN(${z}), 120) AS von, CONVERT(varchar(19), MAX(${z}), 120) AS bis FROM ${ziel}`)).recordset[0];
          return { gWerte, probe, ...grenzen };
        });
        const abstaende = info.probe.slice(0, -1).map((s, i) => s - info.probe[i + 1]).filter(d => d > 0).sort((a, b) => a - b);
        if (abstaende.length < 10) { geprueft.push({ tabelle: t.tabelle, grund: "zu wenige Zeitpunkte" }); continue; }
        const raster = abstaende[Math.floor(abstaende.length / 2)];
        if (raster > 3600 * 1.05) { geprueft.push({ tabelle: t.tabelle, grund: `Zeitraster ${dauerText(raster)}: zu grob (höchstens 1 Stunde)` }); continue; }
        for (const s of werte) {
          reihen.push({ id: crypto.createHash("md5").update(`${t.tabelle}|${s.spalte}`).digest("hex").slice(0, 12),
            tabelle: t.tabelle, schema: t.schema, table: t.table, zeit: zeit.spalte, wert: s.spalte, ...messArt(s.spalte),
            gruppe: gruppe && info.gWerte.length ? gruppe.spalte : null, gruppenWerte: gruppe ? info.gWerte : [],
            aufloesung: raster, von: info.von, bis: info.bis, zeilen: n ?? null });
        }
        geprueft.push({ tabelle: t.tabelle, grund: `gefunden: Raster ${dauerText(raster)}, ${werte.length} Messwert-Spalten` });
      } catch (err) { geprueft.push({ tabelle: t.tabelle, grund: `nicht lesbar: ${err.message}` }); }
    }
    const rang = { arbeit: 0, leistung: 1, zaehler: 2, messwert: 3 };
    reihen.sort((a, b) => rang[a.art] - rang[b.art] || a.tabelle.localeCompare(b.tabelle) || a.wert.localeCompare(b.wert));
    const d = { zeit: new Date().toISOString(), reihen, geprueft };
    lastQuellenCache = { t: Date.now(), d };
    return d;
  })().finally(() => { lastSuche = null; });
  return lastSuche;
}

// valeurs d'une série pour une période : agrégées sur 15 min (≤ 62 jours) ou 1 heure
async function lastDaten(id, gruppeWert, von, bis) {
  const { reihen } = await lastQuellen();
  const r = reihen.find(x => x.id === id);
  if (!r) throw fehler400("Messreihe nicht gefunden. Bitte die Seite neu laden.", 404);
  const tag = /^\d{4}-\d{2}-\d{2}$/;
  if (!tag.test(von || "") || !tag.test(bis || "")) throw fehler400("Ungültiger Zeitraum.");
  const tage = Math.round((new Date(`${bis}T12:00:00`) - new Date(`${von}T12:00:00`)) / 86400000) + 1;
  if (tage < 1 || tage > 366) throw fehler400("Der Zeitraum muss zwischen 1 und 366 Tagen liegen.");
  const raster = r.aufloesung > 900 * 1.05 || tage > 62 ? 60 : 15;                 // minutes
  const z = qi(r.zeit), v = qi(r.wert);
  const bucket = `DATEADD(minute, (DATEDIFF(minute, '2000-01-01', ${z}) / ${raster}) * ${raster}, CAST('2000-01-01' AS datetime2))`;
  const agg = r.art === "arbeit" ? `SUM(CAST(${v} AS float))` : r.art === "zaehler" ? `MAX(CAST(${v} AS float))` : `AVG(CAST(${v} AS float))`;
  const zeilen = await nurLesen(async (tx) => {
    const req = new sql.Request(tx);
    req.input("von", sql.VarChar(10), von).input("bis", sql.VarChar(10), bis);
    let w = `${z} >= CAST(@von AS datetime2) AND ${z} < DATEADD(day, 1, CAST(@bis AS datetime2))`;
    if (r.gruppe && gruppeWert != null && gruppeWert !== "") {
      req.input("g", sql.NVarChar(200), String(gruppeWert));
      w += ` AND LTRIM(RTRIM(CAST(${qi(r.gruppe)} AS nvarchar(200)))) = @g`;
    }
    return (await req.query(`SELECT CONVERT(varchar(16), ${bucket}, 120) AS t, ${agg} AS w, MIN(CAST(${v} AS float)) AS mi, MAX(CAST(${v} AS float)) AS ma
      FROM ${qi(r.schema)}.${qi(r.table)} WHERE ${w} GROUP BY ${bucket} ORDER BY ${bucket}`)).recordset;
  });
  const h = raster / 60;
  let vorher = null;
  const punkte = zeilen.map(x => {
    const wert = x.w == null ? null : Number(x.w);
    let p = null, e = null;
    if (r.art === "arbeit") { e = wert; p = wert == null ? null : wert / h; }
    else if (r.art === "leistung") { p = wert; e = wert == null ? null : wert * h; }
    else if (r.art === "zaehler") { if (wert != null && vorher != null && wert >= vorher) { e = wert - vorher; p = e / h; } if (wert != null) vorher = wert; }
    else p = wert;
    return { t: x.t, p, e, mi: x.mi == null ? null : Number(x.mi), ma: x.ma == null ? null : Number(x.ma) };
  });
  const { gruppenWerte, ...reihe } = r;
  return { reihe, gruppe: gruppeWert ?? null, von, bis, raster, punkte };
}

app.get("/api/last/quellen", route(async (req) => {
  const d = await lastQuellen(req.query.neu === "1");
  return req.benutzer.rolle === "admin" ? d : { zeit: d.zeit, reihen: d.reihen.map(({ schema, table, tabelle, ...x }) => ({ ...x, tabelle: tabelle.replace(/^dbo\./, "") })) };
}));
app.get("/api/last/daten", route((req) => lastDaten(String(req.query.id || ""), req.query.gruppe, String(req.query.von || ""), String(req.query.bis || ""))));

// ---------------------------------------------------------------------
// 5h. Compteurs : arbre (compteur principal → sous-compteurs), bilan, compteurs virtuels, relevés manuels
//   daten/zaehler.json : { zaehler: [...], ablesungen: [...] }
//   Source d'un compteur : « seu » (installation des données énergie), « reihe » (série de mesures trouvée dans la base),
//   « manuell » (relevés saisis, par ex. sur le téléphone via le code QR), « formel » (compteur virtuel, ex. Haupt - P1 - P2)
//   Lire et saisir un relevé : tout utilisateur connecté. Créer, modifier, supprimer : bearbeiter / admin.
// ---------------------------------------------------------------------
const ZAEHLER_DATEI = path.join(DATEN, "zaehler.json");
const Z_QUELLEN = ["manuell", "seu", "reihe", "formel"];
function zaehlerLesen() {
  try { const d = JSON.parse(fs.readFileSync(ZAEHLER_DATEI, "utf8")); return { zaehler: d.zaehler || [], ablesungen: d.ablesungen || [] }; }
  catch (err) { if (err.code === "ENOENT") return { zaehler: [], ablesungen: [] }; throw new Error(`zaehler.json ist beschädigt: ${err.message}`); }
}
function zaehlerSchreiben(d) {
  const tmp = ZAEHLER_DATEI + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2), "utf8");
  fs.renameSync(tmp, ZAEHLER_DATEI);
}

// formule d'un compteur virtuel : codes de compteurs, nombres, + - * / et parenthèses (sans eval)
function formelZerlegen(text) {
  const t = String(text || "").match(/\s*([A-Za-z][A-Za-z0-9_]*|\d+(?:[.,]\d+)?|[-+*/()])\s*/gy);
  if (!t || t.join("").replace(/\s/g, "") !== String(text).replace(/\s/g, "")) throw fehler400("Formel: nur Zählercodes, Zahlen, + - * / und Klammern sind erlaubt.");
  const tok = t.map(x => x.trim());
  let i = 0;
  const ausdruck = () => { let l = term(); while (tok[i] === "+" || tok[i] === "-") { const op = tok[i++]; l = { op, l, r: term() }; } return l; };
  const term = () => { let l = faktor(); while (tok[i] === "*" || tok[i] === "/") { const op = tok[i++]; l = { op, l, r: faktor() }; } return l; };
  const faktor = () => {
    const x = tok[i++];
    if (x === "(") { const e = ausdruck(); if (tok[i++] !== ")") throw fehler400("Formel: Klammer nicht geschlossen."); return e; }
    if (x === "-") return { op: "-", l: { zahl: 0 }, r: faktor() };
    if (x != null && /^\d/.test(x)) return { zahl: Number(x.replace(",", ".")) };
    if (x != null && /^[A-Za-z]/.test(x)) return { code: x };
    throw fehler400("Formel ist unvollständig.");
  };
  const baum = ausdruck();
  if (i !== tok.length) throw fehler400("Formel: unerwartetes Zeichen.");
  return baum;
}
const formelCodes = (b, out = new Set()) => { if (b.code) out.add(b.code); if (b.l) formelCodes(b.l, out); if (b.r) formelCodes(b.r, out); return out; };
const formelRechnen = (b, wert) => {
  if (b.zahl != null) return b.zahl;
  if (b.code) return wert(b.code);
  const l = formelRechnen(b.l, wert), r = formelRechnen(b.r, wert);
  if (l == null || r == null) return null;
  return b.op === "+" ? l + r : b.op === "-" ? l - r : b.op === "*" ? l * r : r === 0 ? null : l / r;
};

function zaehlerPruefen(liste) {
  if (!Array.isArray(liste) || liste.length > 300) throw fehler400("Ungültige Zählerliste (höchstens 300).");
  const text = (v, max) => (v == null ? "" : String(v).trim().slice(0, max));
  const ids = new Set(), codes = new Set();
  const neu = liste.map((z, i) => {
    const id = String(z?.id || "").replace(/[^a-z0-9-]/gi, "").slice(0, 40) || `z${Date.now().toString(36)}${i}`;
    if (ids.has(id)) throw fehler400("Doppelte Zähler-Kennung."); ids.add(id);
    const name = text(z.name, 80); if (!name) throw fehler400(`Zähler ${i + 1}: bitte einen Namen eingeben.`);
    const kurz = text(z.kurz, 20);
    if (!/^[A-Za-z][A-Za-z0-9_]{0,19}$/.test(kurz)) throw fehler400(`${name}: Kurzzeichen mit Buchstabe beginnen, nur Buchstaben, Ziffern und _ (z. B. HZ1).`);
    if (codes.has(kurz.toLowerCase())) throw fehler400(`Kurzzeichen „${kurz}“ ist doppelt.`); codes.add(kurz.toLowerCase());
    const quelle = Z_QUELLEN.includes(z.quelle) ? z.quelle : "manuell";
    const e = { id, name, kurz, einheit: text(z.einheit, 12) || "kWh", traeger: text(z.traeger, 40) || null, eltern: z.eltern || null, anlage: z.anlage || null, quelle,
                seu: null, reihe: null, gruppe: null, formel: null };
    if (quelle === "seu") { if (!SEU_DEF_SERVER.includes(z.seu)) throw fehler400(`${name}: bitte die Anlage wählen.`); e.seu = z.seu; }
    if (quelle === "reihe") { e.reihe = text(z.reihe, 20); if (!e.reihe) throw fehler400(`${name}: bitte die Messreihe wählen.`); e.gruppe = z.gruppe == null ? null : text(z.gruppe, 200); }
    if (quelle === "formel") { e.formel = text(z.formel, 300); formelZerlegen(e.formel); }
    return e;
  });
  const nachCode = new Map(neu.map(z => [z.kurz.toLowerCase(), z]));
  for (const z of neu) {
    if (z.eltern && !neu.some(x => x.id === z.eltern)) z.eltern = null;
    for (let p = z.eltern, n = 0; p; p = neu.find(x => x.id === p)?.eltern, n++) if (p === z.id || n > 50) throw fehler400(`${z.name}: der übergeordnete Zähler ergibt einen Kreis.`);
    if (z.formel) for (const c of formelCodes(formelZerlegen(z.formel))) {
      if (!nachCode.has(c.toLowerCase())) throw fehler400(`${z.name}: Zähler „${c}“ in der Formel gibt es nicht.`);
    }
  }
  // formules sans boucle
  const besucht = new Map();
  const tiefe = (z) => {
    if (besucht.get(z.id) === 1) throw fehler400(`${z.name}: die Formeln verweisen im Kreis aufeinander.`);
    if (besucht.get(z.id) === 2 || !z.formel) return; besucht.set(z.id, 1);
    for (const c of formelCodes(formelZerlegen(z.formel))) tiefe(nachCode.get(c.toLowerCase()));
    besucht.set(z.id, 2);
  };
  neu.forEach(tiefe);
  return neu;
}
const SEU_DEF_SERVER = ["P1", "P2", "UB", "ME"];
const SEU_SPALTE = { P1: "P1_Verbrauch", P2: "P2_Verbrauch", UB: "UB_Verbrauch", ME: "ME_Verbrauch" };

// relevés cumulés → consommation par mois (interpolation linéaire aux limites des mois)
function monateAusAblesungen(ab, jahr) {
  const p = ab.map(a => ({ t: new Date(a.zeit).getTime(), s: a.stand })).sort((x, y) => x.t - y.t);
  const stand = (t) => {
    if (!p.length || t < p[0].t || t > p.at(-1).t) return null;
    for (let i = 1; i < p.length; i++) if (t <= p[i].t) { const a = p[i - 1], b = p[i]; return b.t === a.t ? b.s : a.s + ((b.s - a.s) * (t - a.t)) / (b.t - a.t); }
    return p[0].s;
  };
  return Array.from({ length: 12 }, (_, m) => {
    const a = stand(new Date(jahr, m, 1).getTime()), b = stand(new Date(jahr, m + 1, 1).getTime());
    return a == null || b == null || b < a ? null : b - a;
  });
}

async function zaehlerWerte(jahr) {
  const { zaehler, ablesungen } = zaehlerLesen();
  const werte = {}, leer = () => Array(12).fill(null);
  let energieDaten = null;
  for (const z of zaehler.filter(x => x.quelle !== "formel")) {
    try {
      if (z.quelle === "seu") {
        energieDaten ||= await energie(jahr);
        const m = leer(); for (const r of energieDaten.aktuell) m[r.Monat - 1] = Number(r[SEU_SPALTE[z.seu]]) || 0;
        werte[z.id] = { monate: m };
      } else if (z.quelle === "reihe") {
        const bisHeute = new Date().toLocaleDateString("sv-SE"), ende = `${jahr}-12-31` < bisHeute ? `${jahr}-12-31` : bisHeute;
        const d = await lastDaten(z.reihe, z.gruppe, `${jahr}-01-01`, ende < `${jahr}-01-01` ? `${jahr}-01-01` : ende);
        if (d.reihe.art === "messwert") throw new Error("Die Messreihe enthält keine Energiegröße.");
        const m = leer(); for (const x of d.punkte) if (x.e != null) { const i = Number(x.t.slice(5, 7)) - 1; m[i] = (m[i] || 0) + x.e; }
        werte[z.id] = { monate: m };
      } else werte[z.id] = { monate: monateAusAblesungen(ablesungen.filter(a => a.zaehler === z.id), jahr) };
    } catch (err) { werte[z.id] = { monate: leer(), fehler: err.message }; }
  }
  const nachCode = new Map(zaehler.map(z => [z.kurz.toLowerCase(), z]));
  const rechne = (z) => {
    if (werte[z.id]) return werte[z.id];
    const baum = formelZerlegen(z.formel);
    werte[z.id] = { monate: Array.from({ length: 12 }, (_, i) => formelRechnen(baum, c => rechne(nachCode.get(c.toLowerCase())).monate[i])) };
    return werte[z.id];
  };
  zaehler.forEach(rechne);
  return werte;
}

// ---------------------------------------------------------------------
// 5i. ISO 50001 : exigences (état, preuve, constat), politique énergétique, objectifs, documents, revue de direction
//   daten/iso50001.json ; lecture pour tous, modification bearbeiter / admin
// ---------------------------------------------------------------------
const ISO_DATEI = path.join(DATEN, "iso50001.json");
const ISO_LEER = { anforderungen: {}, politik: { text: "", freigabe: null, von: null }, ziele: [], dokumente: [], review: { datum: null, teilnehmer: "", ergebnisse: "" } };
function isoLesen() {
  try { return { ...ISO_LEER, ...JSON.parse(fs.readFileSync(ISO_DATEI, "utf8")) }; }
  catch (err) { if (err.code === "ENOENT") return structuredClone(ISO_LEER); throw new Error(`iso50001.json ist beschädigt: ${err.message}`); }
}
function isoPruefen(d) {
  const t = (v, n) => (v == null ? "" : String(v).slice(0, n));
  const datum = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const anf = {};
  for (const [k, v] of Object.entries(d?.anforderungen || {}).slice(0, 60)) {
    if (!/^\d{1,2}(\.\d{1,2})?$/.test(k)) continue;
    anf[k] = { status: ["offen", "teilweise", "erfuellt", "nicht_relevant"].includes(v?.status) ? v.status : "offen",
               feststellung: t(v?.feststellung, 2000), verantwortlich: t(v?.verantwortlich, 80), geprueft: datum(v?.geprueft) };
  }
  const liste = (l, max, fn) => (Array.isArray(l) ? l.slice(0, max).map(fn) : []);
  return {
    anforderungen: anf,
    politik: { text: t(d?.politik?.text, 8000), freigabe: datum(d?.politik?.freigabe), von: t(d?.politik?.von, 80) || null },
    ziele: liste(d?.ziele, 100, z => ({ id: t(z.id, 40) || crypto.randomUUID(), titel: t(z.titel, 200), kennzahl: t(z.kennzahl, 100), basis: t(z.basis, 40),
      ziel: t(z.ziel, 40), einheit: t(z.einheit, 20), termin: datum(z.termin), verantwortlich: t(z.verantwortlich, 80),
      status: ["geplant", "laeuft", "erreicht", "verfehlt"].includes(z.status) ? z.status : "geplant" })),
    dokumente: liste(d?.dokumente, 300, x => ({ id: t(x.id, 40) || crypto.randomUUID(), titel: t(x.titel, 200), kapitel: t(x.kapitel, 10), version: t(x.version, 20),
      verantwortlich: t(x.verantwortlich, 80), gueltigBis: datum(x.gueltigBis), ort: t(x.ort, 500) })),
    review: { datum: datum(d?.review?.datum), teilnehmer: t(d?.review?.teilnehmer, 1000), ergebnisse: t(d?.review?.ergebnisse, 8000) }
  };
}
// ---------------------------------------------------------------------
// 5j. Änderungsprotokoll : qui a modifié quoi et quand (aenderungen.log), avec filtres, pour bearbeiter / admin
//     les 20 derniers Mo du fichier au plus ; les entrées les plus récentes d'abord
// ---------------------------------------------------------------------
app.get("/api/protokoll", route((req) => {
  if (!darfSchreiben(req)) throw fehler400("Das Änderungsprotokoll ist Bearbeitern und Administratoren vorbehalten.", 403);
  const datei = path.join(DATEN, "aenderungen.log");
  if (!fs.existsSync(datei)) return { eintraege: [], benutzer: [], aktionen: [], gesamt: 0, gekuerzt: false };
  const groesse = fs.statSync(datei).size, max = 20 * 1024 * 1024, fd = fs.openSync(datei, "r");
  const puffer = Buffer.alloc(Math.min(groesse, max));
  fs.readSync(fd, puffer, 0, puffer.length, groesse - puffer.length); fs.closeSync(fd);
  const alle = [];
  for (const z of puffer.toString("utf8").split("\n")) { if (!z.trim()) continue; try { alle.push(JSON.parse(z)); } catch { /* ligne coupée au début */ } }
  const q = req.query, von = String(q.von || ""), bis = String(q.bis || ""), such = String(q.q || "").toLowerCase();
  const gefiltert = alle.filter(e => (!von || e.zeit >= von) && (!bis || e.zeit.slice(0, 10) <= bis) && (!q.wer || e.wer === q.wer) && (!q.aktion || e.aktion === q.aktion)
    && (!such || JSON.stringify(e).toLowerCase().includes(such))).reverse();
  const limit = Math.min(5000, Math.max(1, parseInt(q.limit, 10) || 1000));
  return { eintraege: gefiltert.slice(0, limit), gesamt: gefiltert.length, gekuerzt: groesse > max,
           benutzer: [...new Set(alle.map(e => e.wer).filter(Boolean))].sort(), aktionen: [...new Set(alle.map(e => e.aktion).filter(Boolean))].sort() };
}));
app.get("/api/iso", route((req) => ({ ...isoLesen(), darf: darfSchreiben(req) })));
app.put("/api/iso", (req, res) => {
  try {
    if (!darfSchreiben(req)) throw fehler400("Keine Berechtigung: Ihre Rolle erlaubt nur das Lesen.", 403);
    const neu = isoPruefen(req.body);
    const tmp = ISO_DATEI + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(neu, null, 2), "utf8"); fs.renameSync(tmp, ISO_DATEI);
    protokoll({ aktion: "ISO 50001 ÄNDERN", wer: req.benutzer.login, tabelle: "iso50001.json", neu: { ziele: neu.ziele.length, dokumente: neu.dokumente.length } });
    res.json(neu);
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});

app.get("/api/zaehler", route(async (req) => {
  const jahr = jahrAus(req), d = zaehlerLesen();
  return { zaehler: d.zaehler, ablesungen: d.ablesungen, werte: await zaehlerWerte(jahr), darf: darfSchreiben(req) };
}));
app.put("/api/zaehler", (req, res) => {
  try {
    if (!darfSchreiben(req)) throw fehler400("Keine Berechtigung: Ihre Rolle erlaubt nur das Lesen.", 403);
    const d = zaehlerLesen(), neu = zaehlerPruefen(req.body?.zaehler);
    const ids = new Set(neu.map(z => z.id));
    zaehlerSchreiben({ zaehler: neu, ablesungen: d.ablesungen.filter(a => ids.has(a.zaehler)) });
    protokoll({ aktion: "ZÄHLER ÄNDERN", wer: req.benutzer.login, tabelle: "zaehler.json", neu: { anzahl: neu.length } });
    res.json({ ok: true });
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.post("/api/zaehler/:id/ablesung", (req, res) => {
  try {
    const d = zaehlerLesen(), z = d.zaehler.find(x => x.id === req.params.id);
    if (!z) throw fehler400("Zähler nicht gefunden.", 404);
    if (z.quelle !== "manuell") throw fehler400("Für diesen Zähler werden die Werte automatisch erfasst.");
    const zeit = new Date(req.body?.zeit || Date.now()), stand = Number(req.body?.stand);
    if (isNaN(zeit) || zeit > Date.now() + 5 * 60000) throw fehler400("Ungültiger Zeitpunkt.");
    if (!Number.isFinite(stand) || stand < 0) throw fehler400("Bitte einen gültigen Zählerstand eingeben.");
    const vorher = d.ablesungen.filter(a => a.zaehler === z.id && new Date(a.zeit) < zeit).sort((a, b) => b.zeit.localeCompare(a.zeit))[0];
    if (vorher && stand < vorher.stand && !req.body?.wechsel) throw fehler400(`Der Stand ist kleiner als die letzte Ablesung (${vorher.stand}). Bei einem Zählertausch bitte „Zählerwechsel“ ankreuzen.`);
    const a = { id: crypto.randomUUID(), zaehler: z.id, zeit: zeit.toISOString(), stand, notiz: String(req.body?.notiz || "").slice(0, 300) || null, wer: req.benutzer.name, wechsel: !!req.body?.wechsel };
    d.ablesungen.push(a); zaehlerSchreiben(d);
    protokoll({ aktion: "ZÄHLERABLESUNG", wer: req.benutzer.login, tabelle: "zaehler.json", neu: { zaehler: z.name, stand } });
    res.json(a);
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.delete("/api/zaehler/:id/ablesung/:aid", (req, res) => {
  try {
    if (!darfSchreiben(req)) throw fehler400("Keine Berechtigung: Ihre Rolle erlaubt nur das Lesen.", 403);
    const d = zaehlerLesen(), alt = d.ablesungen.find(a => a.id === req.params.aid && a.zaehler === req.params.id);
    if (!alt) throw fehler400("Ablesung nicht gefunden.", 404);
    d.ablesungen = d.ablesungen.filter(a => a !== alt); zaehlerSchreiben(d);
    protokoll({ aktion: "ZÄHLERABLESUNG LÖSCHEN", wer: req.benutzer.login, tabelle: "zaehler.json", alt });
    res.json({ geloescht: 1 });
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
const MAIL_FROM = env("MAIL_FROM", SMTP.user || `${APP_NAME} <noreply@185.80.92.91>`);
const APP_URL = env("APP_URL", `http://185.80.92.91:${PORT}`).replace(/\/$/, "");
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

async function mailSenden(an, betreff, html, text, art = "info", anhaenge = []) {
  if (!mailer) throw fehler400("E-Mail ist nicht eingerichtet (SMTP_HOST in .env).", 503);
  const liste = [...new Set([].concat(an).filter(Boolean))];
  if (!liste.length) return { an: [] };
  const z = zustandLesen();
  try {
    // une adresse par e-mail : personne ne voit les adresses des autres
    for (const a of liste) await mailer.sendMail({ from: MAIL_FROM, to: a, subject: betreff, html, text, attachments: anhaenge });
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
<tr><td style="background:#14212B;padding:18px 24px;color:#fff"><b style="font-size:16px">${esc(APP_NAME)}${STANDORT ? ` · ${esc(STANDORT)}` : ""}</b><br><span style="font-size:12px;color:#A9C8DC">Aluminium-Recycling · Energiemanagement nach ISO 50001</span></td></tr>
<tr><td style="padding:24px 24px 8px"><h1 style="margin:0 0 4px;font-size:22px">${esc(titel)}</h1><div style="font-size:13px;color:#5F6B76">${esc(unterzeile)}</div></td></tr>
<tr><td style="padding:8px 24px 16px;font-size:14px;line-height:1.55">${inhalt}</td></tr>
${knopf ? `<tr><td style="padding:0 24px 24px"><a href="${esc(knopf.url)}" style="display:inline-block;background:#2B5874;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px">${esc(knopf.text)}</a></td></tr>` : ""}
<tr><td style="padding:14px 24px;border-top:1px solid #E6EAEE;font-size:11px;color:#8C99A6">Automatische Nachricht der Anwendung ${esc(APP_NAME)}. Benachrichtigungen ändern: in der Anwendung oben rechts auf Ihren Namen klicken, dann „Benachrichtigungen“.</td></tr>
</table></td></tr></table></body></html>`;
}
const kachel = (titel, wert, unter, farbe = "#1F2A33") => `<td width="25%" valign="top" style="padding:4px"><div style="background:#F4F6F8;border-top:3px solid #2B5874;border-radius:6px;padding:10px 12px">
<div style="font-size:11px;color:#5F6B76">${esc(titel)}</div><div style="font-size:19px;font-weight:700;color:${farbe};margin:2px 0">${esc(wert)}</div><div style="font-size:11px;color:#5F6B76">${esc(unter ?? "")}</div></div></td>`;
const pz = (v) => (v == null ? "" : `${v >= 0 ? "+" : "−"}${prozent(Math.abs(v))}`);
const STUFE_MAIL = { kritisch: ["Kritisch", "#CF4B3B"], warnung: ["Warnung", "#E39A2D"], info: ["Hinweis", "#4F83AA"] };
const liste = (eintraege) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${eintraege.join("")}</table>`;
const zeile = (farbe, titel, text) => `<tr><td style="border-left:4px solid ${farbe};padding:6px 10px;background:#FAFBFC"><b style="font-size:13px">${esc(titel)}</b><br><span style="font-size:12px;color:#5F6B76">${esc(text)}</span></td></tr><tr><td height="6"></td></tr>`;

function wochenbericht(lage, art = { titel: "Wochenbericht", extra: "" }) {
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
  if (art.extra) html = art.extra + html;
  return { betreff: `${APP_NAME} – ${art.titel}: ${wichtig.filter(w => w.stufe === "kritisch").length ? "⚠ kritische Auffälligkeit · " : ""}${letzte ? `${MONATE[letzte.Monat - 1]} ${jahr}` : jahr}`,
           html: mailRahmen(art.titel, `Stand ${new Date().toLocaleDateString("de-DE")} · Basisjahr Energie ${en.basisJahr ?? "–"}`, html, { text: "Dashboard öffnen", url: `${APP_URL}/#uebersicht` }) };
}


// ⑨ Monatsbericht : le 2 du mois, bilan du mois écoulé (coûts par énergie, € par tonne, CO₂) + contenu du rapport hebdomadaire
const CO2_STANDARD = { strom: 0.380, erdgas: 0.201, gas: 0.201, "heizöl": 0.266, diesel: 2.65, "fernwärme": 0.180, propan: 0.239 };
function co2Faktor(name, einheit, eigene) {
  const n = String(name).toLowerCase();
  const f = eigene?.[name] ?? Object.entries(CO2_STANDARD).find(([k]) => n.includes(k))?.[1];
  if (f == null) return null;
  return einheit === "MWh" ? f * 1000 : f;
}
async function monatsbericht(lage) {
  const heute = new Date(), m = heute.getMonth() === 0 ? 12 : heute.getMonth(), j = heute.getMonth() === 0 ? heute.getFullYear() - 1 : heute.getFullYear();
  let extra = "", anhaenge = [];
  try {
    const kd = await kostenDaten(j), faktoren = einstellungenLesen().co2?.faktoren || {};
    // tableau joint (s'ouvre dans Excel) : chaque énergie, chaque mois jusqu'au mois du rapport, coûts et consommation
    const zelle = (v) => (v == null ? "" : String(Math.round(v * 100) / 100).replace(".", ","));
    const kopf = ["Energieträger", "Einheit", ...MONATE.slice(0, m).flatMap(x => [`${x} Verbrauch`, `${x} Kosten €`]), "Summe Verbrauch", "Summe Kosten €"];
    const csv = [kopf, ...kd.traeger.map(t => {
      const w = t.aktuell.slice(0, m);
      return [t.name, t.einheit, ...w.flatMap(x => [zelle(x?.verbrauch), zelle(x?.kosten)]), zelle(w.reduce((s, x) => s + (x?.verbrauch || 0), 0)), zelle(w.reduce((s, x) => s + (x?.kosten || 0), 0))];
    })].map(z => z.map(x => `"${String(x).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    anhaenge = [{ filename: `Energiekosten_${j}-${String(m).padStart(2, "0")}.csv`, content: "\uFEFF" + csv, contentType: "text/csv; charset=utf-8" }];
    const zeilen = kd.traeger.map(t => ({ name: t.name, v: t.aktuell[m - 1]?.verbrauch, k: t.aktuell[m - 1]?.kosten, kv: t.vorjahr[m - 1]?.kosten, e: t.einheit,
      co2: t.aktuell[m - 1]?.verbrauch != null && co2Faktor(t.name, t.einheit, faktoren) != null ? (t.aktuell[m - 1].verbrauch * co2Faktor(t.name, t.einheit, faktoren)) / 1000 : null }))
      .filter(x => x.v != null || x.k != null);
    const summe = zeilen.reduce((s, x) => s + (x.k || 0), 0), summeVj = zeilen.reduce((s, x) => s + (x.kv || 0), 0), co2 = zeilen.reduce((s, x) => s + (x.co2 || 0), 0);
    const menge = kd.produktion.aktuell[m - 1], tonnen = menge ? menge / (kd.mengeEinheit === "t" ? 1 : 1000) : null;
    if (zeilen.length) extra = `<h3 style="font-size:15px;margin:4px 0 8px">Energiekosten ${esc(MONATE[m - 1])} ${j}</h3>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        ${kachel("Energiekosten", `${zahlDE(summe)} €`, summeVj ? `${pz(summe / summeVj - 1)} ggü. Vorjahresmonat` : "")}
        ${kachel("Kosten je Tonne", tonnen ? `${dez(summe / tonnen, 2)} €` : "–", tonnen ? `${zahlDE(tonnen)} t verarbeitet` : "")}
        ${kachel("CO₂", co2 ? `${dez(co2, 1)} t` : "–", "Scope 1 und 2")}
        ${kachel("Energieträger", String(zeilen.length), zeilen.map(x => x.name).slice(0, 3).join(", "))}
      </tr></table>
      ${liste(zeilen.map(x => zeile("#2B5874", `${x.name}: ${x.k != null ? `${zahlDE(x.k)} €` : "ohne Kosten"}`, `${x.v != null ? `${zahlDE(x.v)} ${x.e}` : ""}${x.co2 ? ` · ${dez(x.co2, 1)} t CO₂` : ""}`)))}
      <h3 style="font-size:15px;margin:18px 0 8px">Stand heute</h3>`;
  } catch (err) { console.error("[Monatsbericht]", err.message); }
  return { ...wochenbericht(lage, { titel: `Monatsbericht ${MONATE[m - 1]} ${j}`, extra }), anhaenge };
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
    const anKritisch = abonnenten("kritisch"), anFristen = abonnenten("fristen"), anWoche = abonnenten("woche"), anMonat = abonnenten("monat");
    if (!anKritisch.length && !anFristen.length && !anWoche.length && !anMonat.length && !erzwingen) return;
    const lage = await lageBerechnen();

    // 1. alertes critiques : immédiatement, une seule fois par alerte
    const kritisch = lage.warnungen.filter(w => w.stufe === "kritisch");
    const neu = kritisch.filter(w => !z.kritisch[warnSchluessel(w)]);
    for (const w of neu) z.kritisch[warnSchluessel(w)] = jetzt.toISOString();
    if (neu.length && anKritisch.length && !z.ersterLauf) {   // au tout premier contrôle, l'existant est seulement noté
      await mailSenden(anKritisch, `${APP_NAME}: ${neu.length === 1 ? neu[0].titel : `${neu.length} kritische Auffälligkeiten`}`,
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
        await mailSenden(anFristen, `${APP_NAME} – Maßnahmen: ${faellig.filter(x => x.stufe === "ueberfaellig").length ? "überfällige und " : ""}anstehende Fristen`,
          mailRahmen("Fristen im Maßnahmenplan", `${faellig.length} Maßnahme(n)`, liste(faellig.map(x => zeile(x.stufe === "ueberfaellig" ? "#CF4B3B" : "#E39A2D",
            x.titel, `${x.stufe === "ueberfaellig" ? "Überfällig seit" : "Fällig am"} ${datumDE(x.frist)} · ${ANLAGE_NAME[x.anlage] ?? x.anlage}${x.verantwortlich ? ` · ${x.verantwortlich}` : ""}`))),
            { text: "Maßnahmenplan öffnen", url: `${APP_URL}/#massnahmen` }), null, "fristen");
      }
      // maintenance : 7 jours avant l'échéance et au dépassement (une fois par échéance)
      const w = wartungLesen(), namen = Object.fromEntries(anlagenLesen().map(x => [x.id, x.name]));
      const wf = [];
      for (const p of w.plaene) {
        const naechste = wNaechste(p);
        const stufe = !naechste ? null : naechste < heute ? "ueberfaellig" : naechste <= in7 ? "bald" : null;
        const key = `w|${p.id}|${naechste}|${stufe}`;
        if (stufe && !z.fristen[key]) { wf.push({ ...p, naechste, stufe }); z.fristen[key] = jetzt.toISOString(); }
      }
      if (wf.length && anFristen.length) {
        await mailSenden(anFristen, `${APP_NAME} – Wartung: ${wf.some(x => x.stufe === "ueberfaellig") ? "überfällige und " : ""}anstehende Arbeiten`,
          mailRahmen("Fällige Wartungsarbeiten", `${wf.length} Arbeit(en)`, liste(wf.map(x => zeile(x.stufe === "ueberfaellig" ? "#CF4B3B" : "#E39A2D",
            `${namen[x.anlage] ?? x.anlage}: ${x.titel}`, `${x.stufe === "ueberfaellig" ? "Überfällig seit" : "Fällig am"} ${datumDE(x.naechste)}${x.verantwortlich ? ` · ${x.verantwortlich}` : ""}`))),
            { text: "Wartungsplan öffnen", url: `${APP_URL}/#wartung` }), null, "fristen");
      }
    }

    // 3. rapport hebdomadaire : le lundi à l'heure d'envoi
    const kw = `${jetzt.getFullYear()}-${Math.ceil(((jetzt - new Date(jetzt.getFullYear(), 0, 1)) / 86400000 + new Date(jetzt.getFullYear(), 0, 1).getDay() + 1) / 7)}`;
    if (jetzt.getDay() === 1 && jetzt.getHours() === MAIL_STUNDE && z.woche !== kw && anWoche.length) {
      const w = wochenbericht(lage);
      await mailSenden(anWoche, w.betreff, w.html, textVersion(w.html), "woche");
      z.woche = kw;
    }
    // 4. rapport mensuel : le 2 du mois à l'heure d'envoi
    const mk = `${jetzt.getFullYear()}-${jetzt.getMonth() + 1}`;
    if (jetzt.getDate() === 2 && jetzt.getHours() === MAIL_STUNDE && z.monat !== mk && anMonat.length) {
      const w = await monatsbericht(lage);
      await mailSenden(anMonat, w.betreff, w.html, textVersion(w.html), "monat", w.anhaenge);
      z.monat = mk;
    }
    // l'état peut avoir été modifié par mailSenden : on fusionne
    const aktuell = zustandLesen();
    zustandSchreiben({ ...aktuell, woche: z.woche, monat: z.monat, kritisch: z.kritisch, fristen: z.fristen, ersterLauf: false });
  } catch (err) { console.error("[E-Mail-Prüfung]", err.message); }
  finally { pruefungLaeuft = false; }
}
function benachrichtigungenPlanen() {
  if (!mailer) return;
  setTimeout(() => benachrichtigungenPruefen(), 60 * 1000);                 // une minute après le démarrage
  setInterval(() => benachrichtigungenPruefen(), 60 * 60 * 1000);           // puis toutes les heures
}

// --- API ---
// tableau de bord personnel (widgets choisis, ordre et taille) : enregistré pour chaque utilisateur
app.put("/api/auth/cockpit", (req, res) => {
  const sitzung = sitzungVon(req);
  if (!sitzung) return res.status(401).json({ fehler: "Bitte anmelden.", anmeldung: true });
  try {
    const l = req.body?.cockpit;
    if (l !== null && (!Array.isArray(l) || l.length > 40)) throw fehler400("Ungültige Cockpit-Einstellung.");
    const liste = benutzerLesen(), b = liste.find(x => x.login === sitzung.benutzer.login);
    b.cockpit = l === null ? null : l.map(x => ({ id: String(x?.id || "").replace(/[^a-z_]/gi, "").slice(0, 40), g: ["s", "m", "l"].includes(x?.g) ? x.g : "m" })).filter(x => x.id);
    benutzerSchreiben(liste);
    res.json(oeffentlich(b));
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.put("/api/auth/profil", (req, res) => {
  const sitzung = sitzungVon(req);                       // les routes /api/auth/* ne passent pas par le contrôle de session
  if (!sitzung) return res.status(401).json({ fehler: "Bitte anmelden.", anmeldung: true });
  try {
    const liste = benutzerLesen(), b = liste.find(x => x.login === sitzung.benutzer.login);
    const email = String(req.body?.email ?? "").trim();
    if (email && !MAIL_RE.test(email)) throw fehler400("Bitte eine gültige E-Mail-Adresse eingeben.");
    b.email = email || null;
    b.abo = { woche: !!req.body?.abo?.woche, monat: !!req.body?.abo?.monat, kritisch: !!req.body?.abo?.kritisch, fristen: !!req.body?.abo?.fristen };
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
    const html = mailRahmen("Test-E-Mail", new Date().toLocaleString("de-DE"), `<p>Der E-Mail-Versand von ${esc(APP_NAME)} funktioniert.</p><p style="font-size:12px;color:#5F6B76">Server ${esc(SMTP.host)}:${SMTP.port}, Absender ${esc(MAIL_FROM)}</p>`, { text: "Anwendung öffnen", url: APP_URL });
    res.json(await mailSenden(ich.email, `${APP_NAME}: Test-E-Mail`, html, textVersion(html), "test"));
  } catch (err) { res.status(err.status || 500).json({ fehler: err.message }); }
});
app.post("/api/benachrichtigungen/monatsbericht", async (req, res) => {
  try {
    nurAdmin(req);
    const ich = benutzerLesen().find(b => b.login === req.benutzer.login);
    if (!ich?.email) throw fehler400("Bitte zuerst Ihre E-Mail-Adresse eintragen.");
    const w = await monatsbericht(await lageBerechnen());
    res.json(await mailSenden([ich.email], w.betreff, w.html, textVersion(w.html), "monat", w.anhaenge));
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
  if (!claude) return res.status(503).json({ fehler: "Der KI-Dienst ist nicht eingerichtet." });
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
        ? "Der KI-Dienst ist derzeit nicht verfügbar."
        : "Der KI-Dienst ist derzeit nicht verfügbar." });
    }
    res.status(502).json({ fehler: "Der KI-Dienst ist gerade nicht erreichbar. Bitte später erneut versuchen." });
  }
});

const server = app.listen(PORT, HOST, () => {
  naechtlicheSicherung();
  benachrichtigungenPlanen();
  console.log("=".repeat(60));
  console.log(` ${APP_NAME}${STANDORT ? ` (${STANDORT})` : ""} ${VERSION} läuft: http://185.80.92.91:${PORT}`);
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