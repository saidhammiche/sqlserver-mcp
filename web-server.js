// ==================== WEB-OBERFLÄCHE: ÜBERSICHT + KI-ASSISTENT (Claude) ====================
// Start:  npm run web   →   http://localhost:3000
// Der KI-Assistent nutzt Claude über die Anthropic-API (ANTHROPIC_API_KEY in .env).
// Ohne Schlüssel funktioniert alles weiter, Fragen werden dann ohne KI beantwortet.
//
//   GET  /api/jahre                → verfügbare Jahre
//   GET  /api/produktion?jahr=2026 → Monatswerte (Jahr + Vorjahr)
//   POST /api/chat                 → Frage an Claude (nur Lesezugriff)

import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runRead, listTables, describeTable, tabellenVorschau, getJahre, getProduktion, getSEU, DB_INFO } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT  = parseInt(process.env.WEB_PORT || "3000", 10);
const HOST  = process.env.WEB_HOST || "127.0.0.1";          // nur dieser PC (keine Anmeldung)
const MODEL      = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const MAX_RUNDEN = 8;
const claude = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const app = express();
app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---------- API Übersicht ----------
app.get("/api/jahre", async (req, res) => {
  try { res.json(await getJahre()); }
  catch (err) { res.status(500).json({ fehler: err.message }); }
});

app.get("/api/produktion", async (req, res) => {
  const jahr = parseInt(req.query.jahr, 10);
  if (!Number.isInteger(jahr) || jahr < 2000 || jahr > 2100) {
    return res.status(400).json({ fehler: "Ungültiges Jahr" });
  }
  try { res.json(await getProduktion(jahr)); }
  catch (err) { res.status(500).json({ fehler: err.message }); }
});

// ---------- Status (für die Anzeige im KI-Assistenten) ----------
app.get("/api/status", (req, res) => res.json({ ki: !!claude, modell: claude ? MODEL : null }));

// ---------- API Energie (SEUWerte) ----------
app.get("/api/energie", async (req, res) => {
  const jahr = parseInt(req.query.jahr, 10);
  if (!Number.isInteger(jahr) || jahr < 2000 || jahr > 2100) {
    return res.status(400).json({ fehler: "Ungültiges Jahr" });
  }
  try { res.json(await getSEU(jahr)); }
  catch (err) { res.status(500).json({ fehler: err.message }); }
});

// ---------- API Tabellen (alle Tabellen der Datenbank) ----------
app.get("/api/tabellen", async (req, res) => {
  try { res.json(await listTables()); }
  catch (err) { res.status(500).json({ fehler: err.message }); }
});

app.get("/api/tabellen/:name", async (req, res) => {
  try { res.json(await tabellenVorschau(req.params.name, req.query.limit)); }
  catch (err) { res.status(/nicht gefunden/.test(err.message) ? 404 : 500).json({ fehler: err.message }); }
});

// ---------- Werkzeuge für die KI ----------
// "produktion_jahr" liefert die wichtigsten Kennzahlen fertig berechnet mit
// (schneller und günstiger als mehrere SQL-Abfragen).
async function produktionJahr(jahr) {
  const { aktuell } = await getProduktion(jahr);
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
    monate: aktuell.map(r => ({
      monat: r.Monatname, presse_1: r.presse1, presse_2: r.presse2, ubc: r.ubc, gesamt: r.gesamt, abschaum_bewegungen: r.abschaum
    }))
  };
}

const TOOLS = [
  {
    name: "verfuegbare_jahre",
    description: "Gibt die Jahre zurück, für die Produktionsdaten vorhanden sind.",
    parameters: { type: "object", properties: {} },
    run: () => getJahre()
  },
  {
    name: "produktion_jahr",
    description: "Monatswerte und fertig berechnete Kennzahlen (Summen, Anteile, Durchschnitt, stärkster/schwächster Monat) " +
                 "der Produktion für ein Jahr. Für fast alle Fragen zur Produktion zuerst dieses Werkzeug benutzen.",
    parameters: { type: "object", properties: { jahr: { type: "integer", description: "z. B. 2026" } }, required: ["jahr"] },
    run: (a) => produktionJahr(parseInt(a.jahr, 10))
  },
  {
    name: "energie_jahr",
    description: "Monatswerte der Tabelle SEUWerte (Energieverbrauch, verarbeitete Menge und spezifischer Verbrauch " +
                 "je Anlage: Presse I, Presse II, UBC-Aufbereitung, ME) für ein Jahr.",
    parameters: { type: "object", properties: { jahr: { type: "integer", description: "z. B. 2026" } }, required: ["jahr"] },
    run: async (a) => (await getSEU(parseInt(a.jahr, 10))).aktuell
  },
  {
    name: "sql_lesen",
    description: "Führt eine SELECT-Abfrage (T-SQL, SQL Server) aus. Nur Lesen. Nur verwenden, wenn produktion_jahr nicht reicht.",
    parameters: { type: "object", properties: { abfrage: { type: "string" } }, required: ["abfrage"] },
    run: (a, abfragen) => { abfragen.push(a.abfrage); return runRead(a.abfrage); }
  },
  {
    name: "tabellen_auflisten",
    description: "Listet alle Tabellen der Datenbank MRS_BI.",
    parameters: { type: "object", properties: {} },
    run: () => listTables()
  },
  {
    name: "tabelle_beschreiben",
    description: "Zeigt die Spalten einer Tabelle.",
    parameters: { type: "object", properties: { tabelle: { type: "string" } }, required: ["tabelle"] },
    run: (a) => describeTable(a.tabelle)
  }
];

function systemPrompt(jahr) {
  return `Du bist der Datenassistent der Produktion der Firma MRS (Aluminium-Recycling).
Heute ist der ${new Date().toLocaleDateString("de-DE")}. In der Oberfläche ist das Jahr ${jahr} gewählt:
Wenn die Frage kein Jahr nennt, beziehe dich auf ${jahr}.

Wichtigste Tabelle: dbo.ProduktionMonat, eine Zeile pro Monat.\nEnergie: Tabelle dbo.SEUWerte (SEU = wesentliche Energieeinsätze nach ISO 50001), eine Zeile pro Monat.
- Präfixe: P1 = Presse I, P2 = Presse II, UB = UBC-Aufbereitung, ME = weitere Anlage mit Betriebsstunden.
- *_Verbrauch = Energieverbrauch, *_Verarbeitung = verarbeitete Menge, *_Wert = spezifischer Verbrauch (Verbrauch je Menge).
- ME_Stunden, ME_ProTonne, ME_ProStunde, ME_ProTonneGesamtmenge, ME_Wert: Kennzahlen der Anlage ME.
- Der Monatsname heißt in dieser Tabelle [Manatname] (Schreibfehler in der Datenbank).
- Einheiten sind nicht hinterlegt (vermutlich kWh und Tonnen).
Die Datenbank enthält weitere Tabellen: bei Fragen dazu zuerst tabellen_auflisten und tabelle_beschreiben benutzen.
- Presse I, Presse II: Durchsatz der zwei Pressen
- UBC: Input der Dosen-Aufbereitung (Used Beverage Cans)
- Gesamt = Presse I + Presse II + UBC
- Arbeitstage werden nicht gepflegt (0 oder leer): keine Werte pro Arbeitstag berechnen.
- Die Einheit ist nicht hinterlegt (vermutlich kg).
Spaltennamen für SQL: [Jahr], [Monat], [Monatname], [Durchsatz Presse I], [Durchsatz Presse II],
[Input UBC-Aufbereitung], [Material verarbeitet gesamt], [Menge Bewegungen Abschaum].

Regeln:
- Benutze IMMER zuerst ein Werkzeug, bevor du Zahlen nennst. Erfinde niemals Zahlen.
- Übernimm fertig berechnete Kennzahlen aus produktion_jahr, statt selbst zu rechnen.
- Antworte auf Deutsch, kurz und klar. Zahlen im deutschen Format (1.234.567).
- Keine Markdown-Tabellen oder Überschriften; kurze Absätze und Aufzählungen mit "- ".
- Für Ursachen ("warum") vergleiche die Quellen mit ihrem Durchschnitt und sag klar, was die Daten zeigen und was nicht.
- Wenn die Daten eine Frage nicht beantworten können, sag das ehrlich.`;
}

app.post("/api/chat", async (req, res) => {
  if (!claude) {
    return res.status(503).json({ fehler: "Claude ist nicht eingerichtet (ANTHROPIC_API_KEY fehlt in .env)." });
  }
  const jahr = parseInt(req.body?.jahr, 10) || new Date().getFullYear();
  const verlauf = Array.isArray(req.body?.verlauf) ? req.body.verlauf : [];
  const messages = verlauf
    .filter(m => (m.rolle === "nutzer" || m.rolle === "assistent") && typeof m.text === "string" && m.text.trim())
    .slice(-12)
    .map(m => ({ role: m.rolle === "nutzer" ? "user" : "assistant", content: m.text.slice(0, 4000) }));

  if (!messages.length || messages.at(-1).role !== "user") {
    return res.status(400).json({ fehler: "Keine Frage erhalten." });
  }

  const abfragen = [];
  try {
    for (let runde = 0; runde < MAX_RUNDEN; runde++) {
      const antwort = await claude.messages.create({
        model: MODEL,
        max_tokens: 2000,
        system: systemPrompt(jahr),
        tools: TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })),
        messages
      });

      if (antwort.stop_reason !== "tool_use") {
        const text = antwort.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
        return res.json({ antwort: text || "(keine Antwort)", abfragen });
      }

      messages.push({ role: "assistant", content: antwort.content });
      const ergebnisse = [];
      for (const block of antwort.content) {
        if (block.type !== "tool_use") continue;
        const tool = TOOLS.find(t => t.name === block.name);
        let inhalt, fehler = false;
        try {
          if (!tool) throw new Error(`Unbekanntes Werkzeug: ${block.name}`);
          inhalt = JSON.stringify(await tool.run(block.input || {}, abfragen));
        } catch (err) {
          inhalt = `Fehler: ${err.message}`;
          fehler = true;
        }
        ergebnisse.push({ type: "tool_result", tool_use_id: block.id, content: inhalt.slice(0, 20000), is_error: fehler });
      }
      messages.push({ role: "user", content: ergebnisse });
    }
    res.json({ antwort: "Die Frage war zu komplex. Bitte einfacher oder genauer formulieren.", abfragen });
  } catch (err) {
    console.error("[Claude]", err.message);
    const kein_guthaben = /credit balance/i.test(err.message);
    if (err.status === 401 || kein_guthaben) {
      // 503 → die Oberfläche antwortet dann einfach ohne KI
      return res.status(503).json({ fehler: kein_guthaben
        ? "Im Claude-Konto ist kein Guthaben (Billing → Guthaben aufladen)."
        : "Der ANTHROPIC_API_KEY in .env ist ungültig." });
    }
    res.status(502).json({ fehler: `Claude ist gerade nicht erreichbar: ${err.message}` });
  }
});

app.listen(PORT, HOST, () => {
  console.log("=".repeat(60));
  console.log(` Produktions-Dashboard läuft: http://localhost:${PORT}`);
  console.log(` Datenbank: ${DB_INFO}`);
  console.log(claude ? ` KI-Assistent: Claude aktiv (${MODEL})`
                     : " KI-Assistent: ohne KI (ANTHROPIC_API_KEY fehlt in .env)");
  if (HOST !== "127.0.0.1") console.log(` ⚠️  Im Netzwerk erreichbar (${HOST}) – ohne Anmeldung!`);
  console.log("=".repeat(60));
});
