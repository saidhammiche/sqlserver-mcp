// =====================================================================
//  MRS Produktion – INTERFACE (un seul fichier React + Ant Design)
//
//  Contenu :
//   1. Outils (format des nombres, appels API, couleurs, CSV)
//   2. Calcul des indicateurs + contrôle qualité
//   3. Réponses simples SANS IA (si Claude n'est pas disponible)
//   4. Petits composants (graphiques, texte des réponses, logo)
//   5. Pages : Übersicht, Monatswerte, Energie, Tabellen, KI-Assistent, Datenqualität
//   6. Mise en page (menu, en-tête)
//   7. Démarrage (thème clair/sombre)
// =====================================================================

import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  ConfigProvider, App as AntApp, theme, Layout, Menu, Select, Badge, Button, Tooltip, Typography, Alert, Grid, Space, Drawer,
  Upload, Slider, Row, Col, Card, Statistic, Skeleton, Empty, Flex, Tag, Table, Checkbox, Input, Tabs, Modal, Form, InputNumber, Switch,
  DatePicker, Popconfirm, Avatar, Collapse, Segmented, Descriptions, Progress, List, Result, Dropdown
} from "antd";
import {
  DashboardOutlined, TableOutlined, ThunderboltOutlined, DatabaseOutlined, RobotOutlined, SafetyCertificateOutlined,
  SunOutlined, MoonOutlined, CalendarOutlined, MenuOutlined, SyncOutlined, AppstoreOutlined, RiseOutlined,
  ArrowUpOutlined, ArrowDownOutlined, DownloadOutlined, FireOutlined, FieldTimeOutlined, SearchOutlined, EyeOutlined, BarChartOutlined, LineChartOutlined, PieChartOutlined, FilterOutlined, ScheduleOutlined,
  FunctionOutlined, CalculatorOutlined, AimOutlined, FallOutlined, NumberOutlined, OrderedListOutlined, HistoryOutlined,
  UndoOutlined, ClockCircleOutlined, BlockOutlined, ColumnWidthOutlined, SettingOutlined, FlagOutlined, CheckCircleOutlined,
  CloseCircleOutlined, ExperimentOutlined, DotChartOutlined, CloudOutlined, EuroOutlined, AlertOutlined, AreaChartOutlined,
  StockOutlined, MinusCircleOutlined, QuestionCircleOutlined, FundOutlined, BellOutlined, ProjectOutlined, WarningOutlined, FilePdfOutlined, PrinterOutlined, FileTextOutlined, LoginOutlined, LogoutOutlined, CrownOutlined, TeamOutlined, FundProjectionScreenOutlined, SwapOutlined, DiffOutlined, DesktopOutlined, FullscreenOutlined, FullscreenExitOutlined, PauseOutlined, CaretRightOutlined,
  HomeOutlined, LinkOutlined, UploadOutlined, PaperClipOutlined, QrcodeOutlined, ToolOutlined,
  LeftOutlined, RightOutlined, CloseOutlined, CommentOutlined, MailOutlined, SendOutlined,
  PlusOutlined, EditOutlined, DeleteOutlined, LockOutlined, UnlockOutlined, KeyOutlined, UserOutlined, CopyOutlined,
  CodeOutlined, BuildOutlined, BulbOutlined, InfoCircleOutlined, CheckOutlined
} from "@ant-design/icons";
import { Bubble, Sender, Prompts, Welcome } from "@ant-design/x";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip as ChartTooltip, Legend, ComposedChart, ScatterChart, Scatter, ReferenceLine, Area
} from "recharts";
import deDE from "antd/locale/de_DE";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import "dayjs/locale/de";

dayjs.extend(utc);
dayjs.locale("de");
const { Text, Title } = Typography;

// =====================================================================
// ===== BEGIN RECHNEN =====
// Calculs communs : utilisés par cette interface ET lus par server.js au démarrage
// (rapports e-mail). Ici uniquement du JavaScript simple : pas de JSX, pas d'import.
// =====================================================================
const datumDE = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join(".") : "–");

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

const zahl = (v) => (v === null || v === undefined || Number.isNaN(v)) ? "–" : Math.round(v).toLocaleString("de-DE");

const dez = (v, n = 2) => (v === null || v === undefined || Number.isNaN(v)) ? "–" : Number(v).toLocaleString("de-DE", { maximumFractionDigits: n });

const prozent = (v) => (v * 100).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %";

const kurz = (v) => {
  if (v === null || v === undefined) return "–";
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " Mio.";
  if (a >= 1e3) return (v / 1e3).toLocaleString("de-DE", { maximumFractionDigits: 0 }) + " Tsd.";
  return zahl(v);
};

const monatName = (r) => r.Monatname || MONATE[r.Monat - 1];

const summe = (rows, k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);

function berechne(daten) {
  if (!daten) return null;
  const { jahr, aktuell, vorjahr } = daten;
  const mitDaten = aktuell.filter(r => r.gesamt);
  const gesamt = summe(aktuell, "gesamt");
  const best = mitDaten.reduce((a, b) => (!a || b.gesamt > a.gesamt ? b : a), null);
  const schwach = mitDaten.reduce((a, b) => (!a || b.gesamt < a.gesamt ? b : a), null);

  const monate = new Set(aktuell.map(r => r.Monat));
  const vjGleich = vorjahr.filter(r => monate.has(r.Monat));
  const vergleichbar = aktuell.length > 0 && vjGleich.length === aktuell.length;
  const gesamtVj = summe(vjGleich, "gesamt");

  return {
    jahr, aktuell, vorjahr, mitDaten, gesamt, best, schwach, vjGleich, gesamtVj,
    p1: summe(aktuell, "presse1"), p2: summe(aktuell, "presse2"), ubc: summe(aktuell, "ubc"),
    schnitt: mitDaten.length ? gesamt / mitDaten.length : null,
    veraenderung: vergleichbar && gesamtVj ? (gesamt - gesamtVj) / gesamtVj : null,
    zeitraum: aktuell.length === 12 ? `Jahr ${jahr}`
      : aktuell.length ? `${monatName(aktuell[0])} – ${monatName(aktuell.at(-1))} ${jahr}` : String(jahr)
  };
}

function pruefe(k) {
  if (!k || !k.aktuell.length) return [];
  const h = [];
  if (k.aktuell.every(r => !r.Arbeitstage)) h.push({ stufe: "warnung", titel: "Arbeitstage nicht gepflegt",
    text: "Die Spalte Arbeitstage ist leer oder 0. Werte pro Arbeitstag lassen sich nicht berechnen." });
  if (k.aktuell.every(r => !r.abschaum)) h.push({ stufe: "warnung", titel: "Keine Abschaum-Bewegungen erfasst",
    text: `Für ${k.jahr} steht bei allen Monaten 0. Entweder wird nicht mehr erfasst oder der Prozess hat sich geändert.` });
  const falsch = k.aktuell.filter(r => r.gesamt !== (r.presse1 || 0) + (r.presse2 || 0) + (r.ubc || 0));
  h.push(falsch.length
    ? { stufe: "fehler", titel: "Gesamtsumme passt nicht", text: `In ${falsch.map(monatName).join(", ")} entspricht „Gesamt“ nicht Presse I + Presse II + UBC.` }
    : { stufe: "ok", titel: "Gesamtsumme stimmt", text: "In allen Monaten gilt: Gesamt = Presse I + Presse II + UBC." });
  const heute = new Date();
  if (k.jahr === heute.getFullYear()) {
    const fehlend = MONATE.slice(0, heute.getMonth()).filter((_, i) => !k.aktuell.some(r => r.Monat === i + 1));
    if (fehlend.length) h.push({ stufe: "warnung", titel: "Monate fehlen", text: `Noch keine Daten für: ${fehlend.join(", ")}.` });
  }
  h.push({ stufe: "info", titel: "Einheit unbekannt", text: "Die Einheit der Mengen ist in der Datenbank nicht hinterlegt (vermutlich kg)." });
  return h;
}

const SEU_DEF = [
  { key: "P1", name: "Presse I", v: "P1_Verbrauch", m: "P1_Verarbeitung", w: "P1_Wert", treiber: "Verarbeitung", farbe: "p1" },
  { key: "P2", name: "Presse II", v: "P2_Verbrauch", m: "P2_Verarbeitung", w: "P2_Wert", treiber: "Verarbeitung", farbe: "p2" },
  { key: "UB", name: "UBC-Aufbereitung", v: "UB_Verbrauch", m: "UB_Verarbeitung", w: "UB_Wert", treiber: "Verarbeitung", farbe: "ubc" },
  { key: "ME", name: "ME", v: "ME_Verbrauch", m: "ME_Stunden", w: "ME_Wert", treiber: "Betriebsstunden", farbe: "me" }
];

const STANDORT = { key: "ST", name: "Standort gesamt", v: null, m: "Gesamtmenge", w: null, treiber: "Gesamtmenge", farbe: "standort" };

const num = (x) => Number(x) || 0;

const verbrauchVon = (r, a) => (a.v ? num(r[a.v]) : SEU_DEF.reduce((s, x) => s + num(r[x.v]), 0));

const mengeVon = (r, a) => num(r[a.m]);

const durchschnitt = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

function faktorVon(rows, a) {
  if (!a.w) return 1;
  const f = rows.filter(r => num(r[a.m]) && num(r[a.v]) && num(r[a.w])).map(r => num(r[a.w]) / (num(r[a.v]) / num(r[a.m])));
  if (!f.length) return 1;
  const mi = durchschnitt(f);
  if (!f.every(x => Math.abs(x / mi - 1) < 0.01)) return 1;
  const p = 10 ** Math.round(Math.log10(mi));
  return Math.abs(mi / p - 1) < 0.01 ? p : mi;
}

function regression(punkte) {
  const n = punkte.length;
  if (n < 3) return null;
  const mx = durchschnitt(punkte.map(p => p[0])), my = durchschnitt(punkte.map(p => p[1]));
  const sxx = punkte.reduce((s, [x]) => s + (x - mx) ** 2, 0);
  if (!sxx) return null;
  const b = punkte.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0) / sxx;
  const a = my - b * mx;
  const sst = punkte.reduce((s, [, y]) => s + (y - my) ** 2, 0);
  const sse = punkte.reduce((s, [x, y]) => s + (y - (a + b * x)) ** 2, 0);
  return { a, b, r2: sst ? 1 - sse / sst : 0, n, punkte, se: n > 2 ? Math.sqrt(sse / (n - 2)) : null };
}

function energieKennzahlen(rows, basisRows, einst) {
  const def = SEU_DEF.map(a => ({ ...a, faktor: faktorVon([...rows, ...basisRows], a) }));
  const fs = def.filter(a => a.key !== "ME").map(a => a.faktor);
  const standortFaktor = fs.every(x => Math.abs(x / fs[0] - 1) < 0.01) ? fs[0] : 1;
  const gesamtV = rows.reduce((s, r) => s + verbrauchVon(r, STANDORT), 0);
  const monate = new Set(rows.map(r => r.Monat));
  const basisGleich = basisRows.filter(r => monate.has(r.Monat));

  const auswerten = (a) => {
    const V = (rs) => rs.reduce((s, r) => s + verbrauchVon(r, a), 0);
    const M = (rs) => rs.reduce((s, r) => s + mengeVon(r, a), 0);
    const enpi = (rs) => (M(rs) > 0 ? (V(rs) / M(rs)) * a.faktor : null);
    const verbrauch = V(rows), menge = M(rows);
    const enpiAkt = enpi(rows), enpiBasis = enpi(basisGleich);
    const veraenderung = enpiAkt != null && enpiBasis ? (enpiAkt - enpiBasis) / enpiBasis : null;
    const zielEnpi = einst.ziel && enpiBasis ? enpiBasis * (1 - einst.ziel / 100) : null;

    const reg = regression(basisRows.map(r => [mengeVon(r, a), verbrauchVon(r, a)]).filter(([x, y]) => x > 0 && y > 0));
    let cusum = 0;
    const monatlich = rows.map(r => {
      const x = mengeVon(r, a), y = verbrauchVon(r, a);
      const erwartet = reg ? Math.max(0, reg.a + reg.b * x) : null;
      const einsparung = erwartet != null ? erwartet - y : null;
      if (einsparung != null) cusum += einsparung;
      return { Monat: r.Monat, name: monatName(r), monat: monatName(r).slice(0, 3), menge: x, verbrauch: y,
               enpi: x > 0 ? (y / x) * a.faktor : null, erwartet, einsparung, cusum: einsparung != null ? cusum : null };
    });

    // meilleur mois (seulement les mois avec au moins 50 % de la quantité moyenne)
    const mitMenge = monatlich.filter(z => z.menge > 0 && z.verbrauch > 0);
    const schnittMenge = mitMenge.length ? durchschnitt(mitMenge.map(z => z.menge)) : 0;
    const best = mitMenge.filter(z => z.menge >= 0.5 * schnittMenge).reduce((b, z) => (!b || z.enpi < b.enpi ? z : b), null);
    const potenzial = best ? mitMenge.reduce((s, z) => s + Math.max(0, z.verbrauch - (best.verbrauch / best.menge) * z.menge), 0) : null;
    const werte = mitMenge.map(z => z.enpi);
    const mw = werte.length ? durchschnitt(werte) : null;
    const cv = werte.length > 1 && mw ? Math.sqrt(durchschnitt(werte.map(w => (w - mw) ** 2))) / mw : null;

    return {
      ...a, verbrauch, menge, anteil: gesamtV ? verbrauch / gesamtV : null,
      enpiAkt, enpiBasis, veraenderung, zielEnpi, zielErreicht: enpiAkt != null && zielEnpi != null ? enpiAkt <= zielEnpi : null,
      reg, monatlich, einsparung: reg ? cusum : null, best, potenzial, cv,
      grundlast: reg && reg.a > 0 && verbrauch ? Math.min(1, (reg.a * rows.length) / verbrauch) : null,
      co2: einst.co2 ? (verbrauch * einst.co2) / 1000 : null, co2JeMenge: einst.co2 && menge ? (verbrauch * einst.co2) / menge : null,
      kosten: einst.preis ? verbrauch * einst.preis : null, kostenJeMenge: einst.preis && menge ? (verbrauch * einst.preis) / menge : null
    };
  };

  const anlagen = def.map(auswerten);
  const standort = auswerten({ ...STANDORT, faktor: standortFaktor });
  let kum = 0;
  const pareto = [...anlagen].sort((x, y) => y.verbrauch - x.verbrauch).map(a => {
    const vorher = kum; kum += a.anteil || 0;
    return { ...a, kumuliert: kum, seu: vorher < 0.8 && a.verbrauch > 0 };
  });
  const meStunden = summe(rows, "ME_Stunden");
  return {
    anlagen, standort, pareto, gesamtV, basisMonate: basisGleich.length,
    durchsatz: meStunden ? summe(rows, "Gesamtmenge") / meStunden : null,
    anteilMonat: rows.map(r => {
      const g = verbrauchVon(r, STANDORT);
      return { monat: monatName(r).slice(0, 3), ...Object.fromEntries(SEU_DEF.map(a => [a.key, g ? num(r[a.v]) / g : null])) };
    })
  };
}

function prognoseBerechnen(m, rows, vorjahr, basisRows, einst) {
  if (!m || !rows.length) return null;
  const letzter = Math.max(...rows.map(r => r.Monat));
  const rest = Array.from({ length: 12 - letzter }, (_, i) => letzter + 1 + i);
  const vjMonat = (mo) => vorjahr.find(r => r.Monat === mo);
  const ytdMonate = new Set(rows.map(r => r.Monat));

  const mengePrognose = (a) => {
    const ist = rows.reduce((s, r) => s + mengeVon(r, a), 0);
    const vjGleich = vorjahr.filter(r => ytdMonate.has(r.Monat)).reduce((s, r) => s + mengeVon(r, a), 0);
    const faktor = ist > 0 && vjGleich > 0 ? ist / vjGleich : null;
    const schnitt = ist / rows.length;
    return Object.fromEntries(rest.map(mo => {
      const v = vjMonat(mo);
      return [mo, faktor != null && v && mengeVon(v, a) > 0 ? mengeVon(v, a) * faktor : schnitt];
    }));
  };

  const einzeln = (a) => {
    const x = mengePrognose(a);
    const ytdV = rows.reduce((s, r) => s + verbrauchVon(r, a), 0), ytdM = rows.reduce((s, r) => s + mengeVon(r, a), 0);
    const reg = a.reg, brauchbar = !!(reg && reg.n >= 6 && reg.r2 >= 0.5);
    const erwartetYtd = brauchbar ? rows.reduce((s, r) => s + Math.max(0, reg.a + reg.b * mengeVon(r, a)), 0) : null;
    const leistung = brauchbar && erwartetYtd ? ytdV / erwartetYtd : null;
    const roh = ytdM > 0 ? ytdV / ytdM : null;
    const y = Object.fromEntries(rest.map(mo => [mo,
      brauchbar ? Math.max(0, reg.a + reg.b * x[mo]) * leistung : roh != null ? roh * x[mo] : 0]));
    const streuung = brauchbar ? reg.se
      : roh != null && rows.length > 2 ? Math.sqrt(durchschnitt(rows.map(r => (verbrauchVon(r, a) - roh * mengeVon(r, a)) ** 2))) : 0;
    return { x, y, ytdV, ytdM, streuung, methode: brauchbar ? "modell" : "enpi", leistung };
  };

  const proAnlage = {};
  for (const a of m.anlagen) proAnlage[a.key] = einzeln(a);
  // site : consommation = somme des installations, quantité = Gesamtmenge
  const st = m.standort;
  const stX = mengePrognose(st);
  proAnlage.ST = {
    x: stX, y: Object.fromEntries(rest.map(mo => [mo, m.anlagen.reduce((s, a) => s + proAnlage[a.key].y[mo], 0)])),
    ytdV: rows.reduce((s, r) => s + verbrauchVon(r, st), 0), ytdM: rows.reduce((s, r) => s + mengeVon(r, st), 0),
    streuung: Math.sqrt(m.anlagen.reduce((s, a) => s + proAnlage[a.key].streuung ** 2, 0)),
    methode: m.anlagen.every(a => proAnlage[a.key].methode === "modell") ? "modell" : "gemischt"
  };

  return [...m.anlagen, st].map(a => {
    const p = proAnlage[a.key];
    const restV = rest.reduce((s, mo) => s + p.y[mo], 0), restM = rest.reduce((s, mo) => s + p.x[mo], 0);
    const jahrV = p.ytdV + restV, jahrM = p.ytdM + restM;
    const spanne = 1.645 * p.streuung * Math.sqrt(rest.length);
    const enpiJahr = jahrM > 0 ? (jahrV / jahrM) * a.faktor : null;
    const enpiHoch = jahrM > 0 ? ((jahrV + spanne) / jahrM) * a.faktor : null;
    const vjV = vorjahr.length === 12 ? vorjahr.reduce((s, r) => s + verbrauchVon(r, a), 0) : null;
    const bV = basisRows.reduce((s, r) => s + verbrauchVon(r, a), 0), bM = basisRows.reduce((s, r) => s + mengeVon(r, a), 0);
    const enpiBasisJahr = bM > 0 ? (bV / bM) * a.faktor : null;
    const zielJahr = einst.ziel && enpiBasisJahr ? enpiBasisJahr * (1 - einst.ziel / 100) : null;
    // EnPI nécessaire sur les mois restants pour atteindre l'objectif annuel
    const benoetigt = zielJahr && restM > 0 ? ((zielJahr / a.faktor) * jahrM - p.ytdV) / restM * a.faktor : null;
    const status = zielJahr == null || enpiJahr == null ? null
      : enpiHoch <= zielJahr ? "sicher" : enpiJahr <= zielJahr ? "knapp" : "verfehlt";
    let kum = 0;
    const monate = Array.from({ length: 12 }, (_, i) => i + 1).map(mo => {
      const r = rows.find(z => z.Monat === mo);
      const ist = r ? verbrauchVon(r, a) : null;
      const prog = rest.includes(mo) ? p.y[mo] : null;
      kum += ist ?? prog ?? 0;
      const k = rest.indexOf(mo) + 1;
      const band = k > 0 ? 1.645 * p.streuung * Math.sqrt(k) : 0;
      const vj = vjMonat(mo);
      return { Monat: mo, monat: MONATE[mo - 1].slice(0, 3), ist, prognose: prog, vorjahr: vj ? verbrauchVon(vj, a) : null,
               kumIst: r ? kum : null, kumPrognose: mo >= letzter ? kum : null, band: k > 0 ? [kum - band, kum + band] : mo === letzter ? [kum, kum] : null };
    });
    return { ...a, rest, letzter, ytdV: p.ytdV, ytdM: p.ytdM, xRest: p.x, yRest: p.y, leistung: p.leistung ?? null, restV, jahrV, jahrM, spanne, enpiJahr, enpiHoch, enpiBasisJahr, zielJahr, benoetigt, status,
             vjV, methode: p.methode, monate,
             kostenJahr: einst.preis ? jahrV * einst.preis : null, co2Jahr: einst.co2 ? (jahrV * einst.co2) / 1000 : null };
  });
}

const ANLAGE_NAME = { P1: "Presse I", P2: "Presse II", UB: "UBC-Aufbereitung", ME: "ME", ST: "Standort gesamt", SO: "Sonstige" };

const ANLAGE_FARBE = { P1: "p1", P2: "p2", UB: "ubc", ME: "me", ST: "standort", SO: "vorjahr" };

const heuteText = () => new Date().toLocaleDateString("sv-SE");   // AAAA-MM-JJ, heure locale

const istUeberfaellig = (x) => (x.status === "geplant" || x.status === "umsetzung") && x.frist && x.frist < heuteText();

function warnungenBerechnen(en, massnahmen, jahr) {
  const w = [];
  const neu = (x) => w.push({ id: `${x.kategorie}-${x.anlage}-${x.monat ?? 0}-${w.length}`, ...x });
  const m = en.kpi;
  if (m) {
    for (const a of [...m.anlagen, m.standort]) {
      const reg = a.reg;
      const brauchbar = !!(reg && reg.n >= 6 && reg.r2 >= 0.5 && reg.se != null);
      const enpis = a.monatlich.filter(z => z.enpi != null).map(z => z.enpi);
      const mw = enpis.length ? durchschnitt(enpis) : null;
      const sd = enpis.length > 2 ? Math.sqrt(durchschnitt(enpis.map(e => (e - mw) ** 2))) : null;

      for (const z of a.monatlich) {
        if (brauchbar && z.erwartet != null) {
          const abw = z.verbrauch - z.erwartet;
          // au moins 2 % (warnung) / 5 % (kritisch) d'écart, pour ne pas alerter sur du bruit
          if (abw > Math.max(2 * reg.se, 0.02 * z.erwartet)) neu({
            stufe: abw > Math.max(3 * reg.se, 0.05 * z.erwartet) ? "kritisch" : "warnung", kategorie: "modell", anlage: a.key, monat: z.Monat,
            titel: `Mehrverbrauch ${a.name} im ${z.name}`,
            text: `${zahl(abw)} mehr als vom Baseline-Modell erwartet (${zahl(z.erwartet)}, +${prozent(abw / (z.erwartet || 1))}). ` +
                  (reg.se ? `Das ist das ${dez(abw / reg.se, 1)}-fache der üblichen Streuung.` : "") });
        } else if (sd && z.enpi != null && (z.enpi - mw) / sd > 2) {
          neu({ stufe: "warnung", kategorie: "trend", anlage: a.key, monat: z.Monat,
            titel: `EnPI ${a.name} im ${z.name} auffällig hoch`,
            text: `EnPI ${dez(z.enpi, 3)} liegt ${dez((z.enpi - mw) / sd, 1)} Standardabweichungen über dem Jahresmittel (${dez(mw, 3)}).` });
        }
        if (a.key !== "ST" && z.verbrauch === 0 && z.menge > 0) neu({ stufe: "info", kategorie: "daten", anlage: a.key, monat: z.Monat,
          titel: `Kein Verbrauch erfasst: ${a.name}, ${z.name}`, text: `${a.treiber} ${zahl(z.menge)}, aber Verbrauch 0. Zähler oder Erfassung prüfen.` });
        if (a.key !== "ST" && z.verbrauch > 0 && z.menge === 0) neu({ stufe: "info", kategorie: "daten", anlage: a.key, monat: z.Monat,
          titel: `${a.treiber} fehlt: ${a.name}, ${z.name}`, text: `Verbrauch ${zahl(z.verbrauch)}, aber ${a.treiber} 0. Der EnPI kann nicht berechnet werden.` });
      }

      const letzte = a.monatlich.filter(z => z.einsparung != null).slice(-3);
      if (brauchbar && letzte.length === 3 && letzte.every(z => z.einsparung < 0)) neu({
        stufe: "warnung", kategorie: "trend", anlage: a.key, monat: letzte[2].Monat,
        titel: `${a.name}: seit 3 Monaten Mehrverbrauch`,
        text: `${letzte.map(z => z.name).join(", ")}: jeweils mehr als erwartet, zusammen ${zahl(-letzte.reduce((s, z) => s + z.einsparung, 0))}.` });
      if (a.zielErreicht === false) neu({ stufe: "warnung", kategorie: "ziel", anlage: a.key,
        titel: `Ziel verfehlt: ${a.name}`,
        text: `EnPI ${dez(a.enpiAkt, 3)} statt höchstens ${dez(a.zielEnpi, 3)} (Ziel −${dez(en.einst.ziel, 1)} % ggü. ${en.basisJahr}).` });
      if (reg && !brauchbar) neu({ stufe: "info", kategorie: "modell", anlage: a.key,
        titel: `Baseline-Modell ${a.name} eingeschränkt`,
        text: `R² ${dez(reg.r2, 2)} bei ${reg.n} Monaten: Auffälligkeiten werden hier über das Jahresmittel erkannt.` });
    }
    const rows = en.daten?.aktuell || [];
    const max = Math.max(0, ...rows.map(r => r.Monat)), min = rows.length ? Math.min(...rows.map(r => r.Monat)) : 1;
    const fehlen = Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i).filter(mo => !rows.some(r => r.Monat === mo));
    if (fehlen.length) neu({ stufe: "warnung", kategorie: "daten", anlage: "ST",
      titel: "Monate fehlen in SEUWerte", text: `Keine Energiedaten für ${fehlen.map(x => MONATE[x - 1]).join(", ")} ${jahr}.` });
  }
  for (const x of massnahmen || []) {
    if (istUeberfaellig(x)) neu({ stufe: "warnung", kategorie: "massnahme", anlage: x.anlage, massnahmeId: x.id,
      titel: `Maßnahme überfällig: ${x.titel}`,
      text: `Frist ${datumDE(x.frist)}${x.verantwortlich ? `, verantwortlich: ${x.verantwortlich}` : ""}.` });
  }
  for (const x of en.prognose || []) {
    if (!x.rest.length || !x.status || x.status === "sicher") continue;
    neu({ stufe: x.status === "verfehlt" ? "warnung" : "info", kategorie: "prognose", anlage: x.key,
      titel: x.status === "verfehlt" ? `Prognose: Jahresziel ${x.name} wird verfehlt` : `Prognose: Jahresziel ${x.name} nur knapp`,
      text: `EnPI Jahresende voraussichtlich ${dez(x.enpiJahr, 3)} (Ziel ${dez(x.zielJahr, 3)}). ` +
            (x.benoetigt > 0 ? `Nötig in den restlichen ${x.rest.length} Monaten: ${dez(x.benoetigt, 3)}.` : "Mit den restlichen Monaten nicht mehr erreichbar.") });
  }
  const rang = { kritisch: 0, warnung: 1, info: 2 };
  return w.sort((a, b) => rang[a.stufe] - rang[b.stufe] || (b.monat || 0) - (a.monat || 0));
}

function abschaumWarnungen(k) {
  if (!k?.aktuell?.length) return [];
  const q = k.aktuell.filter(r => r.gesamt && r.abschaum).map(r => ({ r, q: r.abschaum / r.gesamt }));
  if (q.length < 4) return [];
  const mw = durchschnitt(q.map(x => x.q)), sd = Math.sqrt(durchschnitt(q.map(x => (x.q - mw) ** 2)));
  return q.filter(x => sd && (x.q - mw) / sd > 2).map(x => ({
    id: `abschaum-${x.r.Monat}`, stufe: "warnung", kategorie: "abschaum", anlage: "ST", monat: x.r.Monat,
    titel: `Abschaumquote im ${monatName(x.r)} auffällig hoch`,
    text: `${prozent(x.q)} statt im Schnitt ${prozent(mw)} (${dez((x.q - mw) / sd, 1)} Standardabweichungen darüber).`
  }));
}
// ===== END RECHNEN =====

// =====================================================================
// 1. Outils
// =====================================================================
const uhrzeit = () => new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

async function api(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && data.anmeldung) dispatchEvent(new Event("mrs-abgemeldet"));   // session expirée → écran de connexion
    const e = new Error(data.fehler || `Fehler ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

// Couleurs des installations (clair / sombre)
const farben = (dunkel) => dunkel
  ? { p1: "#5E9CC6", p2: "#A9C8DC", ubc: "#F0AA2E", me: "#4FC3B1", standort: "#A592D8", linie: "#A9C8DC", vorjahr: "#6B7785", gitter: "#2A333C", text: "#8C99A6" }
  : { p1: "#2B5874", p2: "#7FA8C3", ubc: "#E39A2D", me: "#2F9E8F", standort: "#6A55A3", linie: "#2B5874", vorjahr: "#A6AFB8", gitter: "#E6EAEE", text: "#6B7785" };

function csvHerunterladen(dateiname, kopf, zeilen) {
  const esc = (v) => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [kopf.map(esc).join(";"), ...zeilen.map(z => z.map(esc).join(";"))].join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
  Object.assign(document.createElement("a"), { href: url, download: dateiname }).click();
  URL.revokeObjectURL(url);
}

// =====================================================================
// 2. Indicateurs d'une année + contrôle qualité
// =====================================================================
// =====================================================================
// 3. Réponses simples SANS IA
// =====================================================================
const QUELLEN = [{ key: "presse1", name: "Presse I" }, { key: "presse2", name: "Presse II" }, { key: "ubc", name: "UBC-Aufbereitung" }];
const SEU_ANLAGEN = [
  { name: "Presse I", v: "P1_Verbrauch", w: "P1_Wert" }, { name: "Presse II", v: "P2_Verbrauch", w: "P2_Wert" },
  { name: "UBC-Aufbereitung", v: "UB_Verbrauch", w: "UB_Wert" }, { name: "ME", v: "ME_Verbrauch", w: "ME_Wert" }
];
const KURZ = ["jan", "feb", "mär|maer|mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "dez"];
const diff = (neu, alt) => `${neu >= alt ? "+" : "−"}${prozent(Math.abs(neu - alt) / alt)}`;
const liste = (zeilen) => zeilen.map(z => `- ${z}`).join("\n");
const monatIn = (t) => KURZ.findIndex(x => new RegExp(`\\b(${x})`).test(t));
const istEnergieFrage = (t) => /energie|verbrauch|strom|kwh|seu|iso 50001|\bme\b|betriebsstunde|stunden|spezifisch/i.test(t);

function antwortOhneKI(frage, k) {
  if (!k || !k.aktuell.length) return "Für das gewählte Jahr liegen keine Daten vor.";
  const t = frage.toLowerCase();
  const m = monatIn(t);
  if (m >= 0) {
    const r = k.aktuell.find(x => x.Monat === m + 1);
    if (!r) return `Für ${MONATE[m]} ${k.jahr} liegen keine Daten vor.`;
    const v = k.vorjahr.find(x => x.Monat === m + 1);
    return `Im **${monatName(r)} ${k.jahr}** wurden **${zahl(r.gesamt)}** verarbeitet (${diff(r.gesamt, k.schnitt)} zum Monatsdurchschnitt).\n\n` +
      liste(QUELLEN.map(q => `${q.name}: ${zahl(r[q.key])} (${prozent((r[q.key] || 0) / r.gesamt)})`)) +
      (v?.gesamt ? `\n\nIm ${monatName(v)} ${k.jahr - 1} waren es ${zahl(v.gesamt)}: **${diff(r.gesamt, v.gesamt)}**.` : "");
  }
  if (/vorjahr|vergleich|letzte[sn]? jahr/.test(t)) {
    if (k.veraenderung === null) return `Für ${k.jahr - 1} fehlen Daten für denselben Zeitraum.`;
    return `${k.zeitraum}: **${zahl(k.gesamt)}**, gleicher Zeitraum ${k.jahr - 1}: ${zahl(k.gesamtVj)} → **${diff(k.gesamt, k.gesamtVj)}**.\n\n` +
      liste(QUELLEN.map(q => `${q.name}: ${zahl(summe(k.aktuell, q.key))} statt ${zahl(summe(k.vjGleich, q.key))}`));
  }
  const stark = /stärk|stark|best|höchst|meist|rekord/.test(t);
  if (/schwäch|schwach|schlecht|niedrig|wenigst/.test(t) || stark) {
    const r = stark ? k.best : k.schwach;
    const treiber = QUELLEN.map(q => ({ ...q, abw: (r[q.key] || 0) - summe(k.mitDaten, q.key) / k.mitDaten.length }))
      .sort((a, b) => stark ? b.abw - a.abw : a.abw - b.abw)[0];
    return `${stark ? "Stärkster" : "Schwächster"} Monat ${k.jahr}: **${monatName(r)}** mit **${zahl(r.gesamt)}** (${diff(r.gesamt, k.schnitt)} zum Durchschnitt).\n\n` +
      liste(QUELLEN.map(q => `${q.name}: ${zahl(r[q.key])}`)) +
      `\n\nDen größten Ausschlag gibt **${treiber.name}**: ${zahl(Math.abs(treiber.abw))} ${treiber.abw >= 0 ? "über" : "unter"} dem eigenen Durchschnitt.`;
  }
  if (/ubc|dose|aufbereitung/.test(t)) return `Die UBC-Aufbereitung hat (${k.zeitraum}) **${zahl(k.ubc)}** verarbeitet, das sind **${prozent(k.ubc / k.gesamt)}** der Gesamtmenge.`;
  if (/presse/.test(t)) return `${k.zeitraum}: **${k.p2 > k.p1 ? "Presse II" : "Presse I"}** hat mehr verarbeitet.\n\n` +
    liste([`Presse I: ${zahl(k.p1)}`, `Presse II: ${zahl(k.p2)}`, `Unterschied: ${zahl(Math.abs(k.p1 - k.p2))}`]);
  if (/anteil|verteil|aufteil|quelle/.test(t)) return `Verteilung (${k.zeitraum}):\n\n` +
    liste(QUELLEN.map(q => `${q.name}: ${zahl(summe(k.aktuell, q.key))} (${prozent(summe(k.aktuell, q.key) / k.gesamt)})`));
  if (/gesamt|summe|insgesamt|total|wie ?viel/.test(t)) return `${k.zeitraum}: **${zahl(k.gesamt)}** verarbeitet, im Schnitt **${zahl(k.schnitt)}** pro Monat.`;
  return "Ohne KI kann ich das nicht beantworten. Möglich sind Fragen zu Gesamtmenge, stärkstem oder schwächstem Monat, " +
         "Verteilung, Pressen, UBC-Aufbereitung, Vorjahresvergleich und einzelnen Monaten. " +
         "Wenn Sie den Namen einer Tabelle nennen, zeige ich deren Summen, Durchschnitte und den stärksten Monat.";
}

function antwortEnergieOhneKI(frage, seu) {
  const rows = seu?.aktuell || [];
  if (!rows.length) return `In der Tabelle SEUWerte gibt es keine Daten für ${seu?.jahr ?? "das gewählte Jahr"}.`;
  const t = frage.toLowerCase();
  const jahr = seu.jahr;
  const pro = SEU_ANLAGEN.map(a => ({ ...a, summe: summe(rows, a.v) }));
  const gesamt = pro.reduce((a, b) => a + b.summe, 0);
  const m = monatIn(t);
  if (m >= 0) {
    const r = rows.find(x => x.Monat === m + 1);
    if (!r) return `Für ${MONATE[m]} ${jahr} gibt es keine Energiedaten.`;
    return `Energieverbrauch im **${MONATE[m]} ${jahr}**: **${zahl(SEU_ANLAGEN.reduce((s, a) => s + (Number(r[a.v]) || 0), 0))}**.\n\n` +
      liste(SEU_ANLAGEN.map(a => `${a.name}: ${zahl(r[a.v])} (spezifisch ${dez(r[a.w])})`));
  }
  if (/stunde/.test(t)) {
    const h = summe(rows, "ME_Stunden");
    return `Die Anlage ME lief ${jahr} insgesamt **${zahl(h)} Stunden**` + (h ? `, mit **${dez(summe(rows, "ME_Verbrauch") / h)}** Verbrauch je Stunde.` : ".");
  }
  if (/spezifisch|pro tonne|je tonne|effizien|wert|enpi/.test(t)) {
    const m = energieKennzahlen(rows, [], {});
    return `Spezifischer Verbrauch (EnPI) ${jahr}, gewichtet = Summe Verbrauch ÷ Summe Bezugsgröße:\n\n` +
      liste([...m.anlagen, m.standort].map(a => `${a.name}: ${dez(a.enpiAkt, 3)} je ${a.treiber}`));
  }
  const groesster = [...pro].sort((a, b) => b.summe - a.summe)[0];
  return `Energieverbrauch ${jahr} (${rows.length} Monate): **${zahl(gesamt)}**. Größter Verbraucher ist **${groesster.name}** mit ${prozent(groesster.summe / gesamt)}.\n\n` +
    liste(pro.map(a => `${a.name}: ${zahl(a.summe)} (${prozent(a.summe / gesamt)})`));
}

// =====================================================================
// 4. Petits composants
// =====================================================================

// Texte avec **gras** et listes « - » (sans innerHTML)
function Fett({ text }) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((t, i) => t.startsWith("**") && t.endsWith("**") ? <b key={i}>{t.slice(2, -2)}</b> : t);
}
function AntwortText({ text }) {
  // les lignes « - » consécutives deviennent une liste, le reste des paragraphes
  const istPunkt = (z) => /^\s*[-•*]\s+/.test(z);
  const bloecke = [];
  for (const absatz of String(text).split(/\n{2,}/)) {
    let aktuell = null;
    for (const z of absatz.split("\n")) {
      const art = istPunkt(z) ? "ul" : "p";
      if (!aktuell || aktuell.art !== art) { aktuell = { art, zeilen: [] }; bloecke.push(aktuell); }
      aktuell.zeilen.push(art === "ul" ? z.replace(/^\s*[-•*]\s+/, "") : z);
    }
  }
  return (
    <div className="antwort">
      {bloecke.map((b, i) => b.art === "ul"
        ? <ul key={i}>{b.zeilen.map((z, j) => <li key={j}><Fett text={z} /></li>)}</ul>
        : <p key={i}>{b.zeilen.map((z, j) => <span key={j}>{j > 0 && <br />}<Fett text={z} /></span>)}</p>)}
    </div>
  );
}

function TooltipBox({ active, payload, label, format = zahl, mitSumme }) {
  const { token } = theme.useToken();
  if (!active || !payload?.length) return null;
  const gesamt = payload.reduce((s, p) => s + (Number(p.value) || 0), 0);
  const zeile = { display: "flex", justifyContent: "space-between", gap: 16 };
  return (
    <div style={{ background: token.colorBgElevated, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 8,
                  padding: "8px 12px", boxShadow: token.boxShadowSecondary, fontSize: 13, minWidth: 170 }}>
      {label && <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>}
      {payload.map(p => (
        <div key={p.dataKey} style={zeile}>
          <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: p.color || p.payload?.fill, marginRight: 6 }} />{p.name}</span>
          <b className="zahl">{p.value == null ? "–" : format(p.value)}</b>
        </div>
      ))}
      {mitSumme && payload.length > 1 && (
        <div style={{ ...zeile, borderTop: `1px solid ${token.colorBorderSecondary}`, marginTop: 4, paddingTop: 4 }}>
          <span>Gesamt</span><b className="zahl">{format(gesamt)}</b>
        </div>
      )}
    </div>
  );
}

function StapelBalken({ data, reihen, f, hoehe = 320, format = zahl, gestapelt = true }) {
  return (
    <ResponsiveContainer width="100%" height={hoehe}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={f.gitter} />
        <XAxis dataKey="monat" tickLine={false} axisLine={false} tick={{ fill: f.text, fontSize: 12 }} />
        <YAxis tickFormatter={v => (Math.abs(v) >= 1000 ? kurz(v) : format(v))} tickLine={false} axisLine={false} width={72} tick={{ fill: f.text, fontSize: 12 }} />
        <ChartTooltip content={<TooltipBox mitSumme={gestapelt} format={format} />} cursor={{ fill: "rgba(127,127,127,.08)" }} />
        {reihen.map((r, i) => (
          <Bar key={r.key} dataKey={r.key} name={r.name} stackId={gestapelt ? "a" : undefined} fill={r.farbe} maxBarSize={56}
               radius={!gestapelt || i === reihen.length - 1 ? [4, 4, 0, 0] : 0} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function Linien({ data, reihen, f, hoehe = 260, format = zahl }) {
  return (
    <ResponsiveContainer width="100%" height={hoehe}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={f.gitter} />
        <XAxis dataKey="monat" tickLine={false} axisLine={false} tick={{ fill: f.text, fontSize: 12 }} />
        <YAxis tickFormatter={v => (Math.abs(v) >= 1000 ? kurz(v) : format(v))} tickLine={false} axisLine={false} width={72} tick={{ fill: f.text, fontSize: 12 }} />
        <ChartTooltip content={<TooltipBox format={format} />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 13, color: f.text }} />
        {reihen.map(r => (
          <Line key={r.key} dataKey={r.key} name={r.name} stroke={r.farbe} strokeWidth={r.dicke || 2.5}
                strokeDasharray={r.gestrichelt ? "5 5" : undefined} dot={{ r: 3 }} activeDot={{ r: 5 }} type="monotone" connectNulls={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function Ring({ data, mitte, hoehe = 200 }) {
  const { token } = theme.useToken();
  return (
    <div style={{ position: "relative", width: hoehe, height: hoehe }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="66%" outerRadius="100%" paddingAngle={2} stroke="none">
            {data.map(d => <Cell key={d.name} fill={d.farbe} />)}
          </Pie>
          <ChartTooltip content={<TooltipBox />} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", textAlign: "center" }}>
        <div><div style={{ fontSize: 12, color: token.colorTextSecondary }}>Gesamt</div><div style={{ fontWeight: 700, fontSize: 18 }} className="zahl">{mitte}</div></div>
      </div>
    </div>
  );
}

const Legende = ({ reihen }) => (
  <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "4px 16px" }}>
    {reihen.map(r => <span key={r.key} className="legende"><i style={{ background: r.farbe }} />{r.name}</span>)}
  </span>
);

// format allemand automatique quand seule une précision est donnée (sinon antd affiche 2.80 au lieu de 2,80)
const deFormat = (n) => (v) => (typeof v === "number" ? v.toLocaleString("de-DE", { minimumFractionDigits: n, maximumFractionDigits: n }) : v);
const Kpi = ({ titel, icon, children, precision, formatter, ...stat }) => (
  <Col xs={24} sm={12} xl={6}>
    <Card className="kpi"><Statistic title={icon ? <Space>{icon}{titel}</Space> : titel}
      formatter={formatter ?? (precision != null ? deFormat(precision) : undefined)} {...stat} />{children}</Card>
  </Col>
);

const Kopf = ({ titel, text }) => (
  <div><Title level={3} style={{ margin: 0 }}>{titel}</Title><Text type="secondary">{text}</Text></div>
);

function Marke() {
  return (
    <div className="marke">
      <div className="marke-logo">
        <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden="true">
          <rect x="5" y="16" width="5" height="11" rx="1" fill="#fff" />
          <rect x="13.5" y="10" width="5" height="17" rx="1" fill="#fff" />
          <rect x="22" y="5" width="5" height="22" rx="1" fill="#F0AA2E" />
        </svg>
      </div>
      <div className="marke-text"><b>MRS Produktion</b><span>Aluminium-Recycling</span></div>
    </div>
  );
}

// =====================================================================
// 5. Pages
// =====================================================================

// ---------- Übersicht ----------
function Uebersicht({ k, laedt, dunkel }) {
  if (laedt || !k) return (
    <Row gutter={[16, 16]}>
      {[1, 2, 3, 4].map(i => <Col key={i} xs={24} sm={12} xl={6}><Card><Skeleton active paragraph={{ rows: 1 }} /></Card></Col>)}
      <Col span={24}><Card><Skeleton active paragraph={{ rows: 8 }} /></Card></Col>
    </Row>
  );
  if (!k.aktuell.length) return <Card><Empty description={`Für ${k.jahr} liegen keine Daten vor.`} /></Card>;

  const f = farben(dunkel);
  const reihen = [
    { key: "presse1", name: "Presse I", farbe: f.p1 },
    { key: "presse2", name: "Presse II", farbe: f.p2 },
    { key: "ubc", name: "UBC-Aufbereitung", farbe: f.ubc }
  ];
  const monatsDaten = k.aktuell.map(r => ({ monat: monatName(r).slice(0, 3), presse1: r.presse1, presse2: r.presse2, ubc: r.ubc }));
  const vergleich = MONATE.map((m, i) => ({
    monat: m.slice(0, 3),
    aktuell: k.aktuell.find(r => r.Monat === i + 1)?.gesamt ?? null,
    vorjahr: k.vorjahr.find(r => r.Monat === i + 1)?.gesamt ?? null
  }));
  const anteile = reihen.map(r => ({ name: r.name, value: summe(k.aktuell, r.key), farbe: r.farbe }));
  const v = k.veraenderung;

  return (
    <Flex vertical gap={16}>
      <Kopf titel={`Produktion ${k.zeitraum}`} text="Verarbeitete Menge nach Quelle, Tabelle ProduktionMonat" />

      <Row gutter={[16, 16]}>
        <Kpi titel="Gesamtmenge" icon={<AppstoreOutlined />} value={k.gesamt} formatter={zahl}>
          <Text type="secondary">{k.mitDaten.length} Monate mit Daten</Text>
        </Kpi>
        <Kpi titel="Durchschnitt pro Monat" icon={<CalendarOutlined />} value={k.schnitt} formatter={zahl}>
          <Text type="secondary">Gesamt geteilt durch {k.mitDaten.length}</Text>
        </Kpi>
        <Kpi titel="Stärkster Monat" icon={<RiseOutlined />} value={k.best.gesamt} formatter={zahl} valueStyle={{ color: f.ubc }}>
          <Space size={4} wrap><Tag color="gold">{monatName(k.best)}</Tag><Text type="secondary">schwächster: {monatName(k.schwach)}</Text></Space>
        </Kpi>
        <Kpi titel="Veränderung zum Vorjahr"
          value={v === null ? "–" : Math.abs(v * 100)} precision={1} suffix={v === null ? "" : "%"}
          prefix={v === null ? null : v >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
          valueStyle={{ color: v === null ? undefined : v >= 0 ? "#2F9E8F" : "#CF4B3B" }}
          formatter={val => typeof val === "number" ? val.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : val}>
          <Text type="secondary">{v === null ? `Keine vollständigen Daten für ${k.jahr - 1}` : `gegenüber ${zahl(k.gesamtVj)}`}</Text>
        </Kpi>
      </Row>

      <Card title="Menge pro Monat" extra={<Legende reihen={reihen} />}>
        <StapelBalken data={monatsDaten} reihen={reihen} f={f} hoehe={340} />
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card title="Anteile der Quellen" extra={<Text type="secondary">{k.zeitraum}</Text>} style={{ height: "100%" }}>
            <Flex align="center" justify="space-around" wrap gap={24}>
              <Ring data={anteile} mitte={kurz(k.gesamt)} hoehe={190} />
              <Flex vertical gap={14}>
                {anteile.map(a => (
                  <div key={a.name}>
                    <span className="legende"><i style={{ background: a.farbe }} /><Text type="secondary">{a.name}</Text></span>
                    <div style={{ fontSize: 20, fontWeight: 700 }} className="zahl">{prozent(a.value / k.gesamt)}</div>
                  </div>
                ))}
              </Flex>
            </Flex>
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card title={`Gesamtmenge ${k.jahr} und ${k.jahr - 1}`} style={{ height: "100%" }}>
            <Linien data={vergleich} f={f} hoehe={230} reihen={[
              { key: "aktuell", name: String(k.jahr), farbe: f.linie, dicke: 3 },
              { key: "vorjahr", name: String(k.jahr - 1), farbe: f.vorjahr, gestrichelt: true, dicke: 2 }
            ]} />
          </Card>
        </Col>
      </Row>
    </Flex>
  );
}

// ---------- Monatswerte ----------
function Monatswerte({ k, dunkel }) {
  if (!k) return null;
  const f = farben(dunkel);
  const max = Math.max(...k.aktuell.map(r => r.gesamt || 0), 1);
  const zahlSp = (title, key) => ({ title, dataIndex: key, align: "right", render: zahl, sorter: (a, b) => (a[key] || 0) - (b[key] || 0) });

  const spalten = [
    { title: "Monat", dataIndex: "Monat", sorter: (a, b) => a.Monat - b.Monat, defaultSortOrder: "ascend",
      render: (_, r) => <Flex gap={6} align="center">{monatName(r)}
        {r === k.best && <Tag color="gold" bordered={false}>stärkster</Tag>}
        {r === k.schwach && <Tag bordered={false}>schwächster</Tag>}</Flex> },
    zahlSp("Presse I", "presse1"),
    zahlSp("Presse II", "presse2"),
    zahlSp("UBC-Aufbereitung", "ubc"),
    { ...zahlSp("Gesamt", "gesamt"), render: v => <b>{zahl(v)}</b> },
    { title: "Im Verhältnis", key: "balken", width: 170, render: (_, r) => (
      <Tooltip title={`${prozent((r.gesamt || 0) / max)} des stärksten Monats`}>
        <div className="mini-balken">
          <div style={{ width: `${(r.presse1 || 0) / max * 100}%`, background: f.p1 }} />
          <div style={{ width: `${(r.presse2 || 0) / max * 100}%`, background: f.p2 }} />
          <div style={{ width: `${(r.ubc || 0) / max * 100}%`, background: f.ubc }} />
        </div>
      </Tooltip>) },
    zahlSp("Abschaum-Bew.", "abschaum")
  ];

  const export_ = () => csvHerunterladen(`Produktion_${k.jahr}.csv`,
    ["Monat", "Presse I", "Presse II", "UBC-Aufbereitung", "Gesamt", "Abschaum-Bewegungen"],
    k.aktuell.map(r => [monatName(r), r.presse1, r.presse2, r.ubc, r.gesamt, r.abschaum]));

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="flex-end" wrap gap={12}>
        <Kopf titel={`Monatswerte ${k.jahr}`} text="Alle Werte der Tabelle ProduktionMonat. Spaltenköpfe anklicken zum Sortieren." />
        <Button icon={<DownloadOutlined />} disabled={!k.aktuell.length} onClick={export_}>Als CSV exportieren</Button>
      </Flex>
      <Card styles={{ body: { padding: 0 } }}>
        <Table rowKey="Monat" columns={spalten} dataSource={k.aktuell} pagination={false} scroll={{ x: 900 }} className="zahl"
          summary={() => k.aktuell.length > 0 && (
            <Table.Summary.Row style={{ fontWeight: 700 }}>
              <Table.Summary.Cell index={0}>Summe</Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right">{zahl(k.p1)}</Table.Summary.Cell>
              <Table.Summary.Cell index={2} align="right">{zahl(k.p2)}</Table.Summary.Cell>
              <Table.Summary.Cell index={3} align="right">{zahl(k.ubc)}</Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="right">{zahl(k.gesamt)}</Table.Summary.Cell>
              <Table.Summary.Cell index={5} />
              <Table.Summary.Cell index={6} align="right">{zahl(summe(k.aktuell, "abschaum"))}</Table.Summary.Cell>
            </Table.Summary.Row>
          )} />
      </Card>
    </Flex>
  );
}

// ---------- Energie (SEU) ----------
// Calculs selon ISO 50001 / ISO 50006 :
//  - SEU      : classement de Pareto (installations qui font ensemble ~80 % du verbrauch)
//  - EnPI     : consommation spécifique PONDÉRÉE = Σ Verbrauch ÷ Σ Bezugsgröße (pas la moyenne des mois)
//  - Baseline : régression linéaire sur l'année de référence  Verbrauch = a + b × Bezugsgröße
//  - CUSUM    : somme cumulée de (attendu − réel) → économie normalisée
// Facteur d'échelle de la colonne *_Wert (ex. ×1000 si la quantité est en kg) pour afficher les EnPI comme dans la base
// Régression linéaire simple (moindres carrés) : y = a + b·x, avec R²
const modellGuete = (reg) => !reg ? { farbe: "default", text: "kein Modell", icon: <QuestionCircleOutlined /> }
  : reg.n < 6 ? { farbe: "warning", text: "zu wenige Monate", icon: <AlertOutlined /> }
  : reg.r2 >= 0.75 ? { farbe: "success", text: "belastbar", icon: <CheckCircleOutlined /> }
  : reg.r2 >= 0.5 ? { farbe: "warning", text: "eingeschränkt", icon: <AlertOutlined /> }
  : { farbe: "error", text: "nicht belastbar", icon: <CloseCircleOutlined /> };
const stabilitaet = (cv) => cv == null ? { farbe: "default", text: "–" }
  : cv < 0.1 ? { farbe: "success", text: "stabil" } : cv < 0.2 ? { farbe: "warning", text: "mittel" } : { farbe: "error", text: "unruhig" };

// Petit tooltip commun aux graphiques de cette page
function EnergieTooltip({ active, payload, label, format = wert }) {
  const { token } = theme.useToken();
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: token.colorBgElevated, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 8,
                  padding: "8px 12px", boxShadow: token.boxShadowSecondary, fontSize: 13, minWidth: 180 }}>
      {label != null && <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
          <span>{p.name}</span><b className="zahl">{p.value == null ? "–" : (p.payload?.format?.[p.dataKey] || format)(p.value)}</b>
        </div>
      ))}
    </div>
  );
}

const StatusTag = ({ s }) => <Tag color={s.farbe} icon={s.icon} bordered={false}>{s.text}</Tag>;
const Delta = ({ v }) => v == null ? <Text type="secondary">–</Text> : (
  <Text style={{ color: v <= 0 ? "#2F9E8F" : "#CF4B3B", whiteSpace: "nowrap" }}>
    {v <= 0 ? <ArrowDownOutlined /> : <ArrowUpOutlined />} {prozent(Math.abs(v))}
  </Text>
);
const Punkt = ({ farbe }) => <i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: farbe, marginRight: 8 }} />;

// --- Onglet 1 : vue d'ensemble (page d'origine) ---
function EnergieUeberblick({ k, jahr, f, ANLAGEN, sichtbar, setSichtbar }) {
  const proMonat = (feld) => k.rows.map(r => ({ monat: monatName(r).slice(0, 3), ...Object.fromEntries(ANLAGEN.map(a => [a.key, r[a[feld]]])) }));
  const spalten = [
    { title: "Monat", dataIndex: "Monat", fixed: "left", render: (_, r) => monatName(r), sorter: (a, b) => a.Monat - b.Monat },
    ...ANLAGEN.map(a => ({ title: `Verbrauch ${a.name}`, dataIndex: a.v, align: "right", render: zahl, sorter: (x, y) => x[a.v] - y[a.v] })),
    { title: "Gesamtmenge", dataIndex: "Gesamtmenge", align: "right", render: zahl },
    { title: "ME Stunden", dataIndex: "ME_Stunden", align: "right", render: zahl },
    ...ANLAGEN.map(a => ({ title: `Wert ${a.key}`, dataIndex: a.w, align: "right", render: v => dez(v, 3) }))
  ];
  const pruefText = (p) => p.status === "leer" ? "keine vollständigen Werte."
    : p.status === "abweichend" ? "Wert passt nicht immer zu Verbrauch ÷ Verarbeitung."
    : Math.abs(p.faktor - 1) < 0.01 ? "Wert = Verbrauch ÷ Verarbeitung, bestätigt." : `Wert = Verbrauch ÷ Verarbeitung × ${dez(p.faktor)}, bestätigt.`;

  return (
    <Flex vertical gap={16}>
      <Row gutter={[16, 16]}>
        <Kpi titel="Energieverbrauch gesamt" icon={<ThunderboltOutlined />} value={k.gesamt} formatter={zahl}>
          <Text type="secondary">Summe aller vier Anlagen</Text>
        </Kpi>
        <Kpi titel="Verbrauch je Gesamtmenge" icon={<DashboardOutlined />} value={k.menge ? k.gesamt / k.menge : "–"} formatter={v => dez(v)}>
          <Text type="secondary">bei {zahl(k.menge)} verarbeiteter Menge</Text>
        </Kpi>
        <Kpi titel="Größter Verbraucher" icon={<FireOutlined />} value={k.groesster.name} valueStyle={{ color: k.groesster.farbe }}>
          <Text type="secondary">{prozent(k.groesster.summe / k.gesamt)} des Verbrauchs</Text>
        </Kpi>
        <Kpi titel="Betriebsstunden ME" icon={<FieldTimeOutlined />} value={k.stunden} formatter={zahl}>
          <Text type="secondary">{k.stunden ? `${dez(summe(k.rows, "ME_Verbrauch") / k.stunden)} Verbrauch je Stunde` : "keine Stunden erfasst"}</Text>
        </Kpi>
      </Row>

      <Card title={<Space><BarChartOutlined />Energieverbrauch pro Monat</Space>} extra={<Legende reihen={ANLAGEN} />}>
        <StapelBalken data={proMonat("v")} reihen={ANLAGEN} f={f} hoehe={320} />
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card title={<Space><LineChartOutlined />Spezifischer Verbrauch (Spalten *_Wert)</Space>} style={{ height: "100%" }}
            extra={<Checkbox.Group value={sichtbar} onChange={v => v.length && setSichtbar(v)} options={ANLAGEN.map(a => ({ value: a.key, label: a.key }))} />}>
            <Linien data={proMonat("w")} f={f} hoehe={260} format={v => dez(v, 3)} reihen={ANLAGEN.filter(a => sichtbar.includes(a.key))} />
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card title={<Space><SafetyCertificateOutlined />Prüfung der Kennzahlen</Space>} style={{ height: "100%" }}>
            <Flex vertical gap={8}>
              {k.pruefung.map(p => (
                <Alert key={p.anlage} showIcon type={p.status === "ok" ? "success" : p.status === "leer" ? "info" : "warning"}
                  message={<><b>{p.anlage}:</b> {pruefText(p)}</>} />
              ))}
              <Alert type="info" showIcon message="Einheiten sind nicht hinterlegt (vermutlich kWh und Tonnen). „ME“ mit der Fachabteilung benennen." />
            </Flex>
          </Card>
        </Col>
      </Row>

      <Card styles={{ body: { padding: 0 } }} title={<Space><TableOutlined />Monatswerte {jahr}</Space>} extra={<Tag>{k.rows.length} Monate</Tag>}>
        <Table rowKey="Monat" columns={spalten} dataSource={k.rows} pagination={false} scroll={{ x: 1300 }} size="middle" className="zahl"
          summary={() => (
            <Table.Summary.Row style={{ fontWeight: 700 }}>
              <Table.Summary.Cell index={0}>Summe</Table.Summary.Cell>
              {k.pro.map((a, i) => <Table.Summary.Cell key={a.key} index={i + 1} align="right">{zahl(a.summe)}</Table.Summary.Cell>)}
              <Table.Summary.Cell index={5} align="right">{zahl(k.menge)}</Table.Summary.Cell>
              <Table.Summary.Cell index={6} align="right">{zahl(k.stunden)}</Table.Summary.Cell>
              <Table.Summary.Cell index={7} colSpan={4} />
            </Table.Summary.Row>
          )} />
      </Card>
    </Flex>
  );
}

// --- Onglet 2 : bewertung des SEU (Pareto) ---
function SeuBewertung({ m, f }) {
  const daten = m.pareto.map(a => ({ name: a.name, verbrauch: a.verbrauch, kum: a.kumuliert * 100, farbe: f[a.farbe],
                                     format: { verbrauch: zahl, kum: v => `${dez(v, 1)} %` } }));
  const reihen = SEU_DEF.map(a => ({ key: a.key, name: a.name, farbe: f[a.farbe] }));
  const anzahlSeu = m.pareto.filter(a => a.seu).length;
  const anteilSeu = m.pareto.filter(a => a.seu).reduce((s, a) => s + (a.anteil || 0), 0);

  return (
    <Flex vertical gap={16}>
      <Alert type="info" showIcon icon={<ExperimentOutlined />} className="hinweis"
        message={<><b>Methode (ISO 50001, Abschnitt 6.3):</b> Die Anlagen werden nach Verbrauch sortiert. Alle Anlagen, die zusammen bis etwa
          80 % des Gesamtverbrauchs ausmachen, gelten als wesentlicher Energieeinsatz (SEU). Zusätzlich sollte das Verbesserungspotenzial bewertet werden.</>} />

      <Row gutter={[16, 16]}>
        <Kpi titel="Wesentliche Energieeinsätze" icon={<ThunderboltOutlined />} value={anzahlSeu} suffix={`von ${m.pareto.length}`}>
          <Text type="secondary">{prozent(anteilSeu)} des Gesamtverbrauchs</Text>
        </Kpi>
        <Kpi titel="Gesamtverbrauch" icon={<FireOutlined />} value={m.gesamtV} formatter={zahl}>
          <Text type="secondary">Summe aller Anlagen</Text>
        </Kpi>
        <Kpi titel="Größter SEU" icon={<AimOutlined />} value={m.pareto[0]?.name ?? "–"} valueStyle={{ color: f[m.pareto[0]?.farbe] }}>
          <Text type="secondary">{m.pareto[0] ? `${prozent(m.pareto[0].anteil)} des Verbrauchs` : ""}</Text>
        </Kpi>
        <Kpi titel="Durchsatz je ME-Stunde" icon={<FieldTimeOutlined />} value={m.durchsatz ?? "–"} formatter={wert}>
          <Text type="secondary">Gesamtmenge ÷ Betriebsstunden ME</Text>
        </Kpi>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card title={<Space><BarChartOutlined />Pareto-Analyse</Space>} style={{ height: "100%" }}
            extra={<Text type="secondary" style={{ fontSize: 12 }}><LineChartOutlined /> kumulierter Anteil, Grenze 80 %</Text>}>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={daten} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={f.gitter} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: f.text, fontSize: 12 }} />
                <YAxis yAxisId="v" tickFormatter={kurz} tickLine={false} axisLine={false} width={72} tick={{ fill: f.text, fontSize: 12 }} />
                <YAxis yAxisId="p" orientation="right" domain={[0, 100]} tickFormatter={v => `${v} %`} tickLine={false} axisLine={false} width={48} tick={{ fill: f.text, fontSize: 12 }} />
                <ChartTooltip content={<EnergieTooltip />} cursor={{ fill: "rgba(127,127,127,.08)" }} />
                <ReferenceLine yAxisId="p" y={80} stroke="#CF4B3B" strokeDasharray="4 4" label={{ value: "80 %", position: "insideTopRight", fill: "#CF4B3B", fontSize: 12 }} />
                <Bar yAxisId="v" dataKey="verbrauch" name="Verbrauch" maxBarSize={72} radius={[4, 4, 0, 0]}>
                  {daten.map(d => <Cell key={d.name} fill={d.farbe} />)}
                </Bar>
                <Line yAxisId="p" dataKey="kum" name="Kumuliert" stroke={f.vorjahr} strokeWidth={2.5} dot={{ r: 4 }} type="monotone" />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card title={<Space><OrderedListOutlined />Einstufung</Space>} style={{ height: "100%" }} styles={{ body: { padding: 0 } }}>
            <Table rowKey="key" size="middle" pagination={false} className="zahl" dataSource={m.pareto}
              columns={[
                { title: "Anlage", dataIndex: "name", render: (n, a) => <span><Punkt farbe={f[a.farbe]} /><b>{n}</b></span> },
                { title: "Anteil", dataIndex: "anteil", align: "right", render: v => v == null ? "–" : prozent(v) },
                { title: "Kumuliert", dataIndex: "kumuliert", align: "right", render: prozent },
                { title: "Status", dataIndex: "seu", render: s => s
                    ? <Tag color="volcano" icon={<ThunderboltOutlined />} bordered={false}>SEU</Tag>
                    : <Tag icon={<MinusCircleOutlined />} bordered={false}>kein SEU</Tag> }
              ]} />
          </Card>
        </Col>
      </Row>

      <Card title={<Space><AreaChartOutlined />Anteil am Gesamtverbrauch pro Monat</Space>}>
        <Linien data={m.anteilMonat} f={f} hoehe={260} format={prozent} reihen={reihen} />
      </Card>
    </Flex>
  );
}

// --- Onglet 3 : EnPI, baseline, CUSUM ---
function EnpiBaseline({ m, f, jahr, basisJahr }) {
  const [wahl, setWahl] = useState("P1");
  const alle = [...m.anlagen, m.standort];
  const a = alle.find(x => x.key === wahl) || alle[0];
  const g = modellGuete(a.reg);
  const farbe = f[a.farbe];
  const treiber = a.treiber;

  const basisPunkte = (a.reg?.punkte || []).map(([x, y]) => ({ x, y }));
  const aktPunkte = a.monatlich.filter(z => z.menge > 0 && z.verbrauch > 0).map(z => ({ x: z.menge, y: z.verbrauch, name: z.name }));
  const xs = [...basisPunkte, ...aktPunkte].map(p => p.x);
  const linie = a.reg && xs.length ? [Math.min(...xs), Math.max(...xs)].map(x => ({ x, y: a.reg.a + a.reg.b * x })) : [];

  function PunktTooltip({ active, payload }) {
    const { token } = theme.useToken();
    if (!active || !payload?.length) return null;
    const p = payload[0].payload;
    return (
      <div style={{ background: token.colorBgElevated, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, boxShadow: token.boxShadowSecondary }}>
        {p.name && <div style={{ fontWeight: 600 }}>{p.name}</div>}
        <div>{treiber}: <b className="zahl">{wert(p.x)}</b></div>
        <div>Verbrauch: <b className="zahl">{wert(p.y)}</b></div>
      </div>
    );
  }

  const spalten = [
    { title: "Monat", dataIndex: "name" },
    { title: treiber, dataIndex: "menge", align: "right", render: wert },
    { title: "Verbrauch", dataIndex: "verbrauch", align: "right", render: wert },
    { title: <Tooltip title="Verbrauch, der nach dem Baseline-Modell bei dieser Menge zu erwarten wäre"><Space size={4}>Erwartet<InfoCircleOutlined /></Space></Tooltip>,
      dataIndex: "erwartet", align: "right", render: wert },
    { title: "Einsparung", dataIndex: "einsparung", align: "right",
      render: v => v == null ? "–" : <Text style={{ color: v >= 0 ? "#2F9E8F" : "#CF4B3B" }}>{v >= 0 ? "+" : "−"}{wert(Math.abs(v))}</Text> },
    { title: "CUSUM", dataIndex: "cusum", align: "right", render: v => v == null ? "–" : <b>{wert(v)}</b> },
    { title: "EnPI", dataIndex: "enpi", align: "right", render: v => dez(v, 3) }
  ];

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center" wrap gap={12}>
        <Segmented value={wahl} onChange={setWahl}
          options={alle.map(x => ({ value: x.key, label: <Space size={6}><Punkt farbe={f[x.farbe]} />{x.name}</Space> }))} />
        <Space wrap>
          <Tag icon={<FlagOutlined />} bordered={false}>Basisjahr {basisJahr}</Tag>
          <Tag icon={<DotChartOutlined />} bordered={false}>Bezugsgröße: {treiber}</Tag>
        </Space>
      </Flex>

      <Row gutter={[16, 16]}>
        <Kpi titel={`EnPI ${jahr}`} icon={<FundOutlined />} value={a.enpiAkt ?? "–"} formatter={v => dez(v, 3)} valueStyle={{ color: farbe }}>
          <Text type="secondary">Σ Verbrauch ÷ Σ {treiber}{a.faktor !== 1 ? ` × ${dez(a.faktor)}` : ""} (gewichtet)</Text>
        </Kpi>
        <Kpi titel={`EnPI Basis ${basisJahr}`} icon={<FlagOutlined />} value={a.enpiBasis ?? "–"} formatter={v => dez(v, 3)}>
          <Text type="secondary">gleiche Monate ({m.basisMonate}), gewichtet</Text>
        </Kpi>
        <Kpi titel="Veränderung EnPI" icon={<HistoryOutlined />}
          value={a.veraenderung == null ? "–" : Math.abs(a.veraenderung * 100)} precision={1} suffix={a.veraenderung == null ? "" : "%"}
          prefix={a.veraenderung == null ? null : a.veraenderung <= 0 ? <ArrowDownOutlined /> : <ArrowUpOutlined />}
          valueStyle={{ color: a.veraenderung == null ? undefined : a.veraenderung <= 0 ? "#2F9E8F" : "#CF4B3B" }}
          formatter={x => typeof x === "number" ? x.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : x}>
          <Text type="secondary">{a.veraenderung == null ? "kein Vergleich möglich" : a.veraenderung <= 0 ? "effizienter als im Basisjahr" : "weniger effizient als im Basisjahr"}</Text>
        </Kpi>
        <Kpi titel="Normalisierte Einsparung" icon={<ThunderboltOutlined />} value={a.einsparung ?? "–"} formatter={wert}
          valueStyle={{ color: a.einsparung == null ? undefined : a.einsparung >= 0 ? "#2F9E8F" : "#CF4B3B" }}>
          <Text type="secondary">{a.einsparung == null ? "kein Baseline-Modell" : a.einsparung >= 0 ? "weniger verbraucht als erwartet" : "mehr verbraucht als erwartet"}</Text>
        </Kpi>
      </Row>

      {(!a.reg || a.reg.n < 6 || a.reg.r2 < 0.5) && (
        <Alert type="warning" showIcon
          message="Das Baseline-Modell ist nur eingeschränkt belastbar"
          description={!a.reg ? `Für ${basisJahr} gibt es nicht genug Monate mit Verbrauch und ${treiber}. Wählen Sie in den Einstellungen ein anderes Basisjahr.`
            : a.reg.n < 6 ? `Nur ${a.reg.n} Monate im Basisjahr. Empfohlen sind mindestens 6, besser 12.`
            : `R² = ${dez(a.reg.r2, 2)}: ${treiber} erklärt den Verbrauch nur teilweise. Weitere Einflussgrößen (z. B. Temperatur, Rezeptur) prüfen.`} />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card title={<Space><DotChartOutlined />Baseline-Modell (Regression)</Space>} style={{ height: "100%" }} extra={<StatusTag s={g} />}>
            <ResponsiveContainer width="100%" height={260}>
              <ScatterChart margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                <CartesianGrid stroke={f.gitter} />
                <XAxis type="number" dataKey="x" name={treiber} tickFormatter={kurz} tickLine={false} axisLine={false} tick={{ fill: f.text, fontSize: 12 }} domain={["auto", "auto"]} />
                <YAxis type="number" dataKey="y" name="Verbrauch" tickFormatter={kurz} tickLine={false} axisLine={false} width={72} tick={{ fill: f.text, fontSize: 12 }} domain={["auto", "auto"]} />
                <ChartTooltip content={<PunktTooltip />} cursor={{ strokeDasharray: "3 3" }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 13, color: f.text }} />
                <Scatter name={`Basis ${basisJahr}`} data={basisPunkte} fill={f.vorjahr} />
                <Scatter name={String(jahr)} data={aktPunkte} fill={farbe} />
                {linie.length > 0 && <Scatter name="Modell" data={linie} line={{ stroke: f.linie, strokeWidth: 2 }} shape={() => <g />} legendType="line" fill={f.linie} isAnimationActive={false} />}
              </ScatterChart>
            </ResponsiveContainer>
            {a.reg && (
              <Descriptions size="small" column={2} style={{ marginTop: 12 }} items={[
                { key: "f", label: "Formel", span: 2, children: <Text code>Verbrauch = {wert(a.reg.a)} + {dez(a.reg.b, 4)} × {treiber}</Text> },
                { key: "a", label: <Tooltip title="Verbrauch pro Monat ohne Produktion (Achsenabschnitt a)"><Space size={4}>Grundlast / Monat<InfoCircleOutlined /></Space></Tooltip>, children: wert(a.reg.a) },
                { key: "g", label: "Grundlastanteil", children: a.grundlast == null ? "–" : prozent(a.grundlast) },
                { key: "r", label: "Bestimmtheitsmaß R²", children: <Space size={6}>{dez(a.reg.r2, 3)}<StatusTag s={g} /></Space> },
                { key: "n", label: "Basismonate", children: a.reg.n }
              ]} />
            )}
            {a.reg && a.reg.a < 0 && (
              <Text type="secondary" style={{ fontSize: 12 }}><InfoCircleOutlined /> Negativer Achsenabschnitt: keine physikalische Grundlast ablesbar.
                Das Modell gilt nur im Bereich der gemessenen Mengen.</Text>
            )}
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title={<Space><StockOutlined />CUSUM: kumulierte Einsparung</Space>} style={{ height: "100%" }}
            extra={<Text type="secondary" style={{ fontSize: 12 }}>steigend = Einsparung</Text>}>
            {!a.reg ? <Empty description="Ohne Baseline-Modell keine CUSUM-Auswertung." /> : (
              <ResponsiveContainer width="100%" height={330}>
                <ComposedChart data={a.monatlich} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={f.gitter} />
                  <XAxis dataKey="monat" tickLine={false} axisLine={false} tick={{ fill: f.text, fontSize: 12 }} />
                  <YAxis tickFormatter={kurz} tickLine={false} axisLine={false} width={72} tick={{ fill: f.text, fontSize: 12 }} />
                  <ChartTooltip content={<EnergieTooltip />} cursor={{ fill: "rgba(127,127,127,.08)" }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 13, color: f.text }} />
                  <ReferenceLine y={0} stroke={f.text} />
                  <Bar dataKey="einsparung" name="Einsparung im Monat" maxBarSize={36} radius={[3, 3, 3, 3]} fill="#2F9E8F">
                    {a.monatlich.map(z => <Cell key={z.Monat} fill={(z.einsparung ?? 0) >= 0 ? "#2F9E8F" : "#CF4B3B"} />)}
                  </Bar>
                  <Line dataKey="cusum" name="CUSUM" stroke={f.linie} strokeWidth={3} dot={{ r: 3 }} type="monotone" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Col>
      </Row>

      <Card title={<Space><TableOutlined />Monatliche Auswertung: {a.name}</Space>} styles={{ body: { padding: 0 } }}>
        <Table rowKey="Monat" size="middle" pagination={false} className="zahl" dataSource={a.monatlich} columns={spalten} scroll={{ x: 800 }} />
      </Card>
    </Flex>
  );
}

// --- Onglet 4 : tableau de bord de tous les KPI ---
function KpiCockpit({ m, f, einst, jahr, basisJahr, oeffneEinstellungen }) {
  const zeilen = [...m.anlagen, { ...m.standort, istStandort: true }];
  const summeVon = (k) => m.anlagen.reduce((s, a) => s + (a[k] || 0), 0);
  const spalten = [
    { title: "Anlage", dataIndex: "name", fixed: "left", width: 230,
      render: (n, a) => <span><Punkt farbe={f[a.farbe]} />{a.istStandort ? <b>{n}</b> : n}
        {m.pareto.find(p => p.key === a.key)?.seu && <Tag color="volcano" bordered={false} style={{ marginLeft: 6 }}>SEU</Tag>}</span> },
    { title: <Space size={4}><ThunderboltOutlined />Verbrauch</Space>, dataIndex: "verbrauch", align: "right", render: zahl },
    { title: <Space size={4}><PieChartOutlined />Anteil</Space>, dataIndex: "anteil", align: "right", render: (v, a) => a.istStandort ? "100 %" : v == null ? "–" : prozent(v) },
    { title: <Space size={4}><FundOutlined />EnPI {jahr}</Space>, dataIndex: "enpiAkt", align: "right", render: v => <b>{dez(v, 3)}</b> },
    { title: <Space size={4}><FlagOutlined />EnPI {basisJahr}</Space>, dataIndex: "enpiBasis", align: "right", render: v => dez(v, 3) },
    { title: <Space size={4}><HistoryOutlined />Δ EnPI</Space>, dataIndex: "veraenderung", align: "right", render: v => <Delta v={v} /> },
    ...(einst.ziel ? [{ title: <Space size={4}><AimOutlined />Ziel −{dez(einst.ziel, 1)} %</Space>, dataIndex: "zielErreicht", align: "center",
        render: (z, a) => z == null ? "–" : <Tooltip title={`Ziel-EnPI ${dez(a.zielEnpi, 3)}`}>
          {z ? <Tag color="success" icon={<CheckCircleOutlined />} bordered={false}>erreicht</Tag> : <Tag color="error" icon={<CloseCircleOutlined />} bordered={false}>verfehlt</Tag>}</Tooltip> }] : []),
    { title: <Tooltip title="Bester Monat mit mindestens 50 % der durchschnittlichen Menge"><Space size={4}><RiseOutlined />Bester Monat<InfoCircleOutlined /></Space></Tooltip>,
      dataIndex: "best", align: "right", render: b => b ? <span>{dez(b.enpi, 3)} <Text type="secondary">({b.monat})</Text></span> : "–" },
    { title: <Tooltip title="Verbrauch, der eingespart würde, wenn jeder Monat so effizient wäre wie der beste"><Space size={4}><BulbOutlined />Potenzial<InfoCircleOutlined /></Space></Tooltip>,
      dataIndex: "potenzial", align: "right", render: (v, a) => v == null ? "–" : <span>{zahl(v)} <Text type="secondary">({a.verbrauch ? prozent(v / a.verbrauch) : "–"})</Text></span> },
    { title: <Tooltip title="Variationskoeffizient der monatlichen EnPI: unter 10 % stabil, über 20 % unruhig"><Space size={4}><LineChartOutlined />Stabilität<InfoCircleOutlined /></Space></Tooltip>,
      dataIndex: "cv", align: "center", render: v => <Tooltip title={v == null ? "" : `VK ${prozent(v)}`}><span><StatusTag s={stabilitaet(v)} /></span></Tooltip> },
    { title: <Space size={4}><DotChartOutlined />Modell R²</Space>, dataIndex: "reg", align: "center",
      render: r => <Tooltip title={r ? `R² ${dez(r.r2, 2)}, ${r.n} Monate` : ""}><span><StatusTag s={modellGuete(r)} /></span></Tooltip> },
    ...(einst.co2 ? [
      { title: <Space size={4}><CloudOutlined />CO₂ (t)</Space>, dataIndex: "co2", align: "right", render: v => dez(v, 1) },
      { title: <Space size={4}><CloudOutlined />CO₂ je Bezug</Space>, dataIndex: "co2JeMenge", align: "right", render: v => dez(v, 3) }] : []),
    ...(einst.preis ? [
      { title: <Space size={4}><EuroOutlined />Kosten</Space>, dataIndex: "kosten", align: "right", render: v => v == null ? "–" : `${zahl(v)} €` },
      { title: <Space size={4}><EuroOutlined />Kosten je Bezug</Space>, dataIndex: "kostenJeMenge", align: "right", render: v => v == null ? "–" : `${dez(v, 3)} €` }] : [])
  ];

  return (
    <Flex vertical gap={16}>
      <Row gutter={[16, 16]}>
        <Kpi titel="EnPI Standort" icon={<FundOutlined />} value={m.standort.enpiAkt ?? "–"} formatter={v => dez(v, 3)}>
          <Space size={6}><Delta v={m.standort.veraenderung} /><Text type="secondary">ggü. {basisJahr}</Text></Space>
        </Kpi>
        <Kpi titel="Einsparpotenzial" icon={<BulbOutlined />} value={summeVon("potenzial")} formatter={zahl} valueStyle={{ color: f.ubc }}>
          <Text type="secondary">{m.gesamtV ? prozent(summeVon("potenzial") / m.gesamtV) : "–"} des Verbrauchs (Bestmonat-Methode)</Text>
        </Kpi>
        <Kpi titel="CO₂-Emissionen" icon={<CloudOutlined />} value={einst.co2 ? summeVon("co2") : "–"} formatter={v => typeof v === "number" ? `${dez(v, 1)} t` : v}>
          {einst.co2 ? <Text type="secondary">Faktor {dez(einst.co2, 3)} kg je Einheit</Text>
            : <Button type="link" size="small" icon={<SettingOutlined />} onClick={oeffneEinstellungen} style={{ padding: 0 }}>Faktor eintragen</Button>}
        </Kpi>
        <Kpi titel="Energiekosten" icon={<EuroOutlined />} value={einst.preis ? summeVon("kosten") : "–"} formatter={v => typeof v === "number" ? `${zahl(v)} €` : v}>
          {einst.preis ? <Text type="secondary">Preis {dez(einst.preis, 4)} € je Einheit</Text>
            : <Button type="link" size="small" icon={<SettingOutlined />} onClick={oeffneEinstellungen} style={{ padding: 0 }}>Preis eintragen</Button>}
        </Kpi>
      </Row>

      <Card title={<Space><AppstoreOutlined />KPI-Cockpit {jahr}</Space>} styles={{ body: { padding: 0 } }}
        extra={<Button icon={<DownloadOutlined />} onClick={() => csvHerunterladen(`SEU_KPI_${jahr}.csv`,
          ["Anlage", "Verbrauch", "Anteil", `EnPI ${jahr}`, `EnPI ${basisJahr}`, "Veränderung", "Bester Monat EnPI", "Potenzial", "Variationskoeffizient", "R²", "CO2 t", "Kosten €"],
          zeilen.map(a => [a.name, Math.round(a.verbrauch), a.anteil, a.enpiAkt, a.enpiBasis, a.veraenderung, a.best?.enpi, a.potenzial == null ? "" : Math.round(a.potenzial), a.cv, a.reg?.r2, a.co2, a.kosten]))}>CSV</Button>}>
        <Table rowKey="key" size="middle" pagination={false} className="zahl kopf-nowrap" dataSource={zeilen} columns={spalten.map(c => ({ width: 150, ...c }))} scroll={{ x: "max-content" }}
          rowClassName={a => (a.istStandort ? "zeile-aktiv" : "")} />
      </Card>

      <Text type="secondary" style={{ fontSize: 12 }}>
        <InfoCircleOutlined /> EnPI = Σ Verbrauch ÷ Σ Bezugsgröße (Presse/UBC: Verarbeitung, ME: Betriebsstunden, Standort: Gesamtmenge), skaliert wie die Spalten *_Wert.
        Ein sinkender EnPI bedeutet eine Verbesserung. Vergleich mit dem Basisjahr immer über die gleichen Monate.
      </Text>
    </Flex>
  );
}

// ---------- Prognose : Hochrechnung bis Jahresende ----------
// Bezugsgröße der restlichen Monate = Vorjahresmonat × (Ist ÷ Vorjahr der bisherigen Monate)  → Saisonverlauf bleibt erhalten
// Verbrauch der restlichen Monate   = Baseline-Modell (a + b × Menge) × bisherige Leistung (Ist ÷ Erwartung)
//                                     ohne belastbares Modell: bisheriger EnPI × Menge
// Spanne (90 %)                      = ± 1,64 × Streuung je Monat × √(Anzahl restlicher Monate)
const PROGNOSE_STATUS = {
  sicher: { name: "Ziel sicher", farbe: "success", icon: <CheckCircleOutlined /> },
  knapp: { name: "Ziel knapp", farbe: "warning", icon: <AlertOutlined /> },
  verfehlt: { name: "Ziel verfehlt", farbe: "error", icon: <CloseCircleOutlined /> }
};

function Prognose({ p, f, jahr, einst, basisJahr, oeffneEinstellungen }) {
  const [wahl, setWahl] = useState("ST");
  if (!p) return <Card><Skeleton active paragraph={{ rows: 8 }} /></Card>;
  const a = p.find(x => x.key === wahl) || p.at(-1);
  if (!a.rest.length) return (
    <Card><Result status="success" icon={<CheckCircleOutlined style={{ color: "#2F9E8F" }} />} title={`Das Jahr ${jahr} ist vollständig`}
      subTitle="Für alle 12 Monate liegen Ist-Werte vor, eine Hochrechnung ist nicht nötig. Die Ergebnisse stehen im KPI-Cockpit und im Energiebericht." /></Card>);
  const farbe = f[a.farbe];
  const st = PROGNOSE_STATUS[a.status];

  return (
    <Flex vertical gap={16}>
      <Alert type="info" showIcon icon={<FundProjectionScreenOutlined />} className="hinweis"
        message={<><b>Hochrechnung bis Dezember {jahr}</b> auf Basis von {a.letzter} Monaten Ist-Werten.
          Die Menge der restlichen Monate folgt dem Saisonverlauf des Vorjahres; der Verbrauch folgt dem Baseline-Modell mit der bisherigen Leistung
          ({a.methode === "modell" ? "Modell belastbar" : "teilweise ohne belastbares Modell: bisheriger EnPI"}). Die Spanne entspricht etwa 90 % Sicherheit.</>} />

      <Flex justify="space-between" align="center" wrap gap={12}>
        <Segmented value={wahl} onChange={setWahl}
          options={p.map(x => ({ value: x.key, label: <Space size={6}><Punkt farbe={f[x.farbe]} />{x.name}</Space> }))} />
        {!einst.ziel && <Button icon={<SettingOutlined />} onClick={oeffneEinstellungen}>Ziel festlegen</Button>}
      </Flex>

      <Row gutter={[16, 16]}>
        <Kpi titel={`Verbrauch Jan – ${MONATE[a.letzter - 1].slice(0, 3)}`} icon={<ThunderboltOutlined />} value={a.ytdV} formatter={zahl}>
          <Text type="secondary">Ist-Werte, {a.letzter} Monate</Text>
        </Kpi>
        <Kpi titel={`Prognose Jahr ${jahr}`} icon={<FundProjectionScreenOutlined />} value={a.jahrV} formatter={zahl} valueStyle={{ color: farbe }}>
          <Text type="secondary">± {zahl(a.spanne)}{a.vjV ? <> · <BDeltaNeutral v={a.jahrV / a.vjV - 1} /> ggü. {jahr - 1}</> : ""}</Text>
        </Kpi>
        <Kpi titel="EnPI Jahresende" icon={<FundOutlined />} value={a.enpiJahr ?? "–"} formatter={v => dez(v, 3)}>
          <Space size={6} wrap><Delta v={a.enpiBasisJahr ? a.enpiJahr / a.enpiBasisJahr - 1 : null} /><Text type="secondary">ggü. Jahr {basisJahr}</Text></Space>
        </Kpi>
        <Kpi titel="Zielerreichung" icon={<AimOutlined />} value={st ? st.name : "kein Ziel"} valueStyle={{ fontSize: 20, color: !st ? undefined : a.status === "sicher" ? "#2F9E8F" : a.status === "knapp" ? "#E39A2D" : "#CF4B3B" }}>
          <Text type="secondary">{a.zielJahr == null ? "Ziel in den Einstellungen festlegen"
            : a.benoetigt != null && a.benoetigt <= 0 ? "für die restlichen Monate nicht mehr erreichbar"
            : `Ziel-EnPI ${dez(a.zielJahr, 3)}; nötig ab jetzt: ${dez(a.benoetigt, 3)}`}</Text>
        </Kpi>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card title={<Space><BarChartOutlined />Monatsverbrauch: Ist und Prognose</Space>} style={{ height: "100%" }}>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={a.monate} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={f.gitter} />
                <XAxis dataKey="monat" tickLine={false} axisLine={false} tick={{ fill: f.text, fontSize: 12 }} />
                <YAxis tickFormatter={kurz} tickLine={false} axisLine={false} width={72} tick={{ fill: f.text, fontSize: 12 }} />
                <ChartTooltip content={<EnergieTooltip format={zahl} />} cursor={{ fill: "rgba(127,127,127,.08)" }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 13, color: f.text }} />
                <Bar dataKey="ist" name="Ist" fill={farbe} maxBarSize={36} radius={[3, 3, 0, 0]} />
                <Bar dataKey="prognose" name="Prognose" fill={farbe} fillOpacity={0.35} stroke={farbe} strokeDasharray="4 3" maxBarSize={36} radius={[3, 3, 0, 0]} />
                <Line dataKey="vorjahr" name={String(jahr - 1)} stroke={f.vorjahr} strokeDasharray="5 5" strokeWidth={2} dot={false} type="monotone" />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title={<Space><StockOutlined />Kumulierter Verbrauch mit Spanne</Space>} style={{ height: "100%" }}>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={a.monate} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={f.gitter} />
                <XAxis dataKey="monat" tickLine={false} axisLine={false} tick={{ fill: f.text, fontSize: 12 }} />
                <YAxis tickFormatter={kurz} tickLine={false} axisLine={false} width={72} tick={{ fill: f.text, fontSize: 12 }} />
                <ChartTooltip content={<EnergieTooltip format={v => (Array.isArray(v) ? `${zahl(v[0])} – ${zahl(v[1])}` : zahl(v))} />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 13, color: f.text }} />
                <Area dataKey="band" name="Spanne (90 %)" fill={farbe} fillOpacity={0.15} stroke="none" isAnimationActive={false} />
                <Line dataKey="kumIst" name="Ist" stroke={farbe} strokeWidth={3} dot={{ r: 3 }} type="monotone" connectNulls={false} />
                <Line dataKey="kumPrognose" name="Prognose" stroke={farbe} strokeWidth={2} strokeDasharray="6 4" dot={false} type="monotone" />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>

      <Card title={<Space><AppstoreOutlined />Hochrechnung aller Anlagen</Space>} styles={{ body: { padding: 0 } }}>
        <Table rowKey="key" size="middle" pagination={false} className="zahl kopf-nowrap" dataSource={p} scroll={{ x: "max-content" }}
          rowClassName={x => (x.key === "ST" ? "zeile-aktiv" : "")}
          onRow={x => ({ onClick: () => setWahl(x.key), style: { cursor: "pointer" } })}
          columns={[
            { title: "Anlage", dataIndex: "name", fixed: "left", render: (n, x) => <span><Punkt farbe={f[x.farbe]} />{x.key === "ST" ? <b>{n}</b> : n}</span> },
            { title: <Space size={4}><ThunderboltOutlined />Ist bis {MONATE[a.letzter - 1].slice(0, 3)}</Space>, dataIndex: "ytdV", align: "right", render: zahl },
            { title: <Space size={4}><FundProjectionScreenOutlined />Prognose Jahr</Space>, dataIndex: "jahrV", align: "right",
              render: (v, x) => <span><b>{zahl(v)}</b> <Text type="secondary" style={{ fontSize: 12 }}>± {zahl(x.spanne)}</Text></span> },
            { title: <Space size={4}><HistoryOutlined />Jahr {jahr - 1}</Space>, dataIndex: "vjV", align: "right", render: v => (v == null ? "–" : zahl(v)) },
            { title: "Δ Vorjahr", key: "dvj", align: "right", render: (_, x) => (x.vjV ? <BDeltaNeutral v={x.jahrV / x.vjV - 1} /> : "–") },
            { title: <Space size={4}><FundOutlined />EnPI Jahresende</Space>, dataIndex: "enpiJahr", align: "right", render: v => <b>{dez(v, 3)}</b> },
            { title: <Space size={4}><FlagOutlined />EnPI {basisJahr}</Space>, dataIndex: "enpiBasisJahr", align: "right", render: v => dez(v, 3) },
            ...(einst.ziel ? [
              { title: <Space size={4}><AimOutlined />Ziel-EnPI</Space>, dataIndex: "zielJahr", align: "right", render: v => dez(v, 3) },
              { title: <Tooltip title="EnPI, der in den restlichen Monaten im Schnitt erreicht werden muss"><Space size={4}>Nötig ab jetzt<InfoCircleOutlined /></Space></Tooltip>,
                dataIndex: "benoetigt", align: "right", render: v => (v == null ? "–" : v <= 0 ? <Text type="danger">nicht erreichbar</Text> : dez(v, 3)) },
              { title: "Status", dataIndex: "status", align: "center", render: s => (s ? <Tag color={PROGNOSE_STATUS[s].farbe} icon={PROGNOSE_STATUS[s].icon} bordered={false}>{PROGNOSE_STATUS[s].name}</Tag> : "–") }
            ] : []),
            ...(einst.preis ? [{ title: <Space size={4}><EuroOutlined />Kosten Jahr</Space>, dataIndex: "kostenJahr", align: "right", render: v => (v == null ? "–" : `${zahl(v)} €`) }] : []),
            ...(einst.co2 ? [{ title: <Space size={4}><CloudOutlined />CO₂ Jahr (t)</Space>, dataIndex: "co2Jahr", align: "right", render: v => dez(v, 1) }] : [])
          ]} />
      </Card>
    </Flex>
  );
}

// flèche neutre (la consommation qui monte n'est pas forcément mauvaise : plus de production)
// ---------- Simulator « Was wäre wenn » ----------
// Part de la prévision (onglet Prognose) et modifie les mois restants :
//  - quantité par installation (± %) → consommation recalculée avec le modèle de référence (a + b × quantité) × performance actuelle
//  - consommation spécifique (± %) : meilleure ou moins bonne efficacité
//  - mesures prévues du plan d'actions : économie annuelle ÷ 12 à partir du mois choisi
// Quantité du site = quantité prévue × variation des quantités de Presse I, Presse II et UBC.
const SZ_SPEICHER = "mrs-szenarien";
const SZ_LEER = { menge: {}, eff: {}, preis: 0, massnahmen: {} };

function simulieren(prog, sz, massnahmen) {
  if (!prog?.length) return null;
  const st = prog.find(x => x.key === "ST"), rest = st.rest;
  const anlagen = prog.filter(x => x.key !== "ST");
  const aktiv = (massnahmen || []).filter(m => sz.massnahmen?.[m.id] && m.einsparung > 0);
  const einspar = (keys, mo) => aktiv.filter(m => keys.includes(m.anlage) && sz.massnahmen[m.id] <= mo).reduce((s, m) => s + m.einsparung / 12, 0);
  const proMonat = {};
  for (const a of anlagen) {
    const mPct = (sz.menge?.[a.key] ?? 0) / 100, ePct = (sz.eff?.[a.key] ?? 0) / 100;
    proMonat[a.key] = Object.fromEntries(rest.map(mo => {
      const x = a.xRest?.[mo] || 0, y = a.yRest?.[mo] || 0, x2 = x * (1 + mPct);
      let y2 = a.methode === "modell" && a.reg && a.leistung ? Math.max(0, a.reg.a + a.reg.b * x2) * a.leistung : x ? (y * x2) / x : y;
      y2 = Math.max(0, y2 * (1 + ePct) - einspar([a.key], mo));
      return [mo, { x: x2, y: y2 }];
    }));
  }
  const presse = anlagen.filter(a => a.key !== "ME");
  const site = Object.fromEntries(rest.map(mo => {
    const x0 = presse.reduce((t, b) => t + (b.xRest?.[mo] || 0), 0), x1 = presse.reduce((t, b) => t + proMonat[b.key][mo].x, 0);
    return [mo, { xB: st.xRest?.[mo] || 0, yB: st.yRest?.[mo] || 0, x: (st.xRest?.[mo] || 0) * (x0 ? x1 / x0 : 1),
                  y: Math.max(0, anlagen.reduce((t, b) => t + proMonat[b.key][mo].y, 0) - einspar(["ST", "SO"], mo)) }];
  }));
  const zeilen = prog.map(a => {
    const werte = a.key === "ST" ? site : proMonat[a.key];
    const restY = rest.reduce((s, mo) => s + werte[mo].y, 0), restX = rest.reduce((s, mo) => s + werte[mo].x, 0);
    const jahrV = a.ytdV + restY, jahrM = (a.ytdM || 0) + restX;
    const enpi = jahrM > 0 ? (jahrV / jahrM) * a.faktor : null;
    const noetigV = a.zielJahr ? (a.zielJahr / a.faktor) * jahrM - a.ytdV : null;
    return { key: a.key, name: a.name, farbe: a.farbe, treiber: a.treiber, faktor: a.faktor, basisV: a.jahrV, basisEnpi: a.enpiJahr, jahrV, jahrM, enpi, restY,
             zielJahr: a.zielJahr, erreicht: a.zielJahr && enpi != null ? enpi <= a.zielJahr : null,
             noetigPct: noetigV != null && restY > 0 ? noetigV / restY - 1 : null };
  });
  return { rest, letzter: st.letzter, site, zeilen, st: zeilen.find(z => z.key === "ST") };
}

function Simulator({ en, massnahmen, jahr, f, oeffneEinstellungen }) {
  const { message } = AntApp.useApp();
  const [sz, setSz] = useState(SZ_LEER);
  const [name, setName] = useState("");
  const [gespeichert, setGespeichert] = useState(() => { try { return JSON.parse(localStorage.getItem(SZ_SPEICHER)) || []; } catch { return []; } });
  const prog = en.prognose, einst = en.einst || {};
  const kandidaten = useMemo(() => (massnahmen || []).filter(m => (m.status === "geplant" || m.status === "umsetzung") && m.einsparung > 0), [massnahmen]);
  const sim = useMemo(() => simulieren(prog, sz, kandidaten), [prog, sz, kandidaten]);
  const speichernListe = (l) => { setGespeichert(l); try { localStorage.setItem(SZ_SPEICHER, JSON.stringify(l)); } catch { /* sans stockage */ } };

  if (!prog || !sim) return <Card><Skeleton active paragraph={{ rows: 8 }} /></Card>;
  if (!sim.rest.length) return <Card><Result status="info" icon={<ExperimentOutlined />} title={`Das Jahr ${jahr} ist vollständig`}
    subTitle="Der Simulator verändert die Monate, für die noch keine Ist-Werte vorliegen. Wählen Sie oben das laufende Jahr." /></Card>;

  const anlagen = prog.filter(a => a.key !== "ST");
  const st = sim.st, basisSt = prog.find(a => a.key === "ST");
  const geaendert = JSON.stringify(sz) !== JSON.stringify(SZ_LEER);
  const restText = `${MONATE[sim.rest[0] - 1]} – ${MONATE[sim.rest.at(-1) - 1]}`;
  const pz = (v, n = 1) => (v == null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${dez(Math.abs(v) * 100, n)} %`);
  const setze = (feld, key, v) => setSz(s => ({ ...s, [feld]: { ...s[feld], [key]: v } }));
  const startVon = (m) => {
    const ab = sim.rest[0];
    if (!m.frist || dayjs(m.frist).year() !== jahr) return ab;
    return Math.min(12, Math.max(ab, dayjs(m.frist).month() + 2));            // effet le mois qui suit l'échéance
  };
  const preisFaktor = 1 + (sz.preis || 0) / 100;
  const kosten = (v) => (einst.preis ? v * einst.preis : null);
  // effort nécessaire pour l'objectif (site) : appliqué de façon égale à toutes les installations
  const uebernehmen = () => {
    const k = 1 + st.noetigPct;
    setSz(s => ({ ...s, eff: Object.fromEntries(anlagen.map(a => [a.key, Math.max(-50, Math.floor(((1 + (s.eff[a.key] || 0) / 100) * k - 1) * 100))])) }));
  };

  // graphiques : EnPI du site par mois et consommation cumulée
  const rows = en.daten?.aktuell || [];
  let cumIst = 0, cumB = 0, cumS = 0;
  const chart = MONATE.map((m, i) => {
    const mo = i + 1, r = rows.find(x => x.Monat === mo), s = sim.site[mo];
    const istV = r ? verbrauchVon(r, STANDORT) : null, istM = r ? num(r.Gesamtmenge) : 0;
    if (r) { cumIst += istV; cumB = cumIst; cumS = cumIst; }
    if (s) { cumB += s.yB; cumS += s.y; }
    const istEnpi = r && istM ? (istV / istM) * st.faktor : null;
    const bruecke = mo === sim.letzter;
    return { monat: m.slice(0, 3),
      ist: istEnpi, basis: s ? (s.xB ? (s.yB / s.xB) * st.faktor : null) : bruecke ? istEnpi : null, szenario: s ? (s.x ? (s.y / s.x) * st.faktor : null) : bruecke ? istEnpi : null,
      kIst: r ? cumIst : null, kBasis: s || bruecke ? cumB : null, kSzenario: s || bruecke ? cumS : null,
      format: { ist: v => dez(v, 3), basis: v => dez(v, 3), szenario: v => dez(v, 3), kIst: zahl, kBasis: zahl, kSzenario: zahl } };
  });

  const regler = (feld, a, min, max, step, gutWennNegativ) => {
    const v = sz[feld][a.key] ?? 0;
    return (
      <Flex align="center" gap={10}>
        <Slider style={{ flex: 1, margin: "6px 4px" }} min={min} max={max} step={step} value={v} onChange={x => setze(feld, a.key, x)}
          tooltip={{ formatter: x => `${x > 0 ? "+" : ""}${x} %` }} marks={{ 0: " " }} aria-label={`${a.name} ${feld === "menge" ? "Menge" : "spezifischer Verbrauch"}`} />
        <Tag bordered={false} color={!v ? "default" : (v < 0) === gutWennNegativ ? "success" : "error"} style={{ width: 62, textAlign: "center", marginInlineEnd: 0 }}>{v > 0 ? "+" : ""}{v} %</Tag>
      </Flex>
    );
  };

  return (
    <Flex vertical gap={16}>
      <Alert type="info" showIcon icon={<ExperimentOutlined />} className="hinweis"
        message={<><b>Was wäre wenn?</b> Ausgangspunkt ist die Prognose für {restText} {jahr}. Ändern Sie Menge, Effizienz oder Maßnahmen: alle Zahlen rechnen sofort neu. Die Ist-Monate bleiben unverändert.</>} />

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={9}>
          <Card title={<Space><SettingOutlined />Annahmen {restText}</Space>}
            extra={geaendert && <Button size="small" icon={<UndoOutlined />} onClick={() => setSz(SZ_LEER)}>Zurücksetzen</Button>}>
            <Flex vertical gap={18}>
              {anlagen.map(a => (
                <div key={a.key}>
                  <b><Punkt farbe={f[a.farbe]} />{a.name}</b>
                  <Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 6 }}>{a.treiber === "Betriebsstunden" ? "Betriebsstunden" : "Verarbeitete Menge"}</Text>
                  {regler("menge", a, -50, 50, 5, false)}
                  <Text type="secondary" style={{ display: "block", fontSize: 12 }}>Spezifischer Verbrauch (negativ = effizienter)</Text>
                  {regler("eff", a, -50, 30, 1, true)}
                </div>
              ))}
              {einst.preis ? (
                <div><b><EuroOutlined /> Energiepreis</b>
                  <Flex align="center" gap={10}>
                      <Slider style={{ flex: 1, margin: "6px 4px" }} min={-30} max={50} step={5} value={sz.preis || 0} onChange={x => setSz(s => ({ ...s, preis: x }))}
                        tooltip={{ formatter: x => `${x > 0 ? "+" : ""}${x} %` }} marks={{ 0: " " }} aria-label="Energiepreis" />
                      <Tag bordered={false} style={{ width: 62, textAlign: "center", marginInlineEnd: 0 }}>{sz.preis > 0 ? "+" : ""}{sz.preis || 0} %</Tag>
                    </Flex>
                  <Text type="secondary" style={{ fontSize: 12 }}>heute {dez(einst.preis, 4)} € je Einheit</Text>
                </div>
              ) : null}
              <div>
                <b><ProjectOutlined /> Geplante Maßnahmen</b>
                {!kandidaten.length ? <Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 4 }}>Keine offenen Maßnahmen mit erwarteter Einsparung im Maßnahmenplan.</Text> : (
                  <Flex vertical gap={6} style={{ marginTop: 6 }}>
                    {kandidaten.map(m => {
                      const an = sz.massnahmen[m.id];
                      return (
                        <Flex key={m.id} align="center" gap={8} className="w-karte" style={{ padding: "6px 10px" }}>
                          <Checkbox checked={!!an} onChange={e => setSz(s => ({ ...s, massnahmen: { ...s.massnahmen, [m.id]: e.target.checked ? startVon(m) : undefined } }))} />
                          <Flex vertical style={{ flex: 1, minWidth: 0 }}>
                            <Text ellipsis={{ tooltip: m.titel }}>{m.titel}</Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>{ANLAGE_NAME[m.anlage]}, −{zahl(m.einsparung)} / Jahr</Text>
                          </Flex>
                          {an && <Select size="small" value={an} onChange={v => setSz(s => ({ ...s, massnahmen: { ...s.massnahmen, [m.id]: v } }))} style={{ width: 92 }}
                            aria-label="Wirksam ab" options={sim.rest.map(mo => ({ value: mo, label: `ab ${MONATE[mo - 1].slice(0, 3)}` }))} />}
                        </Flex>
                      );
                    })}
                  </Flex>
                )}
              </div>
              <div>
                <b><DatabaseOutlined /> Szenarien</b>
                <Space.Compact style={{ width: "100%", marginTop: 6 }}>
                  <Input placeholder="Name, z. B. Mehr UBC" value={name} maxLength={40} onChange={e => setName(e.target.value)} />
                  <Button icon={<CheckOutlined />} disabled={!name.trim() || !geaendert}
                    onClick={() => { speichernListe([{ name: name.trim(), sz }, ...gespeichert.filter(x => x.name !== name.trim())].slice(0, 12)); setName(""); message.success("Szenario gespeichert"); }}>Speichern</Button>
                </Space.Compact>
                {gespeichert.length > 0 && (
                  <Flex wrap gap={6} style={{ marginTop: 8 }}>
                    {gespeichert.map(x => (
                      <Tag key={x.name} closable style={{ cursor: "pointer", padding: "2px 8px" }} color={JSON.stringify(x.sz) === JSON.stringify(sz) ? "blue" : undefined}
                        onClick={() => setSz({ ...SZ_LEER, ...x.sz })} onClose={(e) => { e.preventDefault(); speichernListe(gespeichert.filter(y => y.name !== x.name)); }}>{x.name}</Tag>
                    ))}
                  </Flex>
                )}
                <Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 6 }}>Szenarien werden in diesem Browser gespeichert.</Text>
              </div>
            </Flex>
          </Card>
        </Col>

        <Col xs={24} xl={15}>
          <Flex vertical gap={16}>
            <Row gutter={[16, 16]}>
              <Kpi titel={`Verbrauch ${jahr}`} icon={<ThunderboltOutlined />} value={st.jahrV} formatter={zahl}>
                <Text type="secondary">{geaendert ? <><Delta v={st.basisV ? st.jahrV / st.basisV - 1 : null} /> ggü. Prognose</> : "Prognose ohne Änderung"}</Text>
              </Kpi>
              <Kpi titel="EnPI Jahresende" icon={<FundOutlined />} value={st.enpi ?? "–"} formatter={v => dez(v, 3)}>
                <Text type="secondary">Prognose: {dez(st.basisEnpi, 3)}</Text>
              </Kpi>
              <Kpi titel="Energieziel" icon={<AimOutlined />} value={st.zielJahr == null ? "kein Ziel" : st.erreicht ? "erreicht" : "verfehlt"}
                valueStyle={{ fontSize: 22, color: st.zielJahr == null ? undefined : st.erreicht ? "#2F9E8F" : "#CF4B3B" }}>
                {st.zielJahr == null ? <Button type="link" size="small" icon={<SettingOutlined />} onClick={oeffneEinstellungen} style={{ padding: 0 }}>Ziel festlegen</Button>
                  : <Text type="secondary">Ziel-EnPI {dez(st.zielJahr, 3)}</Text>}
              </Kpi>
              <Kpi titel={einst.preis ? "Energiekosten Jahr" : "CO₂ Jahr"} icon={einst.preis ? <EuroOutlined /> : <CloudOutlined />}
                value={einst.preis ? st.jahrV * einst.preis * preisFaktor : einst.co2 ? (st.jahrV * einst.co2) / 1000 : "–"}
                formatter={v => (typeof v !== "number" ? v : einst.preis ? `${zahl(v)} €` : `${dez(v, 1)} t`)}>
                {einst.preis ? <Text type="secondary">{geaendert ? `${(st.jahrV * preisFaktor - st.basisV) >= 0 ? "+" : "−"}${zahl(Math.abs(kosten(st.jahrV * preisFaktor - st.basisV)))} € ggü. Prognose` : "Prognose ohne Änderung"}</Text>
                  : !einst.co2 ? <Button type="link" size="small" icon={<SettingOutlined />} onClick={oeffneEinstellungen} style={{ padding: 0 }}>Preis oder CO₂-Faktor eintragen</Button> : null}
              </Kpi>
            </Row>

            {st.zielJahr != null && st.noetigPct != null && (
              st.noetigPct >= 0
                ? <Alert type="success" showIcon message={`Mit diesen Annahmen wird das Energieziel erreicht.`}
                    description={`Reserve: der Verbrauch in ${restText} dürfte noch um ${dez(st.noetigPct * 100, 1)} % höher sein.`} />
                : st.noetigPct <= -0.99
                  ? <Alert type="error" showIcon message="Das Ziel ist mit den restlichen Monaten nicht mehr erreichbar." />
                  : <Alert type="warning" showIcon message={`Für das Ziel muss der Verbrauch in ${restText} um ${dez(-st.noetigPct * 100, 1)} % niedriger sein als in diesem Szenario.`}
                      action={<Button size="small" onClick={uebernehmen}>Als Effizienz übernehmen</Button>} />
            )}

            <Row gutter={[16, 16]}>
              <Col xs={24} lg={12}>
                <Card title={<Space><LineChartOutlined />EnPI Standort je Monat</Space>} style={{ height: "100%" }}>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={chart} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke={f.gitter} />
                      <XAxis dataKey="monat" tickLine={false} axisLine={false} tick={{ fill: f.text, fontSize: 12 }} />
                      <YAxis tickFormatter={v => dez(v, 2)} tickLine={false} axisLine={false} width={56} tick={{ fill: f.text, fontSize: 12 }} domain={["auto", "auto"]} />
                      <ChartTooltip content={<EnergieTooltip />} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 13, color: f.text }} />
                      {st.zielJahr && <ReferenceLine y={st.zielJahr} stroke="#2F9E8F" strokeDasharray="4 4" label={{ value: "Ziel", position: "insideTopRight", fill: "#2F9E8F", fontSize: 12 }} />}
                      <Line dataKey="ist" name="Ist" stroke={f.linie} strokeWidth={3} dot={{ r: 3 }} type="monotone" connectNulls={false} />
                      <Line dataKey="basis" name="Prognose" stroke={f.vorjahr} strokeWidth={2} strokeDasharray="5 5" dot={false} type="monotone" />
                      <Line dataKey="szenario" name="Szenario" stroke={f.ubc} strokeWidth={3} dot={{ r: 3 }} type="monotone" />
                    </LineChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card title={<Space><StockOutlined />Kumulierter Verbrauch</Space>} style={{ height: "100%" }}>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={chart} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke={f.gitter} />
                      <XAxis dataKey="monat" tickLine={false} axisLine={false} tick={{ fill: f.text, fontSize: 12 }} />
                      <YAxis tickFormatter={kurz} tickLine={false} axisLine={false} width={72} tick={{ fill: f.text, fontSize: 12 }} />
                      <ChartTooltip content={<EnergieTooltip />} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 13, color: f.text }} />
                      <Line dataKey="kIst" name="Ist" stroke={f.linie} strokeWidth={3} dot={false} type="monotone" />
                      <Line dataKey="kBasis" name="Prognose" stroke={f.vorjahr} strokeWidth={2} strokeDasharray="5 5" dot={false} type="monotone" />
                      <Line dataKey="kSzenario" name="Szenario" stroke={f.ubc} strokeWidth={3} dot={false} type="monotone" />
                    </LineChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
            </Row>

            <Card title={<Space><AppstoreOutlined />Ergebnis je Anlage</Space>} styles={{ body: { padding: 0 } }}>
              <Table rowKey="key" size="middle" pagination={false} className="zahl kopf-nowrap" dataSource={sim.zeilen} scroll={{ x: "max-content" }}
                rowClassName={x => (x.key === "ST" ? "zeile-aktiv" : "")}
                columns={[
                  { title: "Anlage", dataIndex: "name", fixed: "left", render: (n, x) => <span><Punkt farbe={f[x.farbe]} />{x.key === "ST" ? <b>{n}</b> : n}</span> },
                  { title: "Verbrauch Prognose", dataIndex: "basisV", align: "right", render: zahl },
                  { title: "Verbrauch Szenario", dataIndex: "jahrV", align: "right", render: v => <b>{zahl(v)}</b> },
                  { title: "Δ", key: "dv", align: "right", render: (_, x) => <Delta v={x.basisV ? x.jahrV / x.basisV - 1 : null} /> },
                  { title: "EnPI Prognose", dataIndex: "basisEnpi", align: "right", render: v => dez(v, 3) },
                  { title: "EnPI Szenario", dataIndex: "enpi", align: "right", render: v => <b>{dez(v, 3)}</b> },
                  ...(einst.ziel ? [
                    { title: "Ziel-EnPI", dataIndex: "zielJahr", align: "right", render: v => dez(v, 3) },
                    { title: "Ziel", dataIndex: "erreicht", align: "center", render: e => e == null ? "–"
                        : e ? <Tag color="success" bordered={false} icon={<CheckCircleOutlined />}>erreicht</Tag> : <Tag color="error" bordered={false} icon={<CloseCircleOutlined />}>verfehlt</Tag> }
                  ] : [])
                ]} />
            </Card>
            <Text type="secondary" style={{ fontSize: 12 }}>
              <InfoCircleOutlined /> Verbrauch bei geänderter Menge über das Baseline-Modell (Grundlast + Anteil je Menge) mit der bisherigen Leistung des Jahres; ohne belastbares Modell proportional zur Menge.
              Maßnahmen wirken mit einem Zwölftel ihrer erwarteten Jahreseinsparung je Monat. Eine Hochrechnung, keine Garantie.
            </Text>
          </Flex>
        </Col>
      </Row>
    </Flex>
  );
}

const BDeltaNeutral = ({ v }) => v == null ? "–" : <Text type="secondary" style={{ whiteSpace: "nowrap" }}>{v > 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {prozent(Math.abs(v))}</Text>;

// --- Page Energie : onglets + réglages ---
function Energie({ jahr, dunkel, en, darf, massnahmen }) {
  const { message } = AntApp.useApp();
  const { daten, jahreSeu, fehler, einst, setEinst, basisJahr, kpi } = en;
  const [sichtbar, setSichtbar] = useState(["P1", "P2", "UB"]);
  const [tab, setTab] = useState("ueberblick");
  const [einstOffen, setEinstOffen] = useState(false);
  const [form] = Form.useForm();
  const f = farben(dunkel);
  const ANLAGEN = [
    { key: "P1", name: "Presse I", farbe: f.p1, v: "P1_Verbrauch", m: "P1_Verarbeitung", w: "P1_Wert" },
    { key: "P2", name: "Presse II", farbe: f.p2, v: "P2_Verbrauch", m: "P2_Verarbeitung", w: "P2_Wert" },
    { key: "UB", name: "UBC-Aufbereitung", farbe: f.ubc, v: "UB_Verbrauch", m: "UB_Verarbeitung", w: "UB_Wert" },
    { key: "ME", name: "ME", farbe: f.me, v: "ME_Verbrauch", m: null, w: "ME_Wert" }
  ];

  const k = useMemo(() => {
    if (!daten?.aktuell.length) return null;
    const rows = daten.aktuell;
    const pro = ANLAGEN.map(a => ({ ...a, summe: summe(rows, a.v) }));
    // Contrôle : Wert = Verbrauch ÷ Verarbeitung (× facteur constant) ?
    const pruefung = ANLAGEN.filter(a => a.m).map(a => {
      const fakt = rows.filter(r => r[a.m] && r[a.v] && r[a.w]).map(r => r[a.w] / (r[a.v] / r[a.m]));
      if (!fakt.length) return { anlage: a.name, status: "leer" };
      const mw = fakt.reduce((s, x) => s + x, 0) / fakt.length;
      return { anlage: a.name, status: fakt.every(x => Math.abs(x / mw - 1) < 0.01) ? "ok" : "abweichend", faktor: mw };
    });
    return { rows, pro, gesamt: pro.reduce((s, a) => s + a.summe, 0), menge: summe(rows, "Gesamtmenge"),
             stunden: summe(rows, "ME_Stunden"), groesster: [...pro].sort((a, b) => b.summe - a.summe)[0], pruefung };
  }, [daten]); // eslint-disable-line react-hooks/exhaustive-deps

  if (fehler) return <Alert type="error" showIcon message="Energiedaten konnten nicht geladen werden" description={fehler} />;
  if (!daten) return <Card><Skeleton active paragraph={{ rows: 8 }} /></Card>;
  if (!k) return <Card><Empty description={`In der Tabelle SEUWerte gibt es keine Daten für ${jahr}.`} /></Card>;

  const zeitraum = k.rows.length === 12 ? `Jahr ${jahr}` : `${monatName(k.rows[0])} – ${monatName(k.rows.at(-1))} ${jahr}`;
  const oeffneEinstellungen = () => { form.setFieldsValue({ basisJahr, ziel: einst.ziel ?? null, co2: einst.co2 ?? null, preis: einst.preis ?? null }); setEinstOffen(true); };
  const warten = <Card><Skeleton active paragraph={{ rows: 8 }} /></Card>;

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="flex-end" wrap gap={12}>
        <Kopf titel={`Energie (SEU) ${zeitraum}`} text="Wesentliche Energieeinsätze und Energieleistungskennzahlen nach ISO 50001, Tabelle SEUWerte" />
        <Space wrap>
          <Tag icon={<FlagOutlined />} bordered={false} style={{ padding: "4px 10px" }}>Basisjahr {basisJahr}</Tag>
          {einst.ziel ? <Tag icon={<AimOutlined />} color="blue" bordered={false} style={{ padding: "4px 10px" }}>Ziel −{dez(einst.ziel, 1)} % EnPI</Tag> : null}
          <Button icon={<SettingOutlined />} onClick={oeffneEinstellungen}>Einstellungen</Button>
        </Space>
      </Flex>

      <Tabs activeKey={tab} onChange={setTab} items={[
        { key: "ueberblick", label: <Space><DashboardOutlined />Überblick</Space>,
          children: <EnergieUeberblick k={k} jahr={jahr} f={f} ANLAGEN={ANLAGEN} sichtbar={sichtbar} setSichtbar={setSichtbar} /> },
        { key: "seu", label: <Space><PieChartOutlined />SEU-Bewertung</Space>, children: kpi ? <SeuBewertung m={kpi} f={f} /> : warten },
        { key: "enpi", label: <Space><FundOutlined />EnPI &amp; Baseline</Space>,
          children: kpi ? <EnpiBaseline m={kpi} f={f} jahr={jahr} basisJahr={basisJahr} /> : warten },
        { key: "prognose", label: <Space><FundProjectionScreenOutlined />Prognose</Space>,
          children: kpi ? <Prognose p={en.prognose} f={f} jahr={jahr} einst={einst} basisJahr={basisJahr} oeffneEinstellungen={oeffneEinstellungen} /> : warten },
        { key: "simulator", label: <Space><ExperimentOutlined />Was wäre wenn?</Space>,
          children: kpi ? <Simulator en={en} massnahmen={massnahmen} jahr={jahr} f={f} oeffneEinstellungen={oeffneEinstellungen} /> : warten },
        { key: "cockpit", label: <Space><AppstoreOutlined />KPI-Cockpit</Space>,
          children: kpi ? <KpiCockpit m={kpi} f={f} einst={einst} jahr={jahr} basisJahr={basisJahr} oeffneEinstellungen={oeffneEinstellungen} /> : warten }
      ]} />

      <Drawer open={einstOffen} onClose={() => setEinstOffen(false)} width={460} title={<Space><SettingOutlined />Einstellungen Energie</Space>}
        footer={<Flex justify="flex-end"><Space>
          <Button onClick={() => setEinstOffen(false)}>Abbrechen</Button>
          <Button type="primary" icon={<CheckCircleOutlined />} disabled={!darf}
            onClick={() => form.validateFields().then(w => setEinst(w)).then(() => { setEinstOffen(false); message.success("Einstellungen für alle Benutzer gespeichert"); }).catch(e => e?.message && message.error(e.message, 6))}>Übernehmen</Button>
        </Space></Flex>}>
        <Form form={form} layout="vertical">
          <Form.Item name="basisJahr" label={<Space size={6}><FlagOutlined />Basisjahr (Energetische Ausgangsbasis)</Space>}
            extra="Referenzjahr für EnPI-Vergleich, Regression und CUSUM. Muss vor dem gewählten Jahr liegen.">
            <Select options={jahreSeu.filter(j => j < jahr).map(j => ({ value: j, label: String(j) }))} placeholder={String(jahr - 1)} />
          </Form.Item>
          <Form.Item name="ziel" label={<Space size={6}><AimOutlined />Ziel: Verbesserung des EnPI</Space>} extra="Leer lassen, wenn kein Ziel festgelegt ist.">
            <InputNumber min={0} max={50} step={0.5} decimalSeparator="," style={{ width: "100%" }} suffix="% ggü. Basisjahr" />
          </Form.Item>
          <Form.Item name="co2" label={<Space size={6}><CloudOutlined />CO₂-Emissionsfaktor</Space>} extra="Aus Stromvertrag oder Rechnung (z. B. kg CO₂ je kWh). Leer = keine CO₂-Werte.">
            <InputNumber min={0} step={0.01} decimalSeparator="," style={{ width: "100%" }} suffix="kg je Verbrauchseinheit" />
          </Form.Item>
          <Form.Item name="preis" label={<Space size={6}><EuroOutlined />Energiepreis</Space>} extra="Durchschnittlicher Preis je Verbrauchseinheit. Leer = keine Kosten.">
            <InputNumber min={0} step={0.01} decimalSeparator="," style={{ width: "100%" }} suffix="€ je Verbrauchseinheit" />
          </Form.Item>
        </Form>
        <Alert type={darf ? "info" : "warning"} showIcon message={darf ? "Die Einstellungen gelten für alle Benutzer und für die E-Mail-Berichte." : "Nur Bearbeiter und Administratoren können die Einstellungen ändern."} />
      </Drawer>
    </Flex>
  );
}

// ---------- SEU-KPI (tables KeyPerformanceIndicators(Month) + KPIType) ----------
// KPI d'une période = Σ Zähler ÷ Σ Nenner (pondéré), mis à l'échelle comme la colonne KPI de la base.
// Si la colonne KPI ne correspond pas à Zähler ÷ Nenner, on prend la moyenne des valeurs KPI.
function kpiFaktoren(zeilen) {
  const proTyp = {};
  for (const z of zeilen) if (z.zaehler && z.nenner && z.kpi) (proTyp[z.typ] ||= []).push(z.kpi / (z.zaehler / z.nenner));
  return Object.fromEntries(Object.entries(proTyp).map(([t, f]) => {
    const mi = durchschnitt(f);
    if (!f.every(x => Math.abs(x / mi - 1) < 0.01)) return [t, null];
    const p = 10 ** Math.round(Math.log10(mi));
    return [t, Math.abs(mi / p - 1) < 0.01 ? p : mi];
  }));
}
function kpiWert(zeilen, faktor) {
  if (!zeilen.length) return null;
  const z = zeilen.reduce((s, x) => s + (x.zaehler || 0), 0);
  // un dénominateur commun à plusieurs SEU dans le même mois (ex. Gesamtmenge) n'est compté qu'une fois
  const proMonat = {};
  for (const x of zeilen) (proMonat[`${x.jahr}-${x.monat}`] ||= []).push(x.nenner || 0);
  const n = Object.values(proMonat).reduce((s, ns) => s + (ns.length > 1 && ns.every(v => Math.abs(v - ns[0]) < 1e-9) ? ns[0] : ns.reduce((a, b) => a + b, 0)), 0);
  if (faktor != null && n) return (z / n) * faktor;
  const k = zeilen.map(x => x.kpi).filter(x => x != null);
  return k.length ? durchschnitt(k) : null;
}
const aenderung = (neu, alt) => (neu != null && alt ? (neu - alt) / Math.abs(alt) : null);

// flèche neutre : le sens « bon » dépend du KPI
const Trend = ({ v, klein }) => v == null ? <Text type="secondary">–</Text> : (
  <Text style={{ whiteSpace: "nowrap", fontSize: klein ? 12 : undefined }} type="secondary">
    {v > 0.0005 ? <ArrowUpOutlined /> : v < -0.0005 ? <ArrowDownOutlined /> : <MinusCircleOutlined />} {prozent(Math.abs(v))}
  </Text>
);

function SeuKpi({ jahr: globalJahr, dunkel }) {
  // année propre à cette page : les tables KPI ne couvrent pas forcément les mêmes années que la production
  const [jahr, setJahr] = useState(globalJahr);
  useEffect(() => { if (globalJahr) setJahr(globalJahr); }, [globalJahr]);
  const [quelle, setQuelle] = useState("berechnet");
  const [daten, setDaten] = useState(null);
  const [fehler, setFehler] = useState("");
  const [monat, setMonat] = useState(null);
  const [seuWahl, setSeuWahl] = useState([]);
  const [typ, setTyp] = useState(null);
  const [diagramm, setDiagramm] = useState("verlauf");
  const f = farben(dunkel);
  const palette = PALETTE(f);

  useEffect(() => {
    if (!jahr) return;
    setDaten(null); setFehler("");
    api(`/api/kpi?jahr=${jahr}&quelle=${quelle}`).then(setDaten).catch(e => setFehler(e.message));
  }, [jahr, quelle]);

  // premier type de KPI présent dans les données + toutes les SEU
  // année sans données dans cette table → on passe à la plus récente
  useEffect(() => {
    if (daten && daten.jahr === jahr && daten.jahre.length && !daten.jahre.includes(jahr)) setJahr(daten.jahre[0]);
  }, [daten]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!daten) return;
    const vorhanden = daten.typen.filter(t => daten.zeilen.some(z => z.typ === t.id && z.jahr === jahr));
    setTyp(t => (vorhanden.some(x => x.id === t) ? t : vorhanden[0]?.id ?? daten.typen[0]?.id ?? null));
    setSeuWahl(w => w.filter(id => daten.seus.some(s => s.id === id)));
  }, [daten]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = useMemo(() => {
    if (!daten) return null;
    const seus = seuWahl.length ? daten.seus.filter(s => seuWahl.includes(s.id)) : daten.seus;
    const seuIds = new Set(seus.map(s => s.id));
    const passt = (z) => seuIds.has(z.seu) && (!monat || z.monat === monat);
    const akt = daten.zeilen.filter(z => z.jahr === jahr && passt(z));
    const vj = daten.zeilen.filter(z => z.jahr === jahr - 1 && passt(z));
    const faktor = kpiFaktoren(daten.zeilen);
    const typen = daten.typen.filter(t => daten.zeilen.some(z => z.typ === t.id));
    // lignes à agréger pour « toutes les SEU » : la ligne « Standort gesamt » si elle existe pour ce type,
    // sinon les SEU individuelles (sans double comptage du total)
    const gesamtIds = new Set(daten.seus.filter(s => s.gesamt).map(s => s.id));
    const fuer = (rows, typId, seuId) => {
      const r = rows.filter(z => z.typ === typId);
      if (seuId != null) return r.filter(z => z.seu === seuId);
      const total = r.filter(z => gesamtIds.has(z.seu));
      return total.length ? total : r.filter(z => !gesamtIds.has(z.seu));
    };
    // valeur pondérée + comparaison avec les mêmes mois de l'année précédente
    const wert = (typId, seuId = null) => {
      const a = fuer(akt, typId, seuId);
      const monate = new Set(a.map(z => z.monat));
      const v = fuer(vj, typId, seuId).filter(z => monate.has(z.monat));
      const jetzt = kpiWert(a, faktor[typId]), vorher = kpiWert(v, faktor[typId]);
      return { jetzt, vorher, delta: aenderung(jetzt, vorher), n: a.length };
    };
    return { seus, akt, vj, faktor, typen, wert, fuer };
  }, [daten, seuWahl, monat, jahr]);

  if (fehler) return <Alert type="error" showIcon message="KPI-Daten konnten nicht geladen werden" description={fehler} />;
  if (!daten || !m) return <Card><Skeleton active paragraph={{ rows: 10 }} /></Card>;

  const typName = (id) => daten.typen.find(t => t.id === id)?.name ?? `KPI-Typ ${id}`;
  const seuName = (id) => daten.seus.find(s => s.id === id)?.name ?? `SEU ${id}`;
  const seuFarbe = (id) => palette[Math.max(0, daten.seus.findIndex(s => s.id === id)) % palette.length];
  const t = typ ?? m.typen[0]?.id;
  const aktiv = m.typen.find(x => x.id === t);
  const zeitraum = monat ? `${MONATE[monat - 1]} ${jahr}` : `Jahr ${jahr}`;

  // --- données des graphiques pour le type choisi ---
  const monate = monat ? [monat] : MONATE.map((_, i) => i + 1);
  const proMonat = (rows, mo, seuId) => kpiWert(m.fuer(rows, t, seuId ?? null).filter(z => z.monat === mo), m.faktor[t]);
  const verlauf = monate.map(mo => ({ monat: MONATE[mo - 1].slice(0, 3), ...Object.fromEntries(m.seus.map(s => [`s${s.id}`, proMonat(m.akt, mo, s.id)])) }));
  const vergleich = monate.map(mo => ({ monat: MONATE[mo - 1].slice(0, 3), aktuell: proMonat(m.akt, mo), vorjahr: proMonat(m.vj, mo) }));
  const zn = monate.map(mo => {
    const r = m.fuer(m.akt, t, null).filter(z => z.monat === mo);
    const nn = r.map(z => z.nenner || 0);
    return { monat: MONATE[mo - 1].slice(0, 3), zaehler: r.length ? r.reduce((s, z) => s + (z.zaehler || 0), 0) : null,
             nenner: r.length ? (nn.every(v => v === nn[0]) ? nn[0] : nn.reduce((a, b) => a + b, 0)) : null, kpi: proMonat(m.akt, mo),
             format: { zaehler: wert, nenner: wert, kpi: v => dez(v, 3) } };
  });
  const DIAGRAMME = [
    { value: "verlauf", icon: <LineChartOutlined />, label: "Verlauf je SEU" },
    { value: "vorjahr", icon: <HistoryOutlined />, label: "Vorjahr" },
    { value: "zn", icon: <BarChartOutlined />, label: "Zähler & Nenner" }
  ];

  // --- tableau détaillé ---
  const einzel = m.akt.filter(z => z.typ === t)
    .map((z, i) => {
      const fk = m.faktor[z.typ];
      const soll = fk != null && z.zaehler && z.nenner ? (z.zaehler / z.nenner) * fk : null;
      return { ...z, key: i, seuName: seuName(z.seu), typName: typName(z.typ),
               pruefung: soll == null || z.kpi == null ? null : Math.abs(z.kpi - soll) <= Math.max(0.0015, Math.abs(soll) * 0.01) };
    }).sort((a, b) => a.monat - b.monat || a.seu - b.seu);

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="flex-end" wrap gap={12}>
        <Kopf titel={`SEU-Kennzahlen ${zeitraum}`} text={quelle === "berechnet"
          ? "KPI der wesentlichen Energieeinsätze, direkt berechnet aus der Tabelle SEUWerte"
          : `KPI der wesentlichen Energieeinsätze, Tabelle ${daten.tabelle} mit KPIType`} />
        <Segmented value={quelle} onChange={setQuelle} options={[
          { value: "berechnet", label: <Tooltip title="Direkt aus dbo.SEUWerte berechnet">Berechnet</Tooltip>, icon: <ExperimentOutlined /> },
          { value: "monat", label: <Tooltip title="dbo.KeyPerformanceIndicatorsMonth">Monatswerte</Tooltip>, icon: <CalendarOutlined /> },
          { value: "gesamt", label: <Tooltip title="dbo.KeyPerformanceIndicators">KPI-Tabelle</Tooltip>, icon: <DatabaseOutlined /> }]} />
      </Flex>

      <Flex gap={8} wrap align="center" className="filter-leiste">
        <Text strong><FilterOutlined /> Filter</Text>
        <Select value={jahr} onChange={setJahr} style={{ width: 130 }} prefix={<CalendarOutlined />} aria-label="Jahr"
          options={daten.jahre.map(j => ({ value: j, label: String(j) }))} />
        <Select value={monat ?? 0} onChange={v => setMonat(v || null)} style={{ width: 170 }} prefix={<ScheduleOutlined />} aria-label="Monat"
          options={[{ value: 0, label: "Alle Monate" }, ...MONATE.map((x, i) => ({ value: i + 1, label: x }))]} />
        <Select mode="multiple" value={seuWahl} onChange={setSeuWahl} placeholder="Alle SEU" allowClear maxTagCount="responsive"
          prefix={<ThunderboltOutlined />} style={{ minWidth: 260, flex: 1, maxWidth: 520 }} aria-label="SEU"
          options={daten.seus.map(s => ({ value: s.id, label: s.name }))} />
        {(monat || seuWahl.length > 0) && <Button icon={<UndoOutlined />} onClick={() => { setMonat(null); setSeuWahl([]); }}>Zurücksetzen</Button>}
        <Text type="secondary" style={{ fontSize: 12, marginLeft: "auto" }}>
          <DatabaseOutlined /> Daten vorhanden: {daten.jahre.length ? `${Math.min(...daten.jahre)}–${Math.max(...daten.jahre)}` : "keine"}
        </Text>
      </Flex>

      {quelle === "berechnet" && (
        <Collapse size="small" items={[{ key: "f", label: <Space><FunctionOutlined /><b>So werden die KPI berechnet</b><Text type="secondary">(Tabelle SEUWerte, je Monat)</Text></Space>,
          children: (
            <Flex vertical gap={6}>
              <Text><FundOutlined /> <b>Spezifischer Energieverbrauch (EnPI)</b> = Verbrauch ÷ Bezugsgröße. Presse I/II und UBC: Verarbeitung, ME: Betriebsstunden, Standort: Gesamtmenge. Skaliert wie die Spalten *_Wert.</Text>
              <Text><PieChartOutlined /> <b>Anteil am Gesamtverbrauch</b> = Verbrauch der Anlage ÷ Verbrauch aller vier Anlagen × 100.</Text>
              <Text><ThunderboltOutlined /> <b>Verbrauch je Gesamtmenge</b> = Verbrauch der Anlage ÷ Gesamtmenge des Standorts.</Text>
              <Text><FieldTimeOutlined /> <b>Durchsatz je ME-Stunde</b> = Gesamtmenge ÷ ME_Stunden.</Text>
              <Text><HistoryOutlined /> <b>Δ Vorjahresmonat</b> = Veränderung des KPI gegenüber dem gleichen Monat des Vorjahres.</Text>
              <Text type="secondary"><InfoCircleOutlined /> Über mehrere Monate immer gewichtet: Σ Zähler ÷ Σ Nenner, nicht der Mittelwert der Monatswerte.</Text>
            </Flex>
          ) }]} />
      )}

      {!daten.namenQuelle && (
        <Alert type="info" showIcon className="hinweis" message="Keine Tabelle dbo.SignificantEnergyUsers gefunden: die SEU werden mit ihrer Nummer angezeigt." />
      )}

      {!m.akt.length ? (
        <Card>
          <Empty image={<FundOutlined style={{ fontSize: 48, opacity: .4 }} />} description={`Keine KPI-Werte für ${zeitraum} in ${daten.tabelle}${seuWahl.length ? " mit den gewählten SEU" : ""}.`}>
            {(() => {
              const vorhanden = [...new Set(daten.zeilen.filter(z => z.jahr === jahr).map(z => z.monat))].filter(Boolean).sort((a, b) => a - b);
              return (
                <Flex vertical gap={10} align="center">
                  {vorhanden.length > 0 ? (
                    <Space wrap style={{ justifyContent: "center" }}>
                      <Text type="secondary"><ScheduleOutlined /> Monate mit Werten in {jahr}:</Text>
                      {vorhanden.map(mo => <Tag key={mo} color="blue" style={{ cursor: "pointer" }} onClick={() => setMonat(mo)}>{MONATE[mo - 1]}</Tag>)}
                    </Space>
                  ) : <Text type="secondary">In {jahr} gibt es in dieser Tabelle keine Werte.</Text>}
                  {daten.jahre.length > 0 && (
                    <Space wrap style={{ justifyContent: "center" }}>
                      <Text type="secondary"><CalendarOutlined /> Jahre mit Werten:</Text>
                      {daten.jahre.map(j => <Tag key={j} style={{ cursor: "pointer" }} onClick={() => { setJahr(j); setMonat(null); }}>{j}</Tag>)}
                    </Space>
                  )}
                  {(monat || seuWahl.length > 0) && <Button icon={<UndoOutlined />} onClick={() => { setMonat(null); setSeuWahl([]); }}>Filter zurücksetzen</Button>}
                </Flex>
              );
            })()}
          </Empty>
        </Card>
      ) : (
        <>
          {/* une carte par type de KPI : cliquer pour l'afficher dans le graphique */}
          <Row gutter={[16, 16]}>
            {m.typen.map((x, i) => {
              const w = m.wert(x.id);
              const gewaehlt = x.id === t;
              return (
                <Col key={x.id} xs={24} sm={12} xl={6}>
                  <Card className="kpi" hoverable onClick={() => setTyp(x.id)}
                    style={{ height: "100%", borderColor: gewaehlt ? palette[i % palette.length] : undefined, boxShadow: gewaehlt ? `inset 0 3px 0 ${palette[i % palette.length]}` : undefined }}>
                    <Statistic title={<Space><FundOutlined style={{ color: palette[i % palette.length] }} />{x.name}</Space>}
                      value={w.jetzt ?? "–"} formatter={v => (typeof v === "number" ? dez(v, 3) : v)} />
                    <Space size={6} wrap>
                      <Trend v={w.delta} /><Text type="secondary">ggü. {jahr - 1}</Text>
                      {gewaehlt && <Tag color="blue" bordered={false} icon={<AimOutlined />}>im Diagramm</Tag>}
                    </Space>
                  </Card>
                </Col>
              );
            })}
          </Row>

          <Card title={<Space>{DIAGRAMME.find(d => d.value === diagramm)?.icon}{aktiv?.name ?? "KPI"}: {DIAGRAMME.find(d => d.value === diagramm)?.label}</Space>}
            extra={<Segmented value={diagramm} onChange={setDiagramm} options={DIAGRAMME} />}>
            <Flex gap={8} wrap align="center" style={{ marginBottom: 12 }}>
              <Select value={t} onChange={setTyp} prefix={<FundOutlined />} style={{ minWidth: 260 }} aria-label="KPI-Typ"
                options={m.typen.map(x => ({ value: x.id, label: x.name }))} />
              {m.faktor[t] == null
                ? <Tooltip title="Die Spalte KPI entspricht nicht immer Zähler ÷ Nenner: Zeiträume werden als Mittelwert der KPI-Werte berechnet.">
                    <Tag color="warning" icon={<AlertOutlined />} bordered={false}>Mittelwert</Tag></Tooltip>
                : <Tooltip title={`KPI = Zähler ÷ Nenner${m.faktor[t] !== 1 ? ` × ${dez(m.faktor[t])}` : ""}, über Zeiträume gewichtet`}>
                    <Tag color="success" icon={<CheckCircleOutlined />} bordered={false}>gewichtet</Tag></Tooltip>}
            </Flex>
            {diagramm === "verlauf" && (
              <Linien data={verlauf} f={f} hoehe={320} format={v => dez(v, 3)}
                reihen={m.seus.map(s => ({ key: `s${s.id}`, name: s.name, farbe: seuFarbe(s.id) }))} />
            )}
            {diagramm === "vorjahr" && (
              <Linien data={vergleich} f={f} hoehe={320} format={v => dez(v, 3)} reihen={[
                { key: "aktuell", name: String(jahr), farbe: f.linie, dicke: 3 },
                { key: "vorjahr", name: String(jahr - 1), farbe: f.vorjahr, gestrichelt: true, dicke: 2 }]} />
            )}
            {diagramm === "zn" && (
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={zn} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={f.gitter} />
                  <XAxis dataKey="monat" tickLine={false} axisLine={false} tick={{ fill: f.text, fontSize: 12 }} />
                  <YAxis yAxisId="w" tickFormatter={kurz} tickLine={false} axisLine={false} width={72} tick={{ fill: f.text, fontSize: 12 }} />
                  <YAxis yAxisId="k" orientation="right" tickFormatter={v => dez(v, 2)} tickLine={false} axisLine={false} width={56} tick={{ fill: f.text, fontSize: 12 }} />
                  <ChartTooltip content={<EnergieTooltip />} cursor={{ fill: "rgba(127,127,127,.08)" }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 13, color: f.text }} />
                  <Bar yAxisId="w" dataKey="zaehler" name="Zähler" fill={f.p1} maxBarSize={28} radius={[3, 3, 0, 0]} />
                  <Bar yAxisId="w" dataKey="nenner" name="Nenner" fill={f.p2} maxBarSize={28} radius={[3, 3, 0, 0]} />
                  <Line yAxisId="k" dataKey="kpi" name="KPI" stroke={f.ubc} strokeWidth={3} dot={{ r: 3 }} type="monotone" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </Card>

          {/* matrice SEU × type de KPI */}
          <Card title={<Space><AppstoreOutlined />KPI-Matrix {zeitraum}</Space>} styles={{ body: { padding: 0 } }}
            extra={<Text type="secondary" style={{ fontSize: 12 }}><InfoCircleOutlined /> Pfeil = Veränderung ggü. gleichen Monaten {jahr - 1}</Text>}>
            <Table rowKey="id" size="middle" pagination={false} className="zahl kopf-nowrap" dataSource={m.seus} scroll={{ x: "max-content" }}
              columns={[
                { title: <Space size={4}><ThunderboltOutlined />SEU</Space>, dataIndex: "name", fixed: "left", width: 220,
                  render: (n, s) => <span><Punkt farbe={seuFarbe(s.id)} /><b>{n}</b></span> },
                ...m.typen.map(x => ({
                  title: <a onClick={() => setTyp(x.id)} style={{ color: "inherit" }}><Space size={4}><FundOutlined />{x.name}</Space></a>,
                  key: `t${x.id}`, align: "right", width: 170,
                  onCell: () => ({ style: x.id === t ? { background: "rgba(79,131,170,.07)" } : undefined }),
                  render: (_, s) => {
                    const w = m.wert(x.id, s.id);
                    return w.n ? <Flex vertical align="flex-end"><b>{dez(w.jetzt, 3)}</b><Trend v={w.delta} klein /></Flex> : <Text type="secondary">–</Text>;
                  }
                }))
              ]} />
          </Card>

          {/* valeurs détaillées */}
          <Card title={<Space><OrderedListOutlined />Einzelwerte: {aktiv?.name}</Space>} styles={{ body: { padding: 0 } }}
            extra={<Button icon={<DownloadOutlined />} onClick={() => csvHerunterladen(`SEU_KPI_${aktiv?.name ?? t}_${jahr}.csv`,
              ["Monat", "SEU", "KPI-Typ", "Zähler", "Nenner", "KPI", "Prozent"],
              einzel.map(z => [MONATE[z.monat - 1], z.seuName, z.typName, z.zaehler, z.nenner, z.kpi, z.prozent]))}>CSV</Button>}>
            <Table rowKey="key" size="middle" className="zahl kopf-nowrap" dataSource={einzel} scroll={{ x: "max-content" }}
              pagination={{ pageSize: 15, showSizeChanger: true, pageSizeOptions: [15, 50, 100] }}
              columns={[
                { title: <Space size={4}><ScheduleOutlined />Monat</Space>, dataIndex: "monat", render: v => MONATE[v - 1] ?? v, sorter: (a, b) => a.monat - b.monat },
                { title: <Space size={4}><ThunderboltOutlined />SEU</Space>, dataIndex: "seuName", render: (n, z) => <span><Punkt farbe={seuFarbe(z.seu)} />{n}</span>,
                  sorter: (a, b) => a.seuName.localeCompare(b.seuName, "de") },
                { title: <Space size={4}><FunctionOutlined />Zähler</Space>, dataIndex: "zaehler", align: "right", render: wert, sorter: (a, b) => (a.zaehler ?? 0) - (b.zaehler ?? 0) },
                { title: <Space size={4}><FunctionOutlined />Nenner</Space>, dataIndex: "nenner", align: "right", render: wert, sorter: (a, b) => (a.nenner ?? 0) - (b.nenner ?? 0) },
                { title: <Space size={4}><FundOutlined />KPI</Space>, dataIndex: "kpi", align: "right", render: v => <b>{dez(v, 3)}</b>, sorter: (a, b) => (a.kpi ?? 0) - (b.kpi ?? 0) },
                { title: <Space size={4}><PieChartOutlined />{daten.prozentText || "Prozent"}</Space>, dataIndex: "prozent", align: "right",
                  render: v => (v == null ? "–" : `${quelle === "berechnet" && v > 0 ? "+" : ""}${dez(v, 2)} %`) },
                { title: <Tooltip title="Stimmt KPI mit Zähler ÷ Nenner überein?"><Space size={4}><SafetyCertificateOutlined />Prüfung<InfoCircleOutlined /></Space></Tooltip>,
                  dataIndex: "pruefung", align: "center",
                  render: p => p == null ? <Text type="secondary">–</Text>
                    : p ? <CheckCircleOutlined style={{ color: "#2F9E8F" }} aria-label="stimmt" /> : <Tooltip title="KPI weicht von Zähler ÷ Nenner ab"><CloseCircleOutlined style={{ color: "#CF4B3B" }} /></Tooltip> }
              ]} />
          </Card>
        </>
      )}
    </Flex>
  );
}

// =====================================================================
// Données énergie partagées (page Energie, Warnungen, Maßnahmen)
// =====================================================================
const EINST_SPEICHER = "mrs-energie";
function useEnergie(jahr, stand = 0, darf = false) {
  const geladenFuer = useRef({ jahr: null, basis: null });
  const [daten, setDaten] = useState(null);
  const [basis, setBasis] = useState(null);
  const [jahreSeu, setJahreSeu] = useState([]);
  const [fehler, setFehler] = useState("");
  const [einst, setEinstLokal] = useState({});
  // réglages communs (serveur). Reprise unique des anciens réglages de ce navigateur, s'il y en a.
  useEffect(() => {
    api("/api/einstellungen").then(e => {
      let wert = e.energie;
      if (!wert) {
        try { const alt = JSON.parse(localStorage.getItem(EINST_SPEICHER)); if (alt && Object.keys(alt).length) { wert = alt;
          if (darf) api("/api/einstellungen/energie", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(alt) }).catch(() => {}); } }
        catch { /* rien à reprendre */ }
      }
      setEinstLokal(wert || {});
    }).catch(() => {});
  }, [stand, darf]);
  const setEinst = async (neu) => {
    const gespeichert = await api("/api/einstellungen/energie", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(neu) });
    setEinstLokal(gespeichert);
  };
  const basisJahr = einst.basisJahr && jahr && einst.basisJahr < jahr ? einst.basisJahr : (jahr ? jahr - 1 : null);

  useEffect(() => { api("/api/energie/jahre").then(setJahreSeu).catch(() => {}); }, []);
  useEffect(() => {
    if (!jahr) return;
    if (geladenFuer.current.jahr !== jahr) { setDaten(null); geladenFuer.current.jahr = jahr; }
    setFehler("");
    api(`/api/energie?jahr=${jahr}`).then(setDaten).catch(e => setFehler(e.message));
  }, [jahr, stand]);
  useEffect(() => {
    if (!basisJahr) return;
    if (geladenFuer.current.basis !== basisJahr) { setBasis(null); geladenFuer.current.basis = basisJahr; }
    api(`/api/energie?jahr=${basisJahr}`).then(d => setBasis(d.aktuell)).catch(() => setBasis([]));
  }, [basisJahr, stand]);

  const kpi = useMemo(() => (daten?.aktuell.length && basis ? energieKennzahlen(daten.aktuell, basis, einst) : null), [daten, basis, einst]);
  const prognose = useMemo(() => (kpi ? prognoseBerechnen(kpi, daten.aktuell, daten.vorjahr || [], basis, einst) : null), [kpi]); // eslint-disable-line react-hooks/exhaustive-deps
  return { daten, basis, jahreSeu, fehler, einst, setEinst, basisJahr, kpi, prognose };
}

// =====================================================================
// Alertes automatiques
//  - Modell   : Verbrauch > Erwartung + 2σ (Warnung) / + 3σ (kritisch), σ = Standardfehler der Regression
//  - Trend    : EnPI > Jahresmittel + 2σ (si pas de modèle fiable) ; 3 mois de Mehrverbrauch à la suite
//  - Ziel     : EnPI-Ziel verfehlt
//  - Daten    : mois manquants, Verbrauch 0 bei Produktion, Bezugsgröße 0
//  - Maßnahme : Frist überschritten
// =====================================================================
const STUFE = {
  kritisch: { name: "Kritisch", farbe: "#CF4B3B", tag: "error", icon: <CloseCircleOutlined /> },
  warnung: { name: "Warnung", farbe: "#E39A2D", tag: "warning", icon: <WarningOutlined /> },
  info: { name: "Hinweis", farbe: "#4F83AA", tag: "blue", icon: <InfoCircleOutlined /> }
};
const KATEGORIE = {
  modell: { name: "Baseline-Modell", icon: <DotChartOutlined /> },
  trend: { name: "Trend", icon: <LineChartOutlined /> },
  ziel: { name: "Ziel", icon: <AimOutlined /> },
  daten: { name: "Daten", icon: <DatabaseOutlined /> },
  massnahme: { name: "Maßnahme", icon: <ProjectOutlined /> },
  prognose: { name: "Prognose", icon: <FundProjectionScreenOutlined /> },
  abschaum: { name: "Abschaum", icon: <ExperimentOutlined /> }
};

function Warnungen({ warnungen, en, massnahmen, jahr, dunkel, zurMassnahme, darf }) {
  const [stufe, setStufe] = useState("alle");
  const [kategorie, setKategorie] = useState(null);
  const [anlage, setAnlage] = useState(null);
  const f = farben(dunkel);

  if (en.fehler) return <Alert type="error" showIcon message="Energiedaten konnten nicht geladen werden" description={en.fehler} />;
  if (!en.kpi && en.daten?.aktuell?.length !== 0) return <Card><Skeleton active paragraph={{ rows: 8 }} /></Card>;

  const anzahl = (s) => warnungen.filter(x => x.stufe === s).length;
  const liste = warnungen.filter(x => (stufe === "alle" || x.stufe === stufe) && (!kategorie || x.kategorie === kategorie) && (!anlage || x.anlage === anlage));
  const offeneZu = (key) => (massnahmen || []).filter(x => x.anlage === key && (x.status === "geplant" || x.status === "umsetzung"));
  const anlagenBetroffen = new Set(warnungen.filter(x => x.stufe !== "info").map(x => x.anlage)).size;

  return (
    <Flex vertical gap={16}>
      <Kopf titel={`Warnungen ${jahr}`} text="Automatische Erkennung von Mehrverbrauch, auffälligen Kennzahlen, Datenlücken und überfälligen Maßnahmen" />

      <Row gutter={[16, 16]}>
        <Kpi titel="Kritisch" icon={<CloseCircleOutlined />} value={anzahl("kritisch")} valueStyle={{ color: anzahl("kritisch") ? STUFE.kritisch.farbe : undefined }}>
          <Text type="secondary">mehr als 3σ über der Erwartung</Text>
        </Kpi>
        <Kpi titel="Warnungen" icon={<WarningOutlined />} value={anzahl("warnung")} valueStyle={{ color: anzahl("warnung") ? STUFE.warnung.farbe : undefined }}>
          <Text type="secondary">Abweichungen, Ziele, Fristen</Text>
        </Kpi>
        <Kpi titel="Hinweise" icon={<InfoCircleOutlined />} value={anzahl("info")}>
          <Text type="secondary">Datenqualität und Modellgüte</Text>
        </Kpi>
        <Kpi titel="Betroffene Anlagen" icon={<ThunderboltOutlined />} value={anlagenBetroffen}>
          <Text type="secondary">mit Warnung oder kritisch</Text>
        </Kpi>
      </Row>

      <Collapse size="small" items={[{ key: "r", label: <Space><ExperimentOutlined /><b>So werden Warnungen erkannt</b></Space>, children: (
        <Flex vertical gap={6}>
          <Text><DotChartOutlined /> <b>Baseline-Modell:</b> Verbrauch höher als vom Modell erwartet, um mehr als das 2-fache (Warnung) oder 3-fache (kritisch) der üblichen Streuung des Basisjahres {en.basisJahr}.</Text>
          <Text><LineChartOutlined /> <b>Trend:</b> drei Monate in Folge Mehrverbrauch, oder (ohne belastbares Modell) EnPI mehr als 2 Standardabweichungen über dem Jahresmittel.</Text>
          <Text><AimOutlined /> <b>Ziel:</b> der EnPI verfehlt das in den Energie-Einstellungen festgelegte Ziel.</Text>
          <Text><DatabaseOutlined /> <b>Daten:</b> fehlende Monate, Verbrauch 0 trotz Produktion, oder Produktion 0 trotz Verbrauch.</Text>
          <Text><ProjectOutlined /> <b>Maßnahmen:</b> geplante oder laufende Maßnahmen mit überschrittener Frist.</Text>
        </Flex>) }]} />

      <Flex gap={8} wrap align="center" className="filter-leiste">
        <Text strong><FilterOutlined /> Filter</Text>
        <Segmented value={stufe} onChange={setStufe} options={[
          { value: "alle", label: `Alle (${warnungen.length})` },
          ...Object.entries(STUFE).map(([k, s]) => ({ value: k, label: `${s.name} (${anzahl(k)})`, icon: s.icon }))]} />
        <Select value={kategorie} onChange={setKategorie} allowClear placeholder="Alle Kategorien" style={{ width: 190 }} prefix={<AppstoreOutlined />}
          options={Object.entries(KATEGORIE).map(([k, x]) => ({ value: k, label: x.name }))} aria-label="Kategorie" />
        <Select value={anlage} onChange={setAnlage} allowClear placeholder="Alle Anlagen" style={{ width: 200 }} prefix={<ThunderboltOutlined />}
          options={Object.entries(ANLAGE_NAME).filter(([k]) => k !== "SO").map(([k, n]) => ({ value: k, label: n }))} aria-label="Anlage" />
      </Flex>

      {!liste.length ? (
        <Card><Result status="success" icon={<CheckCircleOutlined style={{ color: "#2F9E8F" }} />}
          title={warnungen.length ? "Keine Warnungen für diesen Filter" : "Keine Auffälligkeiten"}
          subTitle={warnungen.length ? "Filter ändern, um weitere Meldungen zu sehen." : `Für ${jahr} wurde nichts Auffälliges gefunden.`} /></Card>
      ) : (
        <Card styles={{ body: { padding: 0 } }}>
          <List dataSource={liste} itemLayout="horizontal" renderItem={x => {
            const s = STUFE[x.stufe], k = KATEGORIE[x.kategorie], laufend = offeneZu(x.anlage);
            return (
              <List.Item style={{ padding: "14px 20px", borderInlineStart: `4px solid ${s.farbe}` }}
                actions={!darf && x.kategorie !== "massnahme" ? [] : [
                  x.kategorie === "massnahme"
                    ? <Button key="m" icon={<ProjectOutlined />} onClick={() => zurMassnahme({ id: x.massnahmeId })}>Zur Maßnahme</Button>
                    : <Button key="m" type={x.stufe === "info" ? "default" : "primary"} ghost={x.stufe !== "info"} icon={<PlusOutlined />}
                        onClick={() => zurMassnahme({ vorlage: { anlage: x.anlage, titel: `Ursache klären: ${x.titel}`, beschreibung: x.text,
                          prioritaet: x.stufe === "kritisch" ? "hoch" : "mittel" } })}>Maßnahme anlegen</Button>
                ]}>
                <List.Item.Meta
                  avatar={<Avatar style={{ background: s.farbe }} icon={s.icon} />}
                  title={<Space wrap size={6}><b>{x.titel}</b>
                    <Tag bordered={false} color={s.tag}>{s.name}</Tag>
                    <Tag bordered={false} icon={k.icon}>{k.name}</Tag>
                    <Tag bordered={false}><Punkt farbe={f[ANLAGE_FARBE[x.anlage]] || f.vorjahr} />{ANLAGE_NAME[x.anlage] ?? x.anlage}</Tag>
                    {x.monat && <Tag bordered={false} icon={<ScheduleOutlined />}>{MONATE[x.monat - 1]}</Tag>}
                    {laufend.length > 0 && x.kategorie !== "massnahme" && (
                      <Tooltip title={laufend.map(y => y.titel).join(" · ")}>
                        <Tag color="success" bordered={false} icon={<CheckCircleOutlined />}>{laufend.length} Maßnahme{laufend.length > 1 ? "n" : ""} offen</Tag>
                      </Tooltip>)}
                  </Space>}
                  description={x.text} />
              </List.Item>
            );
          }} />
        </Card>
      )}
    </Flex>
  );
}

// =====================================================================
// Plan d'actions (Maßnahmenplan)
// =====================================================================
const M_STATUS = {
  geplant: { name: "Geplant", tag: "default", icon: <ScheduleOutlined /> },
  umsetzung: { name: "In Umsetzung", tag: "blue", icon: <SyncOutlined /> },
  umgesetzt: { name: "Umgesetzt", tag: "success", icon: <CheckCircleOutlined /> },
  abgebrochen: { name: "Abgebrochen", tag: "default", icon: <CloseCircleOutlined /> }
};
const M_PRIO = {
  hoch: { name: "Hoch", farbe: "#CF4B3B", rang: 0 },
  mittel: { name: "Mittel", farbe: "#E39A2D", rang: 1 },
  niedrig: { name: "Niedrig", farbe: "#8C99A6", rang: 2 }
};

// Économie mesurée = Σ (Erwartung − Ist) de l'installation depuis le mois qui suit la mise en œuvre
function gemesseneEinsparung(x, en, jahr) {
  if (x.status !== "umgesetzt" || !x.umgesetztAm || !en.kpi) return null;
  const a = [...en.kpi.anlagen, en.kpi.standort].find(y => y.key === x.anlage);
  if (!a?.reg) return null;
  const d = dayjs(x.umgesetztAm);
  if (d.year() > jahr) return null;
  const ab = d.year() < jahr ? 1 : d.month() + 2;
  const monate = a.monatlich.filter(z => z.Monat >= ab && z.einsparung != null);
  if (!monate.length) return { gemessen: null, monate: 0, ab };
  const gemessen = monate.reduce((s, z) => s + z.einsparung, 0);
  const erwartet = x.einsparung ? (x.einsparung * monate.length) / 12 : null;
  return { gemessen, erwartet, monate: monate.length, ab, quote: erwartet ? gemessen / erwartet : null };
}

function Massnahmen({ liste, schutz, darf, laden, en, jahr, dunkel, ziel, setZiel }) {
  const { message, notification } = AntApp.useApp();
  const [statusFilter, setStatusFilter] = useState("alle");
  const [anlage, setAnlage] = useState(null);
  const [suche, setSuche] = useState("");
  const [drawer, setDrawer] = useState(null);            // { eintrag } ou { eintrag: null }
  const [speichert, setSpeichert] = useState(false);
  const [passwort, setPasswort] = useState(null);
  const [pw, setPw] = useState({ offen: false, eingabe: "", fehler: "", danach: null });
  const [form] = Form.useForm();
  const statusWert = Form.useWatch("status", form);
  const f = farben(dunkel);
  const preis = en.einst?.preis;

  function oeffnen(eintrag, vorlage) {
    form.resetFields();
    const e = eintrag || { status: "geplant", prioritaet: "mittel", ...vorlage };
    form.setFieldsValue({ ...e, start: e.start ? dayjs(e.start) : null, frist: e.frist ? dayjs(e.frist) : null, umgesetztAm: e.umgesetztAm ? dayjs(e.umgesetztAm) : null });
    setDrawer({ eintrag: eintrag || null });
  }

  // arrivée depuis la page Warnungen : nouvelle mesure pré-remplie ou mesure existante
  useEffect(() => {
    if (!ziel) return;
    if (ziel.vorlage && darf) mitPasswort(() => oeffnen(null, ziel.vorlage));
    else if (ziel.id && darf) { const e = liste.find(x => x.id === ziel.id); if (e) mitPasswort(() => oeffnen(e)); }
    setZiel(null);
  }, [ziel]); // eslint-disable-line react-hooks/exhaustive-deps

  function mitPasswort(aktion) {
    if (!schutz || passwort) aktion(passwort);
    else setPw({ offen: true, eingabe: "", fehler: "", danach: aktion });
  }
  async function pwPruefen() {
    try {
      await api("/api/massnahmen/pruefen", { method: "POST", headers: { "x-bearbeiten-passwort": pw.eingabe } });
      setPasswort(pw.eingabe);
      const { danach, eingabe } = pw;
      setPw({ offen: false, eingabe: "", fehler: "", danach: null });
      if (danach) setTimeout(() => danach(eingabe), 0);
    } catch (e) { setPw(p => ({ ...p, fehler: e.message })); }
  }
  const senden = (methode, url, body) => api(url, {
    method: methode, headers: { "Content-Type": "application/json", "x-bearbeiten-passwort": passwort || "" }, body: body ? JSON.stringify(body) : undefined
  }).catch(e => { if (e.status === 401) setPasswort(null); throw e; });

  async function speichern() {
    const w = await form.validateFields();
    const daten = { ...w, start: w.start?.format("YYYY-MM-DD") ?? null, frist: w.frist?.format("YYYY-MM-DD") ?? null, umgesetztAm: w.umgesetztAm?.format("YYYY-MM-DD") ?? null };
    setSpeichert(true);
    try {
      if (drawer.eintrag) await senden("PUT", `/api/massnahmen/${drawer.eintrag.id}`, daten);
      else await senden("POST", "/api/massnahmen", daten);
      notification.success({ message: drawer.eintrag ? "Maßnahme gespeichert" : "Maßnahme angelegt", description: daten.titel, placement: "topRight" });
      setDrawer(null); laden();
    } catch (e) { message.error(e.message, 6); }
    finally { setSpeichert(false); }
  }
  async function loeschen(x) {
    try { await senden("DELETE", `/api/massnahmen/${x.id}`); message.success("Maßnahme gelöscht"); laden(); }
    catch (e) { message.error(e.message, 6); }
  }

  // --- chiffres ---
  const mit = liste.map(x => ({ ...x, messung: gemesseneEinsparung(x, en, jahr), ueberfaellig: istUeberfaellig(x) }));
  const offen = mit.filter(x => x.status === "geplant" || x.status === "umsetzung");
  const umgesetzt = mit.filter(x => x.status === "umgesetzt");
  const erwartetJahr = mit.filter(x => x.status !== "abgebrochen").reduce((s, x) => s + (x.einsparung || 0), 0);
  // économie mesurée par installation (une seule fois par installation, depuis la 1re mesure mise en œuvre)
  const proAnlage = Object.entries(umgesetzt.reduce((g, x) => ((g[x.anlage] ||= []).push(x), g), {})).map(([key, xs]) => {
    const erste = [...xs].sort((a, b) => (a.umgesetztAm || "").localeCompare(b.umgesetztAm || ""))[0];
    const mess = gemesseneEinsparung(erste, en, jahr);
    const erwartet = xs.reduce((s, x) => s + (x.messung?.erwartet || 0), 0);
    return { key, name: ANLAGE_NAME[key], gemessen: mess?.gemessen ?? null, erwartet: erwartet || null };
  });
  const gemessenSumme = proAnlage.reduce((s, a) => s + (a.gemessen || 0), 0);
  const erwartetAnteilig = proAnlage.reduce((s, a) => s + (a.erwartet || 0), 0);

  const gefiltert = mit.filter(x =>
    (statusFilter === "alle" || (statusFilter === "offen" ? (x.status === "geplant" || x.status === "umsetzung") : statusFilter === "ueberfaellig" ? x.ueberfaellig : x.status === statusFilter)) &&
    (!anlage || x.anlage === anlage) &&
    (!suche || `${x.titel} ${x.beschreibung ?? ""} ${x.verantwortlich ?? ""}`.toLowerCase().includes(suche.toLowerCase())));

  const spalten = [
    { title: <Tooltip title="Priorität"><FlagOutlined /></Tooltip>, dataIndex: "prioritaet", width: 52, align: "center",
      sorter: (a, b) => M_PRIO[a.prioritaet].rang - M_PRIO[b.prioritaet].rang,
      render: p => <Tooltip title={`Priorität ${M_PRIO[p].name}`}><FlagOutlined style={{ color: M_PRIO[p].farbe, fontSize: 16 }} /></Tooltip> },
    { title: <Space size={4}><ProjectOutlined />Maßnahme</Space>, dataIndex: "titel", width: 320,
      render: (t, x) => <Flex vertical><b>{t}</b>{x.beschreibung && <Text type="secondary" ellipsis={{ tooltip: x.beschreibung }} style={{ fontSize: 12, maxWidth: 300 }}>{x.beschreibung}</Text>}</Flex> },
    { title: <Space size={4}><ThunderboltOutlined />Anlage</Space>, dataIndex: "anlage", render: k => <span style={{ whiteSpace: "nowrap" }}><Punkt farbe={f[ANLAGE_FARBE[k]]} />{ANLAGE_NAME[k]}</span> },
    { title: <Space size={4}><UserOutlined />Verantwortlich</Space>, dataIndex: "verantwortlich", render: v => v || <Text type="secondary">–</Text> },
    { title: <Space size={4}><ClockCircleOutlined />Frist</Space>, dataIndex: "frist", sorter: (a, b) => (a.frist || "9").localeCompare(b.frist || "9"),
      render: (d, x) => !d ? <Text type="secondary">–</Text> : (
        <Space size={4} style={{ whiteSpace: "nowrap" }}><span style={{ color: x.ueberfaellig ? "#CF4B3B" : undefined }}>{dayjs(d).format("DD.MM.YYYY")}</span>
          {x.ueberfaellig && <Tag color="error" bordered={false} icon={<WarningOutlined />}>überfällig</Tag>}</Space>) },
    { title: <Space size={4}><SyncOutlined />Status</Space>, dataIndex: "status", render: s => <Tag color={M_STATUS[s].tag} icon={M_STATUS[s].icon} bordered={false}>{M_STATUS[s].name}</Tag> },
    { title: <Tooltip title="Erwartete Einsparung pro Jahr (Verbrauchseinheiten)"><Space size={4}><BulbOutlined />Erwartet / Jahr<InfoCircleOutlined /></Space></Tooltip>,
      dataIndex: "einsparung", align: "right", sorter: (a, b) => (a.einsparung || 0) - (b.einsparung || 0),
      render: (v, x) => v == null ? <Text type="secondary">–</Text> : (
        <Flex vertical align="flex-end"><span>{zahl(v)}</span>
          {preis && x.kosten ? <Text type="secondary" style={{ fontSize: 12 }}><EuroOutlined /> Amortisation {dez(x.kosten / (v * preis), 1)} J.</Text> : null}</Flex>) },
    { title: <Tooltip title={`Gemessen über das Baseline-Modell der Anlage in ${jahr}, ab dem Monat nach der Umsetzung. Mehrere Maßnahmen an derselben Anlage teilen sich die Messung.`}>
        <Space size={4}><StockOutlined />Gemessen {jahr}<InfoCircleOutlined /></Space></Tooltip>, key: "messung", width: 200,
      render: (_, x) => {
        if (x.status !== "umgesetzt") return <Text type="secondary">–</Text>;
        if (!x.messung) return <Tooltip title="Kein Baseline-Modell oder Umsetzung nach dem gewählten Jahr"><Text type="secondary">nicht messbar</Text></Tooltip>;
        if (x.messung.gemessen == null) return <Text type="secondary">noch keine Monate</Text>;
        const q = x.messung.quote;
        return (
          <Tooltip title={`${x.messung.monate} Monate ab ${MONATE[x.messung.ab - 1]}${x.messung.erwartet ? `, anteilig erwartet ${zahl(x.messung.erwartet)}` : ""}`}>
            <Flex vertical gap={2}>
              <span style={{ color: x.messung.gemessen >= 0 ? "#2F9E8F" : "#CF4B3B" }}>{x.messung.gemessen >= 0 ? "+" : "−"}{zahl(Math.abs(x.messung.gemessen))}</span>
              {q != null && <Progress percent={Math.max(0, Math.round(q * 100))} size="small" strokeColor={q >= 1 ? "#2F9E8F" : q >= 0.5 ? "#E39A2D" : "#CF4B3B"} />}
            </Flex>
          </Tooltip>);
      } },
    { title: "", key: "aktionen", fixed: "right", width: 92, render: (_, x) => !darf ? null : (
      <Space size={0}>
        <Tooltip title="Bearbeiten"><Button type="text" icon={<EditOutlined />} onClick={() => mitPasswort(() => oeffnen(x))} aria-label="Bearbeiten" /></Tooltip>
        <Popconfirm title="Maßnahme löschen?" description="Der Eintrag bleibt im Protokoll erhalten." okText="Löschen" cancelText="Abbrechen" okButtonProps={{ danger: true }}
          onConfirm={() => mitPasswort(() => loeschen(x))}>
          <Tooltip title="Löschen"><Button type="text" danger icon={<DeleteOutlined />} aria-label="Löschen" /></Tooltip>
        </Popconfirm>
      </Space>) }
  ];

  const kostenText = (v) => (preis && v ? ` ≈ ${zahl(v * preis)} €` : "");

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="flex-end" wrap gap={12}>
        <Kopf titel="Maßnahmenplan" text="Energieeinsparmaßnahmen nach ISO 50001 (Abschnitt 6.2), mit Wirksamkeitsprüfung über das Baseline-Modell" />
        <Space wrap>
          {schutz && <Tooltip title={passwort ? "Freigeschaltet. Klicken zum Sperren." : "Gesperrt: Passwort wird beim Bearbeiten abgefragt."}>
            <Button shape="circle" icon={passwort ? <UnlockOutlined /> : <LockOutlined />} onClick={() => setPasswort(null)}
              style={passwort ? { color: "#2F9E8F", borderColor: "#2F9E8F" } : undefined} aria-label="Sperren" /></Tooltip>}
          <Button icon={<DownloadOutlined />} disabled={!liste.length} onClick={() => csvHerunterladen(`Massnahmenplan_${dayjs().format("YYYY-MM-DD")}.csv`,
            ["Titel", "Anlage", "Priorität", "Status", "Verantwortlich", "Start", "Frist", "Umgesetzt am", "Erwartete Einsparung/Jahr", "Kosten €", `Gemessen ${jahr}`, "Beschreibung", "Notiz"],
            mit.map(x => [x.titel, ANLAGE_NAME[x.anlage], M_PRIO[x.prioritaet].name, M_STATUS[x.status].name, x.verantwortlich, x.start, x.frist, x.umgesetztAm,
              x.einsparung, x.kosten, x.messung?.gemessen == null ? "" : Math.round(x.messung.gemessen), x.beschreibung, x.notiz]))}>CSV</Button>
          {darf ? <Button type="primary" icon={<PlusOutlined />} onClick={() => mitPasswort(() => oeffnen(null))}>Neue Maßnahme</Button>
            : <Tooltip title="Ihre Rolle erlaubt nur das Lesen"><Tag icon={<LockOutlined />} style={{ padding: "4px 10px" }}>Nur Lesen</Tag></Tooltip>}
        </Space>
      </Flex>

      <Row gutter={[16, 16]}>
        <Kpi titel="Offene Maßnahmen" icon={<ScheduleOutlined />} value={offen.length}>
          {offen.some(x => x.ueberfaellig)
            ? <Text type="danger"><WarningOutlined /> davon {offen.filter(x => x.ueberfaellig).length} überfällig</Text>
            : <Text type="secondary">geplant oder in Umsetzung</Text>}
        </Kpi>
        <Kpi titel="Umgesetzt" icon={<CheckCircleOutlined />} value={umgesetzt.length} valueStyle={{ color: umgesetzt.length ? "#2F9E8F" : undefined }}>
          <Text type="secondary">{umgesetzt.filter(x => x.umgesetztAm?.startsWith(String(jahr))).length} davon in {jahr}</Text>
        </Kpi>
        <Kpi titel="Erwartete Einsparung" icon={<BulbOutlined />} value={erwartetJahr} formatter={zahl} valueStyle={{ color: f.ubc }}>
          <Text type="secondary">pro Jahr, ohne abgebrochene{kostenText(erwartetJahr)}</Text>
        </Kpi>
        <Kpi titel={`Gemessene Einsparung ${jahr ?? ""}`} icon={<StockOutlined />} value={proAnlage.length ? gemessenSumme : "–"} formatter={wert}
          valueStyle={{ color: !proAnlage.length ? undefined : gemessenSumme >= 0 ? "#2F9E8F" : "#CF4B3B" }}>
          <Text type="secondary">{erwartetAnteilig ? `${prozent(gemessenSumme / erwartetAnteilig)} der anteilig erwarteten` : "umgesetzte Maßnahmen, Baseline-Modell"}</Text>
        </Kpi>
      </Row>

      {proAnlage.some(a => a.gemessen != null) && (
        <Card title={<Space><BarChartOutlined />{`Erwartet und gemessen je Anlage (${jahr})`}</Space>}
          extra={<Text type="secondary" style={{ fontSize: 12 }}><InfoCircleOutlined /> erwartet = anteilig für die gemessenen Monate</Text>}>
          <StapelBalken data={proAnlage.map(a => ({ monat: a.name, erwartet: a.erwartet, gemessen: a.gemessen }))} f={f} hoehe={240} gestapelt={false} format={zahl}
            reihen={[{ key: "erwartet", name: "Erwartet", farbe: f.vorjahr }, { key: "gemessen", name: "Gemessen", farbe: "#2F9E8F" }]} />
        </Card>
      )}

      <Flex gap={8} wrap align="center" className="filter-leiste">
        <Text strong><FilterOutlined /> Filter</Text>
        <Segmented value={statusFilter} onChange={setStatusFilter} options={[
          { value: "alle", label: `Alle (${liste.length})` },
          { value: "offen", label: `Offen (${offen.length})`, icon: <ScheduleOutlined /> },
          { value: "ueberfaellig", label: `Überfällig (${mit.filter(x => x.ueberfaellig).length})`, icon: <WarningOutlined /> },
          { value: "umgesetzt", label: `Umgesetzt (${umgesetzt.length})`, icon: <CheckCircleOutlined /> },
          { value: "abgebrochen", label: "Abgebrochen", icon: <CloseCircleOutlined /> }]} />
        <Select value={anlage} onChange={setAnlage} allowClear placeholder="Alle Anlagen" style={{ width: 200 }} prefix={<ThunderboltOutlined />}
          options={Object.entries(ANLAGE_NAME).map(([k, n]) => ({ value: k, label: n }))} aria-label="Anlage" />
        <Input allowClear prefix={<SearchOutlined />} placeholder="Suchen" value={suche} onChange={e => setSuche(e.target.value)} style={{ maxWidth: 240 }} />
      </Flex>

      <Card styles={{ body: { padding: 0 } }}>
        {!liste.length ? (
          <Empty style={{ padding: 32 }} image={<ProjectOutlined style={{ fontSize: 48, opacity: .4 }} />}
            description="Noch keine Maßnahmen. Legen Sie die erste an, oder starten Sie direkt aus einer Warnung.">
            {darf && <Button type="primary" icon={<PlusOutlined />} onClick={() => mitPasswort(() => oeffnen(null))}>Neue Maßnahme</Button>}
          </Empty>
        ) : (
          <Table rowKey="id" columns={spalten} dataSource={gefiltert} size="middle" className="zahl kopf-nowrap" scroll={{ x: "max-content" }}
            pagination={{ pageSize: 15, hideOnSinglePage: true }} rowClassName={x => (x.status === "abgebrochen" ? "zeile-blass" : "")} />
        )}
      </Card>

      <Modal open={pw.offen} title={<Space><LockOutlined />Bearbeiten freischalten</Space>} okText="Freischalten" cancelText="Abbrechen"
        onOk={pwPruefen} onCancel={() => setPw(p => ({ ...p, offen: false }))} okButtonProps={{ disabled: !pw.eingabe }} destroyOnHidden>
        <Text type="secondary">Für Maßnahmen gilt das Bearbeitungs-Passwort aus der .env.</Text>
        <Input.Password autoFocus style={{ marginTop: 12 }} placeholder="Bearbeitungs-Passwort" value={pw.eingabe} status={pw.fehler ? "error" : ""}
          onChange={e => setPw(p => ({ ...p, eingabe: e.target.value }))} onPressEnter={() => pw.eingabe && pwPruefen()} />
        {pw.fehler && <Text type="danger">{pw.fehler}</Text>}
      </Modal>

      <Drawer open={!!drawer} onClose={() => setDrawer(null)} width={560} destroyOnHidden
        title={<Space><ProjectOutlined />{drawer?.eintrag ? "Maßnahme bearbeiten" : "Neue Maßnahme"}</Space>}
        footer={<Flex justify="space-between" align="center"><Text type="secondary" style={{ fontSize: 12 }}><SafetyCertificateOutlined /> Jede Änderung wird protokolliert.</Text>
          <Space><Button onClick={() => setDrawer(null)}>Abbrechen</Button>
            <Button type="primary" icon={<CheckCircleOutlined />} loading={speichert} onClick={speichern}>{drawer?.eintrag ? "Speichern" : "Anlegen"}</Button></Space></Flex>}>
        <Form form={form} layout="vertical" requiredMark>
          <Form.Item name="titel" label={<Space size={6}><ProjectOutlined />Titel</Space>} rules={[{ required: true, message: "Bitte einen Titel eingeben" }]}>
            <Input maxLength={200} showCount placeholder="z. B. Druckluftleckagen an Presse II beheben" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={14}>
              <Form.Item name="anlage" label={<Space size={6}><ThunderboltOutlined />Anlage</Space>} rules={[{ required: true, message: "Bitte eine Anlage wählen" }]}>
                <Select options={Object.entries(ANLAGE_NAME).map(([k, n]) => ({ value: k, label: <span><Punkt farbe={f[ANLAGE_FARBE[k]]} />{n}</span> }))} />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="status" label={<Space size={6}><SyncOutlined />Status</Space>}>
                <Select options={Object.entries(M_STATUS).map(([k, s]) => ({ value: k, label: <Space size={6}>{s.icon}{s.name}</Space> }))} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="prioritaet" label={<Space size={6}><FlagOutlined />Priorität</Space>}>
            <Segmented block options={Object.entries(M_PRIO).map(([k, p]) => ({ value: k, label: p.name, icon: <FlagOutlined style={{ color: p.farbe }} /> }))} />
          </Form.Item>
          <Form.Item name="verantwortlich" label={<Space size={6}><UserOutlined />Verantwortlich</Space>}>
            <Input maxLength={120} placeholder="Name oder Abteilung" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={statusWert === "umgesetzt" ? 8 : 12}><Form.Item name="start" label={<Space size={6}><CalendarOutlined />Start</Space>}><DatePicker format="DD.MM.YYYY" style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={statusWert === "umgesetzt" ? 8 : 12}><Form.Item name="frist" label={<Space size={6}><ClockCircleOutlined />Frist</Space>}><DatePicker format="DD.MM.YYYY" style={{ width: "100%" }} /></Form.Item></Col>
            {statusWert === "umgesetzt" && (
              <Col span={8}><Form.Item name="umgesetztAm" label={<Space size={6}><CheckCircleOutlined />Umgesetzt am</Space>} extra="Ab dem Folgemonat gemessen">
                <DatePicker format="DD.MM.YYYY" style={{ width: "100%" }} /></Form.Item></Col>
            )}
          </Row>
          <Row gutter={12}>
            <Col span={14}><Form.Item name="einsparung" label={<Space size={6}><BulbOutlined />Erwartete Einsparung</Space>} extra="Verbrauchseinheiten pro Jahr (z. B. kWh)">
              <InputNumber min={0} decimalSeparator="," style={{ width: "100%" }} suffix="/ Jahr" /></Form.Item></Col>
            <Col span={10}><Form.Item name="kosten" label={<Space size={6}><EuroOutlined />Kosten</Space>} extra="Investition, optional">
              <InputNumber min={0} decimalSeparator="," style={{ width: "100%" }} suffix="€" /></Form.Item></Col>
          </Row>
          <Form.Item name="beschreibung" label={<Space size={6}><EditOutlined />Beschreibung</Space>}>
            <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} maxLength={2000} placeholder="Was wird gemacht, warum, wie wird der Erfolg geprüft?" />
          </Form.Item>
          <Form.Item name="notiz" label={<Space size={6}><InfoCircleOutlined />Notiz</Space>}>
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} maxLength={2000} />
          </Form.Item>
        </Form>
        {!preis && <Alert type="info" showIcon className="hinweis" message="Tipp: Mit einem Energiepreis in den Energie-Einstellungen werden Einsparungen in Euro und die Amortisation angezeigt." />}
      </Drawer>
    </Flex>
  );
}

// =====================================================================
// Energiebericht : rapport A4 pour la revue de direction (ISO 50001 §9.3)
// « Als PDF speichern » télécharge directement le PDF (html2pdf.js) ; « Drucken » ouvre le dialogue d'impression.
// Le rapport est toujours en clair (indépendant du mode sombre) pour l'impression.
// =====================================================================
const B = { text: "#1F2A33", leise: "#5F6B76", linie: "#DDE3E8", flaeche: "#F4F6F8", primaer: "#2B5874",
            p1: "#2B5874", p2: "#7FA8C3", ubc: "#E39A2D", me: "#2F9E8F", standort: "#6A55A3", vorjahr: "#A6AFB8", gut: "#2F9E8F", schlecht: "#CF4B3B" };
const BERICHT_TEILE = [
  { key: "zusammenfassung", name: "Zusammenfassung" },
  { key: "verbrauch", name: "Energieverbrauch" },
  { key: "seu", name: "Wesentliche Energieeinsätze" },
  { key: "enpi", name: "Energieleistung (EnPI)" },
  { key: "massnahmen", name: "Maßnahmenplan" },
  { key: "warnungen", name: "Auffälligkeiten" },
  { key: "prognose", name: "Prognose Jahresende" },
  { key: "methodik", name: "Methodik und Datenqualität" },
  { key: "freigabe", name: "Freigabe" }
];
const BERICHT_SPEICHER = "mrs-bericht-2";

const BDelta = ({ v, gutWennSinkt = true }) => v == null ? <span style={{ color: B.leise }}>–</span> : (
  <span style={{ color: (v <= 0) === gutWennSinkt ? B.gut : B.schlecht, whiteSpace: "nowrap" }}>{v > 0 ? "▲" : v < 0 ? "▼" : "■"} {prozent(Math.abs(v))}</span>
);
const BPunkt = ({ farbe }) => <i style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: farbe, marginRight: 6 }} />;

// Réglages du rapport (enregistrés dans le navigateur)
const ALLE_ANLAGEN = ["P1", "P2", "UB", "ME", "ST"];
function berichtStandard(en, jahr) {
  return { jahr, von: 1, bis: 12, basisJahr: en.basisJahr, anlagen: ALLE_ANLAGEN, teile: BERICHT_TEILE.map(t => t.key), ersteller: "", kommentar: "" };
}

function Bericht({ en, massnahmen, jahr }) {
  const { message } = AntApp.useApp();
  const [cfg, setCfg] = useState(() => {
    let g = {};
    try { g = JSON.parse(localStorage.getItem(BERICHT_SPEICHER)) || {}; } catch { /* sans stockage */ }
    return { ...berichtStandard(en, jahr), ...g };
  });
  const [bericht, setBericht] = useState(null);      // { cfg, aktuell, vorjahr, basis } après « Bericht erstellen »
  const [laedt, setLaedt] = useState(false);
  const [pdfLaedt, setPdfLaedt] = useState(false);
  const aendern = (x) => setCfg(c => ({ ...c, ...x }));
  useEffect(() => { try { localStorage.setItem(BERICHT_SPEICHER, JSON.stringify(cfg)); } catch { /* sans stockage */ } }, [cfg]);
  // année encore inconnue au démarrage (chargée depuis la base) ou absente de la table → année choisie en haut / la plus récente
  useEffect(() => {
    const gueltig = (j) => Number.isInteger(j) && (!en.jahreSeu.length || en.jahreSeu.includes(j));
    if (gueltig(cfg.jahr)) { if (!(cfg.basisJahr < cfg.jahr)) aendern({ basisJahr: cfg.jahr - 1 }); return; }
    const j = gueltig(jahr) ? jahr : en.jahreSeu[0];
    if (j) aendern({ jahr: j, basisJahr: j - 1 });
  }, [jahr, en.jahreSeu, cfg.jahr]); // eslint-disable-line react-hooks/exhaustive-deps

  const jahre = (en.jahreSeu.length ? en.jahreSeu : [jahr]).filter(Boolean);
  const basisJahre = jahre.filter(j => j < cfg.jahr);
  const veraltet = bericht && JSON.stringify(bericht.cfg) !== JSON.stringify(cfg);
  const [kommentare, setKommentare] = useState({});
  useEffect(() => { if (cfg.jahr) api(`/api/kommentare?jahr=${cfg.jahr}`).then(setKommentare).catch(() => setKommentare({})); }, [cfg.jahr]);
  const monatsKommentar = kommentare[`${cfg.jahr}-${String(cfg.bis).padStart(2, "0")}`];

  async function erstellen() {
    if (!cfg.jahr) return message.warning("Bitte ein Berichtsjahr wählen.");
    if (cfg.von > cfg.bis) return message.warning("Der Startmonat liegt nach dem Endmonat.");
    if (!cfg.anlagen.length) return message.warning("Bitte mindestens eine Anlage wählen.");
    setLaedt(true);
    try {
      const basisJahr = cfg.basisJahr && cfg.basisJahr < cfg.jahr ? cfg.basisJahr : cfg.jahr - 1;
      const [d, b] = await Promise.all([api(`/api/energie?jahr=${cfg.jahr}`), api(`/api/energie?jahr=${basisJahr}`)]);
      const imZeitraum = (r) => r.Monat >= cfg.von && r.Monat <= cfg.bis;
      const aktuell = d.aktuell.filter(imZeitraum);
      if (!aktuell.length) { message.warning(`Keine Energiedaten für diesen Zeitraum in ${cfg.jahr}.`); setBericht(null); return; }
      setBericht({ cfg: { ...cfg }, basisJahr, aktuell, vorjahr: d.vorjahr.filter(imZeitraum), vorjahrVoll: d.vorjahr, basis: b.aktuell });
    } catch (e) { message.error(e.message, 6); }
    finally { setLaedt(false); }
  }

  // PDF direkt herunterladen (ohne Druckdialog) – html2pdf.js wird erst beim Klick geladen
  const dateiname = () => {
    const c = bericht.cfg;
    return `Energiebericht_${c.jahr}_${MONATE[c.von - 1]}-${MONATE[c.bis - 1]}`;
  };
  async function pdfSpeichern() {
    const el = document.querySelector(".bericht");
    if (!el || !bericht) return;
    setPdfLaedt(true);
    try {
      const { default: html2pdf } = await import("html2pdf.js");
      await html2pdf().set({
        margin: [12, 12, 12, 12],
        filename: `${dateiname()}.pdf`,
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: { scale: 2, backgroundColor: "#ffffff", windowWidth: 1200 },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["css", "legacy"], before: ".b-umbruch", avoid: [".b-block", "tr"] }
      }).from(el).save();
      message.success("PDF gespeichert (Ordner Downloads)");
    } catch (e) {
      message.error(`PDF konnte nicht erstellt werden: ${e.message}`, 6);
    } finally {
      setPdfLaedt(false);
    }
  }
  // Drucken: Dateiname des PDFs = Titel der Seite während des Drucks
  const drucken = () => {
    const alt = document.title;
    document.title = dateiname();
    addEventListener("afterprint", () => { document.title = alt; }, { once: true });
    window.print();
  };

  return (
    <Flex vertical gap={16}>
      <Card className="no-print" title={<Space><FilePdfOutlined />Energiebericht zusammenstellen</Space>}
        extra={<Space wrap>
          <Button icon={<UndoOutlined />} onClick={() => setCfg(c => ({ ...berichtStandard(en, jahr), ersteller: c.ersteller }))}>Standard</Button>
          <Button type="primary" icon={<FileTextOutlined />} loading={laedt} onClick={erstellen}>{bericht ? "Bericht neu erstellen" : "Bericht erstellen"}</Button>
          <Tooltip title={!bericht ? "Zuerst den Bericht erstellen" : veraltet ? "Die Auswahl wurde geändert: zuerst neu erstellen" : "PDF-Datei direkt herunterladen"}>
            <Button type="primary" ghost icon={<DownloadOutlined />} loading={pdfLaedt} disabled={!bericht || veraltet} onClick={pdfSpeichern}>Als PDF speichern</Button>
          </Tooltip>
          <Tooltip title={!bericht ? "Zuerst den Bericht erstellen" : veraltet ? "Die Auswahl wurde geändert: zuerst neu erstellen" : "Druckdialog öffnen"}>
            <Button icon={<PrinterOutlined />} disabled={!bericht || veraltet} onClick={drucken}>Drucken</Button>
          </Tooltip>
        </Space>}>
        <Row gutter={[16, 12]}>
          <Col xs={24} md={12} xl={6}>
            <Text type="secondary" style={{ fontSize: 12 }}><CalendarOutlined /> Berichtsjahr</Text>
            <Select value={cfg.jahr} onChange={j => aendern({ jahr: j, basisJahr: cfg.basisJahr && cfg.basisJahr < j ? cfg.basisJahr : j - 1 })}
              options={jahre.map(j => ({ value: j, label: String(j) }))} style={{ width: "100%" }} aria-label="Berichtsjahr" />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Text type="secondary" style={{ fontSize: 12 }}><ScheduleOutlined /> Zeitraum</Text>
            <Space.Compact style={{ width: "100%" }}>
              <Select value={cfg.von} onChange={v => aendern({ von: v })} options={MONATE.map((x, i) => ({ value: i + 1, label: x }))} style={{ width: "50%" }} aria-label="Von Monat" />
              <Select value={cfg.bis} onChange={v => aendern({ bis: v })} options={MONATE.map((x, i) => ({ value: i + 1, label: x }))} style={{ width: "50%" }} aria-label="Bis Monat" />
            </Space.Compact>
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Text type="secondary" style={{ fontSize: 12 }}><FlagOutlined /> Basisjahr (Vergleich)</Text>
            <Select value={cfg.basisJahr && cfg.basisJahr < cfg.jahr ? cfg.basisJahr : cfg.jahr - 1} onChange={v => aendern({ basisJahr: v })}
              options={(basisJahre.length ? basisJahre : [cfg.jahr - 1]).map(j => ({ value: j, label: String(j) }))} style={{ width: "100%" }} aria-label="Basisjahr" />
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Text type="secondary" style={{ fontSize: 12 }}><UserOutlined /> Erstellt von</Text>
            <Input placeholder="Name, Funktion" value={cfg.ersteller} onChange={e => aendern({ ersteller: e.target.value })} />
          </Col>
          <Col span={24}>
            <Text type="secondary" style={{ fontSize: 12, display: "block" }}><ThunderboltOutlined /> Anlagen im Bericht</Text>
            <Checkbox.Group value={cfg.anlagen} onChange={v => aendern({ anlagen: v })}
              options={ALLE_ANLAGEN.map(k => ({ value: k, label: <span><Punkt farbe={B[ANLAGE_FARBE[k]]} />{ANLAGE_NAME[k]}</span> }))} />
          </Col>
          <Col span={24}>
            <Text type="secondary" style={{ fontSize: 12, display: "block" }}><OrderedListOutlined /> Kapitel</Text>
            <Checkbox.Group value={cfg.teile} onChange={v => aendern({ teile: v })} options={BERICHT_TEILE.map(t => ({ value: t.key, label: t.name }))} />
          </Col>
          <Col span={24}>
            <Text type="secondary" style={{ fontSize: 12 }}><EditOutlined /> Bewertung des Energiemanagements (optional, erscheint in der Zusammenfassung)</Text>
            <Input.TextArea value={cfg.kommentar} onChange={e => aendern({ kommentar: e.target.value })} autoSize={{ minRows: 2, maxRows: 8 }} maxLength={8000}
              placeholder="z. B. Bewertung der Ergebnisse, Entscheidungen, nächste Schritte" />
            {monatsKommentar && (
              <Button size="small" type="link" icon={<CommentOutlined />} style={{ paddingInline: 0 }} onClick={() => aendern({ kommentar: monatsKommentar.text })}>
                Monatskommentar {MONATE[cfg.bis - 1]} {cfg.jahr} übernehmen
              </Button>
            )}
          </Col>
        </Row>
        <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 12 }}>
          <InfoCircleOutlined /> Nichts wird automatisch erzeugt: Der Bericht entsteht erst mit „Bericht erstellen“. Danach mit „Als PDF speichern“
          die Datei direkt herunterladen (Ordner Downloads) oder mit „Drucken“ auf Papier ausgeben.
        </Text>
      </Card>

      {veraltet && <Alert className="no-print" type="warning" showIcon message="Die Auswahl wurde geändert. Mit „Bericht neu erstellen“ wird die Vorschau aktualisiert." />}

      {!bericht ? (
        <Card className="no-print"><Empty image={<FileTextOutlined style={{ fontSize: 48, opacity: .4 }} />}
          description="Auswahl festlegen und auf „Bericht erstellen“ klicken. Danach erscheint hier die Vorschau." /></Card>
      ) : <BerichtInhalt b={bericht} einst={en.einst} massnahmen={massnahmen} />}
    </Flex>
  );
}

function BerichtInhalt({ b, einst, massnahmen }) {
  const { cfg, basisJahr, aktuell: rows, vorjahr } = b;
  const jahr = cfg.jahr;
  const m = useMemo(() => energieKennzahlen(rows, b.basis, einst), [b, einst]); // eslint-disable-line react-hooks/exhaustive-deps
  const enB = { kpi: m, daten: { aktuell: rows, vorjahr }, einst, basisJahr };
  const gewaehlt = (k) => cfg.anlagen.includes(k);
  const anlagenDef = SEU_DEF.filter(a => gewaehlt(a.key));
  const anlagenKpi = [...m.anlagen.filter(a => gewaehlt(a.key)), ...(gewaehlt("ST") ? [m.standort] : [])];
  const alleAnlagen = anlagenDef.length === SEU_DEF.length;

  const vjGleich = vorjahr.length === rows.length ? vorjahr : null;
  const V = (rs) => rs.reduce((s, r) => s + verbrauchVon(r, STANDORT), 0);
  const verbrauch = V(rows), verbrauchVj = vjGleich ? V(vjGleich) : null;
  const menge = summe(rows, "Gesamtmenge"), mengeVj = vjGleich ? summe(vjGleich, "Gesamtmenge") : null;
  const zeitraum = rows.length === 12 ? `Januar – Dezember ${jahr}` : `${monatName(rows[0])} – ${monatName(rows.at(-1))} ${jahr}`;
  const st = m.standort;
  const seu = m.pareto.filter(a => a.seu);
  const passtAnlage = (k) => gewaehlt(k) || ((k === "SO") && gewaehlt("ST"));
  const liste = massnahmen.filter(x => passtAnlage(x.anlage)).map(x => ({ ...x, messung: gemesseneEinsparung(x, enB, jahr), ueberfaellig: istUeberfaellig(x) }));
  const offen = liste.filter(x => x.status === "geplant" || x.status === "umsetzung");
  const umgesetzt = liste.filter(x => x.status === "umgesetzt");
  const gemessen = umgesetzt.reduce((s, x) => s + (x.messung?.gemessen || 0), 0);
  const wichtig = warnungenBerechnen(enB, liste, jahr).filter(x => x.stufe !== "info" && passtAnlage(x.anlage));
  // prévision : seulement pour une période qui commence en janvier et se termine avant décembre
  const prog = cfg.von === 1 && rows.at(-1).Monat < 12 ? prognoseBerechnen(m, rows, b.vorjahrVoll || [], b.basis, einst) : null;
  const teile = cfg.teile;
  const nr = (key) => BERICHT_TEILE.map(t => t.key).filter(k => teile.includes(k)).indexOf(key) + 1;
  const zeigen = (key) => teile.includes(key);
  const ersteller = cfg.ersteller;

  const saetze = [
    `Im Zeitraum ${zeitraum} wurden am Standort ${zahl(verbrauch)} Energieeinheiten verbraucht` +
      (verbrauchVj ? ` (${verbrauch >= verbrauchVj ? "+" : "−"}${prozent(Math.abs(verbrauch / verbrauchVj - 1))} gegenüber dem gleichen Zeitraum ${jahr - 1}).` : "."),
    mengeVj ? `Die verarbeitete Gesamtmenge lag bei ${zahl(menge)} (${menge >= mengeVj ? "+" : "−"}${prozent(Math.abs(menge / mengeVj - 1))}).` : `Die verarbeitete Gesamtmenge lag bei ${zahl(menge)}.`,
    st.veraenderung != null
      ? `Der spezifische Energieverbrauch des Standorts (EnPI) beträgt ${dez(st.enpiAkt, 3)} und hat sich gegenüber dem Basisjahr ${basisJahr} um ${prozent(Math.abs(st.veraenderung))} ${st.veraenderung <= 0 ? "verbessert" : "verschlechtert"}.`
      : `Der spezifische Energieverbrauch des Standorts (EnPI) beträgt ${dez(st.enpiAkt, 3)}.`,
    st.einsparung != null
      ? `Bereinigt um die Produktionsmenge (Baseline-Modell) ergibt sich ${st.einsparung >= 0 ? `eine Einsparung von ${zahl(st.einsparung)}` : `ein Mehrverbrauch von ${zahl(-st.einsparung)}`}.` : null,
    st.zielErreicht != null ? `Das Energieziel (EnPI −${dez(einst.ziel, 1)} % gegenüber ${basisJahr}) wurde ${st.zielErreicht ? "erreicht" : "nicht erreicht"}.` : null,
    ...m.anlagen.filter(a => gewaehlt(a.key) && !alleAnlagen && a.veraenderung != null)
      .map(a => `${a.name}: EnPI ${dez(a.enpiAkt, 3)}, ${prozent(Math.abs(a.veraenderung))} ${a.veraenderung <= 0 ? "besser" : "schlechter"} als ${basisJahr}.`),
    `${seu.length} Anlagen sind wesentliche Energieeinsätze (${seu.map(a => a.name).join(", ")}); sie verursachen zusammen ${prozent(seu.reduce((s, a) => s + (a.anteil || 0), 0))} des Verbrauchs.`,
    liste.length ? `Im Maßnahmenplan ${offen.length === 1 ? "ist 1 Maßnahme" : `sind ${offen.length} Maßnahmen`} offen${offen.some(x => x.ueberfaellig) ? `, davon ${offen.filter(x => x.ueberfaellig).length} überfällig` : ""}; ${umgesetzt.length === 1 ? "1 Maßnahme ist" : `${umgesetzt.length} Maßnahmen sind`} umgesetzt.` : "Für die gewählten Anlagen sind keine Maßnahmen erfasst.",
    wichtig.length ? `Die automatische Prüfung meldet ${wichtig.filter(x => x.stufe === "kritisch").length} kritische Auffälligkeit(en) und ${wichtig.filter(x => x.stufe === "warnung").length} Warnung(en).` : "Die automatische Prüfung meldet keine Auffälligkeiten."
  ].filter(Boolean);

  const proMonat = rows.map(r => ({ monat: monatName(r).slice(0, 3), ...Object.fromEntries(anlagenDef.map(a => [a.key, num(r[a.v])])) }));

  return (
    <div className="bericht">
      <header className="b-kopf">
        <div className="b-marke">
          <div className="marke-logo" style={{ width: 40, height: 40 }}>
            <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true">
              <rect x="5" y="16" width="5" height="11" rx="1" fill="#fff" /><rect x="13.5" y="10" width="5" height="17" rx="1" fill="#fff" /><rect x="22" y="5" width="5" height="22" rx="1" fill="#F0AA2E" />
            </svg>
          </div>
          <div><b>MRS Aluminium-Recycling</b><span>Energiemanagementsystem nach ISO 50001</span></div>
        </div>
        <div className="b-meta">Stand {dayjs().format("DD.MM.YYYY")}<br />Datenbank MRS_BI</div>
      </header>

      <h1>Energiebericht {jahr}</h1>
      <p className="b-unter">Managementbewertung (ISO 50001, Abschnitt 9.3) · {zeitraum} · Basisjahr {basisJahr}
        {!alleAnlagen || !gewaehlt("ST") ? ` · Anlagen: ${cfg.anlagen.map(k => ANLAGE_NAME[k]).join(", ")}` : ""}</p>

      <div className="b-kacheln b-block">
        {[
          ["Energieverbrauch Standort", zahl(verbrauch), verbrauchVj ? <span key="d"><BDelta v={verbrauch / verbrauchVj - 1} /> ggü. {jahr - 1}</span> : `${rows.length} Monate`],
          ["EnPI Standort", dez(st.enpiAkt, 3), <span key="d"><BDelta v={st.veraenderung} /> ggü. {basisJahr}</span>],
          ["Normalisierte Einsparung", st.einsparung == null ? "–" : `${st.einsparung >= 0 ? "+" : "−"}${zahl(Math.abs(st.einsparung))}`, "Baseline-Modell"],
          ["Maßnahmen", `${offen.length} offen`, `${umgesetzt.length} umgesetzt`]
        ].map(([t, w, u]) => <div key={t} className="b-kachel"><span>{t}</span><b>{w}</b><small>{u}</small></div>)}
      </div>

      {zeigen("zusammenfassung") && (
        <section className="b-block">
          <h2>{nr("zusammenfassung")}. Zusammenfassung</h2>
          <ul>{saetze.map((x, i) => <li key={i}>{x}</li>)}</ul>
          {cfg.kommentar && (<><h3>Bewertung des Energiemanagements</h3><div className="b-kommentar"><AntwortText text={cfg.kommentar} /></div></>)}
        </section>
      )}

      {zeigen("verbrauch") && anlagenDef.length > 0 && (
        <section>
          <h2>{nr("verbrauch")}. Energieverbrauch und Produktion</h2>
          <div className="b-block">
            <BarChart width={680} height={230} data={proMonat} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={B.linie} />
              <XAxis dataKey="monat" tickLine={false} axisLine={false} tick={{ fill: B.leise, fontSize: 11 }} />
              <YAxis tickFormatter={kurz} tickLine={false} axisLine={false} width={64} tick={{ fill: B.leise, fontSize: 11 }} />
              <Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 11 }} />
              {anlagenDef.map((a, i) => <Bar key={a.key} dataKey={a.key} name={a.name} stackId="a" fill={B[a.farbe]} isAnimationActive={false}
                radius={i === anlagenDef.length - 1 ? [3, 3, 0, 0] : 0} />)}
            </BarChart>
          </div>
          <table className="b-tab b-block">
            <thead><tr><th>Monat</th>{anlagenDef.map(a => <th key={a.key}>{a.name}</th>)}<th>{alleAnlagen ? "Gesamt" : "Standort gesamt"}</th><th>Gesamtmenge</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.Monat}><td>{monatName(r)}</td>{anlagenDef.map(a => <td key={a.key}>{zahl(num(r[a.v]))}</td>)}
                  <td><b>{zahl(verbrauchVon(r, STANDORT))}</b></td><td>{zahl(num(r.Gesamtmenge))}</td></tr>
              ))}
            </tbody>
            <tfoot><tr><td>Summe</td>{anlagenDef.map(a => <td key={a.key}>{zahl(summe(rows, a.v))}</td>)}<td>{zahl(verbrauch)}</td><td>{zahl(menge)}</td></tr></tfoot>
          </table>
        </section>
      )}

      {zeigen("seu") && (
        <section className="b-block">
          <h2>{nr("seu")}. Wesentliche Energieeinsätze (SEU)</h2>
          <p>Bewertung nach Pareto über alle Anlagen: Anlagen, die zusammen bis etwa 80 % des Verbrauchs ausmachen, gelten als wesentlicher Energieeinsatz.</p>
          <table className="b-tab">
            <thead><tr><th>Anlage</th><th>Verbrauch</th><th>Anteil</th><th>Kumuliert</th><th>Einstufung</th></tr></thead>
            <tbody>
              {m.pareto.filter(a => gewaehlt(a.key)).map(a => (
                <tr key={a.key}><td><BPunkt farbe={B[a.farbe]} />{a.name}</td><td>{zahl(a.verbrauch)}</td><td>{a.anteil == null ? "–" : prozent(a.anteil)}</td>
                  <td>{prozent(a.kumuliert)}</td><td>{a.seu ? <b style={{ color: B.ubc }}>SEU</b> : "kein SEU"}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {zeigen("enpi") && anlagenKpi.length > 0 && (
        <section>
          <h2 className="b-umbruch">{nr("enpi")}. Energieleistung (EnPI)</h2>
          <p>EnPI = Σ Verbrauch ÷ Σ Bezugsgröße, Vergleich mit dem Basisjahr {basisJahr} über die gleichen Monate. Ein sinkender EnPI ist eine Verbesserung.</p>
          <table className="b-tab b-block">
            <thead><tr><th>Anlage</th><th>Bezugsgröße</th><th>EnPI {jahr}</th><th>EnPI {basisJahr}</th><th>Veränderung</th>
              {einst.ziel ? <th>Ziel</th> : null}<th>Normalisierte Einsparung</th><th>Modell R²</th><th>Potenzial</th></tr></thead>
            <tbody>
              {anlagenKpi.map(a => (
                <tr key={a.key} className={a.key === "ST" ? "b-summe" : ""}>
                  <td><BPunkt farbe={B[a.farbe]} />{a.name}</td><td>{a.treiber}</td><td><b>{dez(a.enpiAkt, 3)}</b></td><td>{dez(a.enpiBasis, 3)}</td>
                  <td><BDelta v={a.veraenderung} /></td>
                  {einst.ziel ? <td>{a.zielErreicht == null ? "–" : a.zielErreicht ? <span style={{ color: B.gut }}>✔ erreicht</span> : <span style={{ color: B.schlecht }}>✘ verfehlt</span>}</td> : null}
                  <td>{a.einsparung == null ? "–" : <span style={{ color: a.einsparung >= 0 ? B.gut : B.schlecht }}>{a.einsparung >= 0 ? "+" : "−"}{zahl(Math.abs(a.einsparung))}</span>}</td>
                  <td>{a.reg ? `${dez(a.reg.r2, 2)} (${modellGuete(a.reg).text})` : "–"}</td>
                  <td>{a.potenzial == null ? "–" : zahl(a.potenzial)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {anlagenKpi.filter(a => a.reg).map(a => (
            <div key={a.key} className="b-block">
              <h3>CUSUM {a.name}: kumulierte Einsparung gegenüber dem Baseline-Modell</h3>
              <ComposedChart width={680} height={200} data={a.monatlich} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={B.linie} />
                <XAxis dataKey="monat" tickLine={false} axisLine={false} tick={{ fill: B.leise, fontSize: 11 }} />
                <YAxis tickFormatter={kurz} tickLine={false} axisLine={false} width={64} tick={{ fill: B.leise, fontSize: 11 }} />
                <Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke={B.leise} />
                <Bar dataKey="einsparung" name="Einsparung im Monat" maxBarSize={26} isAnimationActive={false} fill={B.gut}>
                  {a.monatlich.map(z => <Cell key={z.Monat} fill={(z.einsparung ?? 0) >= 0 ? B.gut : B.schlecht} />)}
                </Bar>
                <Line dataKey="cusum" name="CUSUM" stroke={B[a.farbe]} strokeWidth={2.5} dot={{ r: 2.5 }} isAnimationActive={false} type="monotone" />
              </ComposedChart>
              <p className="b-klein">Modell: Verbrauch = {wert(a.reg.a)} + {dez(a.reg.b, 4)} × {a.treiber}, R² = {dez(a.reg.r2, 3)}, {a.reg.n} Monate des Basisjahres {basisJahr}.</p>
            </div>
          ))}
        </section>
      )}

      {zeigen("prognose") && prog && (
        <section className="b-block">
          <h2>{nr("prognose")}. Prognose Jahresende</h2>
          <p>Hochrechnung bis Dezember {jahr} auf Basis von {rows.length} Monaten: Menge nach Saisonverlauf des Vorjahres, Verbrauch nach Baseline-Modell mit der bisherigen Leistung. Spanne ≈ 90 % Sicherheit.</p>
          <table className="b-tab">
            <thead><tr><th>Anlage</th><th>Ist bis {MONATE[rows.at(-1).Monat - 1]}</th><th>Prognose Jahr</th><th>Spanne ±</th><th>Jahr {jahr - 1}</th><th>EnPI Jahresende</th>
              {einst.ziel ? <><th>Ziel-EnPI</th><th>Status</th></> : null}</tr></thead>
            <tbody>{prog.filter(x => gewaehlt(x.key)).map(x => (
              <tr key={x.key} className={x.key === "ST" ? "b-summe" : ""}>
                <td><BPunkt farbe={B[x.farbe]} />{x.name}</td><td>{zahl(x.ytdV)}</td><td><b>{zahl(x.jahrV)}</b></td><td>{zahl(x.spanne)}</td>
                <td>{x.vjV == null ? "–" : zahl(x.vjV)}</td><td>{dez(x.enpiJahr, 3)}</td>
                {einst.ziel ? <><td>{dez(x.zielJahr, 3)}</td><td style={{ color: x.status === "sicher" ? B.gut : x.status === "knapp" ? B.ubc : B.schlecht }}>
                  {x.status ? PROGNOSE_STATUS[x.status].name : "–"}</td></> : null}
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}

      {zeigen("massnahmen") && (
        <section>
          <h2>{nr("massnahmen")}. Maßnahmenplan</h2>
          {!liste.length ? <p>Für die gewählten Anlagen sind keine Maßnahmen erfasst.</p> : (
            <table className="b-tab b-text">
              <thead><tr><th>Maßnahme</th><th>Anlage</th><th>Verantwortlich</th><th>Frist</th><th>Status</th><th>Erwartet / Jahr</th><th>Gemessen</th></tr></thead>
              <tbody>
                {[...liste].sort((x, y) => M_PRIO[x.prioritaet].rang - M_PRIO[y.prioritaet].rang).map(x => (
                  <tr key={x.id} className="b-block">
                    <td><b>{x.titel}</b>{x.prioritaet === "hoch" && <span style={{ color: B.schlecht }}> ●</span>}</td>
                    <td>{ANLAGE_NAME[x.anlage]}</td><td>{x.verantwortlich || "–"}</td>
                    <td style={{ color: x.ueberfaellig ? B.schlecht : undefined }}>{x.frist ? dayjs(x.frist).format("DD.MM.YYYY") : "–"}{x.ueberfaellig ? " (überfällig)" : ""}</td>
                    <td>{M_STATUS[x.status].name}{x.status === "umgesetzt" && x.umgesetztAm ? ` am ${dayjs(x.umgesetztAm).format("DD.MM.YYYY")}` : ""}</td>
                    <td>{x.einsparung == null ? "–" : zahl(x.einsparung)}</td>
                    <td>{x.messung?.gemessen == null ? "–" : `${x.messung.gemessen >= 0 ? "+" : "−"}${zahl(Math.abs(x.messung.gemessen))}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {umgesetzt.length > 0 && <p className="b-klein">Gemessene Einsparung der umgesetzten Maßnahmen im Zeitraum: {gemessen >= 0 ? "+" : "−"}{zahl(Math.abs(gemessen))} (Baseline-Modell der jeweiligen Anlage, ab dem Folgemonat der Umsetzung; mehrere Maßnahmen an derselben Anlage teilen sich die Messung).</p>}
        </section>
      )}

      {zeigen("warnungen") && (
        <section className="b-block">
          <h2>{nr("warnungen")}. Auffälligkeiten</h2>
          {!wichtig.length ? <p>Die automatische Prüfung hat für den Zeitraum keine Auffälligkeiten gefunden.</p> : (
            <table className="b-tab b-text">
              <thead><tr><th>Stufe</th><th>Meldung</th><th>Details</th></tr></thead>
              <tbody>{wichtig.map(x => (
                <tr key={x.id}><td style={{ color: x.stufe === "kritisch" ? B.schlecht : B.ubc, whiteSpace: "nowrap" }}><b>{STUFE[x.stufe].name}</b></td><td>{x.titel}</td><td>{x.text}</td></tr>
              ))}</tbody>
            </table>
          )}
        </section>
      )}

      {zeigen("methodik") && (
        <section className="b-block">
          <h2>{nr("methodik")}. Methodik und Datenqualität</h2>
          <ul>
            <li>Datenquelle: Tabelle dbo.SEUWerte der Datenbank MRS_BI, Monatswerte je Anlage; Zeitraum {zeitraum}.</li>
            <li>EnPI gewichtet über den Zeitraum (Σ Verbrauch ÷ Σ Bezugsgröße), skaliert wie die Spalten *_Wert der Datenbank.</li>
            <li>Baseline-Modell nach ISO 50006: lineare Regression Verbrauch = a + b × Bezugsgröße über alle Monate des Basisjahres {basisJahr}; R² ab 0,75 belastbar.</li>
            <li>Normalisierte Einsparung = erwarteter minus tatsächlicher Verbrauch; CUSUM = kumulierte Summe dieser Werte.</li>
            <li>Einheiten sind in der Datenbank nicht hinterlegt (vermutlich kWh und Tonnen).</li>
            {anlagenKpi.filter(a => a.reg && (a.reg.n < 6 || a.reg.r2 < 0.75)).map(a => (
              <li key={a.key}>Eingeschränkte Modellgüte bei {a.name}: R² = {dez(a.reg.r2, 2)}, {a.reg.n} Monate.</li>))}
          </ul>
        </section>
      )}

      {zeigen("freigabe") && (
        <section className="b-block">
          <h2>{nr("freigabe")}. Freigabe</h2>
          <div className="b-unterschriften">
            {[["Erstellt", ersteller || "Energiemanagementbeauftragte/r"], ["Geprüft und freigegeben", "Geschäftsführung"]].map(([t, n]) => (
              <div key={t}><span>{t}</span><div className="b-linie" /><small>Datum, Unterschrift · {n}</small></div>
            ))}
          </div>
        </section>
      )}

      <footer className="b-fuss">MRS Produktion · Energiebericht {jahr} ({zeitraum}) · erstellt am {dayjs().format("DD.MM.YYYY")}{ersteller ? ` von ${ersteller}` : ""}</footer>
    </div>
  );
}

// =====================================================================
// Abgleich : KPI calculés (SEUWerte) ↔ KPI enregistrés (tables KPI)
// =====================================================================
const ZUORDNUNG_SPEICHER = "mrs-kpi-zuordnung";
const BERECHNET_SEU_KEY = { 1: "P1", 2: "P2", 3: "UB", 4: "ME", 5: "ST" };

// propositions d'association d'après les noms
function seuVorschlag(name) {
  const n = String(name || "").toLowerCase();
  if (/presse/.test(n) && /(\bii\b|\b2\b|zwei)/.test(n)) return 2;
  if (/presse/.test(n)) return 1;
  if (/ubc|dose|aufbereit/.test(n)) return 3;
  if (/\bme\b|ofen|schmelz/.test(n)) return 4;
  if (/standort|gesamt|werk|total/.test(n)) return 5;
  return null;
}
function typVorschlag(name) {
  const n = String(name || "").toLowerCase();
  if (/co2|co₂|emission|kosten|€|euro/.test(n)) return 0;          // pas calculable depuis SEUWerte
  if (/anteil|prozent|%/.test(n)) return 2;
  if (/durchsatz/.test(n)) return 4;
  if (/gesamtmenge/.test(n)) return 3;
  if (/kwh|spezif|enpi|je t|pro t|\/t|tonne|stunde|verbrauch/.test(n)) return 1;
  return 0;
}
// facteur d'échelle entre deux séries (ex. ×1000 si l'une est en kg, l'autre en t)
function skala(paare) {
  const r = paare.filter(([a, b]) => a && b).map(([a, b]) => a / b).sort((x, y) => x - y);
  if (!r.length) return 1;
  const med = r[Math.floor(r.length / 2)];
  const p = 10 ** Math.round(Math.log10(Math.abs(med)));
  return Math.abs(med / p - 1) < 0.02 ? p : 1;
}

const ABGLEICH_FARBE = { ok: "#2F9E8F", leicht: "#E39A2D", stark: "#CF4B3B", fehltB: "#A6AFB8", fehltG: "#7C6BB0" };

function KpiAbgleich({ jahr: globalJahr, dunkel }) {
  const { message } = AntApp.useApp();
  const [jahr, setJahr] = useState(globalJahr);
  const [quelle, setQuelle] = useState("monat");
  const [toleranz, setToleranz] = useState(1);
  const [g, setG] = useState(null);
  const [b, setB] = useState(null);
  const [fehler, setFehler] = useState("");
  const [nurAbw, setNurAbw] = useState(true);
  const [zuo, setZuo] = useState(() => { try { return JSON.parse(localStorage.getItem(ZUORDNUNG_SPEICHER)) || { seu: {}, typ: {} }; } catch { return { seu: {}, typ: {} }; } });
  const f = farben(dunkel);
  useEffect(() => { if (globalJahr) setJahr(globalJahr); }, [globalJahr]);
  useEffect(() => { try { localStorage.setItem(ZUORDNUNG_SPEICHER, JSON.stringify(zuo)); } catch { /* sans stockage */ } }, [zuo]);
  useEffect(() => {
    if (!jahr) return;
    setG(null); setB(null); setFehler("");
    Promise.all([api(`/api/kpi?jahr=${jahr}&quelle=${quelle}`), api(`/api/kpi?jahr=${jahr}&quelle=berechnet`)])
      .then(([x, y]) => { setG(x); setB(y); }).catch(e => setFehler(e.message));
  }, [jahr, quelle]);

  // propositions automatiques pour ce qui n'est pas encore associé
  useEffect(() => {
    if (!g) return;
    setZuo(z => ({
      seu: { ...Object.fromEntries(g.seus.map(s => [s.id, seuVorschlag(s.name)])), ...z.seu },
      typ: { ...Object.fromEntries(g.typen.map(t => [t.id, typVorschlag(t.name)])), ...z.typ }
    }));
  }, [g]);

  const auswertung = useMemo(() => {
    if (!g || !b) return null;
    const tol = toleranz / 100;
    const gAkt = g.zeilen.filter(z => z.jahr === jahr), bAkt = b.zeilen.filter(z => z.jahr === jahr);
    const kombis = [...new Map(gAkt.map(z => [`${z.seu}|${z.typ}`, { seu: z.seu, typ: z.typ }])).values()]
      .filter(k => zuo.seu[k.seu] && zuo.typ[k.typ]);
    const zeilen = [], matrix = [];
    for (const k of kombis) {
      const bs = zuo.seu[k.seu], bt = zuo.typ[k.typ];
      const gz = gAkt.filter(z => z.seu === k.seu && z.typ === k.typ);
      const bz = bAkt.filter(z => z.seu === bs && z.typ === bt);
      const paar = (mo) => [gz.find(z => z.monat === mo), bz.find(z => z.monat === mo)];
      const monate = [...new Set([...gz, ...bz].map(z => z.monat))];
      const sK = skala(monate.map(mo => { const [x, y] = paar(mo); return [x?.kpi, y?.kpi]; }));
      const sZ = skala(monate.map(mo => { const [x, y] = paar(mo); return [x?.zaehler, y?.zaehler]; }));
      const sN = skala(monate.map(mo => { const [x, y] = paar(mo); return [x?.nenner, y?.nenner]; }));
      const zellen = {};
      for (const mo of monate) {
        const [x, y] = paar(mo);
        let status, dev = null, devZ = null, devN = null;
        if (x && !y) status = "fehltB";
        else if (!x && y) status = "fehltG";
        else {
          dev = y.kpi ? x.kpi / (y.kpi * sK) - 1 : null;
          devZ = y.zaehler && x.zaehler != null ? x.zaehler / (y.zaehler * sZ) - 1 : null;
          devN = y.nenner && x.nenner != null ? x.nenner / (y.nenner * sN) - 1 : null;
          status = dev == null ? "fehltB" : Math.abs(dev) <= tol ? "ok" : Math.abs(dev) <= 5 * tol ? "leicht" : "stark";
        }
        const hinweis = status === "fehltB" ? "Kein berechneter Wert (SEUWerte fehlt oder Zuordnung prüfen)"
          : status === "fehltG" ? "Wert fehlt in der KPI-Tabelle"
          : status === "ok" ? "stimmt überein"
          : devZ != null && Math.abs(devZ) > tol && (devN == null || Math.abs(devN) <= tol) ? "Zähler weicht ab (Verbrauch)"
          : devN != null && Math.abs(devN) > tol && (devZ == null || Math.abs(devZ) <= tol) ? "Nenner weicht ab (Bezugsgröße)"
          : devZ != null && devN != null && Math.abs(devZ) > tol && Math.abs(devN) > tol ? "Zähler und Nenner weichen ab"
          : "Berechnungsweise unterschiedlich (Zähler und Nenner stimmen)";
        zellen[mo] = { status, dev };
        zeilen.push({ key: `${k.seu}|${k.typ}|${mo}`, monat: mo, seu: k.seu, typ: k.typ, bs, bt, status, dev, devZ, devN, hinweis,
                      kpiG: x?.kpi ?? null, kpiB: y?.kpi ?? null, sK });
      }
      matrix.push({ key: `${k.seu}|${k.typ}`, seu: k.seu, typ: k.typ, bs, bt, sK, zellen });
    }
    const z = (s) => zeilen.filter(x => x.status === s).length;
    return { zeilen, matrix, ok: z("ok"), abw: z("leicht") + z("stark"), fehlt: z("fehltB") + z("fehltG"), stark: z("stark") };
  }, [g, b, zuo, toleranz, jahr]);

  if (fehler) return <Alert type="error" showIcon message="KPI-Daten konnten nicht geladen werden" description={fehler} />;
  if (!g || !b) return <Card><Skeleton active paragraph={{ rows: 10 }} /></Card>;

  const seuName = (id) => g.seus.find(s => s.id === id)?.name ?? `SEU ${id}`;
  const typName = (id) => g.typen.find(t => t.id === id)?.name ?? `Typ ${id}`;
  const bSeuName = (id) => b.seus.find(s => s.id === id)?.name ?? "–";
  const bTypName = (id) => b.typen.find(t => t.id === id)?.name ?? "–";
  const offenZuordnung = g.seus.filter(s => !zuo.seu[s.id]).length + g.typen.filter(t => zuo.typ[t.id] == null).length;
  const verglichen = auswertung.ok + auswertung.abw;
  const vorschlagen = () => {
    setZuo({ seu: Object.fromEntries(g.seus.map(s => [s.id, seuVorschlag(s.name)])), typ: Object.fromEntries(g.typen.map(t => [t.id, typVorschlag(t.name)])) });
    message.success("Zuordnung nach Namen neu vorgeschlagen");
  };
  const pct = (v) => (v == null ? "–" : `${v >= 0 ? "+" : "−"}${dez(Math.abs(v) * 100, 2)} %`);
  const liste = auswertung.zeilen.filter(x => !nurAbw || x.status !== "ok").sort((x, y) => Math.abs(y.dev ?? 9) - Math.abs(x.dev ?? 9));

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="flex-end" wrap gap={12}>
        <Kopf titel={`KPI-Abgleich ${jahr}`} text="Vergleicht die gespeicherten KPI mit den direkt aus SEUWerte berechneten Werten, Monat für Monat" />
        <Segmented value={quelle} onChange={setQuelle} options={[
          { value: "monat", label: <Tooltip title="dbo.KeyPerformanceIndicatorsMonth">Monatswerte</Tooltip>, icon: <CalendarOutlined /> },
          { value: "gesamt", label: <Tooltip title="dbo.KeyPerformanceIndicators">KPI-Tabelle</Tooltip>, icon: <DatabaseOutlined /> }]} />
      </Flex>

      <Flex gap={8} wrap align="center" className="filter-leiste">
        <Text strong><FilterOutlined /> Einstellungen</Text>
        <Select value={jahr} onChange={setJahr} style={{ width: 130 }} prefix={<CalendarOutlined />} aria-label="Jahr"
          options={(g.jahre.length ? g.jahre : [jahr]).map(j => ({ value: j, label: String(j) }))} />
        <InputNumber value={toleranz} onChange={v => setToleranz(v || 0.1)} min={0.1} max={20} step={0.5} decimalSeparator="," prefix={<AimOutlined />} suffix="% Toleranz" style={{ width: 170 }} aria-label="Toleranz" />
        <Space size={6}><Switch size="small" checked={nurAbw} onChange={setNurAbw} /><Text>nur Abweichungen</Text></Space>
        <Button icon={<BulbOutlined />} onClick={vorschlagen} style={{ marginLeft: "auto" }}>Zuordnung vorschlagen</Button>
      </Flex>

      <Collapse size="small" defaultActiveKey={offenZuordnung ? ["z"] : []} items={[{ key: "z",
        label: <Space><SwapOutlined /><b>Zuordnung</b><Text type="secondary">welche gespeicherte SEU und welcher KPI-Typ welchem berechneten Wert entspricht</Text>
          {offenZuordnung > 0 && <Tag color="warning" bordered={false}>{offenZuordnung} offen</Tag>}</Space>,
        children: (
          <Row gutter={[16, 16]}>
            <Col xs={24} xl={12}>
              <Table rowKey="id" size="small" pagination={false} dataSource={g.seus} title={() => <Space><ThunderboltOutlined /><b>SEU</b></Space>}
                columns={[
                  { title: `Gespeichert (${g.namenQuelle ? "Name" : "Nummer"})`, dataIndex: "name", render: (n, s) => <span>{n} <Text type="secondary">#{s.id}</Text></span> },
                  { title: <SwapOutlined />, width: 40, render: () => <SwapOutlined style={{ opacity: .5 }} /> },
                  { title: "Berechnet", key: "z", render: (_, s) => (
                    <Select value={zuo.seu[s.id] ?? null} onChange={v => setZuo(z => ({ ...z, seu: { ...z.seu, [s.id]: v } }))} allowClear placeholder="nicht vergleichen" style={{ width: 210 }}
                      options={b.seus.map(x => ({ value: x.id, label: <span><Punkt farbe={f[ANLAGE_FARBE[BERECHNET_SEU_KEY[x.id]]]} />{x.name}</span> }))} />) }
                ]} />
            </Col>
            <Col xs={24} xl={12}>
              <Table rowKey="id" size="small" pagination={false} dataSource={g.typen} title={() => <Space><FundOutlined /><b>KPI-Typ</b></Space>}
                columns={[
                  { title: "Gespeichert (KPIType)", dataIndex: "name" },
                  { title: <SwapOutlined />, width: 40, render: () => <SwapOutlined style={{ opacity: .5 }} /> },
                  { title: "Berechnet", key: "z", render: (_, t) => (
                    <Select value={zuo.typ[t.id] || 0} onChange={v => setZuo(z => ({ ...z, typ: { ...z.typ, [t.id]: v } }))} style={{ width: 260 }}
                      options={[{ value: 0, label: <Text type="secondary">nicht vergleichen</Text> }, ...b.typen.map(x => ({ value: x.id, label: x.name }))]} />) }
                ]} />
            </Col>
          </Row>) }]} />

      <Row gutter={[16, 16]}>
        <Kpi titel="Verglichene Werte" icon={<DiffOutlined />} value={verglichen}><Text type="secondary">Monat × SEU × KPI-Typ</Text></Kpi>
        <Kpi titel="Übereinstimmend" icon={<CheckCircleOutlined />} value={verglichen ? (auswertung.ok / verglichen) * 100 : "–"} precision={1} suffix={verglichen ? "%" : ""}
          valueStyle={{ color: "#2F9E8F" }}><Text type="secondary">{auswertung.ok} Werte innerhalb ±{dez(toleranz, 1)} %</Text></Kpi>
        <Kpi titel="Abweichend" icon={<WarningOutlined />} value={auswertung.abw} valueStyle={{ color: auswertung.abw ? (auswertung.stark ? "#CF4B3B" : "#E39A2D") : undefined }}>
          <Text type="secondary">davon {auswertung.stark} stark (über {dez(toleranz * 5, 1)} %)</Text></Kpi>
        <Kpi titel="Fehlende Werte" icon={<QuestionCircleOutlined />} value={auswertung.fehlt}><Text type="secondary">nur auf einer Seite vorhanden</Text></Kpi>
      </Row>

      {!auswertung.matrix.length ? (
        <Card><Empty image={<SwapOutlined style={{ fontSize: 44, opacity: .4 }} />} description="Noch nichts zu vergleichen: oben in der Zuordnung SEU und KPI-Typen den berechneten Werten zuordnen." /></Card>
      ) : (
        <>
          <Card title={<Space><AppstoreOutlined />Übersicht je Monat</Space>} styles={{ body: { padding: 0 } }}
            extra={<Space size={12} wrap>{[["ok", "stimmt"], ["leicht", "leichte Abw."], ["stark", "starke Abw."], ["fehltG", "fehlt in Tabelle"], ["fehltB", "nicht berechenbar"]]
              .map(([k, t]) => <span key={k} className="legende"><i style={{ background: ABGLEICH_FARBE[k] }} /><Text type="secondary" style={{ fontSize: 12 }}>{t}</Text></span>)}</Space>}>
            <Table rowKey="key" size="small" pagination={false} dataSource={auswertung.matrix} className="kopf-nowrap" scroll={{ x: "max-content" }}
              columns={[
                { title: "SEU", dataIndex: "seu", fixed: "left", width: 170, render: (s, r) => <span><Punkt farbe={f[ANLAGE_FARBE[BERECHNET_SEU_KEY[r.bs]]]} />{seuName(s)}</span> },
                { title: "KPI-Typ", dataIndex: "typ", width: 200, render: (t, r) => <Flex vertical><span>{typName(t)}</span>
                    {r.sK !== 1 && <Text type="secondary" style={{ fontSize: 11 }}>Skalierung × {zahl(r.sK)} erkannt</Text>}</Flex> },
                ...MONATE.map((m, i) => ({ title: m.slice(0, 3), key: `m${i}`, align: "center", width: 54, render: (_, r) => {
                  const c = r.zellen[i + 1];
                  if (!c) return <span className="abgleich-zelle leer" />;
                  return <Tooltip title={`${m}: ${c.status === "ok" ? "stimmt" : c.dev != null ? pct(c.dev) : c.status === "fehltG" ? "fehlt in Tabelle" : "nicht berechenbar"}`}>
                    <span className="abgleich-zelle" style={{ background: ABGLEICH_FARBE[c.status] }}>{c.status === "ok" ? <CheckOutlined /> : c.dev != null ? dez(Math.abs(c.dev) * 100, 0) : "?"}</span></Tooltip>;
                } }))
              ]} />
          </Card>

          <Card title={<Space><OrderedListOutlined />{nurAbw ? "Abweichungen und fehlende Werte" : "Alle Werte"}</Space>} styles={{ body: { padding: 0 } }}
            extra={<Button icon={<DownloadOutlined />} disabled={!liste.length} onClick={() => csvHerunterladen(`KPI_Abgleich_${jahr}.csv`,
              ["Monat", "SEU", "KPI-Typ", "Gespeichert", "Berechnet", "Abweichung %", "Zähler Abw. %", "Nenner Abw. %", "Hinweis"],
              liste.map(x => [MONATE[x.monat - 1], seuName(x.seu), typName(x.typ), x.kpiG, x.kpiB, x.dev == null ? "" : (x.dev * 100).toFixed(2),
                x.devZ == null ? "" : (x.devZ * 100).toFixed(2), x.devN == null ? "" : (x.devN * 100).toFixed(2), x.hinweis]))}>CSV</Button>}>
            <Table rowKey="key" size="middle" dataSource={liste} className="zahl kopf-nowrap" scroll={{ x: "max-content" }}
              pagination={{ pageSize: 15, hideOnSinglePage: true }}
              locale={{ emptyText: <Result status="success" icon={<CheckCircleOutlined style={{ color: "#2F9E8F" }} />} title="Alle verglichenen Werte stimmen überein" /> }}
              columns={[
                { title: <Space size={4}><ScheduleOutlined />Monat</Space>, dataIndex: "monat", render: v => MONATE[v - 1], sorter: (a, x) => a.monat - x.monat },
                { title: <Space size={4}><ThunderboltOutlined />SEU</Space>, dataIndex: "seu", render: s => seuName(s) },
                { title: <Space size={4}><FundOutlined />KPI-Typ</Space>, dataIndex: "typ", render: (t, r) => <Tooltip title={`berechnet: ${bSeuName(r.bs)} · ${bTypName(r.bt)}`}>{typName(t)}</Tooltip> },
                { title: <Space size={4}><DatabaseOutlined />Gespeichert</Space>, dataIndex: "kpiG", align: "right", render: v => dez(v, 3) },
                { title: <Space size={4}><ExperimentOutlined />Berechnet</Space>, dataIndex: "kpiB", align: "right", render: (v, r) => (v == null ? "–" : dez(v * r.sK, 3)) },
                { title: "Abweichung", dataIndex: "dev", align: "right", sorter: (a, x) => Math.abs(a.dev ?? 0) - Math.abs(x.dev ?? 0),
                  render: (v, r) => <Tag color={r.status === "ok" ? "success" : r.status === "leicht" ? "warning" : r.status === "stark" ? "error" : "default"} bordered={false}>{v == null ? "–" : pct(v)}</Tag> },
                { title: <Tooltip title="Zähler = Verbrauch"><Space size={4}><FunctionOutlined />Zähler</Space></Tooltip>, dataIndex: "devZ", align: "right", render: pct },
                { title: <Tooltip title="Nenner = Bezugsgröße (Menge, Stunden)"><Space size={4}><FunctionOutlined />Nenner</Space></Tooltip>, dataIndex: "devN", align: "right", render: pct },
                { title: <Space size={4}><BulbOutlined />Hinweis</Space>, dataIndex: "hinweis" }
              ]} />
          </Card>
        </>
      )}
    </Flex>
  );
}

// page SEU-KPI : onglets « Kennzahlen » et « Abgleich »
function SeuKpiSeite({ jahr, dunkel }) {
  const [tab, setTab] = useState("kennzahlen");
  return (
    <Tabs activeKey={tab} onChange={setTab} items={[
      { key: "kennzahlen", label: <Space><FundOutlined />Kennzahlen</Space>, children: <SeuKpi jahr={jahr} dunkel={dunkel} /> },
      { key: "abgleich", label: <Space><DiffOutlined />Abgleich berechnet ↔ gespeichert</Space>, children: <KpiAbgleich jahr={jahr} dunkel={dunkel} /> }
    ]} />
  );
}

// =====================================================================
// Abschaum (crasse) : quantité et taux par mois, tendance pluriannuelle, lien avec la part UBC
// Taux de crasse = Menge Bewegungen Abschaum ÷ Material verarbeitet gesamt
// =====================================================================
function Abschaum({ jahr, jahre, dunkel }) {
  const [daten, setDaten] = useState(null);
  const [fehler, setFehler] = useState("");
  const f = farben(dunkel);

  useEffect(() => {
    if (!jahre.length) return;
    setDaten(null);
    Promise.all(jahre.map(j => api(`/api/produktion?jahr=${j}`).then(d => d.aktuell)))
      .then(listen => setDaten(listen.flat())).catch(e => setFehler(e.message));
  }, [jahre.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (fehler) return <Alert type="error" showIcon message="Produktionsdaten konnten nicht geladen werden" description={fehler} />;
  if (!daten) return <Card><Skeleton active paragraph={{ rows: 8 }} /></Card>;

  const quote = (rs) => { const g = summe(rs, "gesamt"); return g ? summe(rs, "abschaum") / g : null; };
  const akt = daten.filter(r => r.Jahr === jahr), vj = daten.filter(r => r.Jahr === jahr - 1);
  const mitAbschaum = akt.some(r => r.abschaum);
  const proJahr = [...new Set(daten.map(r => r.Jahr))].sort().map(j => {
    const rs = daten.filter(r => r.Jahr === j);
    return { monat: String(j), quote: quote(rs) * 100, abschaum: summe(rs, "abschaum"), erfasst: rs.some(r => r.abschaum), format: { quote: v => `${dez(v, 2)} %`, abschaum: zahl } };
  });
  const monate = MONATE.map((m, i) => {
    const r = akt.find(x => x.Monat === i + 1), v = vj.find(x => x.Monat === i + 1);
    return { Monat: i + 1, monat: m.slice(0, 3), abschaum: r?.abschaum ?? null, gesamt: r?.gesamt ?? null,
             quote: r?.gesamt && r.abschaum != null ? (r.abschaum / r.gesamt) * 100 : null,
             vorjahr: v?.gesamt && v.abschaum ? (v.abschaum / v.gesamt) * 100 : null,
             ubc: r?.gesamt ? (r.ubc / r.gesamt) * 100 : null,
             format: { abschaum: zahl, quote: x => `${dez(x, 2)} %`, vorjahr: x => `${dez(x, 2)} %` } };
  });
  const qa = quote(akt), qv = vj.some(r => r.abschaum) ? quote(vj.filter(r => akt.some(a => a.Monat === r.Monat))) : null;
  const mitQ = monate.filter(x => x.quote != null && x.abschaum);
  const best = mitQ.reduce((a, x) => (!a || x.quote < a.quote ? x : a), null);
  const schlecht = mitQ.reduce((a, x) => (!a || x.quote > a.quote ? x : a), null);

  // lien taux de crasse ↔ part UBC (toutes années)
  const punkte = daten.filter(r => r.gesamt && r.abschaum).map(r => ({ x: (r.ubc / r.gesamt) * 100, y: (r.abschaum / r.gesamt) * 100, name: `${monatName(r)} ${r.Jahr}` }));
  const reg = regression(punkte.map(p => [p.x, p.y]));
  const xs = punkte.map(p => p.x);
  const linie = reg && xs.length ? [Math.min(...xs), Math.max(...xs)].map(x => ({ x, y: reg.a + reg.b * x })) : [];

  return (
    <Flex vertical gap={16}>
      <Kopf titel={`Abschaum ${jahr}`} text="Abschaummenge und Abschaumquote (Menge Bewegungen Abschaum ÷ Material verarbeitet gesamt), Tabelle ProduktionMonat" />

      {!mitAbschaum && (
        <Alert type="warning" showIcon message={`Für ${jahr} sind keine Abschaum-Bewegungen erfasst`}
          description={`Alle Monate stehen auf 0 oder leer. Die Auswertung über mehrere Jahre unten zeigt die erfassten Vorjahre. Bitte mit der Fachabteilung klären, ob die Erfassung geändert wurde.`} />
      )}

      <Row gutter={[16, 16]}>
        <Kpi titel="Abschaummenge" icon={<ExperimentOutlined />} value={summe(akt, "abschaum")} formatter={zahl}>
          <Text type="secondary">{akt.length} Monate, Einheit laut Datenbank</Text>
        </Kpi>
        <Kpi titel="Abschaumquote" icon={<PieChartOutlined />} value={mitAbschaum && qa != null ? qa * 100 : "–"} precision={2} suffix={mitAbschaum ? "%" : ""}
          valueStyle={{ color: f.ubc }}>
          {qv != null && mitAbschaum ? <Space size={6}><Delta v={qa / qv - 1} /><Text type="secondary">ggü. {jahr - 1} ({dez(qv * 100, 2)} %)</Text></Space>
            : <Text type="secondary">Anteil an der verarbeiteten Menge</Text>}
        </Kpi>
        <Kpi titel="Bester Monat" icon={<CheckCircleOutlined />} value={best ? best.quote : "–"} precision={2} suffix={best ? "%" : ""} valueStyle={{ color: best ? "#2F9E8F" : undefined }}>
          <Text type="secondary">{best ? MONATE[best.Monat - 1] : "keine Werte"}</Text>
        </Kpi>
        <Kpi titel="Höchste Quote" icon={<WarningOutlined />} value={schlecht ? schlecht.quote : "–"} precision={2} suffix={schlecht ? "%" : ""} valueStyle={{ color: schlecht ? "#CF4B3B" : undefined }}>
          <Text type="secondary">{schlecht ? MONATE[schlecht.Monat - 1] : "keine Werte"}</Text>
        </Kpi>
      </Row>

      {mitAbschaum && (
        <Card title={<Space><BarChartOutlined />Abschaum und Quote pro Monat</Space>}>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={monate} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={f.gitter} />
              <XAxis dataKey="monat" tickLine={false} axisLine={false} tick={{ fill: f.text, fontSize: 12 }} />
              <YAxis yAxisId="m" tickFormatter={kurz} tickLine={false} axisLine={false} width={72} tick={{ fill: f.text, fontSize: 12 }} />
              <YAxis yAxisId="q" orientation="right" tickFormatter={v => `${dez(v, 1)} %`} tickLine={false} axisLine={false} width={56} tick={{ fill: f.text, fontSize: 12 }} />
              <ChartTooltip content={<EnergieTooltip />} cursor={{ fill: "rgba(127,127,127,.08)" }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 13, color: f.text }} />
              <Bar yAxisId="m" dataKey="abschaum" name="Abschaummenge" fill={f.p2} maxBarSize={40} radius={[3, 3, 0, 0]} />
              <Line yAxisId="q" dataKey="quote" name={`Quote ${jahr}`} stroke={f.ubc} strokeWidth={3} dot={{ r: 3 }} type="monotone" />
              <Line yAxisId="q" dataKey="vorjahr" name={`Quote ${jahr - 1}`} stroke={f.vorjahr} strokeDasharray="5 5" strokeWidth={2} dot={false} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card title={<Space><HistoryOutlined />Abschaumquote je Jahr</Space>} style={{ height: "100%" }}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={proJahr} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={f.gitter} />
                <XAxis dataKey="monat" tickLine={false} axisLine={false} tick={{ fill: f.text, fontSize: 12 }} />
                <YAxis tickFormatter={v => `${dez(v, 1)} %`} tickLine={false} axisLine={false} width={56} tick={{ fill: f.text, fontSize: 12 }} />
                <ChartTooltip content={<EnergieTooltip />} cursor={{ fill: "rgba(127,127,127,.08)" }} />
                <Bar dataKey="quote" name="Abschaumquote" maxBarSize={56} radius={[4, 4, 0, 0]}>
                  {proJahr.map(x => <Cell key={x.monat} fill={!x.erfasst ? f.gitter : Number(x.monat) === jahr ? f.ubc : f.p2} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {proJahr.some(x => !x.erfasst) && <Text type="secondary" style={{ fontSize: 12 }}><InfoCircleOutlined /> Jahre ohne erfassten Abschaum: {proJahr.filter(x => !x.erfasst).map(x => x.monat).join(", ")}</Text>}
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title={<Space><DotChartOutlined />Zusammenhang mit dem UBC-Anteil</Space>} style={{ height: "100%" }}
            extra={reg && <Tag bordered={false} color={reg.r2 >= 0.5 ? "warning" : "default"}>R² {dez(reg.r2, 2)}</Tag>}>
            {punkte.length < 4 ? <Empty description="Zu wenige Monate mit Abschaum für eine Auswertung." /> : (
              <>
                <ResponsiveContainer width="100%" height={230}>
                  <ScatterChart margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                    <CartesianGrid stroke={f.gitter} />
                    <XAxis type="number" dataKey="x" name="UBC-Anteil" tickFormatter={v => `${dez(v, 0)} %`} tickLine={false} axisLine={false} tick={{ fill: f.text, fontSize: 12 }} domain={["auto", "auto"]} />
                    <YAxis type="number" dataKey="y" name="Abschaumquote" tickFormatter={v => `${dez(v, 1)} %`} tickLine={false} axisLine={false} width={56} tick={{ fill: f.text, fontSize: 12 }} domain={["auto", "auto"]} />
                    <ChartTooltip cursor={{ strokeDasharray: "3 3" }} formatter={(v, n) => [`${dez(v, 2)} %`, n]} labelFormatter={() => ""} />
                    <Scatter name="Monate" data={punkte} fill={f.ubc} />
                    {linie.length > 0 && <Scatter name="Trend" data={linie} line={{ stroke: f.linie, strokeWidth: 2 }} shape={() => <g />} isAnimationActive={false} />}
                  </ScatterChart>
                </ResponsiveContainer>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  <InfoCircleOutlined /> {reg && reg.r2 >= 0.5
                    ? `Deutlicher Zusammenhang: je Prozentpunkt mehr UBC steigt die Abschaumquote um etwa ${dez(reg.b, 3)} Prozentpunkte.`
                    : "Kein deutlicher Zusammenhang zwischen UBC-Anteil und Abschaumquote erkennbar."}
                </Text>
              </>
            )}
          </Card>
        </Col>
      </Row>

      <Card title={<Space><TableOutlined />Monatswerte {jahr}</Space>} styles={{ body: { padding: 0 } }}
        extra={<Button icon={<DownloadOutlined />} onClick={() => csvHerunterladen(`Abschaum_${jahr}.csv`, ["Monat", "Material gesamt", "Abschaum", "Quote %", `Quote ${jahr - 1} %`, "UBC-Anteil %"],
          monate.filter(x => x.gesamt != null).map(x => [MONATE[x.Monat - 1], x.gesamt, x.abschaum, x.quote?.toFixed(3), x.vorjahr?.toFixed(3), x.ubc?.toFixed(1)]))}>CSV</Button>}>
        <Table rowKey="Monat" size="middle" pagination={false} className="zahl kopf-nowrap" scroll={{ x: "max-content" }} dataSource={monate.filter(x => x.gesamt != null)}
          columns={[
            { title: <Space size={4}><ScheduleOutlined />Monat</Space>, dataIndex: "Monat", render: v => MONATE[v - 1] },
            { title: "Material gesamt", dataIndex: "gesamt", align: "right", render: zahl },
            { title: <Space size={4}><ExperimentOutlined />Abschaum</Space>, dataIndex: "abschaum", align: "right", render: zahl },
            { title: "Quote", dataIndex: "quote", align: "right", render: (v, x) => (v == null || !x.abschaum ? "–" : <b>{dez(v, 2)} %</b>) },
            { title: `Quote ${jahr - 1}`, dataIndex: "vorjahr", align: "right", render: v => (v == null ? "–" : `${dez(v, 2)} %`) },
            { title: "Δ (Prozentpunkte)", key: "d", align: "right", render: (_, x) => (x.quote == null || x.vorjahr == null || !x.abschaum ? "–"
                : Math.abs(x.quote - x.vorjahr) < 0.005 ? <Text type="secondary">±0</Text>
                : <Text style={{ color: x.quote <= x.vorjahr ? "#2F9E8F" : "#CF4B3B" }}>{x.quote > x.vorjahr ? "+" : "−"}{dez(Math.abs(x.quote - x.vorjahr), 2)}</Text>) },
            { title: <Space size={4}><PieChartOutlined />UBC-Anteil</Space>, dataIndex: "ubc", align: "right", render: v => (v == null ? "–" : `${dez(v, 1)} %`) }
          ]} />
      </Card>
    </Flex>
  );
}

// ---------- Alle Tabellen (lecture + modification optionnelle) ----------
const GANZ = ["int", "bigint", "smallint", "tinyint"];
const KOMMA = ["decimal", "numeric", "money", "float", "real"];
const ZEIT = ["datetime", "datetime2", "smalldatetime"];
const istDatum = (s) => s.typ === "date" || ZEIT.includes(s.typ);
const ohnePunkt = (sp) => /id$|^id|jahr|monat|nr$|nummer/i.test(sp);
const typText = (s) => `${s.typ}${s.laenge > 0 && !GANZ.includes(s.typ) && !KOMMA.includes(s.typ) ? `(${s.laenge})` : s.laenge === -1 ? "(max)" : ""}`;
const datumText = (s, v) => s.typ === "date" ? dayjs.utc(v).format("YYYY-MM-DD") : dayjs.utc(v).format("YYYY-MM-DDTHH:mm:ss") + ".000Z";

function anzeige(v, spalte) {
  if (v === null || v === undefined) return <Text type="secondary">–</Text>;
  if (typeof v === "boolean") return v ? "Ja" : "Nein";
  if (typeof v === "number") return ohnePunkt(spalte) ? String(v) : v.toLocaleString("de-DE", { maximumFractionDigits: 4 });
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return dayjs.utc(v).format(/T00:00:00/.test(v) ? "DD.MM.YYYY" : "DD.MM.YYYY HH:mm");
  return String(v);
}

function Eingabefeld({ s, gesperrt, neu }) {
  if (s.typ === "bit") return <Switch disabled={gesperrt} />;
  if (GANZ.includes(s.typ) || KOMMA.includes(s.typ)) {
    const punkte = !ohnePunkt(s.spalte);
    return <InputNumber style={{ width: "100%" }} disabled={gesperrt} decimalSeparator=","
      precision={GANZ.includes(s.typ) ? 0 : undefined} placeholder={s.identity && neu ? "automatisch" : undefined}
      formatter={punkte ? (v) => (v === undefined || v === null || v === "" ? "" : String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ".")) : undefined}
      parser={punkte ? (v) => (v ? v.replace(/\./g, "") : v) : undefined} />;
  }
  if (s.typ === "date") return <DatePicker style={{ width: "100%" }} disabled={gesperrt} format="DD.MM.YYYY" />;
  if (ZEIT.includes(s.typ)) return <DatePicker showTime style={{ width: "100%" }} disabled={gesperrt} format="DD.MM.YYYY HH:mm" />;
  if (s.laenge === -1 || s.laenge > 200) return <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} disabled={gesperrt} maxLength={s.laenge > 0 ? s.laenge : undefined} />;
  return <Input disabled={gesperrt} maxLength={s.laenge > 0 ? s.laenge : undefined} showCount={s.laenge > 0 && s.laenge <= 200} />;
}

// Übersicht d'une table : comme la page Übersicht principale
//  - 4 chiffres clés pour la colonne choisie
//  - 3 diagrammes au choix : Verlauf (barres), Anteile (anneau), Vorjahr (lignes)
//  - tableau des chiffres de toutes les colonnes
const PALETTE = (f) => [f.p1, f.ubc, f.me, f.p2, "#9B6FB0", "#C4574A", "#5B8C5A", "#B08D57"];
const wert = (v) => (typeof v !== "number" ? (v ?? "–") : Number.isNaN(v) ? "–" : Math.abs(v) >= 100 ? zahl(v) : dez(v, 2));
const mittel = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function TabellenUebersicht({ ue, laedt, dunkel }) {
  const [auswahl, setAuswahl] = useState([]);
  const [haupt, setHaupt] = useState(null);
  const [art, setArt] = useState("summe");
  const [diagramm, setDiagramm] = useState("balken");
  const [gestapelt, setGestapelt] = useState(true);
  const namen = (ue?.spalten || []).map(s => s.spalte);
  const schluessel = namen.join("|");

  // nouvelle table : les 3 premières colonnes numériques, la 1re comme colonne principale
  useEffect(() => {
    setAuswahl(a => (a.length && a.every(x => namen.includes(x)) ? a : namen.slice(0, 3)));
    setHaupt(h => (namen.includes(h) ? h : namen[0] ?? null));
  }, [schluessel]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ue) return laedt ? <Skeleton active paragraph={{ rows: 8 }} /> : null;
  if (!ue.spalten.length) return <Empty image={<NumberOutlined style={{ fontSize: 44, opacity: .4 }} />} description="Diese Tabelle hat keine Zahlenspalten für eine Übersicht." />;

  const f = farben(dunkel);
  const farbe = PALETTE(f);
  const proMonat = ue.gruppierung === "monat";
  const einheit = proMonat ? "Monat" : "Jahr";
  const gName = (g) => (proMonat ? MONATE[g - 1] ?? String(g) : String(g));
  const artText = art === "summe" ? "Summe" : "Durchschnitt";
  const hs = ue.spalten.find(s => s.spalte === haupt) || ue.spalten[0];
  const vj = ue.vorjahr || [];

  // --- chiffres clés de la colonne principale ---
  const v = (g) => g?.[art]?.[hs.spalte];
  const mit = ue.gruppen.filter(g => v(g) != null);
  const schnitt = mit.length ? mittel(mit.map(v)) : null;
  const best = mit.reduce((a, g) => (!a || v(g) > v(a) ? g : a), null);
  const schwach = mit.reduce((a, g) => (!a || v(g) < v(a) ? g : a), null);
  const paare = mit.map(g => [g, proMonat ? vj.find(x => x.gruppe === g.gruppe) : vj[0]]);
  const vergleichbar = !!ue.jahr && mit.length > 0 && paare.every(([, x]) => v(x) != null);
  const zusammen = (xs) => (art === "summe" ? xs.reduce((a, b) => a + b, 0) : mittel(xs));
  const jetzt = vergleichbar ? zusammen(paare.map(([g]) => v(g))) : null;
  const vorher = vergleichbar ? zusammen(paare.map(([, x]) => v(x))) : null;
  const veraenderung = vergleichbar && vorher ? (jetzt - vorher) / Math.abs(vorher) : null;

  // --- diagrammes ---
  const vorjahrMoeglich = !!ue.jahr && proMonat;
  const aktiv = !ue.gruppierung ? "anteile" : diagramm === "vorjahr" && !vorjahrMoeglich ? "balken" : diagramm;
  const gewaehlt = ue.spalten.filter(s => auswahl.includes(s.spalte));
  const reihen = gewaehlt.map((s, i) => ({ key: `r${i}`, name: s.spalte, farbe: farbe[i % farbe.length] }));
  const balken = ue.gruppen.map(g => ({
    monat: proMonat ? gName(g.gruppe).slice(0, 3) : gName(g.gruppe),
    ...Object.fromEntries(gewaehlt.map((s, i) => [`r${i}`, g[art][s.spalte]]))
  }));
  const anteile = gewaehlt.map((s, i) => ({ name: s.spalte, value: Math.max(0, s.summe || 0), farbe: farbe[i % farbe.length] })).filter(a => a.value > 0);
  const anteilSumme = anteile.reduce((a, b) => a + b.value, 0);
  const monate = ue.monat ? [ue.monat] : MONATE.map((_, i) => i + 1);
  const vergleich = monate.map(m => ({
    monat: MONATE[m - 1].slice(0, 3),
    aktuell: v(ue.gruppen.find(g => g.gruppe === m)) ?? null,
    vorjahr: v(vj.find(g => g.gruppe === m)) ?? null
  }));

  const DIAGRAMME = [
    { value: "balken", icon: <BarChartOutlined />, label: "Verlauf", disabled: !ue.gruppierung,
      titel: `${artText} pro ${einheit}` },
    { value: "anteile", icon: <PieChartOutlined />, label: "Anteile",
      titel: "Anteile der Spalten (Summen)" },
    { value: "vorjahr", icon: <LineChartOutlined />, disabled: !vorjahrMoeglich,
      label: <Tooltip title={vorjahrMoeglich ? "" : "Oben ein Jahr wählen (Jahr + Monat nötig)"}>Vorjahr</Tooltip>,
      titel: `${hs.spalte}: ${ue.jahr} und ${ue.jahr - 1}` }
  ];
  const diag = DIAGRAMME.find(d => d.value === aktiv);

  return (
    <Flex vertical gap={16}>
      {/* colonne principale + Summe / Durchschnitt */}
      <Flex align="center" gap={8} wrap>
        <Select value={hs.spalte} onChange={setHaupt} prefix={<AimOutlined />} aria-label="Kennzahl" style={{ minWidth: 260 }}
          options={namen.map(n => ({ value: n, label: n }))} showSearch />
        <Segmented value={art} onChange={setArt} options={[
          { value: "summe", label: "Summe", icon: <FunctionOutlined /> },
          { value: "schnitt", label: "Durchschnitt", icon: <CalculatorOutlined /> }]} />
        <Text type="secondary" style={{ fontSize: 12 }}><InfoCircleOutlined /> Die Kennzahlen gelten für die gewählte Spalte.</Text>
      </Flex>

      <Row gutter={[16, 16]}>
        <Kpi titel={hs.spalte} icon={<AppstoreOutlined />} value={hs[art]} formatter={wert}>
          <Text type="secondary"><DatabaseOutlined /> {artText} aus {zahl(ue.zeilen)} Zeilen</Text>
        </Kpi>
        <Kpi titel={`Durchschnitt pro ${einheit}`} icon={<CalendarOutlined />} value={schnitt ?? "–"} formatter={wert}>
          <Text type="secondary">{ue.gruppierung ? `${mit.length} ${proMonat ? "Monate" : "Jahre"} mit Daten` : "Kein Zeitverlauf möglich"}</Text>
        </Kpi>
        <Kpi titel={`Stärkster ${einheit}`} icon={<RiseOutlined />} value={best ? v(best) : "–"} formatter={wert} valueStyle={{ color: f.ubc }}>
          {best ? <Space size={4} wrap><Tag color="gold" icon={<RiseOutlined />}>{gName(best.gruppe)}</Tag>
            <Text type="secondary"><FallOutlined /> schwächster: {gName(schwach.gruppe)}</Text></Space>
            : <Text type="secondary">Kein Zeitverlauf möglich</Text>}
        </Kpi>
        <Kpi titel="Veränderung zum Vorjahr" icon={<HistoryOutlined />}
          value={veraenderung === null ? "–" : Math.abs(veraenderung * 100)} precision={1} suffix={veraenderung === null ? "" : "%"}
          prefix={veraenderung === null ? null : veraenderung >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
          valueStyle={{ color: veraenderung === null ? undefined : veraenderung >= 0 ? "#2F9E8F" : "#CF4B3B" }}
          formatter={x => typeof x === "number" ? x.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : x}>
          <Text type="secondary">{veraenderung !== null ? `gegenüber ${wert(vorher)} (${ue.jahr - 1})`
            : ue.jahr ? `Keine vollständigen Daten für ${ue.jahr - 1}` : "Oben ein Jahr wählen"}</Text>
        </Kpi>
      </Row>

      {/* un seul graphique, choisi parmi 3 */}
      <Card title={<Space>{diag.icon}{diag.titel}</Space>}
        extra={<Segmented value={aktiv} onChange={setDiagramm} options={DIAGRAMME.map(({ titel, ...o }) => o)} />}>
        {aktiv !== "vorjahr" && (
          <Flex gap={12} wrap align="center" style={{ marginBottom: 12 }}>
            <Select mode="multiple" value={auswahl} onChange={x => x.length && x.length <= 8 && setAuswahl(x)} prefix={<ColumnWidthOutlined />}
              options={namen.map(n => ({ value: n, label: n }))} style={{ flex: 1, minWidth: 260 }} maxTagCount="responsive" aria-label="Spalten wählen" />
            {aktiv === "balken" && (
              <Tooltip title="Säulen übereinander (wie in der Hauptübersicht) oder nebeneinander">
                <Space size={6}><BlockOutlined /><Text>Gestapelt</Text><Switch size="small" checked={gestapelt} onChange={setGestapelt} /></Space>
              </Tooltip>
            )}
          </Flex>
        )}

        {aktiv === "balken" && (!balken.length ? <Empty description="Keine Daten für diese Auswahl." /> : (
          <>
            <div style={{ marginBottom: 8 }}><Legende reihen={reihen} /></div>
            <StapelBalken data={balken} reihen={reihen} f={f} hoehe={320} format={wert} gestapelt={gestapelt} />
          </>
        ))}

        {aktiv === "anteile" && (!anteilSumme ? <Empty description="Keine positiven Summen zum Vergleichen." /> : (
          <Flex align="center" justify="space-around" wrap gap={24} style={{ padding: "8px 0" }}>
            <Ring data={anteile} mitte={kurz(anteilSumme)} hoehe={210} />
            <Flex vertical gap={14}>
              {anteile.map(a => (
                <div key={a.name}>
                  <span className="legende"><i style={{ background: a.farbe }} /><Text type="secondary">{a.name}</Text></span>
                  <div style={{ fontSize: 20, fontWeight: 700 }} className="zahl">{prozent(a.value / anteilSumme)}</div>
                  <Text type="secondary" style={{ fontSize: 12 }}>{wert(a.value)}</Text>
                </div>
              ))}
            </Flex>
          </Flex>
        ))}

        {aktiv === "vorjahr" && (
          <Linien data={vergleich} f={f} hoehe={300} format={wert} reihen={[
            { key: "aktuell", name: String(ue.jahr), farbe: f.linie, dicke: 3 },
            { key: "vorjahr", name: String(ue.jahr - 1), farbe: f.vorjahr, gestrichelt: true, dicke: 2 }
          ]} />
        )}

        {!ue.gruppierung && (
          <Alert type="info" showIcon style={{ marginTop: 12 }}
            message="Diese Tabelle hat keine Jahr-, Monats- oder Datumsspalte: nur die Anteile sind möglich." />
        )}
      </Card>

      {/* chiffres de toutes les colonnes */}
      <Card size="small" title={<Space><OrderedListOutlined />Kennzahlen je Spalte</Space>} styles={{ body: { padding: 0 } }}>
        <Table rowKey="spalte" size="small" pagination={false} className="zahl" dataSource={ue.spalten} scroll={{ x: 640 }}
          onRow={s => ({ onClick: () => setHaupt(s.spalte), style: { cursor: "pointer" } })}
          rowClassName={s => (s.spalte === hs.spalte ? "zeile-aktiv" : "")}
          columns={[
            { title: <Space size={4}><NumberOutlined />Spalte</Space>, dataIndex: "spalte",
              render: x => <Space size={6}>{x === hs.spalte && <AimOutlined style={{ color: f.ubc }} />}<b>{x}</b></Space> },
            ...[["summe", "Summe", <FunctionOutlined />], ["schnitt", "Durchschnitt", <CalculatorOutlined />],
                ["min", "Minimum", <FallOutlined />], ["max", "Maximum", <RiseOutlined />]]
              .map(([k, t, ic]) => ({ title: <Space size={4}>{ic}{t}</Space>, dataIndex: k, align: "right", render: wert,
                                      sorter: (a, b) => (a[k] ?? 0) - (b[k] ?? 0) }))
          ]} />
      </Card>
    </Flex>
  );
}

// ---------- Übersicht : un onglet par table de consommation / coûts (Kosten, Energie, Gas, Erdgas …) ----------
// Les tables sont trouvées par le serveur (/api/verbrauch/tabellen, VERBRAUCH_MUSTER dans .env)
// et affichées exactement comme la Übersicht d'une table (TabellenUebersicht), seulement avec leurs colonnes de consommation.
const V_KATEGORIE = [
  { key: "kosten", re: /kosten|betrag|euro|€/i, name: "Kosten", icon: <EuroOutlined /> },
  { key: "gas", re: /gas/i, name: "Gas", icon: <FireOutlined /> },
  { key: "wasser", re: /wasser/i, name: "Wasser", icon: <CloudOutlined /> },
  { key: "energie", re: /strom|kwh|mwh|energie|verbrauch|seu|druckluft/i, name: "Energie", icon: <ThunderboltOutlined /> }
];
const V_SONSTIGE = { key: "sonstige", name: "Verbrauch", icon: <DashboardOutlined /> };
const vKategorie = (t) => V_KATEGORIE.find(k => k.re.test(t.tabelle)) || V_KATEGORIE.find(k => k.re.test(t.spalten.join(" "))) || V_SONSTIGE;
const kurzName = (t) => String(t).replace(/^dbo\./, "");

function VerbrauchTabelle({ t, jahr, dunkel, kat }) {
  const start = !t.zeit ? null : t.jahre.includes(jahr) ? jahr : t.jahre[0] ?? null;
  const [j, setJ] = useState(start);
  useEffect(() => { setJ(start); }, [jahr]); // eslint-disable-line react-hooks/exhaustive-deps
  const [ue, setUe] = useState(null);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState("");

  useEffect(() => {
    let aktiv = true;
    setLaedt(true); setFehler("");
    const q = new URLSearchParams({ nur: "verbrauch", ...(j ? { jahr: j } : {}) });
    api(`/api/tabellen/${encodeURIComponent(t.tabelle)}/uebersicht?${q}`)
      .then(d => aktiv && setUe(d)).catch(e => aktiv && setFehler(e.message)).finally(() => aktiv && setLaedt(false));
    return () => { aktiv = false; };
  }, [t.tabelle, j]);

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="flex-end" wrap gap={12}>
        <Kopf titel={<Space>{kat.icon}{`${kat.name}: ${kurzName(t.tabelle)}${j ? ` ${j}` : ""}`}</Space>}
          text={<Text type="secondary" ellipsis={{ tooltip: t.spalten.join(", ") }} style={{ maxWidth: 720 }}>
            Tabelle {t.tabelle}{t.view ? " (View)" : ""} · Spalten: {t.spalten.join(", ")}</Text>} />
        {t.zeit && t.jahre.length > 0 && (
          <Select value={j} onChange={setJ} style={{ width: 130 }} prefix={<CalendarOutlined />} aria-label="Jahr"
            options={t.jahre.map(x => ({ value: x, label: String(x) }))} />
        )}
      </Flex>
      {jahr && t.zeit && start && !t.jahre.includes(jahr) && j === start && (
        <Alert type="info" showIcon message={`Für ${jahr} gibt es in dieser Tabelle keine Daten: angezeigt wird ${start}.`} />
      )}
      {fehler ? <Alert type="error" showIcon message="Tabelle konnte nicht ausgewertet werden" description={fehler} />
        : <TabellenUebersicht ue={ue} laedt={laedt} dunkel={dunkel} />}
    </Flex>
  );
}

function UebersichtSeite({ k, laedt, dunkel, jahr }) {
  const [tabellen, setTabellen] = useState(null);
  const [fehler, setFehler] = useState("");
  const [tab, setTab] = useState("produktion");
  useEffect(() => { api("/api/verbrauch/tabellen").then(setTabellen).catch(e => { setTabellen([]); setFehler(e.message); }); }, []);

  const reihenfolge = { kosten: 0, energie: 1, gas: 2, wasser: 3, sonstige: 4 };
  const liste = (tabellen || []).map(t => ({ t, kat: vKategorie(t) }))
    .sort((a, b) => reihenfolge[a.kat.key] - reihenfolge[b.kat.key] || a.t.tabelle.localeCompare(b.t.tabelle, "de"));

  return (
    <Flex vertical gap={8}>
      {fehler && <Alert type="warning" showIcon message="Verbrauchstabellen konnten nicht gesucht werden" description={fehler} />}
      <Tabs activeKey={tab} onChange={setTab} items={[
        { key: "produktion", label: <Space><AppstoreOutlined />Produktion</Space>, children: <Uebersicht k={k} laedt={laedt} dunkel={dunkel} /> },
        ...liste.map(({ t, kat }) => ({
          key: t.tabelle, label: <Space>{kat.icon}{kurzName(t.tabelle)}</Space>,
          children: <VerbrauchTabelle key={t.tabelle} t={t} jahr={jahr} dunkel={dunkel} kat={kat} />
        }))
      ]} />
      {tabellen && !liste.length && !fehler && (
        <Text type="secondary" style={{ fontSize: 12 }}><InfoCircleOutlined /> Keine Tabelle mit Spalten zu Verbrauch oder Kosten gefunden.</Text>
      )}
    </Flex>
  );
}

function Tabellen({ jahr, dunkel }) {
  const { message, notification } = AntApp.useApp();
  const [liste, setListe] = useState(null);
  const [suche, setSuche] = useState("");
  const [gewaehlt, setGewaehlt] = useState(null);
  const [daten, setDaten] = useState(null);
  const [laedt, setLaedt] = useState(false);
  const [filter, setFilter] = useState("");
  const [fehler, setFehler] = useState("");
  const [neuLaden, setNeuLaden] = useState(0);
  // filtre année / mois + Übersicht
  const [fJahr, setFJahr] = useState(jahr);
  const [fMonat, setFMonat] = useState(null);
  const [ue, setUe] = useState(null);
  const [ueLaedt, setUeLaedt] = useState(false);
  const letzte = useRef(null);
  // modification
  const [status, setStatus] = useState({ aktiv: false });
  const [passwort, setPasswort] = useState(null);
  const [pw, setPw] = useState({ offen: false, eingabe: "", fehler: "", danach: null });
  const [drawer, setDrawer] = useState(null);       // { zeile } ou { zeile: null } pour une nouvelle ligne
  const [speichert, setSpeichert] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    api("/api/tabellen").then(setListe).catch(e => setFehler(e.message));
    api("/api/bearbeiten/status").then(setStatus).catch(() => {});
  }, []);

  function waehlen(name) {          // nouvelle table : filtre = année choisie en haut, tous les mois
    setGewaehlt(name); setFJahr(jahr); setFMonat(null);
  }
  const parameter = () => new URLSearchParams({ ...(fJahr ? { jahr: fJahr } : {}), ...(fMonat ? { monat: fMonat } : {}) }).toString();

  useEffect(() => {
    if (!gewaehlt) return;
    let aktiv = true;
    if (letzte.current !== gewaehlt) { setDaten(null); setUe(null); setFilter(""); letzte.current = gewaehlt; }
    const url = `/api/tabellen/${encodeURIComponent(gewaehlt)}`;
    setLaedt(true); setUeLaedt(true); setFehler("");
    api(`${url}?${parameter()}`)
      .then(d => {
        if (!aktiv) return;
        setDaten(d);
        // année absente de cette table → on prend la plus récente
        if (d.zeit && fJahr && d.jahre.length && !d.jahre.includes(fJahr)) setFJahr(d.jahre[0]);
      })
      .catch(e => aktiv && setFehler(e.message)).finally(() => aktiv && setLaedt(false));
    api(`${url}/uebersicht?${parameter()}`)
      .then(d => aktiv && setUe(d)).catch(() => aktiv && setUe(null)).finally(() => aktiv && setUeLaedt(false));
    return () => { aktiv = false; };
  }, [gewaehlt, neuLaden, fJahr, fMonat]); // eslint-disable-line react-hooks/exhaustive-deps

  const meta = daten?.meta;
  const klein = String(gewaehlt).toLowerCase();
  const erlaubt = !status.tabellen || [klein, klein.replace(/^dbo\./, "")].some(n => status.tabellen.includes(n));
  const bearbeitbar = status.aktiv && meta?.schluessel?.length > 0 && erlaubt;
  const grund = !status.aktiv ? "Nur Lesen: Bearbeiten ist ausgeschaltet (ALLOW_WRITE in .env) oder Ihre Rolle erlaubt es nicht."
    : !meta ? "Views können nicht bearbeitet werden."
    : !meta.schluessel?.length ? "Tabelle ohne Primärschlüssel: Bearbeiten nicht möglich."
    : !erlaubt ? "Diese Tabelle ist nicht in EDIT_TABELLEN freigegeben." : "";

  const gefiltert = (liste || []).filter(t => `${t.schema}.${t.tabelle}`.toLowerCase().includes(suche.toLowerCase()));
  const zeilen = useMemo(() => {
    if (!daten) return [];
    const f = filter.toLowerCase();
    return (f ? daten.zeilen.filter(z => Object.values(z).some(v => String(v ?? "").toLowerCase().includes(f))) : daten.zeilen)
      .map((z, i) => ({ ...z, __key: meta?.schluessel?.length ? meta.schluessel.map(k => z[k]).join("|") : i }));
  }, [daten, filter, meta]);

  // --- mot de passe : demandé une seule fois ---
  function mitPasswort(aktion) {
    if (passwort || status.passwort === false) aktion(passwort);
    else setPw({ offen: true, eingabe: "", fehler: "", danach: aktion });
  }
  async function pwPruefen() {
    try {
      await api("/api/bearbeiten/pruefen", { method: "POST", headers: { "x-bearbeiten-passwort": pw.eingabe } });
      setPasswort(pw.eingabe);
      const { danach, eingabe } = pw;
      setPw({ offen: false, eingabe: "", fehler: "", danach: null });
      if (danach) setTimeout(() => danach(eingabe), 0);
    } catch (e) { setPw(p => ({ ...p, fehler: e.message })); }
  }

  const senden = (methode, body, kennwort = passwort) => api(`/api/tabellen/${encodeURIComponent(gewaehlt)}/zeilen`, {
    method: methode, headers: { "Content-Type": "application/json", "x-bearbeiten-passwort": kennwort }, body: JSON.stringify(body)
  }).catch(e => { if (e.status === 401) setPasswort(null); throw e; });
  const schluesselVon = (z) => Object.fromEntries(meta.schluessel.map(k => [k, z[k]]));
  const fertig = (titel) => { notification.success({ message: titel, description: `${gewaehlt}, im Protokoll gespeichert`, placement: "topRight" }); setNeuLaden(n => n + 1); };

  const felder = (meta?.spalten || []).filter(s => !s.berechnet);
  function oeffnen(zeile) {
    form.resetFields();
    form.setFieldsValue(Object.fromEntries(felder.map(s => {
      const v = zeile?.[s.spalte];
      if (v === null || v === undefined) return [s.spalte, s.typ === "bit" ? false : null];
      return [s.spalte, istDatum(s) ? dayjs.utc(v) : v];
    })));
    setDrawer({ zeile });
  }

  async function speichern() {
    const werte = await form.validateFields();
    const neu = !drawer.zeile;
    const ausgabe = {};
    for (const s of felder) {
      if (s.identity || (!neu && s.schluessel)) continue;
      let v = werte[s.spalte];
      if (dayjs.isDayjs(v)) v = datumText(s, v);
      if (v === undefined || v === null) v = "";
      if (neu) { if (v !== "" || s.typ === "bit") ausgabe[s.spalte] = v; continue; }
      const alt = drawer.zeile[s.spalte];
      const altText = istDatum(s) && alt ? datumText(s, alt) : (alt ?? "");
      if (String(altText) !== String(v)) ausgabe[s.spalte] = v;     // seulement les champs modifiés
    }
    if (!neu && !Object.keys(ausgabe).length) { message.info("Keine Änderungen."); setDrawer(null); return; }
    setSpeichert(true);
    try {
      if (neu) { await senden("POST", { werte: ausgabe }); fertig("Zeile angelegt"); }
      else { await senden("PUT", { schluessel: schluesselVon(drawer.zeile), werte: ausgabe }); fertig("Zeile gespeichert"); }
      setDrawer(null);
    } catch (e) { message.error(e.message, 6); }
    finally { setSpeichert(false); }
  }

  async function loeschen(z, kennwort) {
    try { await senden("DELETE", { schluessel: schluesselVon(z) }, kennwort); fertig("Zeile gelöscht"); }
    catch (e) { message.error(e.message, 6); }
  }

  // --- colonnes du tableau ---
  const schluesselIcon = <KeyOutlined style={{ color: "#E39A2D" }} />;
  const spalten = (daten?.spalten || []).map(s => ({
    title: <Space size={4}>{meta?.schluessel?.includes(s.spalte) && schluesselIcon}{s.spalte}</Space>,
    dataIndex: s.spalte, ellipsis: true, width: 160,
    align: zeilen.length && typeof zeilen[0][s.spalte] === "number" ? "right" : "left",
    sorter: (a, b) => {
      const x = a[s.spalte], y = b[s.spalte];
      return typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""), "de");
    },
    render: v => anzeige(v, s.spalte)
  }));
  if (bearbeitbar) spalten.push({
    title: "", key: "aktionen", fixed: "right", width: 92,
    render: (_, z) => (
      <Space size={0}>
        <Tooltip title="Bearbeiten"><Button type="text" icon={<EditOutlined />} onClick={() => mitPasswort(() => oeffnen(z))} aria-label="Zeile bearbeiten" /></Tooltip>
        <Popconfirm title="Zeile endgültig löschen?" okText="Löschen" cancelText="Abbrechen" okButtonProps={{ danger: true }}
          description={<div style={{ maxWidth: 280 }}>{meta.schluessel.map(k => <div key={k}><Text type="secondary">{k}:</Text> <b>{String(z[k])}</b></div>)}
            <Text type="secondary" style={{ fontSize: 12 }}>Der alte Inhalt bleibt im Protokoll erhalten.</Text></div>}
          onConfirm={() => mitPasswort((kennwort) => loeschen(z, kennwort))}>
          <Tooltip title="Löschen"><Button type="text" danger icon={<DeleteOutlined />} aria-label="Zeile löschen" /></Tooltip>
        </Popconfirm>
      </Space>
    )
  });

  return (
    <Flex vertical gap={16}>
      <Text type="secondary">{status.aktiv ? "Bearbeiten ist eingeschaltet: Änderungen wirken direkt in der Datenbank und werden protokolliert." : "Nur Lesen, nichts kann verändert werden."}</Text>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={7} xl={6}>
          <Card styles={{ body: { padding: 12 } }}>
            <Input allowClear placeholder="Tabelle suchen" prefix={<SearchOutlined />} value={suche} onChange={e => setSuche(e.target.value)} />
            <Text type="secondary" style={{ fontSize: 12, display: "block", margin: "8px 4px" }}>{liste ? `${gefiltert.length} von ${liste.length} Tabellen` : "Wird geladen"}</Text>
            {!liste && !fehler && <Skeleton active />}
            <div style={{ maxHeight: "calc(100dvh - 320px)", overflowY: "auto" }}>
              <Menu mode="inline" selectedKeys={gewaehlt ? [gewaehlt] : []} style={{ borderInlineEnd: 0 }} onClick={e => waehlen(e.key)}
                items={gefiltert.map(t => ({
                  key: `${t.schema}.${t.tabelle}`,
                  icon: t.typ === "VIEW" ? <EyeOutlined /> : <TableOutlined />,
                  label: <Flex justify="space-between" gap={8}><span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{t.tabelle}</span>
                    {t.zeilen_ca != null && <Text type="secondary" style={{ fontSize: 12 }}>{kurz(Number(t.zeilen_ca))}</Text>}</Flex>
                }))} />
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={17} xl={18}>
          {fehler && <Alert type="error" showIcon message={fehler} style={{ marginBottom: 16 }} />}
          {!gewaehlt && !fehler && <Card><Empty image={<DatabaseOutlined style={{ fontSize: 48, opacity: .4 }} />} description="Links eine Tabelle auswählen" /></Card>}
          {gewaehlt && !daten && laedt && <Card><Skeleton active paragraph={{ rows: 10 }} /></Card>}
          {daten && (
            <Card
              title={<Space direction="vertical" size={0}><span>{daten.tabelle}</span>
                <Space size={4}><Tag color="blue" bordered={false}>{daten.zeilen_gesamt.toLocaleString("de-DE")} Zeilen</Tag><Tag bordered={false}>{daten.spalten.length} Spalten</Tag></Space></Space>}
              extra={
                <Space wrap>
                  {bearbeitbar ? (
                    <>
                      {status.passwort !== false && <Tooltip title={passwort ? "Freigeschaltet. Klicken zum Sperren." : "Gesperrt. Passwort wird beim ersten Bearbeiten abgefragt."}>
                        <Button shape="circle" icon={passwort ? <UnlockOutlined /> : <LockOutlined />} onClick={() => setPasswort(null)}
                                style={passwort ? { color: "#2F9E8F", borderColor: "#2F9E8F" } : undefined} aria-label="Sperren" />
                      </Tooltip>}
                      <Button type="primary" icon={<PlusOutlined />} onClick={() => mitPasswort(() => oeffnen(null))}>Neue Zeile</Button>
                    </>
                  ) : <Tooltip title={grund}><Tag icon={<LockOutlined />} style={{ padding: "4px 10px" }}>Nur Lesen</Tag></Tooltip>}
                  <Button icon={<DownloadOutlined />} disabled={!zeilen.length}
                    onClick={() => csvHerunterladen(`${gewaehlt}.csv`, daten.spalten.map(s => s.spalte), zeilen.map(z => daten.spalten.map(s => z[s.spalte])))}>CSV</Button>
                </Space>}>
              {daten.zeit && (
                <Flex gap={8} wrap align="center" className="filter-leiste">
                  <Text strong><FilterOutlined /> Filter</Text>
                  <Select value={fJahr ?? 0} onChange={v => setFJahr(v || null)} style={{ width: 150 }} prefix={<CalendarOutlined />} aria-label="Jahr filtern"
                    options={[{ value: 0, label: "Alle Jahre" }, ...daten.jahre.map(j => ({ value: j, label: String(j) }))]} />
                  <Select value={fMonat ?? 0} onChange={v => setFMonat(v || null)} style={{ width: 170 }} prefix={<ScheduleOutlined />} aria-label="Monat filtern"
                    disabled={daten.zeit.art === "spalten" && !daten.zeit.monat}
                    options={[{ value: 0, label: "Alle Monate" }, ...MONATE.map((m, i) => ({ value: i + 1, label: m }))]} />
                  {(fMonat || fJahr !== (daten.jahre.includes(jahr) ? jahr : daten.jahre[0])) && (
                    <Button icon={<UndoOutlined />} onClick={() => { setFJahr(daten.jahre.includes(jahr) ? jahr : daten.jahre[0] ?? null); setFMonat(null); }}>Zurücksetzen</Button>
                  )}
                  <Text type="secondary" style={{ fontSize: 12, marginLeft: "auto" }}>
                    <ClockCircleOutlined /> Zeit aus {daten.zeit.art === "datum" ? `Datumsspalte „${daten.zeit.datum}“` : `Spalte „${daten.zeit.jahr}“${daten.zeit.monat ? ` und „${daten.zeit.monat}“` : ""}`}
                  </Text>
                </Flex>
              )}
              <Tabs items={[
                { key: "uebersicht", label: <Space><DashboardOutlined />Übersicht</Space>, children: (
                  <TabellenUebersicht ue={ue} laedt={ueLaedt} dunkel={dunkel} />
                ) },
                { key: "daten", label: <Space><TableOutlined />Daten</Space>, children: (
                  <>
                    <Flex justify="space-between" wrap gap={8} style={{ marginBottom: 12 }}>
                      <Input allowClear placeholder="In den Daten suchen" prefix={<SearchOutlined />} value={filter} onChange={e => setFilter(e.target.value)} style={{ maxWidth: 300 }} />
                      <Text type="secondary">{daten.zeilen_gesamt > daten.zeilen.length ? `Neueste ${daten.zeilen.length} von ${daten.zeilen_gesamt.toLocaleString("de-DE")} Zeilen` : `${daten.zeilen.length} Zeilen`}</Text>
                    </Flex>
                    <Table rowKey="__key" columns={spalten} dataSource={zeilen} size="middle" loading={laedt} className="zahl"
                      scroll={{ x: Math.max(800, spalten.length * 160) }} pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: [20, 50, 100, 200] }} />
                  </>
                ) },
                { key: "spalten", label: <Space><KeyOutlined />Spalten</Space>, children: (
                  <Table rowKey="spalte" size="small" pagination={false} dataSource={meta?.spalten || daten.spalten}
                    columns={[
                      { title: "Spalte", dataIndex: "spalte", render: (v, s) => <Space>{s.schluessel && schluesselIcon}<b>{v}</b></Space> },
                      { title: "Typ", dataIndex: "typ", render: (_, s) => <Tag>{typText(s)}</Tag> },
                      { title: "Leer erlaubt", dataIndex: "nullable", render: n => (n === true || n === "YES") ? "Ja" : "Nein" },
                      { title: "Besonderheit", key: "x", render: (_, s) => <Space size={4}>{s.identity && <Tag color="blue">automatisch</Tag>}{s.berechnet && <Tag>berechnet</Tag>}{s.standard && <Tag>Standardwert</Tag>}</Space> }
                    ]} />
                ) }
              ]} />
            </Card>
          )}
        </Col>
      </Row>

      <Modal open={pw.offen} title={<Space><LockOutlined />Bearbeiten freischalten</Space>} okText="Freischalten" cancelText="Abbrechen"
             onOk={pwPruefen} onCancel={() => setPw(p => ({ ...p, offen: false }))} okButtonProps={{ disabled: !pw.eingabe }} destroyOnHidden>
        <Text type="secondary">Änderungen wirken direkt in der Datenbank MRS_BI.</Text>
        <Input.Password autoFocus style={{ marginTop: 12 }} placeholder="Bearbeitungs-Passwort" value={pw.eingabe} status={pw.fehler ? "error" : ""}
          onChange={e => setPw(p => ({ ...p, eingabe: e.target.value }))} onPressEnter={() => pw.eingabe && pwPruefen()} />
        {pw.fehler && <Text type="danger">{pw.fehler}</Text>}
      </Modal>

      <Drawer open={!!drawer} onClose={() => setDrawer(null)} width={520} destroyOnHidden
        title={drawer?.zeile ? "Zeile bearbeiten" : "Neue Zeile"}
        extra={<Text type="secondary">{meta?.voll}</Text>}
        footer={<Flex justify="space-between" align="center"><Text type="secondary" style={{ fontSize: 12 }}>Jede Änderung wird protokolliert.</Text>
          <Space><Button onClick={() => setDrawer(null)}>Abbrechen</Button><Button type="primary" loading={speichert} onClick={speichern}>{drawer?.zeile ? "Speichern" : "Anlegen"}</Button></Space></Flex>}>
        <Form form={form} layout="vertical" requiredMark>
          {felder.map(s => {
            const gesperrt = s.identity || (!!drawer?.zeile && s.schluessel);
            const pflicht = !s.nullable && !s.identity && !s.standard;
            return (
              <Form.Item key={s.spalte} name={s.spalte}
                label={<Space size={4}>{s.schluessel && schluesselIcon}{s.spalte}</Space>}
                extra={s.identity ? "wird automatisch vergeben" : `${typText(s)}${s.nullable ? ", darf leer sein" : ""}`}
                rules={pflicht && !gesperrt ? [{ required: true, message: "Pflichtfeld" }] : []}
                valuePropName={s.typ === "bit" ? "checked" : "value"}>
                <Eingabefeld s={s} gesperrt={gesperrt} neu={!drawer?.zeile} />
              </Form.Item>
            );
          })}
        </Form>
        {drawer && !drawer.zeile && felder.some(s => s.identity) && <Alert type="info" showIcon message="Der Schlüssel wird beim Anlegen automatisch vergeben." />}
      </Drawer>
    </Flex>
  );
}

// ---------- KI-Assistent ----------
// Vorschläge : thèmes fixes (toutes les pages de l'application) + questions générées pour CHAQUE table de la base
// (d'après ses colonnes), + tables de consommation / coûts trouvées automatiquement.
const ROBOTER_FARBE = "linear-gradient(140deg,#3E7099,#21465D)";
const ZEIT_SPALTE = /^(jahr|year|monat|month)$/i;

function themenFragen(j, verbrauch, tabellen) {
  const vt = (verbrauch || []).slice(0, 8);
  const gross = [...(tabellen || [])].sort((a, b) => Number(b.zeilen_ca || 0) - Number(a.zeilen_ca || 0)).slice(0, 4);
  return [
    { key: "produktion", label: "Produktion", icon: <BuildOutlined style={{ color: "#2B5874" }} />, fragen: [
      `Wie viel wurde ${j} insgesamt verarbeitet, und wie verteilt sich das auf Presse I, Presse II und UBC?`,
      `Welcher Monat war ${j} der stärkste und welcher der schwächste? Woran lag es?`,
      `Vergleiche Presse I und Presse II im ersten Halbjahr ${j}.`,
      `Wie hat sich der Anteil der UBC-Aufbereitung ${j} von Monat zu Monat entwickelt?`,
      `Liegen wir ${j} über oder unter ${j - 1}, und in welchen Monaten?`,
      `Wie entwickelt sich die Abschaumquote ${j} im Vergleich zu ${j - 1}?`,
      "Gibt es einen Zusammenhang zwischen UBC-Anteil und Abschaumquote?",
      `Welche Monate fehlen ${j} in der Tabelle ProduktionMonat?`,
      `Wie groß ist der Monatsdurchschnitt ${j}, und welche Monate liegen deutlich darunter?`,
      `Hochrechnung: Wie viel werden wir ${j} insgesamt verarbeiten, wenn es so weitergeht?`
    ] },
    { key: "energie", label: "Energie (SEU)", icon: <ThunderboltOutlined style={{ color: "#E39A2D" }} />, fragen: [
      `Welche Anlage verbraucht ${j} am meisten Energie, und wie viel Prozent sind das?`,
      `Wie hoch ist der spezifische Verbrauch (EnPI) je Anlage ${j}?`,
      `Hat sich der EnPI des Standorts ${j} gegenüber ${j - 1} verbessert oder verschlechtert?`,
      "Welche Anlagen sind nach Pareto wesentliche Energieeinsätze (SEU)?",
      `In welchem Monat ${j} war der Verbrauch im Verhältnis zur Menge am schlechtesten?`,
      `Wie viele Betriebsstunden hatte die Anlage ME ${j}, und wie viel Energie je Stunde?`,
      `Passt der Energieverbrauch ${j} zur produzierten Menge?`,
      `Wie hoch ist die Grundlast der Pressen ohne Produktion?`,
      "Stimmen die gespeicherten KPI mit den direkt aus SEUWerte berechneten Werten überein?",
      `Erreichen wir ${j} das Energieziel, wenn es so weitergeht?`
    ] },
    { key: "verbrauch", label: "Verbrauch & Kosten", icon: <EuroOutlined style={{ color: "#2F9E8F" }} />, fragen: [
      "Welche Tabellen mit Verbrauchs- oder Kostendaten gibt es, und was enthalten sie?",
      `Wie hoch waren die Energiekosten ${j} insgesamt, und wie im Vorjahr?`,
      `Welcher Energieträger (Strom, Gas, Erdgas …) ist ${j} der größte Kosten- oder Verbrauchsblock?`,
      `In welchem Monat ${j} waren Verbrauch und Kosten am höchsten?`,
      ...vt.flatMap(t => {
        const n = kurzName(t.tabelle), s = t.spalten[0];
        return [`Wie hat sich ${s} in ${n} ${j} pro Monat entwickelt, im Vergleich zu ${j - 1}?`,
                t.spalten[1] ? `Wie verhalten sich ${s} und ${t.spalten[1]} in ${n} zueinander?` : `In welchem Monat war ${s} in ${n} am höchsten?`];
      })
    ] },
    { key: "wartung", label: "Wartung & Störungen", icon: <ToolOutlined style={{ color: "#C4574A" }} />, fragen: [
      "Welche Störungen sind gerade offen, und seit wann?",
      `Welche Anlage hatte ${j} die meisten Stillstandsstunden?`,
      "Welche Wartungsarbeiten sind überfällig oder in den nächsten 30 Tagen fällig?",
      `Wie lang war die mittlere Reparaturzeit (MTTR) ${j}?`,
      "Welche Ursachen kommen bei Störungen am häufigsten vor?",
      "Für welche Anlagen gibt es noch keinen Wartungsplan?",
      "Gibt es Anlagen, an denen Störungen immer wieder auftreten?"
    ] },
    { key: "massnahmen", label: "Maßnahmen", icon: <ProjectOutlined style={{ color: "#7C6BB0" }} />, fragen: [
      "Welche Maßnahmen sind überfällig, und wer ist verantwortlich?",
      "Wie viel Einsparung erwarten wir von den offenen Maßnahmen pro Jahr?",
      "Welche umgesetzten Maßnahmen haben messbar Energie gespart?",
      "Welche Maßnahme hat die kürzeste Amortisationszeit?",
      "Für welche Anlage gibt es die meisten Maßnahmen?",
      "Was steht im letzten Monatskommentar?",
      "Welche Energie-Einstellungen gelten (Basisjahr, Ziel, Preis, CO₂-Faktor)?"
    ] },
    { key: "werk", label: "Werksplan", icon: <HomeOutlined style={{ color: "#4F83AA" }} />, fragen: [
      "Welche Hallen und Anlagen gibt es am Standort?",
      "Welche Anlagen stehen in welcher Halle?",
      "Für welche Anlagen fehlen noch Dokumente oder technische Daten?",
      "Welche Anlagen sind mit Live-Daten aus der Datenbank verbunden?",
      "Welche technischen Daten sind zu den Pressen hinterlegt?"
    ] },
    { key: "datenbank", label: "Datenbank", icon: <DatabaseOutlined style={{ color: "#4F83AA" }} />, fragen: [
      "Welche Tabellen gibt es in der Datenbank, und wofür sind sie da?",
      "Welche Tabellen sind am größten, und welche sind leer?",
      `Welche Tabellen haben Daten für ${j}?`,
      "In welchen Tabellen gibt es fehlende Monate oder leere Werte?",
      "Welche Tabellen hängen über gemeinsame Spalten zusammen?",
      ...gross.map(t => `Was enthält die Tabelle ${t.tabelle}, und wie viele Zeilen hat sie?`)
    ] }
  ];
}

// questions générées à partir des colonnes d'une table
function tabellenFragen(tabelle, spalten, j) {
  const n = kurzName(tabelle);
  const zahlen = spalten.filter(s => ZAHL_TYP.test(s.typ) && !ZEIT_SPALTE.test(s.spalte) && !/(^id$|_id$|ID$|Id$|^id_|nr$|nummer$)/i.test(s.spalte)).map(s => s.spalte);
  const zeit = spalten.some(s => /^(jahr|year)$/i.test(s.spalte) || /date|time/i.test(s.typ));
  const [a, b, c] = zahlen;
  return [
    `Was steht in der Tabelle ${n}? Erkläre die Spalten kurz.`,
    `Zeige die neuesten 10 Einträge aus ${n}.`,
    a && zeit && `Wie hat sich ${a} in ${n} ${j} pro Monat entwickelt?`,
    a && zeit && `Vergleiche ${a} in ${n} zwischen ${j} und ${j - 1}.`,
    a && zeit && `In welchem Monat ${j} war ${a} am höchsten, in welchem am niedrigsten?`,
    a && `Wie groß sind Summe, Durchschnitt, Minimum und Maximum von ${a} in ${n}?`,
    b && `Gibt es einen Zusammenhang zwischen ${a} und ${b} in ${n}?`,
    c && `Welche Zahlenspalte in ${n} hat den größten Anteil an der Summe: ${a}, ${b} oder ${c}?`,
    b && zeit && `Wie hat sich das Verhältnis ${a} zu ${b} in ${n} über die Monate ${j} verändert?`,
    `Gibt es in ${n} Ausreißer, leere oder doppelte Werte?`,
    zeit && `Für welche Zeiträume fehlen in ${n} Daten?`,
    zeit && `Welche Jahre enthält ${n}, und wie haben sich die Werte von Jahr zu Jahr entwickelt?`
  ].filter(Boolean);
}

const mischen = (xs, seed) => (!seed ? xs : xs.map((x, i) => [x, Math.sin(seed * 9301 + i * 49.297)]).sort((p, q) => p[1] - q[1]).map(p => p[0]));

function FragenAuswahl({ jahr, tabellen, verbrauch, stellen }) {
  const [thema, setThema] = useState("produktion");
  const [seed, setSeed] = useState(0);
  const [alle, setAlle] = useState(false);
  const [tabelle, setTabelle] = useState(null);
  const [spalten, setSpalten] = useState(null);
  const j = jahr || new Date().getFullYear();
  const themen = useMemo(() => themenFragen(j, verbrauch, tabellen), [j, verbrauch, tabellen]);
  useEffect(() => {
    setSpalten(null);
    if (!tabelle) return;
    api(`/api/live/spalten?tabelle=${encodeURIComponent(tabelle)}`).then(d => setSpalten(d.spalten)).catch(() => setSpalten([]));
  }, [tabelle]);
  useEffect(() => { setAlle(false); setSeed(0); }, [thema]);

  const aktiv = themen.find(t => t.key === thema);
  const pool = thema === "tabelle" ? (tabelle && spalten ? tabellenFragen(tabelle, spalten, j) : []) : aktiv?.fragen || [];
  const zeigen = alle ? pool : mischen(pool, seed).slice(0, 6);

  return (
    <Flex vertical gap={12}>
      <div className="fragen-themen">
        <Segmented value={thema} onChange={setThema} options={[
          ...themen.map(t => ({ value: t.key, label: t.label, icon: t.icon })),
          { value: "tabelle", label: "Tabelle wählen", icon: <TableOutlined /> }]} />
      </div>
      {thema === "tabelle" && (
        <Select showSearch allowClear value={tabelle} onChange={setTabelle} placeholder={`Eine der ${tabellen.length} Tabellen auswählen`}
          prefix={<TableOutlined />} style={{ width: "100%", maxWidth: 460 }} aria-label="Tabelle"
          options={tabellen.map(t => ({ value: `${t.schema}.${t.tabelle}`, label: `${t.schema}.${t.tabelle}${t.zeilen_ca != null ? ` (${kurz(Number(t.zeilen_ca))} Zeilen)` : ""}` }))} />
      )}
      {thema === "tabelle" && !tabelle && <Text type="secondary">Wählen Sie eine Tabelle: die Vorschläge passen sich an ihre Spalten an.</Text>}
      {thema === "tabelle" && tabelle && !spalten && <Skeleton active paragraph={{ rows: 2 }} title={false} />}
      {zeigen.length > 0 && (
        <div className="fragen-raster">
          {zeigen.map(q => (
            <button key={q} className="frage-knopf" onClick={() => stellen(q)}>
              <span>{q}</span><SendOutlined />
            </button>
          ))}
        </div>
      )}
      {pool.length > 6 && (
        <Space size={4} wrap>
          {!alle && <Button type="link" size="small" icon={<SyncOutlined />} onClick={() => setSeed(Math.random() + 0.1)} style={{ paddingInline: 0 }}>Andere Vorschläge</Button>}
          <Button type="link" size="small" onClick={() => setAlle(x => !x)}>{alle ? "Weniger zeigen" : `Alle ${pool.length} Fragen zeigen`}</Button>
        </Space>
      )}
    </Flex>
  );
}

// Nachfragen : tournent d'une réponse à l'autre
const NACHFRAGEN = ["Und im Vergleich zum Vorjahr?", "Erklär das genauer.", "Was sollten wir daraus ableiten?", "Welche Anlage ist dafür verantwortlich?",
  "Zeig mir die Monatswerte dazu.", "Wie sicher ist diese Aussage?", "Gibt es dabei Auffälligkeiten?", "Was bedeutet das für die Kosten?",
  "Und wie sieht es im letzten Monat aus?", "Welche Maßnahme würdest du vorschlagen?", "Fasse das in drei Sätzen für die Geschäftsführung zusammen."];
const nachfragenFuer = (n) => Array.from({ length: 4 }, (_, i) => NACHFRAGEN[(n * 3 + i) % NACHFRAGEN.length])
  .map((t, i) => ({ key: `n${i}`, icon: <BulbOutlined />, description: t }));

// réponse sans IA à une question qui nomme une table : chiffres de la Übersicht de cette table
async function antwortTabelleOhneKI(frage, tabellen, jahr) {
  const t = frage.toLowerCase();
  const name = tabellen.map(x => `${x.schema}.${x.tabelle}`)
    .filter(n => t.includes(kurzName(n).toLowerCase()) && kurzName(n).length > 2).sort((a, b) => b.length - a.length)[0];
  if (!name) return null;
  const url = `/api/tabellen/${encodeURIComponent(name)}/uebersicht`;
  let ue = await api(`${url}?jahr=${jahr}`);
  if (!ue.zeilen) ue = await api(url);                       // aucune ligne cette année : toutes les années
  const kopf = `Tabelle **${name}**${ue.jahr ? `, Jahr ${ue.jahr}` : ", alle Jahre"}: **${zahl(ue.zeilen)}** Zeilen.`;
  if (!ue.spalten.length) return `${kopf} Die Tabelle hat keine Zahlenspalten zum Auswerten.`;
  let text = `${kopf}\n\n` + liste(ue.spalten.slice(0, 8).map(s => `${s.spalte}: Summe ${wert(s.summe)}, Durchschnitt ${wert(s.schnitt)}, Min ${wert(s.min)}, Max ${wert(s.max)}`));
  const s = ue.spalten[0].spalte, g = ue.gruppen.filter(x => x.summe[s] != null).sort((p, q) => q.summe[s] - p.summe[s]);
  const gn = (x) => (ue.gruppierung === "monat" ? MONATE[x.gruppe - 1] : String(x.gruppe));
  if (g.length > 1) text += `\n\n**${s}** am höchsten: ${gn(g[0])} (${wert(g[0].summe[s])}), am niedrigsten: ${gn(g.at(-1))} (${wert(g.at(-1).summe[s])}).`;
  if (ue.weitere) text += `\n\n${ue.weitere} weitere Zahlenspalten sind nicht aufgeführt.`;
  return text;
}

function Fusszeile({ n }) {
  const { message } = AntApp.useApp();
  const [kopiert, setKopiert] = useState(false);
  if (n.fehler) return null;
  const kopieren = () => navigator.clipboard?.writeText(n.text).then(() => {
    setKopiert(true); message.success("Antwort kopiert"); setTimeout(() => setKopiert(false), 1500);
  });
  return (
    <Space size={0} wrap>
      <Tooltip title={kopiert ? "Kopiert" : "Antwort kopieren"}>
        <Button type="text" size="small" icon={kopiert ? <CheckOutlined /> : <CopyOutlined />} onClick={kopieren} />
      </Tooltip>
      {n.abfragen?.length > 0 && (
        <Collapse ghost size="small" items={[{ key: "sql", label: <Space size={4}><CodeOutlined />SQL ({n.abfragen.length})</Space>,
          children: n.abfragen.map((a, i) => <pre key={i} style={{ whiteSpace: "pre-wrap", margin: "0 0 6px", fontSize: 12, padding: 8, borderRadius: 6, background: "rgba(127,127,127,.1)" }}>{a}</pre>) }]} />
      )}
    </Space>
  );
}

function Assistent({ k }) {
  const { token } = theme.useToken();
  const [nachrichten, setNachrichten] = useState([]);
  const [eingabe, setEingabe] = useState("");
  const [laedt, setLaedt] = useState(false);
  const [status, setStatus] = useState(null);
  const [tabellen, setTabellen] = useState([]);
  const [verbrauch, setVerbrauch] = useState([]);
  const [vorschlaege, setVorschlaege] = useState(false);
  const abbruch = useRef(null);

  useEffect(() => {
    api("/api/status").then(setStatus).catch(() => setStatus({ ki: false }));
    api("/api/tabellen").then(setTabellen).catch(() => {});
    api("/api/verbrauch/tabellen").then(setVerbrauch).catch(() => {});
  }, []);

  const antworte = (n) => setNachrichten(alt => [...alt, { rolle: "assistent", zeit: uhrzeit(), ...n }]);

  async function senden(text) {
    text = String(text || "").trim();
    if (!text || laedt) return;
    setVorschlaege(false);
    const neu = [...nachrichten, { rolle: "nutzer", text, zeit: uhrzeit() }];
    setNachrichten(neu); setEingabe(""); setLaedt(true);
    abbruch.current = new AbortController();
    try {
      const verlauf = neu.filter(n => !n.fehler && !n.ohneKI).map(n => ({ rolle: n.rolle, text: n.text }));
      const { antwort, abfragen } = await api("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verlauf, jahr: k?.jahr }), signal: abbruch.current.signal
      });
      antworte({ text: antwort, abfragen });
    } catch (err) {
      if (err.name === "AbortError") antworte({ text: "Abgebrochen.", fehler: true });
      else if (err.status === 503) {
        // Claude indisponible → réponse simple calculée dans le navigateur (table nommée, énergie ou production)
        const zuTabelle = await antwortTabelleOhneKI(text, tabellen, k?.jahr).catch(() => null);
        const antwort = zuTabelle ?? (istEnergieFrage(text)
          ? antwortEnergieOhneKI(text, await api(`/api/energie?jahr=${k?.jahr}`).catch(() => null))
          : antwortOhneKI(text, k));
        antworte({ text: antwort, ohneKI: err.message });
      } else antworte({ text: err.message, fehler: true });
    } finally { setLaedt(false); }
  }

  const items = nachrichten.map((n, i) => ({
    key: i,
    role: n.rolle === "nutzer" ? "user" : "ai",
    content: n,
    header: n.rolle === "nutzer" ? <Text type="secondary" style={{ fontSize: 12 }}>{n.zeit}</Text>
      : <Space size={6}><Text strong style={{ fontSize: 13 }}>{n.ohneKI ? "Assistent" : "Claude"}</Text><Text type="secondary" style={{ fontSize: 12 }}>{n.zeit}</Text>
          {n.ohneKI && <Tooltip title={n.ohneKI}><Tag icon={<InfoCircleOutlined />} color="warning" bordered={false}>ohne KI</Tag></Tooltip>}</Space>,
    footer: n.rolle === "nutzer" ? undefined : <Fusszeile n={n} />
  }));
  if (laedt) items.push({ key: "laedt", role: "ai", content: "", loading: true,
    header: <Text type="secondary" style={{ fontSize: 12 }}>Durchsucht die Datenbank und rechnet nach</Text> });

  const rollen = {
    ai: {
      placement: "start", variant: "borderless",
      avatar: <Avatar icon={<RobotOutlined />} style={{ background: ROBOTER_FARBE }} />,
      contentRender: (n) => n?.fehler ? <Text type="danger">{n.text}</Text> : n?.text ? <div style={{ fontSize: 15, lineHeight: 1.65 }}><AntwortText text={n.text} /></div> : null
    },
    user: {
      placement: "end", variant: "filled", shape: "round",
      avatar: <Avatar icon={<UserOutlined />} style={{ background: token.colorFillSecondary, color: token.colorText }} />,
      styles: { content: { background: token.colorPrimary, color: "#fff" } },
      contentRender: (n) => <span style={{ whiteSpace: "pre-wrap" }}>{n.text}</span>
    }
  };
  const auswahl = <FragenAuswahl jahr={k?.jahr} tabellen={tabellen} verbrauch={verbrauch} stellen={senden} />;

  return (
    <div className="chat-wrap">
      <Flex justify="space-between" align="center" style={{ marginBottom: 12 }} gap={8} wrap>
        <Space wrap>
          {status && <Tooltip title={status.ki ? `Modell: ${status.modell}` : "Ohne Guthaben oder Schlüssel: einfache Antworten ohne KI"}>
            <Tag color={status.ki ? "success" : "warning"} bordered={false} style={{ padding: "2px 10px" }}>{status.ki ? "● Claude aktiv" : "● Ohne KI"}</Tag></Tooltip>}
          <Text type="secondary" style={{ fontSize: 13 }}>Liest {tabellen.length ? `alle ${tabellen.length} Tabellen` : "alle Tabellen"} von MRS_BI, ändert nichts. Bezug: {k?.jahr}</Text>
        </Space>
        {nachrichten.length > 0 && (
          <Space>
            <Button icon={<BulbOutlined />} shape="round" onClick={() => setVorschlaege(true)}>Fragen</Button>
            <Button icon={<PlusOutlined />} shape="round" onClick={() => setNachrichten([])}>Neues Gespräch</Button>
          </Space>
        )}
      </Flex>

      <div className="chat-liste" style={{ overflowY: nachrichten.length ? "hidden" : "auto" }}>
        {nachrichten.length === 0 ? (
          <Flex vertical gap={20} style={{ paddingTop: 8, paddingBottom: 12 }}>
            <Welcome variant="borderless"
              icon={<Avatar size={56} icon={<RobotOutlined />} style={{ background: ROBOTER_FARBE }} />}
              title="Guten Tag! Was möchten Sie wissen?"
              description="Fragen Sie in eigenen Worten nach Produktion, Energie, Kosten, Wartung oder jeder anderen Tabelle. Oder wählen Sie unten ein Thema bzw. eine Tabelle." />
            {auswahl}
          </Flex>
        ) : (
          <Bubble.List items={items} role={rollen} autoScroll style={{ height: "100%" }} />
        )}
      </div>

      {!laedt && nachrichten.length > 0 && !nachrichten.at(-1).fehler && (
        <Prompts items={nachfragenFuer(nachrichten.length)} wrap onItemClick={({ data }) => senden(data.description)} style={{ margin: "8px 0" }}
          styles={{ item: { padding: "4px 12px", borderRadius: 16 } }} />
      )}

      <Sender value={eingabe} onChange={setEingabe} onSubmit={senden} loading={laedt}
        onCancel={() => abbruch.current?.abort()} placeholder="Frage stellen … (z. B. zu einer Tabelle, einem Monat oder einer Anlage)" autoSize={{ minRows: 1, maxRows: 6 }}
        style={{ boxShadow: token.boxShadowSecondary, background: token.colorBgContainer, marginTop: 8 }} />
      <Text type="secondary" style={{ fontSize: 12, textAlign: "center", marginTop: 6 }}>
        Enter zum Senden, Umschalt + Enter für eine neue Zeile. Antworten bei wichtigen Entscheidungen bitte prüfen.
      </Text>

      <Drawer open={vorschlaege} onClose={() => setVorschlaege(false)} width={620} title={<Space><BulbOutlined />Fragen vorschlagen</Space>}>
        {vorschlaege && auswahl}
      </Drawer>
    </div>
  );
}

// ---------- Datenqualität ----------
const ALERT_TYP = { ok: "success", warnung: "warning", fehler: "error", info: "info" };
function Datenqualitaet({ hinweise, jahr }) {
  return (
    <Flex vertical gap={12} style={{ maxWidth: 820 }}>
      <Kopf titel={`Datenqualität ${jahr}`} text="Automatische Prüfung der Tabelle ProduktionMonat. Diese Punkte sollten mit der Fachabteilung geklärt werden." />
      {hinweise.map(h => <Alert key={h.titel} type={ALERT_TYP[h.stufe]} showIcon message={<b>{h.titel}</b>} description={h.text} />)}
    </Flex>
  );
}

// =====================================================================
// 6. Mise en page (menu à gauche, en-tête, page choisie)
// =====================================================================
// =====================================================================
// Connexion, rôles et gestion des utilisateurs
// =====================================================================
const ROLLE = {
  leser: { name: "Leser", farbe: "default", icon: <EyeOutlined />, text: "sieht alles, ändert nichts" },
  bearbeiter: { name: "Bearbeiter", farbe: "blue", icon: <EditOutlined />, text: "darf Tabellen und Maßnahmen bearbeiten" },
  admin: { name: "Admin", farbe: "gold", icon: <CrownOutlined />, text: "zusätzlich Benutzer und Protokoll verwalten" }
};
const initialen = (name) => String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");

// Écran de connexion (et de première configuration)
function Anmeldung({ status, angemeldet }) {
  const { token } = theme.useToken();
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState("");
  const einrichten = !status.eingerichtet;

  async function senden(w) {
    setLaedt(true); setFehler("");
    try {
      const d = await api(einrichten ? "/api/auth/einrichten" : "/api/auth/anmelden",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(w) });
      angemeldet(d.benutzer);
    } catch (e) { setFehler(e.message); }
    finally { setLaedt(false); }
  }

  return (
    <div className="anmelden">
      <aside className="anmelden-marke">
        <Marke />
        <div className="anmelden-text">
          <h2>Energie- und Produktionsdaten</h2>
          <p>Kennzahlen, SEU-Bewertung, Maßnahmenplan und Energiebericht nach ISO 50001.</p>
        </div>
        <span className="anmelden-fuss"><DatabaseOutlined /> Datenbank MRS_BI</span>
      </aside>
      <main className="anmelden-form" style={{ background: token.colorBgLayout }}>
        <Card style={{ width: "100%", maxWidth: 400 }}>
          {einrichten && !status.einrichtungErlaubt ? (
            <Result status="info" icon={<SafetyCertificateOutlined style={{ color: token.colorPrimary }} />} title="Anmeldung noch nicht eingerichtet"
              subTitle="Der erste Administrator kann nur direkt am Server-PC angelegt werden. Bitte die Anwendung dort öffnen." />
          ) : (
            <>
              <Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>{einrichten ? "Administrator anlegen" : "Anmelden"}</Title>
              <Text type="secondary">{einrichten
                ? "Erster Start: Legen Sie das Konto an, mit dem Sie später weitere Benutzer verwalten."
                : "Mit Ihrem Benutzerkonto für MRS Produktion."}</Text>
              <Form layout="vertical" onFinish={senden} style={{ marginTop: 20 }} requiredMark={false} disabled={laedt}>
                {einrichten && (
                  <Form.Item name="name" label="Name" rules={[{ required: true, message: "Bitte Ihren Namen eingeben" }]}>
                    <Input prefix={<UserOutlined />} placeholder="Vorname Nachname" maxLength={80} autoComplete="name" />
                  </Form.Item>
                )}
                <Form.Item name="login" label="Benutzername" rules={[{ required: true, message: "Bitte den Benutzernamen eingeben" },
                  ...(einrichten ? [{ pattern: /^[A-Za-z0-9._-]{3,32}$/, message: "3 bis 32 Zeichen: Buchstaben, Ziffern, . _ -" }] : [])]}>
                  <Input prefix={<UserOutlined />} placeholder="z. B. a.hammiche" autoComplete="username" autoFocus />
                </Form.Item>
                <Form.Item name="passwort" label="Passwort" rules={[{ required: true, message: "Bitte das Passwort eingeben" },
                  ...(einrichten ? [{ min: 8, message: "Mindestens 8 Zeichen" }] : [])]}>
                  <Input.Password prefix={<LockOutlined />} autoComplete={einrichten ? "new-password" : "current-password"} />
                </Form.Item>
                {einrichten && (
                  <Form.Item name="wiederholung" label="Passwort wiederholen" dependencies={["passwort"]}
                    rules={[{ required: true, message: "Bitte wiederholen" },
                      ({ getFieldValue }) => ({ validator: (_, v) => (!v || v === getFieldValue("passwort") ? Promise.resolve() : Promise.reject(new Error("Die Passwörter stimmen nicht überein"))) })]}>
                    <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
                  </Form.Item>
                )}
                {fehler && <Alert type="error" showIcon message={fehler} style={{ marginBottom: 16 }} />}
                <Button type="primary" htmlType="submit" block size="large" loading={laedt} icon={einrichten ? <CrownOutlined /> : <LoginOutlined />}>
                  {einrichten ? "Administrator anlegen und anmelden" : "Anmelden"}
                </Button>
              </Form>
            </>
          )}
        </Card>
      </main>
    </div>
  );
}

// Menu utilisateur dans l'en-tête
function BenutzerMenue({ benutzer, abmelden, profilGespeichert }) {
  const { message } = AntApp.useApp();
  const [pwOffen, setPwOffen] = useState(false);
  const [aboOffen, setAboOffen] = useState(false);
  const [form] = Form.useForm();
  const [aboForm] = Form.useForm();
  async function aboSpeichern() {
    const w = await aboForm.validateFields();
    try {
      const b = await api("/api/auth/profil", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(w) });
      profilGespeichert?.(b); message.success("Benachrichtigungen gespeichert"); setAboOffen(false);
    } catch (e) { message.error(e.message, 6); }
  }
  const r = ROLLE[benutzer.rolle];

  async function pwAendern() {
    const w = await form.validateFields();
    try {
      await api("/api/auth/passwort", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alt: w.alt, neu: w.neu }) });
      message.success("Passwort geändert"); setPwOffen(false);
    } catch (e) { message.error(e.message, 6); }
  }

  return (
    <>
      <Dropdown trigger={["click"]} menu={{ items: [
        { key: "kopf", disabled: true, label: <Flex vertical style={{ minWidth: 200 }}><b>{benutzer.name}</b><Text type="secondary" style={{ fontSize: 12 }}>{benutzer.login}</Text>
          <Tag color={r.farbe} icon={r.icon} bordered={false} style={{ marginTop: 6, width: "fit-content" }}>{r.name}</Tag></Flex> },
        { type: "divider" },
        { key: "abo", icon: <BellOutlined />, label: "Benachrichtigungen", onClick: () => { aboForm.setFieldsValue({ email: benutzer.email, abo: benutzer.abo || {} }); setAboOffen(true); } },
        { key: "pw", icon: <KeyOutlined />, label: "Passwort ändern", onClick: () => { form.resetFields(); setPwOffen(true); } },
        { key: "ab", icon: <LogoutOutlined />, danger: true, label: "Abmelden", onClick: abmelden }
      ] }}>
        <Button type="text" style={{ height: 40, paddingInline: 6 }} aria-label="Benutzermenü">
          <Space size={8}>
            <Avatar size={30} style={{ background: "linear-gradient(140deg,#3E7099,#21465D)", fontSize: 13 }}>{initialen(benutzer.name)}</Avatar>
            <span className="kopf-name">{benutzer.name}</span>
          </Space>
        </Button>
      </Dropdown>
      <Modal open={aboOffen} title={<Space><BellOutlined />Benachrichtigungen per E-Mail</Space>} okText="Speichern" cancelText="Abbrechen" onOk={aboSpeichern} onCancel={() => setAboOffen(false)} destroyOnHidden>
        <Form form={aboForm} layout="vertical" requiredMark={false}><AboFelder /></Form>
        <Text type="secondary" style={{ fontSize: 12 }}><InfoCircleOutlined /> Der Versand muss von einem Administrator eingerichtet sein.</Text>
      </Modal>
      <Modal open={pwOffen} title={<Space><KeyOutlined />Passwort ändern</Space>} okText="Ändern" cancelText="Abbrechen" onOk={pwAendern} onCancel={() => setPwOffen(false)} destroyOnHidden>
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item name="alt" label="Bisheriges Passwort" rules={[{ required: true, message: "Bitte eingeben" }]}><Input.Password autoComplete="current-password" /></Form.Item>
          <Form.Item name="neu" label="Neues Passwort" rules={[{ required: true, message: "Bitte eingeben" }, { min: 8, message: "Mindestens 8 Zeichen" }]}><Input.Password autoComplete="new-password" /></Form.Item>
          <Form.Item name="wdh" label="Neues Passwort wiederholen" dependencies={["neu"]} rules={[{ required: true, message: "Bitte wiederholen" },
            ({ getFieldValue }) => ({ validator: (_, v) => (!v || v === getFieldValue("neu") ? Promise.resolve() : Promise.reject(new Error("Stimmt nicht überein"))) })]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

// abonnements e-mail (utilisés par le menu personnel et par l'admin)
const ABOS = [
  { key: "woche", name: "Wochenbericht", text: "jeden Montag: Kennzahlen, Auffälligkeiten, Fristen, Monatskommentar", icon: <MailOutlined /> },
  { key: "kritisch", name: "Kritische Auffälligkeiten", text: "sofort bei einer kritischen Abweichung oder einem gemeldeten Stillstand", icon: <CloseCircleOutlined /> },
  { key: "fristen", name: "Fristen (Maßnahmen und Wartung)", text: "7 Tage vor der Frist und bei Überschreitung", icon: <ClockCircleOutlined /> }
];
const AboFelder = () => (
  <>
    <Form.Item name="email" label={<Space size={6}><MailOutlined />E-Mail-Adresse</Space>} rules={[{ type: "email", message: "Bitte eine gültige E-Mail-Adresse eingeben" }]}>
      <Input placeholder="vorname.nachname@firma.de" autoComplete="email" />
    </Form.Item>
    {ABOS.map(a => (
      <Form.Item key={a.key} name={["abo", a.key]} valuePropName="checked" style={{ marginBottom: 8 }}>
        <Checkbox><Space size={6} align="start">{a.icon}<span><b>{a.name}</b><br /><Text type="secondary" style={{ fontSize: 12 }}>{a.text}</Text></span></Space></Checkbox>
      </Form.Item>
    ))}
  </>
);

// onglet « E-Mail » (admin)
const MAIL_ART = { woche: { name: "Wochenbericht", farbe: "blue" }, kritisch: { name: "Kritisch", farbe: "error" }, fristen: { name: "Fristen", farbe: "warning" },
                   test: { name: "Test", farbe: "default" }, info: { name: "Info", farbe: "default" } };
function EmailVerwaltung() {
  const { message } = AntApp.useApp();
  const [d, setD] = useState(null);
  const [vorschau, setVorschau] = useState(null);
  const [laedt, setLaedt] = useState("");
  const laden = () => api("/api/benachrichtigungen").then(setD).catch(e => message.error(e.message));
  useEffect(() => { laden(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function aktion(name, url, body) {
    setLaedt(name);
    try {
      const r = await api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
      message.success(`Gesendet an ${r.an.join(", ")}`);
    } catch (e) { message.error(e.message, 8); }
    finally { setLaedt(""); laden(); }
  }
  async function zeigeVorschau() {
    setLaedt("vorschau");
    try { setVorschau(await api("/api/benachrichtigungen/vorschau")); } catch (e) { message.error(e.message, 8); } finally { setLaedt(""); }
  }

  if (!d) return <Card><Skeleton active paragraph={{ rows: 6 }} /></Card>;
  return (
    <Flex vertical gap={16}>
      {!d.eingerichtet ? (
        <Card>
          <Result status="info" icon={<MailOutlined style={{ color: "#4F83AA" }} />} title="E-Mail-Versand ist noch nicht eingerichtet"
            subTitle="Tragen Sie die Daten Ihres Mailservers in die .env ein und starten Sie die Anwendung neu (dienst.ps1 neustart). Die Angaben bekommen Sie von der IT."
            extra={<pre style={{ textAlign: "left", display: "inline-block", fontSize: 12, padding: 12, borderRadius: 6, background: "rgba(127,127,127,.1)" }}>{`SMTP_HOST=smtp.firma.de
SMTP_PORT=587
SMTP_USER=produktion@firma.de
SMTP_PASS=...
MAIL_FROM=MRS Produktion <produktion@firma.de>
APP_URL=http://185.80.92.91:3020
MAIL_STUNDE=7`}</pre>} />
        </Card>
      ) : (
        <>
          <Card title={<Space><MailOutlined />E-Mail-Versand</Space>} extra={<Tag color="success" icon={<CheckCircleOutlined />} bordered={false}>eingerichtet</Tag>}>
            <Descriptions size="small" column={{ xs: 1, md: 2 }} items={[
              { key: "s", label: "Mailserver", children: <Text code>{d.smtp.host}:{d.smtp.port}{d.smtp.secure ? " (SSL)" : ""}</Text> },
              { key: "a", label: "Absender", children: d.absender },
              { key: "u", label: "Links in E-Mails", children: <Text code>{d.appUrl}</Text> },
              { key: "z", label: "Versandzeit", children: `${d.stunde}:00 Uhr (Wochenbericht montags, Fristen täglich)` },
              { key: "n", label: "Nächster Wochenbericht", children: dayjs(d.naechsterWochenbericht).format("dddd, DD.MM.YYYY HH:mm") },
              { key: "k", label: "Kritische Meldungen", children: "werden stündlich geprüft und sofort gesendet" }
            ]} />
            <Flex gap={8} wrap style={{ marginTop: 16 }}>
              <Button icon={<SendOutlined />} loading={laedt === "test"} onClick={() => aktion("test", "/api/benachrichtigungen/test")}>Test-E-Mail an mich</Button>
              <Button icon={<EyeOutlined />} loading={laedt === "vorschau"} onClick={zeigeVorschau}>Wochenbericht ansehen</Button>
              <Button icon={<MailOutlined />} loading={laedt === "ich"} onClick={() => aktion("ich", "/api/benachrichtigungen/wochenbericht", { an: "ich" })}>Wochenbericht an mich</Button>
              <Popconfirm title="Wochenbericht jetzt an alle Abonnenten senden?" okText="Senden" cancelText="Abbrechen" onConfirm={() => aktion("alle", "/api/benachrichtigungen/wochenbericht", { an: "alle" })}>
                <Button type="primary" icon={<SendOutlined />} loading={laedt === "alle"}>Jetzt an alle Abonnenten</Button>
              </Popconfirm>
            </Flex>
          </Card>
        </>
      )}

      <Card title={<Space><TeamOutlined />Empfänger</Space>} styles={{ body: { padding: 0 } }}
        extra={<Text type="secondary" style={{ fontSize: 12 }}><InfoCircleOutlined /> jede Person stellt ihre Benachrichtigungen selbst ein (Name oben rechts)</Text>}>
        <Table rowKey="login" size="small" pagination={false} dataSource={d.empfaenger} locale={{ emptyText: "Noch niemand hat eine E-Mail-Adresse eingetragen" }}
          columns={[
            { title: "Name", dataIndex: "name" },
            { title: <Space size={4}><MailOutlined />E-Mail</Space>, dataIndex: "email" },
            ...ABOS.map(a => ({ title: <Tooltip title={a.text}><Space size={4}>{a.icon}{a.name}</Space></Tooltip>, key: a.key, align: "center",
              render: (_, b) => (b.abo?.[a.key] ? <CheckCircleOutlined style={{ color: "#2F9E8F" }} /> : <Text type="secondary">–</Text>) }))
          ]} />
      </Card>

      <Card title={<Space><HistoryOutlined />Versandprotokoll</Space>} styles={{ body: { padding: 0 } }}>
        <Table rowKey={(x, i) => `${x.zeit}-${i}`} size="small" dataSource={d.verlauf} pagination={{ pageSize: 10, hideOnSinglePage: true }} className="kopf-nowrap" scroll={{ x: "max-content" }}
          locale={{ emptyText: "Noch keine E-Mails gesendet" }}
          columns={[
            { title: <Space size={4}><ClockCircleOutlined />Zeit</Space>, dataIndex: "zeit", render: z => dayjs(z).format("DD.MM.YYYY HH:mm") },
            { title: "Art", dataIndex: "art", render: a => <Tag color={MAIL_ART[a]?.farbe} bordered={false}>{MAIL_ART[a]?.name ?? a}</Tag> },
            { title: "Betreff", dataIndex: "betreff" },
            { title: "An", dataIndex: "an", render: an => <Text type="secondary" style={{ fontSize: 12 }}>{an.join(", ")}</Text> },
            { title: "Status", dataIndex: "ok", render: (ok, x) => ok ? <Tag color="success" icon={<CheckCircleOutlined />} bordered={false}>gesendet</Tag>
                : <Tooltip title={x.fehler}><Tag color="error" icon={<CloseCircleOutlined />} bordered={false}>Fehler</Tag></Tooltip> }
          ]} />
      </Card>

      <Modal open={!!vorschau} onCancel={() => setVorschau(null)} footer={null} width={720} title={<Space><EyeOutlined />{vorschau?.betreff}</Space>}>
        {vorschau && <iframe title="Vorschau Wochenbericht" srcDoc={vorschau.html} style={{ width: "100%", height: "70vh", border: 0, borderRadius: 6 }} sandbox="" />}
      </Modal>
    </Flex>
  );
}

// Page « Benutzer » (administrateurs) : comptes + protocole des modifications
const AKTION_FARBE = (a) => /LÖSCH/.test(a) ? "error" : /NEU|EINFÜG|EINRICHT/.test(a) ? "success" : /ÄNDER|PASSWORT/.test(a) ? "blue" : "default";

function Benutzerverwaltung({ ich }) {
  const { message, notification } = AntApp.useApp();
  const [liste, setListe] = useState(null);
  const [protokoll, setProtokoll] = useState(null);
  const [tab, setTab] = useState("benutzer");
  const [drawer, setDrawer] = useState(null);
  const [speichert, setSpeichert] = useState(false);
  const [suche, setSuche] = useState("");
  const [form] = Form.useForm();

  const laden = () => api("/api/benutzer").then(setListe).catch(e => message.error(e.message));
  useEffect(() => { laden(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === "protokoll") api("/api/protokoll").then(setProtokoll).catch(e => message.error(e.message)); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  function oeffnen(b) { form.resetFields(); form.setFieldsValue(b ? { ...b, abo: b.abo || {} } : { rolle: "leser", aktiv: true, abo: {} }); setDrawer({ b: b || null }); }
  async function speichern() {
    const w = await form.validateFields();
    setSpeichert(true);
    try {
      const body = JSON.stringify({ ...w, passwort: w.passwort || undefined });
      if (drawer.b) await api(`/api/benutzer/${encodeURIComponent(drawer.b.login)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body });
      else await api("/api/benutzer", { method: "POST", headers: { "Content-Type": "application/json" }, body });
      notification.success({ message: drawer.b ? "Benutzer gespeichert" : "Benutzer angelegt", description: w.name, placement: "topRight" });
      setDrawer(null); laden();
    } catch (e) { message.error(e.message, 6); }
    finally { setSpeichert(false); }
  }
  async function loeschen(b) {
    try { await api(`/api/benutzer/${encodeURIComponent(b.login)}`, { method: "DELETE" }); message.success("Benutzer gelöscht"); laden(); }
    catch (e) { message.error(e.message, 6); }
  }

  const anzahl = (r) => (liste || []).filter(b => b.rolle === r && b.aktiv).length;
  const datum = (d) => (d ? dayjs(d).format("DD.MM.YYYY HH:mm") : <Text type="secondary">nie</Text>);
  const gefiltert = (protokoll || []).filter(z => !suche || JSON.stringify(z).toLowerCase().includes(suche.toLowerCase()));

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="flex-end" wrap gap={12}>
        <Kopf titel="Benutzer und System" text="Konten, Rollen, Sicherungen und das Protokoll aller Änderungen" />
        {tab === "benutzer" && <Button type="primary" icon={<PlusOutlined />} onClick={() => oeffnen(null)}>Neuer Benutzer</Button>}
      </Flex>

      <Row gutter={[16, 16]}>
        <Kpi titel="Aktive Benutzer" icon={<TeamOutlined />} value={(liste || []).filter(b => b.aktiv).length}>
          <Text type="secondary">{(liste || []).filter(b => !b.aktiv).length} deaktiviert</Text>
        </Kpi>
        {Object.entries(ROLLE).map(([k, r]) => (
          <Kpi key={k} titel={r.name} icon={r.icon} value={anzahl(k)}><Text type="secondary">{r.text}</Text></Kpi>
        ))}
      </Row>

      <Tabs activeKey={tab} onChange={setTab} items={[
        { key: "benutzer", label: <Space><TeamOutlined />Benutzer</Space>, children: (
          <Card styles={{ body: { padding: 0 } }}>
            <Table rowKey="login" loading={!liste} dataSource={liste || []} pagination={false} size="middle" className="kopf-nowrap" scroll={{ x: "max-content" }}
              rowClassName={b => (b.aktiv ? "" : "zeile-blass")}
              columns={[
                { title: <Space size={4}><UserOutlined />Name</Space>, dataIndex: "name", render: (n, b) => (
                  <Space><Avatar size={28} style={{ background: b.aktiv ? "linear-gradient(140deg,#3E7099,#21465D)" : "#A6AFB8", fontSize: 12 }}>{initialen(n)}</Avatar>
                    <Flex vertical><b>{n}{b.login === ich.login && <Tag bordered={false} style={{ marginLeft: 6 }}>Sie</Tag>}</b><Text type="secondary" style={{ fontSize: 12 }}>{b.login}</Text></Flex></Space>) },
                { title: <Space size={4}><SafetyCertificateOutlined />Rolle</Space>, dataIndex: "rolle",
                  render: r => <Tooltip title={ROLLE[r].text}><Tag color={ROLLE[r].farbe} icon={ROLLE[r].icon} bordered={false}>{ROLLE[r].name}</Tag></Tooltip> },
                { title: "Status", dataIndex: "aktiv", render: a => a ? <Tag color="success" icon={<CheckCircleOutlined />} bordered={false}>aktiv</Tag> : <Tag icon={<MinusCircleOutlined />} bordered={false}>deaktiviert</Tag> },
                { title: <Space size={4}><MailOutlined />E-Mail</Space>, dataIndex: "email", render: (e, b) => !e ? <Text type="secondary">–</Text> : (
                  <Space size={6}><Text style={{ fontSize: 13 }}>{e}</Text>{ABOS.filter(a => b.abo?.[a.key]).map(a => <Tooltip key={a.key} title={a.name}><span style={{ color: "#4F83AA" }}>{a.icon}</span></Tooltip>)}</Space>) },
                { title: <Space size={4}><LoginOutlined />Letzte Anmeldung</Space>, dataIndex: "letzteAnmeldung", render: datum,
                  sorter: (a, b) => (a.letzteAnmeldung || "").localeCompare(b.letzteAnmeldung || "") },
                { title: <Space size={4}><CalendarOutlined />Angelegt</Space>, dataIndex: "erstellt", render: d => (d ? dayjs(d).format("DD.MM.YYYY") : "–") },
                { title: "", key: "aktionen", width: 92, fixed: "right", render: (_, b) => (
                  <Space size={0}>
                    <Tooltip title="Bearbeiten"><Button type="text" icon={<EditOutlined />} onClick={() => oeffnen(b)} aria-label="Bearbeiten" /></Tooltip>
                    {b.login !== ich.login && (
                      <Popconfirm title={`${b.name} löschen?`} description="Tipp: Deaktivieren behält den Namen im Protokoll sichtbar." okText="Löschen" cancelText="Abbrechen"
                        okButtonProps={{ danger: true }} onConfirm={() => loeschen(b)}>
                        <Tooltip title="Löschen"><Button type="text" danger icon={<DeleteOutlined />} aria-label="Löschen" /></Tooltip>
                      </Popconfirm>)}
                  </Space>) }
              ]} />
          </Card>
        ) },
        { key: "email", label: <Space><MailOutlined />E-Mail</Space>, children: <EmailVerwaltung /> },
        { key: "system", label: <Space><DesktopOutlined />System und Sicherungen</Space>, children: <SystemSicherung /> },
        { key: "protokoll", label: <Space><HistoryOutlined />Änderungsprotokoll</Space>, children: (
          <Card styles={{ body: { padding: 0 } }} title={<Input allowClear prefix={<SearchOutlined />} placeholder="Protokoll durchsuchen" value={suche} onChange={e => setSuche(e.target.value)} style={{ maxWidth: 320 }} />}
            extra={<Text type="secondary" style={{ fontSize: 12 }}><InfoCircleOutlined /> die letzten 500 Einträge aus aenderungen.log</Text>}>
            <Table rowKey="nr" loading={!protokoll} dataSource={gefiltert} size="small" className="kopf-nowrap" scroll={{ x: "max-content" }}
              pagination={{ pageSize: 25, showSizeChanger: false, hideOnSinglePage: true }}
              expandable={{ expandedRowRender: z => <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap" }}>{JSON.stringify({ schluessel: z.schluessel, alt: z.alt, neu: z.neu }, null, 2)}</pre>,
                            rowExpandable: z => !!(z.alt || z.neu || z.schluessel) }}
              columns={[
                { title: <Space size={4}><ClockCircleOutlined />Zeit</Space>, dataIndex: "zeit", render: d => (d ? dayjs(d).format("DD.MM.YYYY HH:mm:ss") : "–") },
                { title: <Space size={4}><UserOutlined />Wer</Space>, dataIndex: "wer", render: w => w || <Text type="secondary">vor der Anmeldung</Text> },
                { title: "Aktion", dataIndex: "aktion", render: a => <Tag color={AKTION_FARBE(a || "")} bordered={false}>{a}</Tag> },
                { title: <Space size={4}><DatabaseOutlined />Ziel</Space>, dataIndex: "tabelle" },
                { title: "Kurz", key: "kurz", render: (_, z) => <Text type="secondary" ellipsis style={{ maxWidth: 360 }}>
                    {z.neu?.titel || z.alt?.titel || z.neu?.name || z.alt?.name || (z.schluessel ? Object.entries(z.schluessel).map(([k, v]) => `${k}=${v}`).join(", ") : "")}</Text> }
              ]} />
          </Card>
        ) }
      ]} />

      <Drawer open={!!drawer} onClose={() => setDrawer(null)} width={460} destroyOnHidden
        title={<Space><UserOutlined />{drawer?.b ? "Benutzer bearbeiten" : "Neuer Benutzer"}</Space>}
        footer={<Flex justify="flex-end"><Space><Button onClick={() => setDrawer(null)}>Abbrechen</Button>
          <Button type="primary" icon={<CheckCircleOutlined />} loading={speichert} onClick={speichern}>{drawer?.b ? "Speichern" : "Anlegen"}</Button></Space></Flex>}>
        <Form form={form} layout="vertical" requiredMark>
          <Form.Item name="name" label={<Space size={6}><UserOutlined />Name</Space>} rules={[{ required: true, message: "Bitte einen Namen eingeben" }]}>
            <Input maxLength={80} placeholder="Vorname Nachname" />
          </Form.Item>
          <Form.Item name="login" label={<Space size={6}><LoginOutlined />Benutzername</Space>} extra={drawer?.b ? "kann nicht geändert werden" : "3 bis 32 Zeichen: Buchstaben, Ziffern, . _ -"}
            rules={drawer?.b ? [] : [{ required: true, message: "Bitte eingeben" }, { pattern: /^[A-Za-z0-9._-]{3,32}$/, message: "3 bis 32 Zeichen: Buchstaben, Ziffern, . _ -" }]}>
            <Input disabled={!!drawer?.b} placeholder="z. B. m.weber" />
          </Form.Item>
          <Form.Item name="rolle" label={<Space size={6}><SafetyCertificateOutlined />Rolle</Space>}>
            <Select options={Object.entries(ROLLE).map(([k, r]) => ({ value: k, label: <Space size={6}>{r.icon}<b>{r.name}</b><Text type="secondary" style={{ fontSize: 12 }}>{r.text}</Text></Space> }))} />
          </Form.Item>
          <AboFelder />
          {drawer?.b && (
            <Form.Item name="aktiv" label="Konto aktiv" valuePropName="checked" extra="Deaktivierte Benutzer können sich nicht anmelden; laufende Sitzungen werden beendet.">
              <Switch disabled={drawer.b.login === ich.login} />
            </Form.Item>
          )}
          <Form.Item name="passwort" label={<Space size={6}><KeyOutlined />{drawer?.b ? "Neues Passwort (optional)" : "Passwort"}</Space>}
            extra={drawer?.b ? "Leer lassen, um das Passwort nicht zu ändern." : "Mindestens 8 Zeichen. Die Person kann es danach selbst ändern."}
            rules={[...(drawer?.b ? [] : [{ required: true, message: "Bitte ein Passwort vergeben" }]), { min: 8, message: "Mindestens 8 Zeichen" }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Drawer>
    </Flex>
  );
}

// Onglet « System » (admin) : état de l'application et sauvegardes
function SystemSicherung() {
  const { message, notification } = AntApp.useApp();
  const [s, setS] = useState(null);
  const [laedt, setLaedt] = useState(false);
  const laden = () => api("/api/system").then(setS).catch(e => message.error(e.message));
  useEffect(() => { laden(); const t = setInterval(laden, 30000); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function jetztSichern() {
    setLaedt(true);
    try { const r = await api("/api/sicherungen", { method: "POST" }); message.success(`Sicherung ${r.name} erstellt`); laden(); }
    catch (e) { message.error(e.message, 6); } finally { setLaedt(false); }
  }
  async function wiederherstellen(name) {
    try {
      const r = await api(`/api/sicherungen/${name}/wiederherstellen`, { method: "POST" });
      notification.success({ message: "Wiederhergestellt", placement: "topRight", duration: 8,
        description: `${r.dateien.join(", ")} aus ${name}. Der vorherige Stand wurde als ${r.sicherungDavor} gesichert. Bitte die Seite neu laden.` });
      laden();
    } catch (e) { message.error(e.message, 6); }
  }

  if (!s) return <Card><Skeleton active paragraph={{ rows: 6 }} /></Card>;
  const dauer = (sek) => { const t = Math.floor(sek / 86400), h = Math.floor((sek % 86400) / 3600), m = Math.floor((sek % 3600) / 60); return `${t ? `${t} T ` : ""}${h} h ${m} min`; };
  const groesse = (b) => (b > 1048576 ? `${dez(b / 1048576, 1)} MB` : `${dez(b / 1024, 0)} KB`);
  const letzte = s.sicherungen[0];
  const ART = { auto: { name: "automatisch", farbe: "blue", icon: <ClockCircleOutlined /> }, manuell: { name: "manuell", farbe: "default", icon: <UserOutlined /> },
                vorher: { name: "vor Wiederherstellung", farbe: "gold", icon: <HistoryOutlined /> } };

  return (
    <Flex vertical gap={16}>
      <Row gutter={[16, 16]}>
        <Kpi titel="Anwendung" icon={<DesktopOutlined />} value={`Version ${s.version}`} valueStyle={{ fontSize: 22 }}>
          <Text type="secondary">läuft seit {dauer(s.laufzeitSek)}</Text>
        </Kpi>
        <Kpi titel="Datenbank" icon={<DatabaseOutlined />} value={s.db.ok ? "verbunden" : "Fehler"} valueStyle={{ fontSize: 22, color: s.db.ok ? "#2F9E8F" : "#CF4B3B" }}>
          <Tooltip title={s.db.fehler}><Text type="secondary" ellipsis style={{ maxWidth: 240 }}>{s.db.ok ? s.datenbank : s.db.fehler}</Text></Tooltip>
        </Kpi>
        <Kpi titel="Letzte Sicherung" icon={<SafetyCertificateOutlined />} value={letzte ? dayjs(letzte.zeit).format("DD.MM. HH:mm") : "keine"}
          valueStyle={{ fontSize: 22, color: letzte && Date.now() - new Date(letzte.zeit) < 26 * 3600 * 1000 ? "#2F9E8F" : "#E39A2D" }}>
          <Text type="secondary">täglich um {s.sicherung.stunde}:00 Uhr, {s.sicherung.anzahl} behalten</Text>
        </Kpi>
        <Kpi titel="Angemeldet" icon={<TeamOutlined />} value={s.sitzungen} valueStyle={{ fontSize: 22 }}>
          <Text type="secondary">aktive Sitzungen, {s.benutzer} Benutzer</Text>
        </Kpi>
      </Row>

      <Card title={<Space><SafetyCertificateOutlined />Sicherungen</Space>} styles={{ body: { padding: 0 } }}
        extra={<Button type="primary" icon={<SafetyCertificateOutlined />} loading={laedt} onClick={jetztSichern}>Jetzt sichern</Button>}>
        <div style={{ padding: "12px 16px" }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <InfoCircleOutlined /> Gesichert werden Benutzer, Maßnahmen, Monatskommentare und das Änderungsprotokoll, in <Text code>{s.sicherung.ordner}</Text>
            {s.sicherung.zweitesZiel ? <> und zusätzlich in <Text code>{s.sicherung.zweitesZiel}</Text></> : <>. Tipp: mit BACKUP_ZIEL in der .env eine zweite Kopie auf einem anderen Laufwerk anlegen.</>}
            {" "}Die .env (Passwörter) wird bewusst nicht gesichert: bitte separat aufbewahren.
          </Text>
        </div>
        <Table rowKey="name" size="middle" dataSource={s.sicherungen} pagination={{ pageSize: 10, hideOnSinglePage: true }} className="kopf-nowrap" scroll={{ x: "max-content" }}
          locale={{ emptyText: "Noch keine Sicherung" }}
          columns={[
            { title: <Space size={4}><ClockCircleOutlined />Zeitpunkt</Space>, dataIndex: "zeit", render: z => dayjs(z).format("DD.MM.YYYY HH:mm:ss") },
            { title: "Art", dataIndex: "art", render: a => <Tag color={ART[a]?.farbe} icon={ART[a]?.icon} bordered={false}>{ART[a]?.name ?? a}</Tag> },
            { title: "Dateien", dataIndex: "dateien", render: d => <Text type="secondary" style={{ fontSize: 12 }}>{d.join(", ")}</Text> },
            { title: "Größe", dataIndex: "groesse", align: "right", render: groesse },
            { title: "", key: "a", fixed: "right", render: (_, x) => (
              <Space size={0}>
                <Tooltip title="Als Datei herunterladen"><Button type="text" icon={<DownloadOutlined />} href={`/api/sicherungen/${x.name}/download`} aria-label="Herunterladen" /></Tooltip>
                <Popconfirm title="Diesen Stand wiederherstellen?" okText="Wiederherstellen" cancelText="Abbrechen" okButtonProps={{ danger: true }}
                  description={<div style={{ maxWidth: 300 }}>Benutzer, Maßnahmen und Monatskommentare werden durch den Stand vom {dayjs(x.zeit).format("DD.MM.YYYY HH:mm")} ersetzt.
                    Der aktuelle Stand wird vorher automatisch gesichert. Das Änderungsprotokoll bleibt unverändert.</div>}
                  onConfirm={() => wiederherstellen(x.name)}>
                  <Tooltip title="Wiederherstellen"><Button type="text" icon={<UndoOutlined />} aria-label="Wiederherstellen" /></Tooltip>
                </Popconfirm>
              </Space>) }
          ]} />
      </Card>

      <Card size="small" title={<Space><SettingOutlined />Betrieb</Space>}>
        <Descriptions size="small" column={{ xs: 1, md: 2 }} items={[
          { key: "a", label: "Adresse", children: <Text code>{s.host}:{s.port}</Text> },
          { key: "n", label: "Node.js", children: s.node },
          { key: "k", label: "KI-Assistent", children: s.ki ? "eingerichtet" : "ohne Schlüssel" },
          { key: "b", label: "Datenbank bearbeiten", children: s.bearbeiten ? "erlaubt (ALLOW_WRITE)" : "nur Lesen" },
          { key: "s", label: "Arbeitsspeicher", children: `${s.speicherMB} MB` },
          { key: "g", label: "Gestartet", children: dayjs(s.gestartet).format("DD.MM.YYYY HH:mm") },
          { key: "l", label: "Protokolldatei", span: 2, children: <Text code style={{ fontSize: 12 }}>{s.log}</Text> }
        ]} />
        <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8 }}>
          <InfoCircleOutlined /> Als Windows-Dienst einrichten: im Projektordner PowerShell als Administrator öffnen und <Text code>powershell -ExecutionPolicy Bypass -File .\dienst.ps1 installieren</Text> ausführen.
        </Text>
      </Card>
    </Flex>
  );
}

// Garde-fou : affiche la connexion tant que personne n'est connecté
function Zugang({ dunkel, setDunkel }) {
  const [status, setStatus] = useState(null);
  const [benutzer, setBenutzer] = useState(null);
  const [fehler, setFehler] = useState("");

  const pruefen = () => api("/api/auth/status").then(s => { setStatus(s); setBenutzer(s.benutzer); setFehler(""); }).catch(e => setFehler(e.message));
  useEffect(() => {
    pruefen();
    const weg = () => { setBenutzer(null); pruefen(); };
    addEventListener("mrs-abgemeldet", weg);
    return () => removeEventListener("mrs-abgemeldet", weg);
  }, []);

  async function abmelden() {
    await api("/api/auth/abmelden", { method: "POST" }).catch(() => {});
    setBenutzer(null); pruefen();
  }

  if (fehler) return <Result status="warning" title="Server nicht erreichbar" subTitle={fehler}
    extra={<Button icon={<SyncOutlined />} onClick={pruefen}>Erneut versuchen</Button>} />;
  if (!status) return <Flex align="center" justify="center" style={{ minHeight: "100dvh" }}><Skeleton.Avatar active size={48} /></Flex>;
  if (!benutzer) return <Anmeldung status={status} angemeldet={(b) => { setBenutzer(b); setStatus(s => ({ ...s, eingerichtet: true })); }} />;
  return <App dunkel={dunkel} setDunkel={setDunkel} benutzer={benutzer} abmelden={abmelden} profilGespeichert={setBenutzer} />;
}

// =====================================================================
// Hallenmonitor : affichage plein écran pour un grand écran (halle, bureau)
//  - pages qui défilent automatiquement, très grands chiffres
//  - données rechargées toutes les 5 minutes, l'écran ne se met pas en veille
//  - clavier : ← → changer de page, Espace pause, F plein écran, Échap quitter
// =====================================================================
const MONITOR_SPEICHER = "mrs-monitor";
const MONITOR_FOLIEN = [
  { key: "produktion", name: "Produktion", icon: <AppstoreOutlined /> },
  { key: "energie", name: "Energieleistung", icon: <ThunderboltOutlined /> },
  { key: "verbrauch", name: "Verbrauch je Anlage", icon: <BarChartOutlined /> },
  { key: "warnungen", name: "Warnungen", icon: <BellOutlined /> },
  { key: "massnahmen", name: "Maßnahmen", icon: <ProjectOutlined /> },
  { key: "abschaum", name: "Abschaum", icon: <ExperimentOutlined /> },
  { key: "kommentar", name: "Kommentar des Monats", icon: <CommentOutlined /> }
];
const M = { text: "#E8EEF2", leise: "rgba(232,238,242,.6)", gut: "#4FC3B1", schlecht: "#F07A6A", warn: "#F0AA2E" };

const MDelta = ({ v, gutWennSinkt = false, neutral = false, text }) => v == null ? null : (
  <span className="m-delta" style={{ color: neutral ? M.leise : (v <= 0) === gutWennSinkt ? M.gut : M.schlecht }}>
    {v > 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {prozent(Math.abs(v))}{text ? <small> {text}</small> : null}
  </span>
);
const MKachel = ({ titel, icon, wert, unter, farbe, gross }) => (
  <div className={`m-kachel${gross ? " m-gross" : ""}`}>
    <span className="m-titel">{icon} {titel}</span>
    <b className={typeof wert === "string" && /[A-Za-zÄÖÜäöü]{4,}/.test(wert) ? "m-wort" : ""} style={{ color: farbe }}>{wert}</b>
    {unter && <div className="m-unter">{unter}</div>}
  </div>
);

function Hallenmonitor({ k, en, warnungen, massnahmen, jahr, standZeit, verlassen }) {
  const [einst, setEinst] = useState(() => {
    try { return { sekunden: 20, folien: MONITOR_FOLIEN.map(x => x.key), ...JSON.parse(localStorage.getItem(MONITOR_SPEICHER)) }; }
    catch { return { sekunden: 20, folien: MONITOR_FOLIEN.map(x => x.key) }; }
  });
  const [i, setI] = useState(0);
  const [pause, setPause] = useState(false);
  const [steuerung, setSteuerung] = useState(true);
  const [bewegung, setBewegung] = useState(0);
  const letzteBewegung = useRef(0);
  const bewegt = () => { const t = Date.now(); if (t - letzteBewegung.current > 800) { letzteBewegung.current = t; setSteuerung(true); setBewegung(x => x + 1); } };
  const [einstOffen, setEinstOffen] = useState(false);
  const [jetzt, setJetzt] = useState(new Date());
  const [voll, setVoll] = useState(!!document.fullscreenElement);
  const f = farben(true);
  useEffect(() => { try { localStorage.setItem(MONITOR_SPEICHER, JSON.stringify(einst)); } catch { /* sans stockage */ } }, [einst]);

  const hatAbschaum = !!k?.aktuell?.some(r => r.abschaum);
  const [kommentar, setKommentar] = useState(null);
  useEffect(() => {
    if (!jahr) return;
    api(`/api/kommentare?jahr=${jahr}`).then(alle => {
      const s = Object.keys(alle).sort().at(-1);
      setKommentar(s ? { ...alle[s], monat: Number(s.slice(5)) } : null);
    }).catch(() => {});
  }, [jahr, standZeit]);
  const folien = MONITOR_FOLIEN.filter(x => einst.folien.includes(x.key) && (x.key !== "abschaum" || hatAbschaum) && (x.key !== "kommentar" || kommentar));
  const n = Math.max(1, folien.length);
  const folie = folien[i % n];

  // horloge, rotation, masquage des commandes
  useEffect(() => { const t = setInterval(() => setJetzt(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (pause || folien.length < 2) return;
    const t = setTimeout(() => setI(x => (x + 1) % n), einst.sekunden * 1000);
    return () => clearTimeout(t);
  }, [i, pause, einst.sekunden, n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!steuerung || einstOffen) return;
    const t = setTimeout(() => setSteuerung(false), 3500);
    return () => clearTimeout(t);
  }, [steuerung, einstOffen, bewegung]);

  // plein écran et écran toujours allumé (si le navigateur le permet)
  const vollbild = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())?.catch?.(() => {});
  useEffect(() => {
    const fs = () => setVoll(!!document.fullscreenElement);
    addEventListener("fullscreenchange", fs);
    let sperre = null;
    const wach = async () => { try { sperre = await navigator.wakeLock?.request("screen"); } catch { /* non disponible */ } };
    const sichtbar = () => { if (document.visibilityState === "visible") wach(); };
    wach(); document.addEventListener("visibilitychange", sichtbar);
    return () => { removeEventListener("fullscreenchange", fs); document.removeEventListener("visibilitychange", sichtbar); sperre?.release?.().catch(() => {}); };
  }, []);
  useEffect(() => {
    const taste = (e) => {
      if (einstOffen) return;
      if (e.key === "ArrowRight") setI(x => (x + 1) % n);
      else if (e.key === "ArrowLeft") setI(x => (x - 1 + n) % n);
      else if (e.key === " ") { e.preventDefault(); setPause(p => !p); }
      else if (e.key.toLowerCase() === "f") vollbild();
      else if (e.key === "Escape" && !document.fullscreenElement) verlassen();
      bewegt();
    };
    addEventListener("keydown", taste);
    return () => removeEventListener("keydown", taste);
  }, [n, einstOffen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- contenu des pages ----------
  const letzte = k?.aktuell?.filter(r => r.gesamt).at(-1);
  const vjMonat = letzte && k.vorjahr.find(r => r.Monat === letzte.Monat);
  const st = en.kpi?.standort;
  const progST = en.prognose?.find(x => x.key === "ST");
  const offene = massnahmen.filter(x => x.status === "geplant" || x.status === "umsetzung");
  const ueberfaellig = offene.filter(istUeberfaellig);
  const wichtige = warnungen.filter(x => x.stufe !== "info");
  const laden = <div className="m-leer">Daten werden geladen …</div>;

  function inhalt() {
    switch (folie?.key) {
      case "produktion": {
        if (!letzte) return laden;
        const quellen = [{ key: "presse1", name: "Presse I", farbe: f.p1 }, { key: "presse2", name: "Presse II", farbe: f.p2 }, { key: "ubc", name: "UBC-Aufbereitung", farbe: f.ubc }];
        return (
          <div className="m-raster">
            <MKachel gross titel={`Verarbeitet im ${monatName(letzte)}`} icon={<AppstoreOutlined />} wert={zahl(letzte.gesamt)}
              unter={vjMonat?.gesamt ? <MDelta v={letzte.gesamt / vjMonat.gesamt - 1} text={`ggü. ${monatName(vjMonat)} ${jahr - 1}`} /> : null} />
            <div className="m-kachel m-quellen">
              <span className="m-titel"><PieChartOutlined /> Quellen im {monatName(letzte)}</span>
              {quellen.map(q => (
                <div key={q.key} className="m-quelle">
                  <span><i style={{ background: q.farbe }} />{q.name}</span><b>{zahl(letzte[q.key])}</b>
                  <div className="m-balken"><div style={{ width: `${((letzte[q.key] || 0) / letzte.gesamt) * 100}%`, background: q.farbe }} /></div>
                </div>
              ))}
            </div>
            <MKachel titel={`${k.zeitraum}`} icon={<CalendarOutlined />} wert={zahl(k.gesamt)}
              unter={k.veraenderung != null ? <MDelta v={k.veraenderung} text={`ggü. ${jahr - 1}`} /> : `${k.mitDaten.length} Monate`} />
            <MKachel titel="Stärkster Monat" icon={<RiseOutlined />} wert={k.best ? monatName(k.best) : "–"} farbe={M.warn}
              unter={k.best ? `${zahl(k.best.gesamt)} verarbeitet` : null} />
            <MKachel titel="Durchschnitt pro Monat" icon={<CalendarOutlined />} wert={zahl(k.schnitt)} unter={`${k.mitDaten.length} Monate mit Daten`} />
          </div>
        );
      }
      case "energie": {
        if (!st) return laden;
        const enpiMonate = st.monatlich.map(z => ({ monat: z.monat, enpi: z.enpi }));
        const ps = progST?.status ? PROGNOSE_STATUS[progST.status] : null;
        return (
          <div className="m-raster">
            <MKachel gross titel="EnPI Standort" icon={<FundOutlined />} wert={dez(st.enpiAkt, 2)}
              unter={<MDelta v={st.veraenderung} gutWennSinkt text={`ggü. ${en.basisJahr}`} />} />
            <MKachel titel="Normalisierte Einsparung" icon={<StockOutlined />}
              wert={st.einsparung == null ? "–" : `${st.einsparung >= 0 ? "+" : "−"}${kurz(Math.abs(st.einsparung))}`}
              farbe={st.einsparung == null ? undefined : st.einsparung >= 0 ? M.gut : M.schlecht} unter="gegenüber dem Baseline-Modell" />
            <MKachel titel="Jahresziel (Prognose)" icon={<AimOutlined />}
              wert={ps ? ps.name : progST?.rest?.length ? kurz(progST.jahrV) : "–"}
              farbe={!ps ? undefined : progST.status === "sicher" ? M.gut : progST.status === "knapp" ? M.warn : M.schlecht}
              unter={ps ? `EnPI Jahresende ${dez(progST.enpiJahr, 2)}, Ziel ${dez(progST.zielJahr, 2)}` : progST?.rest?.length ? "Prognose Jahresverbrauch" : "kein Ziel festgelegt"} />
            <div className="m-kachel m-diagramm">
              <span className="m-titel"><LineChartOutlined /> EnPI je Monat</span>
              <ResponsiveContainer width="100%" height="85%">
                <LineChart data={enpiMonate} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,.08)" />
                  <XAxis dataKey="monat" tickLine={false} axisLine={false} tick={{ fill: M.leise, fontSize: 14 }} />
                  <YAxis tickLine={false} axisLine={false} width={56} tick={{ fill: M.leise, fontSize: 14 }} domain={["auto", "auto"]} tickFormatter={v => dez(v, 0)} />
                  <Line dataKey="enpi" stroke={f.standort} strokeWidth={4} dot={{ r: 4 }} isAnimationActive={false} type="monotone" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      }
      case "verbrauch": {
        if (!en.daten?.aktuell?.length) return laden;
        const daten = en.daten.aktuell.map(r => ({ monat: monatName(r).slice(0, 3), ...Object.fromEntries(SEU_DEF.map(a => [a.key, num(r[a.v])])) }));
        return (
          <div className="m-voll">
            <div className="m-legende">{SEU_DEF.map(a => <span key={a.key}><i style={{ background: f[a.farbe] }} />{a.name}
              <b>{en.kpi ? prozent(en.kpi.anlagen.find(x => x.key === a.key)?.anteil || 0) : ""}</b></span>)}</div>
            <ResponsiveContainer width="100%" height="88%">
              <BarChart data={daten} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,.08)" />
                <XAxis dataKey="monat" tickLine={false} axisLine={false} tick={{ fill: M.leise, fontSize: 18 }} />
                <YAxis tickFormatter={kurz} tickLine={false} axisLine={false} width={96} tick={{ fill: M.leise, fontSize: 16 }} />
                {SEU_DEF.map((a, j) => <Bar key={a.key} dataKey={a.key} stackId="a" fill={f[a.farbe]} isAnimationActive={false}
                  radius={j === SEU_DEF.length - 1 ? [5, 5, 0, 0] : 0} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      }
      case "warnungen":
        return !wichtige.length ? (
          <div className="m-leer m-gut"><CheckCircleOutlined /><span>Keine Auffälligkeiten</span><small>Energie, Daten und Maßnahmen ohne Befund</small></div>
        ) : (
          <div className="m-liste-raster">
            <div className="m-zahlen">
              <MKachel titel="Kritisch" icon={<CloseCircleOutlined />} wert={wichtige.filter(x => x.stufe === "kritisch").length} farbe={M.schlecht} />
              <MKachel titel="Warnungen" icon={<WarningOutlined />} wert={wichtige.filter(x => x.stufe === "warnung").length} farbe={M.warn} />
            </div>
            <ul className="m-liste">
              {wichtige.slice(0, 6).map(x => (
                <li key={x.id} style={{ borderLeftColor: x.stufe === "kritisch" ? M.schlecht : M.warn }}>
                  <b>{x.titel}</b>
                  <span>{ANLAGE_NAME[x.anlage] ?? x.anlage}{x.monat ? ` · ${MONATE[x.monat - 1]}` : ""} · {KATEGORIE[x.kategorie]?.name}</span>
                </li>
              ))}
              {wichtige.length > 6 && <li className="m-mehr">und {wichtige.length - 6} weitere</li>}
            </ul>
          </div>
        );
      case "massnahmen": {
        const naechste = [...offene].sort((a, b) => (a.frist || "9999").localeCompare(b.frist || "9999")).slice(0, 6);
        return (
          <div className="m-liste-raster">
            <div className="m-zahlen">
              <MKachel titel="Offen" icon={<ScheduleOutlined />} wert={offene.length} />
              <MKachel titel="Überfällig" icon={<WarningOutlined />} wert={ueberfaellig.length} farbe={ueberfaellig.length ? M.schlecht : M.gut} />
              <MKachel titel="Umgesetzt" icon={<CheckCircleOutlined />} wert={massnahmen.filter(x => x.status === "umgesetzt").length} farbe={M.gut} />
            </div>
            {!naechste.length ? <div className="m-leer"><ProjectOutlined /><span>Keine offenen Maßnahmen</span></div> : (
              <ul className="m-liste">
                {naechste.map(x => (
                  <li key={x.id} style={{ borderLeftColor: istUeberfaellig(x) ? M.schlecht : M_PRIO[x.prioritaet].farbe }}>
                    <b>{x.titel}</b>
                    <span>{ANLAGE_NAME[x.anlage]}{x.verantwortlich ? ` · ${x.verantwortlich}` : ""} ·{" "}
                      <em style={{ color: istUeberfaellig(x) ? M.schlecht : undefined }}>{x.frist ? `Frist ${dayjs(x.frist).format("DD.MM.YYYY")}` : "ohne Frist"}{istUeberfaellig(x) ? " (überfällig)" : ""}</em></span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      }
      case "abschaum": {
        const q = (rs) => { const g = summe(rs, "gesamt"); return g ? summe(rs, "abschaum") / g : null; };
        const r = k.aktuell.filter(x => x.abschaum).at(-1);
        const qj = q(k.aktuell), qv = k.vorjahr.some(x => x.abschaum) ? q(k.vjGleich) : null;
        const verlauf = k.aktuell.map(x => ({ monat: monatName(x).slice(0, 3), quote: x.gesamt && x.abschaum ? (x.abschaum / x.gesamt) * 100 : null }));
        return (
          <div className="m-raster">
            <MKachel gross titel={`Abschaumquote ${r ? monatName(r) : ""}`} icon={<ExperimentOutlined />} wert={r ? `${dez((r.abschaum / r.gesamt) * 100, 2)} %` : "–"} farbe={M.warn} />
            <MKachel titel={`Quote ${k.zeitraum}`} icon={<CalendarOutlined />} wert={qj != null ? `${dez(qj * 100, 2)} %` : "–"}
              unter={qv ? <MDelta v={qj / qv - 1} gutWennSinkt text={`ggü. ${jahr - 1}`} /> : null} />
            <MKachel titel="Abschaummenge" icon={<AppstoreOutlined />} wert={kurz(summe(k.aktuell, "abschaum"))} unter={k.zeitraum} />
            <div className="m-kachel m-diagramm">
              <span className="m-titel"><LineChartOutlined /> Quote je Monat</span>
              <ResponsiveContainer width="100%" height="85%">
                <LineChart data={verlauf} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,.08)" />
                  <XAxis dataKey="monat" tickLine={false} axisLine={false} tick={{ fill: M.leise, fontSize: 14 }} />
                  <YAxis tickLine={false} axisLine={false} width={56} tick={{ fill: M.leise, fontSize: 14 }} domain={["auto", "auto"]} tickFormatter={v => `${dez(v, 1)}`} />
                  <Line dataKey="quote" stroke={f.ubc} strokeWidth={4} dot={{ r: 4 }} isAnimationActive={false} type="monotone" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      }
      case "kommentar":
        return (
          <div className="m-kommentar">
            <span className="m-titel"><CommentOutlined /> {MONATE[kommentar.monat - 1]} {jahr} · {kommentar.wer}</span>
            <AntwortText text={kommentar.text} />
          </div>
        );
      default: return <div className="m-leer">Keine Seiten ausgewählt</div>;
    }
  }

  return (
    <div className={`monitor${steuerung ? "" : " m-ohne-zeiger"}`} onMouseMove={bewegt} onClick={bewegt}>
      <header className="m-kopf">
        <div className="m-marke">
          <div className="marke-logo"><svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true">
            <rect x="5" y="16" width="5" height="11" rx="1" fill="#fff" /><rect x="13.5" y="10" width="5" height="17" rx="1" fill="#fff" /><rect x="22" y="5" width="5" height="22" rx="1" fill="#F0AA2E" /></svg></div>
          <span>MRS Produktion</span>
        </div>
        <h1 key={folie?.key}>{folie?.icon} {folie?.name}</h1>
        <div className="m-zeit">
          <b>{jetzt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</b>
          <span>{jetzt.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}</span>
        </div>
      </header>

      <main className="m-inhalt" key={`${folie?.key}-${i}`}>{inhalt()}</main>

      <footer className="m-fuss">
        <div className="m-punkte">{folien.map((x, j) => (
          <button key={x.key} className={j === i % n ? "aktiv" : ""} onClick={() => setI(j)} aria-label={x.name}>{x.icon}<span>{x.name}</span></button>
        ))}</div>
        <span className="m-stand"><SyncOutlined /> Stand {standZeit.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}{pause ? " · angehalten" : ""}</span>
        {folien.length > 1 && <div className="m-fortschritt"><div key={`${i}-${pause}`} style={{ animationDuration: `${einst.sekunden}s`, animationPlayState: pause ? "paused" : "running" }} /></div>}
      </footer>

      <div className={`m-steuerung${steuerung ? " sichtbar" : ""}`}>
        <Tooltip title="Vorherige Seite (←)"><Button shape="circle" size="large" icon={<LeftOutlined />} onClick={() => setI(x => (x - 1 + n) % n)} /></Tooltip>
        <Tooltip title={pause ? "Weiter (Leertaste)" : "Anhalten (Leertaste)"}><Button shape="circle" size="large" type="primary" icon={pause ? <CaretRightOutlined /> : <PauseOutlined />} onClick={() => setPause(p => !p)} /></Tooltip>
        <Tooltip title="Nächste Seite (→)"><Button shape="circle" size="large" icon={<RightOutlined />} onClick={() => setI(x => (x + 1) % n)} /></Tooltip>
        <Tooltip title="Einstellungen"><Button shape="circle" size="large" icon={<SettingOutlined />} onClick={() => setEinstOffen(true)} /></Tooltip>
        <Tooltip title={voll ? "Vollbild beenden (F)" : "Vollbild (F)"}><Button shape="circle" size="large" icon={voll ? <FullscreenExitOutlined /> : <FullscreenOutlined />} onClick={vollbild} /></Tooltip>
        <Tooltip title="Monitor verlassen (Esc)"><Button shape="circle" size="large" icon={<CloseOutlined />} onClick={() => { if (document.fullscreenElement) document.exitFullscreen(); verlassen(); }} /></Tooltip>
      </div>

      <Modal open={einstOffen} title={<Space><SettingOutlined />Hallenmonitor einstellen</Space>} footer={null} onCancel={() => setEinstOffen(false)}>
        <Flex vertical gap={16}>
          <div>
            <Text strong><ClockCircleOutlined /> Anzeigedauer je Seite</Text>
            <Segmented block style={{ marginTop: 8 }} value={einst.sekunden} onChange={v => setEinst(e => ({ ...e, sekunden: v }))}
              options={[10, 15, 20, 30, 60].map(s => ({ value: s, label: `${s} s` }))} />
          </div>
          <div>
            <Text strong><AppstoreOutlined /> Seiten</Text>
            <Checkbox.Group style={{ display: "grid", gap: 8, marginTop: 8 }} value={einst.folien} onChange={v => { if (v.length) { setEinst(e => ({ ...e, folien: v })); setI(0); } }}
              options={MONITOR_FOLIEN.map(x => ({ value: x.key, label: <Space size={6}>{x.icon}{x.name}{x.key === "abschaum" && !hatAbschaum ? <Text type="secondary">(keine Daten)</Text> : null}</Space> }))} />
          </div>
          <Text type="secondary" style={{ fontSize: 12 }}><InfoCircleOutlined /> Die Daten werden alle 5 Minuten neu geladen. Tipp: für ein Hallenbildschirm einen eigenen Benutzer mit der Rolle „Leser“ anlegen.</Text>
        </Flex>
      </Modal>
    </div>
  );
}

// =====================================================================
// Monatskommentar : chiffres du mois → brouillon (Claude ou règles fixes) → relu et enregistré
// =====================================================================
const r1 = (v, n = 1) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** n) / 10 ** n);
const proz = (v) => (v == null ? null : r1(v * 100, 1));

// Toutes les données du mois, déjà calculées (ce que Claude reçoit)
function monatsDaten({ k, en, warnungen, massnahmen, jahr, monat }) {
  const r = k?.aktuell.find(x => x.Monat === monat);
  const v = k?.vorjahr.find(x => x.Monat === monat);
  const bis = k?.aktuell.filter(x => x.Monat <= monat) || [];
  const vjBis = k?.vorjahr.filter(x => bis.some(y => y.Monat === x.Monat)) || [];
  const m = en.kpi;
  const anl = (a) => {
    const z = a.monatlich.find(x => x.Monat === monat);
    const bisher = a.monatlich.filter(x => x.Monat <= monat && x.einsparung != null);
    return {
      anlage: a.name, verbrauch_monat: z ? Math.round(z.verbrauch) : null, enpi_monat: r1(z?.enpi, 3),
      einsparung_monat_normalisiert: z?.einsparung != null ? Math.round(z.einsparung) : null,
      einsparung_seit_januar: bisher.length ? Math.round(bisher.reduce((s, x) => s + x.einsparung, 0)) : null,
      enpi_seit_januar: r1(a.enpiAkt, 3), enpi_basisjahr_gleiche_monate: r1(a.enpiBasis, 3), veraenderung_enpi_prozent: proz(a.veraenderung),
      ziel_erreicht: a.zielErreicht, anteil_am_verbrauch_prozent: a.key === "ST" ? 100 : proz(a.anteil),
      modellguete_r2: r1(a.reg?.r2, 2)
    };
  };
  const p = (en.prognose || []).find(x => x.key === "ST");
  const imMonat = warnungen.filter(x => x.monat === monat || !x.monat);
  const abschaumQ = r?.gesamt && r.abschaum ? r.abschaum / r.gesamt : null;
  const abschaumQs = (k?.aktuell || []).filter(x => x.gesamt && x.abschaum).map(x => x.abschaum / x.gesamt);
  return {
    zeitraum: `${MONATE[monat - 1]} ${jahr}`, basisjahr_energie: en.basisJahr, energieziel_prozent: en.einst?.ziel ?? null,
    produktion: r ? {
      gesamt: r.gesamt, presse_1: r.presse1, presse_2: r.presse2, ubc: r.ubc,
      vorjahresmonat_gesamt: v?.gesamt ?? null, veraenderung_zum_vorjahresmonat_prozent: v?.gesamt ? proz(r.gesamt / v.gesamt - 1) : null,
      seit_januar_gesamt: summe(bis, "gesamt"),
      seit_januar_veraenderung_prozent: vjBis.length === bis.length && summe(vjBis, "gesamt") ? proz(summe(bis, "gesamt") / summe(vjBis, "gesamt") - 1) : null,
      monatsdurchschnitt_seit_januar: Math.round(summe(bis, "gesamt") / (bis.length || 1))
    } : null,
    energie: m ? [...m.anlagen, m.standort].map(anl) : null,
    seu: m ? m.pareto.filter(a => a.seu).map(a => a.name) : null,
    prognose_jahresende: p && p.rest.length ? {
      verbrauch_jahr: Math.round(p.jahrV), spanne_plus_minus: Math.round(p.spanne), enpi_jahresende: r1(p.enpiJahr, 3),
      ziel_enpi: r1(p.zielJahr, 3), status: p.status, noetiger_enpi_restliche_monate: r1(p.benoetigt, 3)
    } : null,
    abschaum: abschaumQ != null ? { quote_monat_prozent: proz(abschaumQ), quote_durchschnitt_jahr_prozent: proz(durchschnitt(abschaumQs)) } : null,
    auffaelligkeiten: imMonat.filter(x => x.stufe !== "info").slice(0, 8).map(x => ({ stufe: x.stufe, titel: x.titel, details: x.text })),
    massnahmen: {
      offen: massnahmen.filter(x => x.status === "geplant" || x.status === "umsetzung").length,
      ueberfaellig: massnahmen.filter(istUeberfaellig).map(x => ({ titel: x.titel, frist: x.frist, verantwortlich: x.verantwortlich })),
      umgesetzt: massnahmen.filter(x => x.status === "umgesetzt").map(x => {
        const g = gemesseneEinsparung(x, en, jahr);
        return { titel: x.titel, anlage: ANLAGE_NAME[x.anlage], erwartete_einsparung_jahr: x.einsparung, gemessen_bisher: g?.gemessen != null ? Math.round(g.gemessen) : null };
      })
    }
  };
}

// Brouillon sans IA (règles fixes) à partir des mêmes données
function regelKommentar(d) {
  const t = [];
  const p = d.produktion, st = d.energie?.find(x => x.anlage === "Standort gesamt");
  const pz = (v) => `${v >= 0 ? "+" : "−"}${dez(Math.abs(v), 1)} %`;
  if (p) t.push(`Im ${d.zeitraum} wurden **${zahl(p.gesamt)}** verarbeitet` +
    (p.veraenderung_zum_vorjahresmonat_prozent != null ? ` (${pz(p.veraenderung_zum_vorjahresmonat_prozent)} gegenüber dem Vorjahresmonat)` : "") +
    `. Seit Januar sind es ${zahl(p.seit_januar_gesamt)}` + (p.seit_januar_veraenderung_prozent != null ? ` (${pz(p.seit_januar_veraenderung_prozent)}).` : "."));
  if (st) {
    let e = `Der EnPI des Standorts lag im Monat bei ${dez(st.enpi_monat, 3)}, seit Januar bei **${dez(st.enpi_seit_januar, 3)}**`;
    if (st.veraenderung_enpi_prozent != null) e += ` (${pz(st.veraenderung_enpi_prozent)} gegenüber ${d.basisjahr_energie}; ${st.veraenderung_enpi_prozent <= 0 ? "Verbesserung" : "Verschlechterung"})`;
    e += ".";
    if (st.einsparung_monat_normalisiert != null) e += ` Bereinigt um die Menge ergibt sich im Monat ${st.einsparung_monat_normalisiert >= 0 ? `eine Einsparung von ${zahl(st.einsparung_monat_normalisiert)}` : `ein Mehrverbrauch von ${zahl(-st.einsparung_monat_normalisiert)}`}.`;
    const pr = d.prognose_jahresende;
    if (pr?.status) e += ` Laut Prognose wird das Jahresziel ${pr.status === "sicher" ? "sicher erreicht" : pr.status === "knapp" ? "nur knapp erreicht" : "verfehlt"} (EnPI Jahresende ${dez(pr.enpi_jahresende, 3)}, Ziel ${dez(pr.ziel_enpi, 3)}).`;
    t.push(e);
  }
  const a = d.auffaelligkeiten || [];
  let f = a.length ? `Auffälligkeiten: ${a.slice(0, 3).map(x => x.titel).join("; ")}.` : "Die automatische Prüfung meldet keine Auffälligkeiten.";
  f += ` Im Maßnahmenplan ${d.massnahmen.offen === 1 ? "ist 1 Maßnahme" : `sind ${d.massnahmen.offen} Maßnahmen`} offen${d.massnahmen.ueberfaellig.length ? `, davon ${d.massnahmen.ueberfaellig.length} überfällig` : ""}.`;
  if (d.abschaum) f += ` Die Abschaumquote lag bei ${dez(d.abschaum.quote_monat_prozent, 2)} % (Jahresschnitt ${dez(d.abschaum.quote_durchschnitt_jahr_prozent, 2)} %).`;
  t.push(f);
  const emp = [];
  if (a.some(x => x.stufe === "kritisch")) emp.push("Ursache der kritischen Abweichung klären und eine Maßnahme anlegen.");
  if (d.massnahmen.ueberfaellig.length) emp.push("Überfällige Maßnahmen mit den Verantwortlichen neu terminieren.");
  if (d.prognose_jahresende?.status === "verfehlt") emp.push(`Für das Jahresziel ist in den restlichen Monaten ein EnPI von höchstens ${dez(d.prognose_jahresende.noetiger_enpi_restliche_monate, 3)} nötig.`);
  if (!emp.length) emp.push("Kurs beibehalten und die laufenden Maßnahmen weiter verfolgen.");
  t.push("Empfehlungen:\n" + emp.map(x => `- ${x}`).join("\n"));
  return t.join("\n\n");
}

const QUELLE = { ki: { name: "KI-Entwurf", icon: <RobotOutlined />, farbe: "purple" }, regel: { name: "Automatischer Entwurf", icon: <FunctionOutlined />, farbe: "blue" },
                 manuell: { name: "Manuell", icon: <EditOutlined />, farbe: "default" } };

function Monatskommentar({ k, en, warnungen, massnahmen, jahr, darf }) {
  const { message } = AntApp.useApp();
  const [kommentare, setKommentare] = useState(null);
  const [status, setStatus] = useState(null);
  const [monat, setMonat] = useState(null);
  const [entwurf, setEntwurf] = useState(null);        // { text, quelle, modell }
  const [laedt, setLaedt] = useState(false);
  const [kiFehler, setKiFehler] = useState("");

  const monate = (k?.aktuell || []).filter(r => r.gesamt).map(r => r.Monat);
  const laden = () => jahr && api(`/api/kommentare?jahr=${jahr}`).then(setKommentare).catch(e => message.error(e.message));
  useEffect(() => { laden(); }, [jahr]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api("/api/status").then(setStatus).catch(() => setStatus({ ki: false })); }, []);
  useEffect(() => { if (monate.length && !monate.includes(monat)) setMonat(monate.at(-1)); }, [monate.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setEntwurf(null); setKiFehler(""); }, [monat, jahr]);

  if (!k || !kommentare) return <Card><Skeleton active paragraph={{ rows: 8 }} /></Card>;
  if (!monate.length) return <Card><Empty description={`Für ${jahr} liegen keine Produktionsdaten vor.`} /></Card>;

  const schluessel = monat ? `${jahr}-${String(monat).padStart(2, "0")}` : null;
  const gespeichert = schluessel ? kommentare[schluessel] : null;
  const daten = monat ? monatsDaten({ k, en, warnungen, massnahmen, jahr, monat }) : null;

  async function mitKi() {
    setLaedt(true); setKiFehler("");
    try {
      const r = await api("/api/kommentar/entwurf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jahr, monat, daten }) });
      setEntwurf({ text: r.text, quelle: "ki", modell: r.modell });
    } catch (e) { setKiFehler(e.message); }
    finally { setLaedt(false); }
  }
  async function speichern() {
    try {
      await api(`/api/kommentare/${schluessel}`, { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: entwurf.text, quelle: entwurf.quelle, modell: entwurf.modell }) });
      message.success("Kommentar gespeichert"); setEntwurf(null); setKiFehler(""); laden();
    } catch (e) { message.error(e.message, 6); }
  }
  async function loeschen() {
    try { await api(`/api/kommentare/${schluessel}`, { method: "DELETE" }); message.success("Kommentar gelöscht"); laden(); }
    catch (e) { message.error(e.message, 6); }
  }

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="flex-end" wrap gap={12}>
        <Kopf titel={`Monatskommentar ${jahr}`} text="Kommentar zu Produktion und Energie für die Geschäftsführung: Entwurf erstellen, prüfen, speichern" />
        {status && <Tooltip title={status.ki ? `Modell: ${status.modell}` : "Ohne Schlüssel oder Guthaben: Entwurf ohne KI möglich"}>
          <Tag color={status.ki ? "success" : "warning"} bordered={false} icon={<RobotOutlined />} style={{ padding: "4px 10px" }}>{status.ki ? "Claude eingerichtet" : "Ohne KI"}</Tag></Tooltip>}
      </Flex>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={7} xl={6}>
          <Card styles={{ body: { padding: 8 } }} title={<Space><CalendarOutlined />Monate {jahr}</Space>}>
            <Menu mode="inline" selectedKeys={monat ? [String(monat)] : []} onClick={e => setMonat(Number(e.key))} style={{ borderInlineEnd: 0 }}
              items={[...monate].reverse().map(mo => {
                const g = kommentare[`${jahr}-${String(mo).padStart(2, "0")}`];
                return { key: String(mo), icon: g ? <CheckCircleOutlined style={{ color: "#2F9E8F" }} /> : <MinusCircleOutlined style={{ opacity: .4 }} />,
                  label: <Flex justify="space-between" gap={8}><span>{MONATE[mo - 1]}</span>{g && <Text type="secondary" style={{ fontSize: 12 }}>{dayjs(g.zeit).format("DD.MM.")}</Text>}</Flex> };
              })} />
          </Card>
        </Col>

        <Col xs={24} lg={17} xl={18}>
          <Flex vertical gap={16}>
            {entwurf ? (
              <Card title={<Space><EditOutlined />Entwurf für {MONATE[monat - 1]} {jahr}<Tag color={QUELLE[entwurf.quelle].farbe} icon={QUELLE[entwurf.quelle].icon} bordered={false}>{QUELLE[entwurf.quelle].name}</Tag></Space>}
                extra={<Space><Button onClick={() => setEntwurf(null)}>Verwerfen</Button>
                  <Button type="primary" icon={<CheckCircleOutlined />} disabled={!entwurf.text.trim()} onClick={speichern}>Speichern</Button></Space>}>
                <Alert type="info" showIcon className="hinweis" style={{ marginBottom: 12 }}
                  message={entwurf.quelle === "ki" ? "Bitte prüfen: Der Text wurde von Claude aus den Kennzahlen geschrieben. Zahlen und Aussagen vor dem Speichern kontrollieren."
                    : "Automatisch aus festen Regeln erstellt. Ergänzen Sie Ursachen und Bewertung."} />
                <Input.TextArea value={entwurf.text} onChange={e => setEntwurf(x => ({ ...x, text: e.target.value, quelle: x.quelle === "manuell" ? "manuell" : x.quelle }))}
                  autoSize={{ minRows: 10, maxRows: 24 }} maxLength={8000} showCount />
                <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8 }}><InfoCircleOutlined /> **fett** und Zeilen mit „- “ werden formatiert angezeigt.</Text>
              </Card>
            ) : gespeichert ? (
              <Card title={<Space><CommentOutlined />{MONATE[monat - 1]} {jahr}</Space>}
                extra={<Space wrap>
                  <Tag color={QUELLE[gespeichert.quelle]?.farbe} icon={QUELLE[gespeichert.quelle]?.icon} bordered={false}>{QUELLE[gespeichert.quelle]?.name}</Tag>
                  <Tooltip title="Kopieren"><Button icon={<CopyOutlined />} onClick={() => navigator.clipboard?.writeText(gespeichert.text).then(() => message.success("Kopiert"))} /></Tooltip>
                  {darf && <Button icon={<EditOutlined />} onClick={() => setEntwurf({ text: gespeichert.text, quelle: "manuell", modell: null })}>Bearbeiten</Button>}
                  {darf && <Popconfirm title="Kommentar löschen?" okText="Löschen" cancelText="Abbrechen" okButtonProps={{ danger: true }} onConfirm={loeschen}>
                    <Button danger icon={<DeleteOutlined />} aria-label="Löschen" /></Popconfirm>}
                </Space>}>
                <div style={{ fontSize: 15, lineHeight: 1.7, maxWidth: 760 }}><AntwortText text={gespeichert.text} /></div>
                <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 12 }}>
                  <UserOutlined /> {gespeichert.wer} · <ClockCircleOutlined /> {dayjs(gespeichert.zeit).format("DD.MM.YYYY HH:mm")}{gespeichert.modell ? ` · ${gespeichert.modell}` : ""}
                </Text>
              </Card>
            ) : (
              <Card><Empty image={<CommentOutlined style={{ fontSize: 48, opacity: .4 }} />} description={`Noch kein Kommentar für ${MONATE[monat - 1]} ${jahr}.`} /></Card>
            )}

            {darf && !entwurf && (
              <Card size="small" title={<Space><FileTextOutlined />{gespeichert ? "Neuen Entwurf erstellen" : "Entwurf erstellen"}</Space>}>
                <Flex gap={12} wrap align="center">
                  <Tooltip title={status?.ki ? "Claude schreibt aus den Kennzahlen dieses Monats" : "Claude ist nicht eingerichtet"}>
                    <Button type="primary" icon={<RobotOutlined />} loading={laedt} disabled={!status?.ki} onClick={mitKi}>Mit KI schreiben</Button>
                  </Tooltip>
                  <Button icon={<FunctionOutlined />} onClick={() => setEntwurf({ text: regelKommentar(daten), quelle: "regel", modell: null })}>Entwurf ohne KI</Button>
                  <Button icon={<EditOutlined />} onClick={() => setEntwurf({ text: "", quelle: "manuell", modell: null })}>Selbst schreiben</Button>
                </Flex>
                {kiFehler && <Alert type="warning" showIcon style={{ marginTop: 12 }} message={kiFehler}
                  action={<Button size="small" onClick={() => setEntwurf({ text: regelKommentar(daten), quelle: "regel", modell: null })}>Entwurf ohne KI</Button>} />}
              </Card>
            )}

            <Collapse size="small" items={[{ key: "d", label: <Space><DatabaseOutlined /><b>Verwendete Kennzahlen</b><Text type="secondary">genau diese Daten erhält Claude</Text></Space>,
              children: <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap", maxHeight: 360, overflow: "auto" }}>{JSON.stringify(daten, null, 2)}</pre> }]} />
          </Flex>
        </Col>
      </Row>
    </Flex>
  );
}

// =====================================================================
// Werksplan 3D : halles et installations en 3D, clic → documentation
//  - three.js chargé seulement à l'ouverture de la page (import dynamique)
//  - données : /api/anlagen (daten/anlagen.json), fichiers : daten/dokumente/<id>/
//  - souris : glisser = tourner, clic droit glisser = déplacer, molette = zoom, clic = choisir
// =====================================================================
const W_TYPEN = {
  halle: { name: "Halle", icon: <HomeOutlined /> },
  presse: { name: "Presse", icon: <BuildOutlined /> },
  aufbereitung: { name: "Aufbereitung", icon: <SyncOutlined /> },
  ofen: { name: "Ofen / Anlage", icon: <FireOutlined /> },
  lager: { name: "Lager", icon: <AppstoreOutlined /> },
  sonstige: { name: "Sonstiges", icon: <SettingOutlined /> }
};
const W_FARBE_TYP = { halle: "#4F83AA", presse: "#7C6BB0", aufbereitung: "#B08D57", ofen: "#C4574A", lager: "#9C8A66", sonstige: "#8C99A6" };
const wFarbe = (a, f) => (a.seu ? f[ANLAGE_FARBE[a.seu]] : W_FARBE_TYP[a.typ] || "#8C99A6");
const ZUSTAND_FARBE = { ok: "#2F9E8F", warnung: "#E39A2D", kritisch: "#CF4B3B" };
const ZUSTAND_NAME = { ok: "in Ordnung", warnung: "Warnung", kritisch: "kritisch" };
const escHtml = (t) => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const DOKU_ANNEHMEN = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.dwg,.dxf,.step,.stp,.zip";
const dateiGroesse = (b) => (b > 1048576 ? `${dez(b / 1048576, 1)} MB` : `${dez(Math.max(1, b / 1024), 0)} KB`);
const kennung = (t) => String(t).toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "element";
// valeurs sûres pour la 3D (pendant la saisie, un champ peut être vide)
const wSicher = (a) => {
  const n = (v, d, min) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.max(min, Number(v)) : d);
  return { ...a, x: n(a.x, 0, -500), z: n(a.z, 0, -500), breite: n(a.breite, 4, 0.5), tiefe: n(a.tiefe, 4, 0.5), hoehe: n(a.hoehe, 4, 0.5), drehung: n(a.drehung, 0, -360) };
};

// construit un élément en géométrie simple (une forme reconnaissable par type)
function w3dBauen(THREE, a, farbe, dunkel) {
  const g = new THREE.Group();
  const { breite: b, tiefe: t, hoehe: h } = a;
  const haupt = new THREE.Color(farbe), dunkler = haupt.clone().multiplyScalar(0.62), grau = new THREE.Color(dunkel ? "#55626e" : "#9aa5af");
  const teil = (geo, c, x, y, z, eltern = g, extra = {}) => {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.2, ...extra }));
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; m.userData.rolle = "koerper";
    eltern.add(m); return m;
  };
  // décalage propre à chaque élément : les machines ne bougent pas toutes en même temps
  const phase = ([...String(a.id)].reduce((x, c) => x + c.charCodeAt(0), 0) % 97) / 97 * Math.PI * 2;
  const Box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
  switch (a.typ) {
    case "halle": {
      const boden = new THREE.Mesh(Box(b, 0.2, t), new THREE.MeshStandardMaterial({ color: dunkel ? "#25303a" : "#d3dae0", roughness: 1 }));
      boden.position.y = 0.1; boden.receiveShadow = true; g.add(boden);
      const wand = new THREE.Mesh(Box(b, h, t), new THREE.MeshStandardMaterial({ color: haupt, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide }));
      wand.position.y = h / 2; wand.userData.rolle = "wand"; g.add(wand);
      const kante = dunkel ? "#7FA8C3" : "#2B5874";
      const linien = new THREE.LineSegments(new THREE.EdgesGeometry(Box(b, h, t)), new THREE.LineBasicMaterial({ color: kante }));
      linien.position.y = h / 2; linien.userData = { rolle: "kante", farbe: kante, pickbar: false }; g.add(linien);
      // fermes de toit : donnent l'échelle et la direction de la halle
      const n = Math.max(2, Math.round(b / 8));
      for (let i = 1; i < n; i++) {
        const x = -b / 2 + (b / n) * i;
        const p = [x, h, -t / 2, x, h + h * 0.14, 0, x, h + h * 0.14, 0, x, h, t / 2];
        const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
        const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: kante, transparent: true, opacity: 0.45 }));
        l.userData.pickbar = false; g.add(l);
      }
      break;
    }
    case "presse": {
      teil(Box(b, h * 0.28, t), dunkler, 0, h * 0.14, 0);                                     // bâti
      for (const sx of [-1, 1]) teil(Box(b * 0.14, h * 0.5, t * 0.5), haupt, sx * b * 0.36, h * 0.53, 0);   // montants
      teil(Box(b * 0.9, h * 0.22, t * 0.8), haupt, 0, h * 0.89, 0);                           // tête
      const rampe = teil(Box(b * 0.5, 0.3, t * 0.5), grau, -b * 0.62, h * 0.2, 0); rampe.rotation.z = 0.35;
      const stempel = teil(Box(b * 0.5, h * 0.1, t * 0.45), grau, 0, h * 0.6, 0);             // coulisseau
      const r = Math.min(b, t) * 0.07;
      const stange = teil(new THREE.CylinderGeometry(r, r, 1, 12), grau, 0, 0, 0);
      const oben = h * 0.78, tief = h * 0.33, hoch = h * 0.68;
      const setzen = (y) => { stempel.position.y = y; const top = y + h * 0.05, l = Math.max(0.05, oben - top); stange.scale.y = l; stange.position.y = top + l / 2; };
      // course : descente rapide, remontée lente, petite pause en haut
      g.userData.anim = (sek) => { const k = (Math.sin(sek * 1.5 + phase) + 1) / 2; setzen(hoch - (hoch - tief) * k ** 3); };
      g.userData.anim(0);
      break;
    }
    case "aufbereitung": {
      teil(Box(b, h * 0.35, t), dunkler, 0, h * 0.175, 0);
      const r = Math.min(t * 0.18, h * 0.15);
      const walzen = [-t * 0.2, t * 0.2].map(z => {                                            // rouleaux du broyeur
        const halter = new THREE.Group(); halter.position.set(-b * 0.15, h * 0.35 + r, z); halter.rotation.z = Math.PI / 2; g.add(halter);
        return teil(new THREE.CylinderGeometry(r, r, b * 0.5, 8), haupt, 0, 0, 0, halter, { flatShading: true });
      });
      const trichter = teil(new THREE.CylinderGeometry(Math.min(b, t) * 0.3, Math.min(b, t) * 0.1, h * 0.35, 4), haupt, -b * 0.15, h * 0.8, 0); trichter.rotation.y = Math.PI / 4;
      const band = new THREE.Group(); band.position.set(b * 0.3, h * 0.55, 0); band.rotation.z = 0.45; g.add(band);   // convoyeur
      const laenge = b * 0.55;
      teil(Box(laenge, 0.35, t * 0.25), grau, 0, 0, 0, band);
      const stuecke = [0, 1, 2, 3].map(() => teil(Box(0.35, 0.3, 0.35), haupt, 0, 0.33, 0, band));
      g.userData.anim = (sek) => {
        walzen.forEach((w, i) => { w.rotation.y = sek * (i ? -3 : 3) + phase; });
        stuecke.forEach((m, i) => { m.position.x = -laenge * 0.45 + ((sek * 0.35 + i / 4 + phase) % 1) * laenge * 0.9; });
      };
      g.userData.anim(0);
      break;
    }
    case "ofen": {
      const r = Math.min(b, t) / 2;
      teil(new THREE.CylinderGeometry(r, r * 1.05, h * 0.62, 32), haupt, 0, h * 0.31, 0);
      teil(new THREE.CylinderGeometry(r * 0.92, r, h * 0.1, 32), dunkler, 0, h * 0.67, 0);
      teil(new THREE.CylinderGeometry(r * 0.12, r * 0.14, h * 0.45, 12), grau, r * 0.45, h * 0.72 + h * 0.2, r * 0.2);
      const glut = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, Math.max(0.08, r * 0.05), 8, 48), new THREE.MeshBasicMaterial({ color: "#ff8a2a", transparent: true, opacity: 0.8 }));
      glut.rotation.x = Math.PI / 2; glut.position.y = h * 0.62; g.add(glut);
      const kamin = { x: r * 0.45, y: h * 1.145, z: r * 0.2 };
      const rauch = Array.from({ length: 6 }, () => {
        const m = new THREE.Mesh(new THREE.SphereGeometry(r * 0.16, 10, 8), new THREE.MeshStandardMaterial({ color: dunkel ? "#8c99a6" : "#c9d1d8", transparent: true, opacity: 0, depthWrite: false }));
        m.userData.pickbar = false; g.add(m); return m;
      });
      g.userData.anim = (sek) => {
        glut.material.opacity = 0.55 + 0.4 * (Math.sin(sek * 2.2 + phase) + 1) / 2;
        rauch.forEach((m, i) => {
          const k = (sek * 0.22 + i / rauch.length + phase) % 1;
          m.position.set(kamin.x + k * 1.6, kamin.y + k * h * 0.7, kamin.z);
          m.scale.setScalar(0.6 + k * 2); m.material.opacity = 0.45 * (1 - k) * Math.min(1, k * 6);
        });
      };
      g.userData.anim(0);
      break;
    }
    case "lager": {
      const nx = Math.max(1, Math.floor(b / 2.4)), nz = Math.max(1, Math.floor(t / 2.4));
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const lagen = Math.min(Math.max(1, Math.floor(h / 1.4)), ((i * 7 + j * 3) % 3) + 1), hh = lagen * 1.3;
        teil(Box(2, hh, 2), (i + j) % 2 ? haupt : dunkler, -b / 2 + 1.2 + i * (b - 2.4) / Math.max(1, nx - 1), hh / 2, -t / 2 + 1.2 + j * (t - 2.4) / Math.max(1, nz - 1));
      }
      break;
    }
    default: teil(Box(b, h, t), haupt, 0, h / 2, 0);
  }
  return g;
}

function Werk3D({ anlagen, auswahl, onWaehlen, dunkel, beschriftung, heim, animiert, drehen, zustandAn, live, hilfe = true, children }) {
  const buehne = useRef(null);
  const s = useRef(null);
  const waehlenRef = useRef(onWaehlen); waehlenRef.current = onWaehlen;
  const auswahlRef = useRef(auswahl); auswahlRef.current = auswahl;
  const [bereit, setBereit] = useState(false);
  const [fehler, setFehler] = useState("");

  // 1. scène, caméra, lumières, contrôles (une seule fois)
  useEffect(() => {
    let weg = false;
    (async () => {
      try {
        const [THREE, { OrbitControls }, { CSS2DRenderer, CSS2DObject }] = await Promise.all([
          import("three"), import("three/examples/jsm/controls/OrbitControls.js"), import("three/examples/jsm/renderers/CSS2DRenderer.js")]);
        if (weg || !buehne.current) return;
        const el = buehne.current;
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        el.appendChild(renderer.domElement);
        const labels = new CSS2DRenderer(); labels.domElement.className = "w3d-labels"; el.appendChild(labels.domElement);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 1200);
        camera.position.set(0, 60, 80);
        const controls = new OrbitControls(camera, renderer.domElement);
        Object.assign(controls, { enableDamping: true, maxPolarAngle: Math.PI * 0.47, minDistance: 6, maxDistance: 260 });
        scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.15));
        const sonne = new THREE.DirectionalLight(0xffffff, 1.7);
        sonne.position.set(45, 90, 35); sonne.castShadow = true; sonne.shadow.mapSize.set(2048, 2048);
        Object.assign(sonne.shadow.camera, { left: -100, right: 100, top: 100, bottom: -100, near: 1, far: 300 });
        scene.add(sonne);
        const boden = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }));
        boden.rotation.x = -Math.PI / 2; boden.receiveShadow = true; scene.add(boden);
        const gitter = new THREE.GridHelper(600, 150, 0x8899aa, 0x8899aa);
        gitter.material.transparent = true; gitter.material.opacity = 0.18; gitter.position.y = 0.02; scene.add(gitter);
        const gruppe = new THREE.Group(); scene.add(gruppe);
        const reduziert = matchMedia("(prefers-reduced-motion: reduce)").matches;
        const st = { THREE, CSS2DObject, renderer, labels, scene, camera, controls, boden, gruppe, objekte: new Map(), flug: null, hover: null, raf: 0 };
        s.current = st;

        const groesse = () => {
          const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return;
          renderer.setSize(w, h); labels.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
        };
        groesse(); st.ro = new ResizeObserver(groesse); st.ro.observe(el);

        // déplacements de caméra
        st.fliegeZu = (ziel, pos, sofort) => {
          if (sofort || reduziert) { camera.position.copy(pos); controls.target.copy(ziel); st.flug = null; return; }
          st.flug = { vonPos: camera.position.clone(), nachPos: pos, vonZiel: controls.target.clone(), nachZiel: ziel, start: performance.now(), dauer: 900 };
        };
        st.heim = (sofort) => {
          const as = [...st.objekte.values()].map(o => o.userData.a);
          if (!as.length) return;
          const minX = Math.min(...as.map(a => a.x - a.breite / 2)), maxX = Math.max(...as.map(a => a.x + a.breite / 2));
          const minZ = Math.min(...as.map(a => a.z - a.tiefe / 2)), maxZ = Math.max(...as.map(a => a.z + a.tiefe / 2));
          const ziel = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
          const spanne = Math.max(maxX - minX, maxZ - minZ, 20);
          st.fliegeZu(ziel, ziel.clone().add(new THREE.Vector3(0, 0.85, 1).normalize().multiplyScalar(spanne * 1.05 + 14)), sofort);
        };
        st.fokus = (a) => {
          const ziel = new THREE.Vector3(a.x, a.typ === "halle" ? 0 : a.hoehe * 0.45, a.z);
          const abstand = a.typ === "halle" ? Math.max(a.breite, a.tiefe) * 1.15 + 10 : Math.max(a.breite, a.tiefe, a.hoehe) * 2.4 + 8;
          const richtung = camera.position.clone().sub(controls.target).normalize();
          if (richtung.y < 0.45) { richtung.y = 0.45; richtung.normalize(); }
          st.fliegeZu(ziel, ziel.clone().add(richtung.multiplyScalar(abstand)));
        };
        // mise en évidence (survol / sélection)
        st.markieren = () => {
          for (const [id, o] of st.objekte) {
            const sel = id === auswahlRef.current, hov = id === st.hover;
            o.traverse(m => {
              if (m.userData.rolle === "koerper") { m.material.emissive.set(sel ? "#F0AA2E" : hov ? "#4F83AA" : "#000000"); m.material.emissiveIntensity = sel ? 0.45 : hov ? 0.35 : 0; }
              if (m.userData.rolle === "wand") m.material.opacity = sel ? 0.16 : hov ? 0.11 : 0.06;
              if (m.userData.rolle === "kante") m.material.color.set(sel ? "#F0AA2E" : hov ? "#4F83AA" : m.userData.farbe);
            });
            o.userData.label?.classList.toggle("aktiv", sel);
          }
        };

        // choix à la souris : d'abord les machines, ensuite les halles (sinon le mur de la halle cache tout)
        const ray = new THREE.Raycaster(), maus = new THREE.Vector2(), dom = renderer.domElement;
        const treffer = (e) => {
          const r = dom.getBoundingClientRect();
          maus.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
          ray.setFromCamera(maus, camera);
          const alle = [...st.objekte.values()];
          for (const nurHalle of [false, true]) {
            const h = ray.intersectObjects(alle.filter(o => (o.userData.typ === "halle") === nurHalle), true).find(x => x.object.userData.pickbar !== false);
            if (h) { let o = h.object; while (o && !o.userData.id) o = o.parent; return o?.userData.id ?? null; }
          }
          return null;
        };
        let unten = null;
        dom.addEventListener("pointerdown", e => { unten = [e.clientX, e.clientY]; });
        dom.addEventListener("pointerup", e => {
          if (e.button !== 0 || !unten || Math.hypot(e.clientX - unten[0], e.clientY - unten[1]) > 5) return;
          waehlenRef.current(treffer(e));
        });
        dom.addEventListener("pointermove", e => {
          if (e.buttons) return;
          const id = treffer(e);
          if (id !== st.hover) { st.hover = id; dom.style.cursor = id ? "pointer" : "grab"; st.markieren(); }
        });
        dom.addEventListener("pointerleave", () => { if (st.hover) { st.hover = null; st.markieren(); } });

        const ease = (x) => 1 - (1 - x) ** 3;
        const schleife = (zeit) => {
          st.raf = requestAnimationFrame(schleife);
          if (st.flug) {
            const x = Math.min(1, (zeit - st.flug.start) / st.flug.dauer), k = ease(Math.max(0, x));
            camera.position.lerpVectors(st.flug.vonPos, st.flug.nachPos, k);
            controls.target.lerpVectors(st.flug.vonZiel, st.flug.nachZiel, k);
            if (x >= 1) st.flug = null;
          }
          if (st.animiert) { const sek = zeit / 1000; for (const o of st.objekte.values()) if (o.userData.laeuft !== false) o.userData.anim?.(sek); }
          controls.update();
          renderer.render(scene, camera); labels.render(scene, camera);
        };
        st.raf = requestAnimationFrame(schleife);
        setBereit(true);
      } catch (e) { setFehler(e.message || "WebGL ist in diesem Browser nicht verfügbar."); }
    })();
    return () => {
      weg = true;
      const st = s.current; if (!st) return;
      cancelAnimationFrame(st.raf); st.ro?.disconnect(); st.controls.dispose();
      st.scene.traverse(o => { o.geometry?.dispose(); [].concat(o.material || []).forEach(m => m.dispose()); });
      st.renderer.dispose(); st.renderer.forceContextLoss(); st.renderer.domElement.remove(); st.labels.domElement.remove();
      s.current = null;
    };
  }, []);

  // 2. éléments : reconstruits quand la liste ou le thème change
  useEffect(() => {
    const st = s.current; if (!st || !bereit) return;
    const { THREE, gruppe, scene } = st;
    gruppe.traverse(o => { o.geometry?.dispose(); [].concat(o.material || []).forEach(m => m.dispose()); o.element?.remove(); });
    gruppe.clear(); st.objekte.clear();
    const f = farben(dunkel), hg = dunkel ? "#0f1418" : "#eef2f5";
    scene.background = new THREE.Color(hg); scene.fog = new THREE.Fog(hg, 180, 480);
    st.boden.material.color.set(dunkel ? "#151d24" : "#e3e8ec");
    for (const roh of anlagen) {
      const a = wSicher(roh);
      // mode « Zustand » : vert / orange / rouge selon les avertissements, gris sans données d'énergie
      const zf = zustandAn ? ZUSTAND_FARBE[a.zustand?.stufe] : null;
      const farbe = zf || (zustandAn && a.typ !== "halle" ? (dunkel ? "#55626e" : "#a7b0b8") : wFarbe(a, f));
      const o = w3dBauen(THREE, a, farbe, dunkel);
      if (a.zustand?.stillstand) o.userData.anim = null;           // machine arrêtée : elle ne bouge plus
      o.position.set(a.x, 0, a.z); o.rotation.y = -(a.drehung * Math.PI) / 180;
      const div = document.createElement("div");
      div.className = `w3d-label${a.typ === "halle" ? " halle" : ""}`; div.textContent = a.name;
      if (zustandAn && a.zustand?.meldungen?.length) {
        const badge = document.createElement("span");
        badge.className = `w3d-badge ${a.zustand.stufe}`; badge.textContent = a.zustand.stillstand ? "Stillstand" : a.zustand.meldungen.length; div.appendChild(badge);
      }
      if (zustandAn && a.typ !== "halle" && a.zustand?.stufe === "kritisch") {
        const rr = Math.max(a.breite, a.tiefe) * 0.75;
        const ring = new THREE.Mesh(new THREE.RingGeometry(rr, rr + 0.5, 48),
          new THREE.MeshBasicMaterial({ color: ZUSTAND_FARBE.kritisch, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.25; ring.userData.pickbar = false; o.add(ring);
        const vorher = o.userData.anim;
        o.userData.anim = (sek) => { vorher?.(sek); const k = (sek * 0.8) % 1; ring.scale.setScalar(1 + k * 0.6); ring.material.opacity = 0.75 * (1 - k); };
      }
      const label = new st.CSS2DObject(div);
      label.position.set(0, a.typ === "halle" ? a.hoehe * 1.16 + 0.8 : a.hoehe + 1.4, a.typ === "halle" ? -a.tiefe / 2 : 0);
      o.add(label);
      const liveZeile = document.createElement("div"); liveZeile.className = "w3d-live"; liveZeile.style.display = "none"; div.appendChild(liveZeile);
      Object.assign(o.userData, { id: a.id, typ: a.typ, a, label: div, liveZeile });
      gruppe.add(o); st.objekte.set(a.id, o);
    }
    st.markieren();
    if (!st.erstesMal && anlagen.length) { st.erstesMal = true; st.heim(true); }
  }, [anlagen, dunkel, bereit, zustandAn]);

  useEffect(() => { const st = s.current; if (st && bereit) st.labels.domElement.style.display = beschriftung ? "" : "none"; }, [beschriftung, bereit]);
  useEffect(() => {
    const st = s.current; if (!st || !bereit) return;
    st.markieren();
    const o = auswahl && st.objekte.get(auswahl);
    if (o) st.fokus(o.userData.a);
  }, [auswahl, bereit]);
  useEffect(() => { if (heim && s.current) s.current.heim(); }, [heim]);
  useEffect(() => { const st = s.current; if (st && bereit) st.animiert = !!animiert; }, [animiert, bereit]);
  // valeurs en temps réel : étiquette mise à jour sans reconstruire la scène ; la machine ne bouge que si elle tourne
  useEffect(() => {
    const st = s.current; if (!st || !bereit) return;
    for (const [id, o] of st.objekte) {
      const l = live?.[id], el = o.userData.liveZeile;
      o.userData.laeuft = !l || l.status === "lauf" || l.status === "daten";
      if (!el) continue;
      el.style.display = l ? "" : "none";
      if (l) { el.className = `w3d-live ${l.status}`; el.textContent = liveKurz(l); }
    }
  }, [live, bereit, anlagen, zustandAn]);
  useEffect(() => {
    const st = s.current; if (!st || !bereit) return;
    st.controls.autoRotate = !!drehen; st.controls.autoRotateSpeed = drehen === "langsam" ? 0.35 : 0.8;
  }, [drehen, bereit]);

  return (
    <div className="w3d">
      <div ref={buehne} className="w3d-buehne" />
      {!bereit && !fehler && <Flex className="w3d-hinweis" vertical align="center" justify="center" gap={8}><BuildOutlined style={{ fontSize: 32, opacity: .5 }} /><Text type="secondary">3D-Ansicht wird geladen …</Text></Flex>}
      {fehler && <div className="w3d-hinweis"><Result status="warning" title="3D-Ansicht nicht verfügbar" subTitle={`${fehler} Die Liste rechts funktioniert trotzdem.`} /></div>}
      {bereit && hilfe && <div className="w3d-hilfe">Ziehen: drehen · Rechte Maustaste: verschieben · Mausrad: zoomen · Klick: Dokumentation</div>}
      {bereit && children}
    </div>
  );
}

// =====================================================================
// Maintenance et pannes (Wartung & Störungen)
// =====================================================================
const W_EINHEIT = { tage: "Tage", wochen: "Wochen", monate: "Monate" };
const W_EINHEIT_1 = { tage: "Tag", wochen: "Woche", monate: "Monat" };
const intervallText = (p) => `alle ${p.intervall === 1 ? "" : `${p.intervall} `}${p.intervall === 1 ? W_EINHEIT_1[p.einheit] : W_EINHEIT[p.einheit]}`;
function naechsteWartung(p) {
  if (!p.letzte) return null;
  const d = dayjs(p.letzte);
  return (p.einheit === "monate" ? d.add(p.intervall, "month") : d.add(p.intervall * (p.einheit === "wochen" ? 7 : 1), "day")).format("YYYY-MM-DD");
}
function wartungStatus(p) {
  const n = naechsteWartung(p), heute = dayjs().format("YYYY-MM-DD");
  if (!n) return "erst";
  if (n < heute) return "ueberfaellig";
  return n <= dayjs().add(7, "day").format("YYYY-MM-DD") ? "bald" : "ok";
}
const W_STATUS = { ueberfaellig: { name: "überfällig", farbe: "error" }, bald: { name: "bald fällig", farbe: "warning" },
                   erst: { name: "noch nie durchgeführt", farbe: "warning" }, ok: { name: "geplant", farbe: "success" } };
const STOER_STUFE = { stillstand: { name: "Stillstand", farbe: "error" }, eingeschraenkt: { name: "Eingeschränkt", farbe: "warning" } };
const stoerStunden = (x) => Math.max(0, ((x.ende ? new Date(x.ende) : new Date()) - new Date(x.beginn)) / 3600000);
const dauerText = (h) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${dez(h, 1)} h` : `${dez(h / 24, 1)} Tage`);
const LEER_WARTUNG = { plaene: [], stoerungen: [], darf: false };

// une seule fenêtre pour : signaler / clôturer / modifier une panne, créer / modifier un plan, noter une maintenance faite
function WartungDialog({ dialog, schliessen, anlagen, fertig }) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [laedt, setLaedt] = useState(false);
  const art = dialog?.art;
  const pflicht = [{ required: true, message: "Pflichtfeld" }];
  const keineZukunft = (d) => d && d.isAfter(dayjs(), "day");
  useEffect(() => {
    if (!dialog) return;
    form.resetFields();
    const jetzt = dayjs();
    if (art === "stoerung-neu") form.setFieldsValue({ anlage: dialog.anlage ?? undefined, stufe: "stillstand", beginn: jetzt });
    if (art === "stoerung-beheben") form.setFieldsValue({ ende: jetzt, ursache: dialog.s.ursache, behebung: dialog.s.behebung });
    if (art === "stoerung-bearbeiten") form.setFieldsValue({ ...dialog.s, beginn: dayjs(dialog.s.beginn), ende: dialog.s.ende ? dayjs(dialog.s.ende) : null });
    if (art === "plan") form.setFieldsValue(dialog.p ? { ...dialog.p, letzte: dialog.p.letzte ? dayjs(dialog.p.letzte) : null }
      : { anlage: dialog.anlage ?? undefined, intervall: 3, einheit: "monate", letzte: jetzt });
    if (art === "erledigt") form.setFieldsValue({ datum: jetzt, notiz: "" });
  }, [dialog]); // eslint-disable-line react-hooks/exhaustive-deps

  async function speichern() {
    const w = await form.validateFields();
    const zeit = (d) => (d ? d.toISOString() : null), tag = (d) => (d ? d.format("YYYY-MM-DD") : null);
    const senden = (method, url, body) => api(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setLaedt(true);
    try {
      let d;
      if (art === "stoerung-neu") d = await senden("POST", "/api/stoerungen", { ...w, beginn: zeit(w.beginn) });
      if (art === "stoerung-beheben") d = await senden("PUT", `/api/stoerungen/${dialog.s.id}`, { ...w, ende: zeit(w.ende) });
      if (art === "stoerung-bearbeiten") d = await senden("PUT", `/api/stoerungen/${dialog.s.id}`, { ...w, beginn: zeit(w.beginn), ende: zeit(w.ende) });
      if (art === "plan") d = await senden(dialog.p ? "PUT" : "POST", dialog.p ? `/api/wartung/plaene/${dialog.p.id}` : "/api/wartung/plaene", { ...w, letzte: tag(w.letzte) });
      if (art === "erledigt") d = await senden("POST", `/api/wartung/plaene/${dialog.p.id}/erledigt`, { ...w, datum: tag(w.datum) });
      message.success({ "stoerung-neu": "Störung gemeldet", "stoerung-beheben": "Störung als behoben eingetragen", "stoerung-bearbeiten": "Störung gespeichert",
                        plan: dialog.p ? "Wartungsplan gespeichert" : "Wartungsplan angelegt", erledigt: "Wartung als erledigt eingetragen" }[art]);
      schliessen(); fertig(d);
    } catch (e) { if (e?.message) message.error(e.message, 6); }
    finally { setLaedt(false); }
  }

  const anlageFeld = (
    <Form.Item name="anlage" label="Halle oder Anlage" rules={pflicht}>
      <Select showSearch optionFilterProp="label" placeholder="Bitte wählen" options={anlagen.map(a => ({ value: a.id, label: a.name }))} />
    </Form.Item>
  );
  const titel = { "stoerung-neu": "Störung melden", "stoerung-beheben": "Störung beheben", "stoerung-bearbeiten": "Störung bearbeiten",
                  plan: dialog?.p ? "Wartungsplan bearbeiten" : "Neuer Wartungsplan", erledigt: "Wartung erledigt" }[art];
  const ok = { "stoerung-neu": "Störung melden", "stoerung-beheben": "Als behoben speichern", erledigt: "Als erledigt speichern" }[art] || "Speichern";
  return (
    <Modal open={!!dialog} title={<Space>{art?.startsWith("stoerung") ? <WarningOutlined /> : <ToolOutlined />}{titel}</Space>}
      onCancel={schliessen} onOk={speichern} confirmLoading={laedt} okText={ok} cancelText="Abbrechen" okButtonProps={{ danger: art === "stoerung-neu" }}>
      <Form form={form} layout="vertical" requiredMark={false}>
        {(art === "stoerung-neu" || art === "stoerung-bearbeiten") && (<>
          {anlageFeld}
          <Form.Item name="titel" label="Was ist passiert?" rules={pflicht}><Input maxLength={150} placeholder="z. B. Hydraulikleck, Antrieb ausgefallen" /></Form.Item>
          <Form.Item name="stufe" label="Auswirkung">
            <Segmented block options={[{ value: "stillstand", label: "Anlage steht" }, { value: "eingeschraenkt", label: "Läuft eingeschränkt" }]} />
          </Form.Item>
          <Form.Item name="beginn" label="Seit" rules={pflicht}><DatePicker showTime format="DD.MM.YYYY HH:mm" style={{ width: "100%" }} disabledDate={keineZukunft} /></Form.Item>
          <Form.Item name="beschreibung" label="Beschreibung"><Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} maxLength={2000} placeholder="Was ist zu sehen oder zu hören? Was wurde schon versucht?" /></Form.Item>
        </>)}
        {art === "stoerung-beheben" && (
          <Alert type="info" showIcon style={{ marginBottom: 16 }} message={dialog.s.titel}
            description={`Seit ${dayjs(dialog.s.beginn).format("DD.MM.YYYY HH:mm")}, bisher ${dauerText(stoerStunden(dialog.s))}`} />
        )}
        {(art === "stoerung-beheben" || art === "stoerung-bearbeiten") && (<>
          <Form.Item name="ende" label={art === "stoerung-beheben" ? "Behoben am" : "Behoben am (leer = noch offen)"} rules={art === "stoerung-beheben" ? pflicht : []}>
            <DatePicker showTime format="DD.MM.YYYY HH:mm" style={{ width: "100%" }} disabledDate={keineZukunft} />
          </Form.Item>
          <Form.Item name="ursache" label="Ursache"><Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} maxLength={1000} /></Form.Item>
          <Form.Item name="behebung" label="Was wurde gemacht?"><Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} maxLength={1000} /></Form.Item>
        </>)}
        {art === "plan" && (<>
          {anlageFeld}
          <Form.Item name="titel" label="Aufgabe" rules={pflicht}><Input maxLength={150} placeholder="z. B. Hydrauliköl wechseln" /></Form.Item>
          <Row gutter={12}>
            <Col span={10}><Form.Item name="intervall" label="Alle" rules={pflicht}><InputNumber min={1} max={1000} precision={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={14}><Form.Item name="einheit" label="Einheit"><Select options={Object.entries(W_EINHEIT).map(([k, v]) => ({ value: k, label: v }))} /></Form.Item></Col>
          </Row>
          <Form.Item name="letzte" label="Zuletzt durchgeführt" extra="Leer lassen, wenn die Arbeit noch nie gemacht wurde."><DatePicker format="DD.MM.YYYY" style={{ width: "100%" }} disabledDate={keineZukunft} /></Form.Item>
          <Form.Item name="verantwortlich" label="Verantwortlich"><Input maxLength={120} placeholder="Name oder Abteilung" /></Form.Item>
          <Form.Item name="beschreibung" label="Anleitung und Hinweise"><Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} maxLength={2000} placeholder="Material, Ölsorte, Sicherheitshinweise …" /></Form.Item>
        </>)}
        {art === "erledigt" && (<>
          <Alert type="info" showIcon style={{ marginBottom: 16 }} message={dialog.p.titel}
            description={`${intervallText(dialog.p)}${dialog.p.letzte ? `, zuletzt am ${dayjs(dialog.p.letzte).format("DD.MM.YYYY")}` : ", noch nie durchgeführt"}`} />
          <Form.Item name="datum" label="Durchgeführt am" rules={pflicht}><DatePicker format="DD.MM.YYYY" style={{ width: "100%" }} disabledDate={keineZukunft} /></Form.Item>
          <Form.Item name="notiz" label="Notiz"><Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} maxLength={1000} placeholder="z. B. Filter getauscht, Dichtung beim nächsten Mal prüfen" /></Form.Item>
        </>)}
      </Form>
    </Modal>
  );
}

// onglet « Wartung » de la fiche d'un élément (Werksplan)
function WartungAnlage({ a, wartung, darf, setDialog }) {
  const plaene = wartung.plaene.filter(p => p.anlage === a.id).sort((x, y) => (naechsteWartung(x) || "0").localeCompare(naechsteWartung(y) || "0"));
  const stoer = wartung.stoerungen.filter(s => s.anlage === a.id);
  const offen = stoer.filter(s => !s.ende), frueher = stoer.filter(s => s.ende).slice(0, 5);
  return (
    <Flex vertical gap={16}>
      {offen.map(s => (
        <Alert key={s.id} type={s.stufe === "stillstand" ? "error" : "warning"} showIcon
          message={<b>{STOER_STUFE[s.stufe].name}: {s.titel}</b>}
          description={<>{s.beschreibung && <div>{s.beschreibung}</div>}
            <Text type="secondary" style={{ fontSize: 12 }}>seit {dayjs(s.beginn).format("DD.MM.YYYY HH:mm")} ({dauerText(stoerStunden(s))}), gemeldet von {s.gemeldetVon}</Text></>}
          action={darf && <Button size="small" type="primary" onClick={() => setDialog({ art: "stoerung-beheben", s })}>Behoben</Button>} />
      ))}
      <Button danger icon={<WarningOutlined />} onClick={() => setDialog({ art: "stoerung-neu", anlage: a.id })}>Störung melden</Button>
      <div>
        <Flex justify="space-between" align="center">
          <Text strong>Wartungsplan</Text>
          {darf && <Button size="small" type="link" icon={<PlusOutlined />} onClick={() => setDialog({ art: "plan", anlage: a.id })} style={{ padding: 0 }}>Arbeit hinzufügen</Button>}
        </Flex>
        {!plaene.length ? <Text type="secondary" style={{ display: "block", marginTop: 4 }}>Noch keine Wartungsarbeiten geplant.</Text> : (
          <Flex vertical gap={6} style={{ marginTop: 6 }}>
            {plaene.map(p => {
              const st = wartungStatus(p), n = naechsteWartung(p);
              return (
                <div key={p.id} className="w-karte">
                  <Flex justify="space-between" gap={8} align="start">
                    <div style={{ minWidth: 0 }}><b>{p.titel}</b>
                      <div><Text type="secondary" style={{ fontSize: 12 }}>{intervallText(p)}{p.verantwortlich ? `, ${p.verantwortlich}` : ""}</Text></div></div>
                    <Tooltip title={W_STATUS[st].name}><Tag color={W_STATUS[st].farbe} bordered={false} style={{ marginInlineEnd: 0 }}>{n ? dayjs(n).format("DD.MM.YYYY") : "offen"}</Tag></Tooltip>
                  </Flex>
                  {darf && <Space size={4} style={{ marginTop: 6 }}>
                    <Button size="small" icon={<CheckOutlined />} onClick={() => setDialog({ art: "erledigt", p })}>Erledigt</Button>
                    <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setDialog({ art: "plan", p })} aria-label="Wartungsplan bearbeiten" />
                  </Space>}
                </div>
              );
            })}
          </Flex>
        )}
      </div>
      {frueher.length > 0 && (
        <div><Text strong>Letzte Störungen</Text>
          <ul className="w3d-liste">{frueher.map(s => <li key={s.id}>{dayjs(s.beginn).format("DD.MM.YYYY")}: {s.titel} <Text type="secondary">({dauerText(stoerStunden(s))})</Text></li>)}</ul></div>
      )}
    </Flex>
  );
}

// page « Wartung & Störungen » : toutes les installations
function WartungSeite({ wartung, setWartung, laden, jahr, dunkel }) {
  const { message } = AntApp.useApp();
  const [anlagen, setAnlagen] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [tab, setTab] = useState("stoerungen");
  const [filter, setFilter] = useState("offen");
  const [anlage, setAnlage] = useState(null);
  const f = farben(dunkel);
  const darf = wartung.darf;
  useEffect(() => { api("/api/anlagen").then(d => setAnlagen(d.liste)).catch(() => {}); laden(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const name = (id) => anlagen.find(a => a.id === id)?.name ?? "(gelöscht)";
  const zumWerk = (id) => { location.hash = `werk/${id}`; };
  const loeschen = async (url, text) => { try { setWartung(await api(url, { method: "DELETE" })); message.success(text); } catch (e) { message.error(e.message, 6); } };

  const imJahr = wartung.stoerungen.filter(s => dayjs(s.beginn).year() === jahr);
  const offen = wartung.stoerungen.filter(s => !s.ende);
  const stillstandH = imJahr.filter(s => s.stufe === "stillstand").reduce((x, s) => x + stoerStunden(s), 0);
  const behoben = imJahr.filter(s => s.ende);
  const mttr = behoben.length ? behoben.reduce((x, s) => x + stoerStunden(s), 0) / behoben.length : null;
  const plaene = wartung.plaene.map(p => ({ ...p, naechste: naechsteWartung(p), status: wartungStatus(p) }));
  const ueber = plaene.filter(p => p.status === "ueberfaellig");
  const in30 = plaene.filter(p => p.status === "erst" || (p.status !== "ueberfaellig" && p.naechste <= dayjs().add(30, "day").format("YYYY-MM-DD")));
  const proAnlage = Object.values(imJahr.reduce((g, s) => {
    const z = (g[s.anlage] ||= { monat: name(s.anlage), stillstand: 0, eingeschraenkt: 0 });
    z[s.stufe] = Math.round((z[s.stufe] + stoerStunden(s)) * 10) / 10; return g;
  }, {})).sort((x, y) => (y.stillstand + y.eingeschraenkt) - (x.stillstand + x.eingeschraenkt));

  const stoerListe = wartung.stoerungen.filter(s => (filter === "offen" ? !s.ende : filter === "jahr" ? dayjs(s.beginn).year() === jahr : true) && (!anlage || s.anlage === anlage));
  const planListe = plaene.filter(p => !anlage || p.anlage === anlage)
    .sort((x, y) => ({ ueberfaellig: 0, erst: 1, bald: 2, ok: 3 }[x.status] - { ueberfaellig: 0, erst: 1, bald: 2, ok: 3 }[y.status]) || (x.naechste || "").localeCompare(y.naechste || ""));
  const anlageSpalte = { title: <Space size={4}><BuildOutlined />Anlage</Space>, dataIndex: "anlage", render: id => <a onClick={() => zumWerk(id)}>{name(id)}</a>,
                         sorter: (x, y) => name(x.anlage).localeCompare(name(y.anlage), "de") };

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="flex-end" wrap gap={12}>
        <Kopf titel="Wartung und Störungen" text="Störungen melden und beheben, Wartungsarbeiten planen und abhaken. Alles ist mit dem Werksplan 3D verknüpft." />
        <Space wrap>
          {darf && <Button icon={<PlusOutlined />} onClick={() => setDialog({ art: "plan" })}>Neue Wartungsarbeit</Button>}
          <Button type="primary" danger icon={<WarningOutlined />} onClick={() => setDialog({ art: "stoerung-neu" })}>Störung melden</Button>
        </Space>
      </Flex>

      <Row gutter={[16, 16]}>
        <Kpi titel="Offene Störungen" icon={<WarningOutlined />} value={offen.length} valueStyle={{ color: offen.length ? "#CF4B3B" : "#2F9E8F" }}>
          <Text type="secondary">{offen.length ? `davon ${offen.filter(s => s.stufe === "stillstand").length} mit Stillstand` : "alle Anlagen laufen"}</Text>
        </Kpi>
        <Kpi titel={`Stillstand ${jahr}`} icon={<ClockCircleOutlined />} value={stillstandH} formatter={v => `${dez(v, 1)} h`}>
          <Text type="secondary">{imJahr.length} Störungen im Jahr</Text>
        </Kpi>
        <Kpi titel="Mittlere Reparaturzeit" icon={<ToolOutlined />} value={mttr == null ? "–" : dauerText(mttr)}>
          <Text type="secondary">MTTR {jahr}, {behoben.length} behobene Störungen</Text>
        </Kpi>
        <Kpi titel="Wartung überfällig" icon={<ScheduleOutlined />} value={ueber.length} valueStyle={{ color: ueber.length ? "#CF4B3B" : undefined }}>
          <Text type="secondary">{in30.length} in den nächsten 30 Tagen fällig</Text>
        </Kpi>
      </Row>

      <Flex gap={8} wrap align="center" className="filter-leiste">
        <Text strong><FilterOutlined /> Filter</Text>
        <Select value={anlage} onChange={setAnlage} allowClear placeholder="Alle Hallen und Anlagen" style={{ width: 240 }} prefix={<BuildOutlined />}
          options={anlagen.map(a => ({ value: a.id, label: a.name }))} aria-label="Anlage" />
      </Flex>

      <Tabs activeKey={tab} onChange={setTab} items={[
        { key: "stoerungen", label: <Space><WarningOutlined />Störungen{offen.length ? <Badge count={offen.length} size="small" /> : null}</Space>, children: (
          <Flex vertical gap={16}>
            {proAnlage.length > 0 && (
              <Card title={<Space><BarChartOutlined />Störungsstunden je Anlage {jahr}</Space>} extra={<Legende reihen={[{ key: "s", name: "Stillstand", farbe: "#CF4B3B" }, { key: "e", name: "Eingeschränkt", farbe: "#E39A2D" }]} />}>
                <StapelBalken data={proAnlage} f={f} hoehe={220} format={v => `${dez(v, 1)} h`}
                  reihen={[{ key: "stillstand", name: "Stillstand", farbe: "#CF4B3B" }, { key: "eingeschraenkt", name: "Eingeschränkt", farbe: "#E39A2D" }]} />
              </Card>
            )}
            <Card styles={{ body: { padding: 0 } }} title={<Segmented value={filter} onChange={setFilter} options={[
                { value: "offen", label: `Offen (${offen.length})` }, { value: "jahr", label: `${jahr} (${imJahr.length})` }, { value: "alle", label: "Alle" }]} />}
              extra={<Button icon={<DownloadOutlined />} disabled={!stoerListe.length} onClick={() => csvHerunterladen(`Stoerungen_${dayjs().format("YYYY-MM-DD")}.csv`,
                ["Anlage", "Störung", "Auswirkung", "Beginn", "Ende", "Dauer h", "Ursache", "Behebung", "Gemeldet von", "Behoben von"],
                stoerListe.map(s => [name(s.anlage), s.titel, STOER_STUFE[s.stufe].name, dayjs(s.beginn).format("DD.MM.YYYY HH:mm"), s.ende ? dayjs(s.ende).format("DD.MM.YYYY HH:mm") : "",
                  stoerStunden(s).toFixed(2).replace(".", ","), s.ursache, s.behebung, s.gemeldetVon, s.behobenVon]))}>CSV</Button>}>
              <Table rowKey="id" size="middle" dataSource={stoerListe} className="kopf-nowrap" scroll={{ x: "max-content" }} pagination={{ pageSize: 15, hideOnSinglePage: true }}
                locale={{ emptyText: <Result status="success" icon={<CheckCircleOutlined style={{ color: "#2F9E8F" }} />} title={filter === "offen" ? "Keine offenen Störungen" : "Keine Störungen erfasst"} /> }}
                columns={[
                  anlageSpalte,
                  { title: "Störung", dataIndex: "titel", width: 300, render: (t, s) => <Flex vertical><b>{t}</b>{s.beschreibung && <Text type="secondary" ellipsis={{ tooltip: s.beschreibung }} style={{ fontSize: 12, maxWidth: 280 }}>{s.beschreibung}</Text>}</Flex> },
                  { title: "Auswirkung", dataIndex: "stufe", render: x => <Tag color={STOER_STUFE[x].farbe} bordered={false}>{STOER_STUFE[x].name}</Tag> },
                  { title: <Space size={4}><ClockCircleOutlined />Beginn</Space>, dataIndex: "beginn", render: z => dayjs(z).format("DD.MM.YYYY HH:mm"), sorter: (x, y) => x.beginn.localeCompare(y.beginn), defaultSortOrder: "descend" },
                  { title: "Dauer", key: "dauer", render: (_, s) => s.ende ? dauerText(stoerStunden(s)) : <Tag color="error" bordered={false}>offen, {dauerText(stoerStunden(s))}</Tag>,
                    sorter: (x, y) => stoerStunden(x) - stoerStunden(y) },
                  { title: "Ursache und Behebung", key: "u", width: 280, render: (_, s) => !s.ursache && !s.behebung ? <Text type="secondary">–</Text>
                      : <Text ellipsis={{ tooltip: [s.ursache, s.behebung].filter(Boolean).join(" · ") }} style={{ maxWidth: 260 }}>{[s.ursache, s.behebung].filter(Boolean).join(" · ")}</Text> },
                  { title: <Space size={4}><UserOutlined />Gemeldet</Space>, dataIndex: "gemeldetVon" },
                  { title: "", key: "a", fixed: "right", render: (_, s) => !darf ? null : (
                    <Space size={0}>
                      {!s.ende && <Button size="small" type="primary" onClick={() => setDialog({ art: "stoerung-beheben", s })}>Behoben</Button>}
                      <Tooltip title="Bearbeiten"><Button type="text" icon={<EditOutlined />} onClick={() => setDialog({ art: "stoerung-bearbeiten", s })} aria-label="Bearbeiten" /></Tooltip>
                      <Popconfirm title="Störung löschen?" okText="Löschen" cancelText="Abbrechen" okButtonProps={{ danger: true }} onConfirm={() => loeschen(`/api/stoerungen/${s.id}`, "Störung gelöscht")}>
                        <Tooltip title="Löschen"><Button type="text" danger icon={<DeleteOutlined />} aria-label="Löschen" /></Tooltip></Popconfirm>
                    </Space>) }
                ]} />
            </Card>
          </Flex>
        ) },
        { key: "plan", label: <Space><ToolOutlined />Wartungsplan{ueber.length ? <Badge count={ueber.length} size="small" color="#E39A2D" /> : null}</Space>, children: (
          <Card styles={{ body: { padding: 0 } }}
            extra={<Button icon={<DownloadOutlined />} disabled={!planListe.length} onClick={() => csvHerunterladen(`Wartungsplan_${dayjs().format("YYYY-MM-DD")}.csv`,
              ["Anlage", "Aufgabe", "Intervall", "Verantwortlich", "Zuletzt", "Nächste", "Status"],
              planListe.map(p => [name(p.anlage), p.titel, intervallText(p), p.verantwortlich, p.letzte ? dayjs(p.letzte).format("DD.MM.YYYY") : "", p.naechste ? dayjs(p.naechste).format("DD.MM.YYYY") : "", W_STATUS[p.status].name]))}>CSV</Button>}>
            <Table rowKey="id" size="middle" dataSource={planListe} className="kopf-nowrap" scroll={{ x: "max-content" }} pagination={{ pageSize: 20, hideOnSinglePage: true }}
              locale={{ emptyText: <Empty description="Noch keine Wartungsarbeiten geplant." /> }}
              expandable={{ rowExpandable: p => p.historie?.length > 0, expandedRowRender: p => (
                <Flex vertical gap={4}>{p.historie.slice(0, 20).map(h => <Text key={h.id}><CheckOutlined style={{ color: "#2F9E8F" }} /> {dayjs(h.datum).format("DD.MM.YYYY")}, {h.wer}{h.notiz ? `: ${h.notiz}` : ""}</Text>)}</Flex>) }}
              columns={[
                anlageSpalte,
                { title: "Aufgabe", dataIndex: "titel", width: 300, render: (t, p) => <Flex vertical><b>{t}</b>{p.beschreibung && <Text type="secondary" ellipsis={{ tooltip: p.beschreibung }} style={{ fontSize: 12, maxWidth: 280 }}>{p.beschreibung}</Text>}</Flex> },
                { title: "Intervall", key: "i", render: (_, p) => intervallText(p) },
                { title: <Space size={4}><UserOutlined />Verantwortlich</Space>, dataIndex: "verantwortlich", render: v => v || <Text type="secondary">–</Text> },
                { title: "Zuletzt", dataIndex: "letzte", render: d => (d ? dayjs(d).format("DD.MM.YYYY") : <Text type="secondary">nie</Text>) },
                { title: <Space size={4}><ScheduleOutlined />Nächste</Space>, dataIndex: "naechste", sorter: (x, y) => (x.naechste || "0").localeCompare(y.naechste || "0"),
                  render: (d, p) => <Tag color={W_STATUS[p.status].farbe} bordered={false}>{d ? dayjs(d).format("DD.MM.YYYY") : W_STATUS[p.status].name}{d && p.status !== "ok" ? `, ${W_STATUS[p.status].name}` : ""}</Tag> },
                { title: "", key: "a", fixed: "right", render: (_, p) => !darf ? null : (
                  <Space size={0}>
                    <Button size="small" icon={<CheckOutlined />} onClick={() => setDialog({ art: "erledigt", p })}>Erledigt</Button>
                    <Tooltip title="Bearbeiten"><Button type="text" icon={<EditOutlined />} onClick={() => setDialog({ art: "plan", p })} aria-label="Bearbeiten" /></Tooltip>
                    <Popconfirm title="Wartungsarbeit löschen?" description="Die Historie dieser Arbeit wird ebenfalls gelöscht." okText="Löschen" cancelText="Abbrechen" okButtonProps={{ danger: true }}
                      onConfirm={() => loeschen(`/api/wartung/plaene/${p.id}`, "Wartungsarbeit gelöscht")}>
                      <Tooltip title="Löschen"><Button type="text" danger icon={<DeleteOutlined />} aria-label="Löschen" /></Tooltip></Popconfirm>
                  </Space>) }
              ]} />
          </Card>
        ) }
      ]} />

      <WartungDialog dialog={dialog} schliessen={() => setDialog(null)} anlagen={anlagen} fertig={(d) => (d ? setWartung(d) : laden())} />
    </Flex>
  );
}

// =====================================================================
// Données en temps réel (Live) : état et valeurs lus dans la base toutes les 10 secondes
// =====================================================================
const ZAHL_TYP = /int|decimal|numeric|money|float|real/i;
const LIVE_STATUS = {
  lauf: { name: "Läuft", farbe: "#2F9E8F", tag: "success", badge: "success" },
  stopp: { name: "Steht", farbe: "#8C99A6", tag: "default", badge: "default" },
  stoerung: { name: "Störung", farbe: "#CF4B3B", tag: "error", badge: "error" },
  veraltet: { name: "Keine aktuellen Daten", farbe: "#E39A2D", tag: "warning", badge: "warning" },
  keine: { name: "Keine Daten", farbe: "#8C99A6", tag: "default", badge: "default" },
  fehler: { name: "Fehler beim Lesen", farbe: "#CF4B3B", tag: "error", badge: "error" },
  daten: { name: "Live", farbe: "#4F83AA", tag: "blue", badge: "processing" }
};
const liveZahl = (v) => (typeof v !== "number" ? (v ?? "–") : Math.abs(v) >= 100 ? zahl(v) : dez(v, 2));
const alterText = (sek) => (sek == null ? "" : sek < 60 ? "gerade eben" : sek < 3600 ? `vor ${Math.round(sek / 60)} min` : sek < 172800 ? `vor ${dez(sek / 3600, 1)} h` : `vor ${Math.round(sek / 86400)} Tagen`);
const liveKurz = (l) => {
  const w = (l?.werte || []).find(x => typeof x.wert === "number");
  return `${LIVE_STATUS[l?.status]?.name ?? ""}${w && !["fehler", "keine"].includes(l.status) ? ` · ${liveZahl(w.wert)}${w.einheit ? ` ${w.einheit}` : ""}` : ""}`;
};

function LiveKarte({ l }) {
  if (!l) return null;
  const s = LIVE_STATUS[l.status] || LIVE_STATUS.daten;
  return (
    <Card size="small" title={<Space><Badge status={s.badge} />Live aus der Datenbank</Space>} extra={<Tag color={s.tag} bordered={false} style={{ marginInlineEnd: 0 }}>{s.name}</Tag>}>
      {l.status === "fehler" ? <Text type="danger">{l.fehler}</Text> : !l.zeit ? <Text type="secondary">Die Tabelle liefert für diesen Filter keine Zeile.</Text> : (
        <Flex vertical gap={8}>
          {l.werte?.length > 0 && <div className="live-werte">{l.werte.map(w => <div key={w.name}><span>{w.name}</span><b className="zahl">{liveZahl(w.wert)}{w.einheit ? <small> {w.einheit}</small> : null}</b></div>)}</div>}
          {l.verlauf?.length > 2 && (
            <ResponsiveContainer width="100%" height={70}>
              <LineChart data={l.verlauf} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <YAxis hide domain={["auto", "auto"]} />
                <ChartTooltip formatter={(v) => [liveZahl(v), l.werte?.[0]?.name]} labelFormatter={(_, p) => p?.[0]?.payload?.t ?? ""} />
                <Line dataKey="v" dot={false} stroke={s.farbe} strokeWidth={2} isAnimationActive={false} type="monotone" />
              </LineChart>
            </ResponsiveContainer>
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>Letzter Wert {l.zeit} ({alterText(l.alterSek)}){l.rohStatus != null ? `, Status „${l.rohStatus}“` : ""}</Text>
        </Flex>
      )}
    </Card>
  );
}

// partie « Live-Daten » de la fenêtre d'édition d'un élément
function LiveEinstellung({ form, offen }) {
  const { message } = AntApp.useApp();
  const [tabellen, setTabellen] = useState([]);
  const [spalten, setSpalten] = useState([]);
  const [test, setTest] = useState(null);
  const [testet, setTestet] = useState(false);
  const tabelle = Form.useWatch(["live", "tabelle"], form);
  const statusSpalte = Form.useWatch(["live", "statusSpalte"], form);
  useEffect(() => { if (offen && !tabellen.length) api("/api/tabellen").then(setTabellen).catch(() => {}); }, [offen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setTest(null);
    if (!tabelle) { setSpalten([]); return; }
    api(`/api/live/spalten?tabelle=${encodeURIComponent(tabelle)}`).then(d => setSpalten(d.spalten)).catch(e => { setSpalten([]); message.error(e.message, 6); });
  }, [tabelle]); // eslint-disable-line react-hooks/exhaustive-deps
  const opt = (filter) => spalten.filter(filter || (() => true)).map(s => ({ value: s.spalte, label: <span>{s.spalte} <Text type="secondary" style={{ fontSize: 12 }}>{s.typ}</Text></span>, title: s.spalte }));
  const istZeit = (s) => /date|time/i.test(s.typ);
  const istZahl = (s) => ZAHL_TYP.test(s.typ);
  async function testen() {
    setTestet(true); setTest(null);
    try { setTest({ ok: true, ...(await api("/api/live/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ live: form.getFieldValue("live") }) })) }); }
    catch (e) { setTest({ ok: false, fehler: e.message }); }
    finally { setTestet(false); }
  }
  return (
    <>
      <Form.Item name={["live", "tabelle"]} label="Tabelle" extra="Tabelle mit laufend neuen Zeilen (z. B. Maschinendaten, Zählerstände). Leer = keine Live-Daten.">
        <Select allowClear showSearch optionFilterProp="label" placeholder="keine Live-Daten"
          options={tabellen.map(t => ({ value: `${t.schema}.${t.tabelle}`, label: `${t.schema}.${t.tabelle}` }))} />
      </Form.Item>
      {tabelle && (<>
        <Form.Item name={["live", "zeitSpalte"]} label="Zeitspalte" rules={[{ required: true, message: "Pflichtfeld" }]} extra="Die neueste Zeile nach dieser Spalte gilt als aktueller Stand.">
          <Select showSearch options={opt(istZeit).length ? opt(istZeit) : opt()} placeholder="Datum/Uhrzeit" />
        </Form.Item>
        <Row gutter={8}>
          <Col span={12}><Form.Item name={["live", "filterSpalte"]} label="Filter: Spalte" extra="Wenn die Tabelle mehrere Anlagen enthält"><Select allowClear showSearch options={opt()} placeholder="kein Filter" /></Form.Item></Col>
          <Col span={12}><Form.Item name={["live", "filterWert"]} label="Filter: Wert"><Input placeholder="z. B. P1" maxLength={200} /></Form.Item></Col>
        </Row>
        <Form.Item name={["live", "statusSpalte"]} label="Statusspalte (optional)"><Select allowClear showSearch options={opt()} placeholder="keine" /></Form.Item>
        {statusSpalte ? (
          <Row gutter={8}>
            <Col span={12}><Form.Item name={["live", "laufWerte"]} label="Werte für „läuft“"><Input placeholder="z. B. 1, RUN, Ein" /></Form.Item></Col>
            <Col span={12}><Form.Item name={["live", "stoerWerte"]} label="Werte für „Störung“"><Input placeholder="z. B. 3, ERR" /></Form.Item></Col>
          </Row>
        ) : (
          <Row gutter={8}>
            <Col span={14}><Form.Item name={["live", "schwelleSpalte"]} label="Oder: läuft, wenn Spalte" extra="z. B. Leistung oder Strom"><Select allowClear showSearch options={opt(istZahl)} placeholder="keine" /></Form.Item></Col>
            <Col span={10}><Form.Item name={["live", "schwelle"]} label="größer als"><InputNumber decimalSeparator="," style={{ width: "100%" }} placeholder="0" /></Form.Item></Col>
          </Row>
        )}
        <Text strong>Angezeigte Werte (höchstens 4)</Text>
        <Form.List name={["live", "werte"]}>{(felder, { add, remove }) => (
          <div style={{ marginTop: 8, marginBottom: 12 }}>
            {felder.map(({ key, name: n }) => (
              <Flex key={key} gap={6} align="start">
                <Form.Item name={[n, "spalte"]} style={{ flex: 1.3, marginBottom: 8 }} rules={[{ required: true, message: "Spalte" }]}><Select showSearch options={opt()} placeholder="Spalte" /></Form.Item>
                <Form.Item name={[n, "name"]} style={{ flex: 1, marginBottom: 8 }}><Input placeholder="Anzeigename" maxLength={40} /></Form.Item>
                <Form.Item name={[n, "einheit"]} style={{ width: 70, marginBottom: 8 }}><Input placeholder="kW" maxLength={12} /></Form.Item>
                <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(n)} aria-label="Wert entfernen" />
              </Flex>
            ))}
            {felder.length < 4 && <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({})}>Wert hinzufügen</Button>}
          </div>
        )}</Form.List>
        <Form.Item name={["live", "maxAlterMin"]} label="Als veraltet melden nach" extra="Wenn länger keine neue Zeile kommt, erscheint die Anlage orange.">
          <InputNumber min={1} max={10080} precision={0} style={{ width: "100%" }} suffix="Minuten" placeholder="15" />
        </Form.Item>
        <Button icon={<ThunderboltOutlined />} loading={testet} onClick={testen} block>Verbindung testen</Button>
        {test && (test.ok
          ? <Alert style={{ marginTop: 12 }} type={test.zeit ? "success" : "warning"} showIcon
              message={test.zeit ? `${LIVE_STATUS[test.status]?.name}: letzte Zeile ${test.zeit} (${alterText(test.alterSek)})` : "Keine Zeile gefunden (Filter prüfen)."}
              description={test.werte?.length ? test.werte.map(w => `${w.name}: ${liveZahl(w.wert)}${w.einheit ? ` ${w.einheit}` : ""}`).join(" · ") + (test.rohStatus != null ? ` · Status „${test.rohStatus}“` : "") : null} />
          : <Alert style={{ marginTop: 12 }} type="error" showIcon message={test.fehler} />)}
      </>)}
    </>
  );
}

function Werksplan({ en, massnahmen, warnungen, wartung = LEER_WARTUNG, setWartung, jahr, dunkel, darf, gehe }) {
  const { message, notification } = AntApp.useApp();
  const [d, setD] = useState(null);
  const [fehler, setFehler] = useState("");
  const [auswahl, setAuswahl] = useState(null);
  const [beschriftung, setBeschriftung] = useState(true);
  const [heim, setHeim] = useState(0);
  const [suche, setSuche] = useState("");
  const [bearbeiten, setBearbeiten] = useState(null);       // { a } ou { a: null } pour un nouvel élément
  const [vorschau, setVorschau] = useState(null);
  const [speichert, setSpeichert] = useState(false);
  const [laedtHoch, setLaedtHoch] = useState(false);
  const [animiert, setAnimiert] = useState(() => !matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [tour, setTour] = useState(null);                   // { index, pause } pendant la présentation
  const [dauer, setDauer] = useState(12);
  const [voll, setVoll] = useState(false);
  const rahmen = useRef(null);
  const [zustandAn, setZustandAn] = useState(true);
  const [doku, setDoku] = useState(null);                  // id de l'élément dont la documentation s'affiche dans la vue 3D
  const [ansicht, setAnsicht] = useState(null);            // document ouvert dans la visionneuse
  const [wDialog, setWDialog] = useState(null);            // fenêtres maintenance / pannes
  const [appUrl, setAppUrl] = useState("");
  const [qr, setQr] = useState(null);                      // { a, png, link }
  const detailRef = useRef(null);
  const hashFertig = useRef(false);
  const screens = Grid.useBreakpoint();
  const [form] = Form.useForm();
  const typWert = Form.useWatch("typ", form);
  const f = farben(dunkel);

  useEffect(() => {
    api("/api/anlagen").then(setD).catch(e => setFehler(e.message));
    api("/api/status").then(x => setAppUrl(x.appUrl || "")).catch(() => {});
  }, []);
  const liste = d?.liste || [];

  // données en temps réel : toutes les 10 secondes, seulement si l'onglet est visible
  const [live, setLive] = useState({});
  const [liveZeit, setLiveZeit] = useState(null);
  const hatLive = liste.some(x => x.live?.tabelle);
  useEffect(() => {
    if (!hatLive) { setLive({}); return; }
    let weg = false, t;
    const holen = async () => {
      if (document.visibilityState === "visible") {
        try { const r = await api("/api/live"); if (!weg) { setLive(r.anlagen || {}); setLiveZeit(new Date()); } } catch { /* nouvel essai au prochain tour */ }
      }
      if (!weg) t = setTimeout(holen, 10000);
    };
    holen();
    return () => { weg = true; clearTimeout(t); };
  }, [hatLive, d]);
  const liveSignatur = Object.entries(live).map(([k, v]) => `${k}:${v.status}`).join("|");

  // état de chaque élément d'après les avertissements (page Warnungen) ; une halle prend le pire état de ses installations
  // + pannes ouvertes (arrêt = critique) et maintenances en retard (avertissement)
  const zustand = useMemo(() => {
    const m = {};
    const eigen = (x) => {
      const offen = wartung.stoerungen.filter(s => s.anlage === x.id && !s.ende);
      const plaene = wartung.plaene.filter(p => p.anlage === x.id);
      const meldungen = [
        ...offen.map(s => ({ id: `s-${s.id}`, stufe: s.stufe === "stillstand" ? "kritisch" : "warnung", titel: `${s.stufe === "stillstand" ? "Stillstand" : "Störung"}: ${s.titel}` })),
        ...(x.seu ? (warnungen || []).filter(w => w.anlage === x.seu && w.stufe !== "info") : []),
        ...plaene.filter(p => wartungStatus(p) === "ueberfaellig").map(p => ({ id: `w-${p.id}`, stufe: "warnung", titel: `Wartung überfällig: ${p.titel}` }))
      ];
      const l = live[x.id];
      if (l?.status === "stoerung") meldungen.unshift({ id: `l-${x.id}`, stufe: "kritisch", titel: `Live: Störung (Status „${l.rohStatus}“)` });
      if (l?.status === "veraltet") meldungen.push({ id: `l-${x.id}`, stufe: "warnung", titel: `Live: keine aktuellen Daten (letzter Wert ${alterText(l.alterSek)})` });
      if (l?.status === "fehler") meldungen.push({ id: `l-${x.id}`, stufe: "warnung", titel: "Live-Daten können nicht gelesen werden" });
      return { meldungen, stillstand: offen.some(s => s.stufe === "stillstand"), basis: !!x.seu || !!x.live?.tabelle || plaene.length > 0 || wartung.stoerungen.some(s => s.anlage === x.id) };
    };
    const stufeVon = (meldungen, basis) => (meldungen.some(w => w.stufe === "kritisch") ? "kritisch" : meldungen.length ? "warnung" : basis ? "ok" : null);
    for (const x of liste) {
      if (x.typ === "halle") continue;
      const e = eigen(x);
      m[x.id] = { stufe: stufeVon(e.meldungen, e.basis), meldungen: e.meldungen, stillstand: e.stillstand };
    }
    for (const h of liste.filter(x => x.typ === "halle")) {
      const e = eigen(h), k = liste.filter(x => x.halle === h.id).map(x => m[x.id]).filter(Boolean);
      const meldungen = [...e.meldungen, ...k.flatMap(z => z.meldungen)];
      m[h.id] = { stufe: stufeVon(meldungen, e.basis || k.some(z => z.stufe)), meldungen };
    }
    return m;
  }, [liste, warnungen, wartung, liveSignatur]); // eslint-disable-line react-hooks/exhaustive-deps
  const anzeigen = useMemo(() => {
    const l = !vorschau ? liste : liste.some(x => x.id === vorschau.id) ? liste.map(x => (x.id === vorschau.id ? vorschau : x)) : [...liste, vorschau];
    return l.map(x => ({ ...x, zustand: zustand[x.id] }));
  }, [liste, vorschau, zustand]);

  // lien direct #werk/<id> (codes QR) : ouverture de la fiche, et adresse mise à jour à chaque sélection
  useEffect(() => {
    if (!d) return;
    const lesen = () => {
      const id = decodeURIComponent(location.hash.split("/")[1] || "");
      if (!id || !d.liste.some(x => x.id === id)) return;
      setAuswahl(id);
      if (!screens.xl) setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 500);
    };
    if (!hashFertig.current) { lesen(); hashFertig.current = true; }
    addEventListener("hashchange", lesen);
    return () => removeEventListener("hashchange", lesen);
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!hashFertig.current || !location.hash.startsWith("#werk")) return;
    const ziel = `#werk${auswahl ? `/${auswahl}` : ""}`;
    if (location.hash !== ziel) history.replaceState(null, "", ziel);
  }, [auswahl]);

  // --- codes QR ---
  const istLokal = (u) => /\/\/(185.80.92.91|127\.|\[::1\])/i.test(u);
  const qrBasis = (() => { const u = appUrl.replace(/\/$/, ""); return u && !istLokal(u) ? u : !istLokal(location.origin) ? location.origin : null; })();
  const qrLink = (id) => `${qrBasis || location.origin}/#werk/${encodeURIComponent(id)}`;
  async function qrZeigen(el) {
    try {
      const QR = (await import("qrcode")).default;
      setQr({ a: el, link: qrLink(el.id), png: await QR.toDataURL(qrLink(el.id), { width: 640, margin: 1, errorCorrectionLevel: "M" }) });
    } catch (e) { message.error(`QR-Code konnte nicht erstellt werden: ${e.message}`, 6); }
  }
  async function etikettenDrucken(elemente) {
    try {
      const QR = (await import("qrcode")).default;
      const karten = await Promise.all(elemente.map(async x => ({ x, bild: await QR.toDataURL(qrLink(x.id), { width: 480, margin: 1, errorCorrectionLevel: "M" }) })));
      const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>QR-Etiketten Werksplan</title><style>
@page { size: A4; margin: 10mm; }
body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; color: #1F2A33; }
.raster { display: grid; grid-template-columns: repeat(3, 1fr); }
.e { border: 1px dashed #b8c1c9; padding: 6mm 4mm 5mm; text-align: center; break-inside: avoid; }
.e img { width: 42mm; height: 42mm; display: block; margin: 0 auto; }
.e b { display: block; font-size: 15pt; margin-top: 2mm; }
.e span { display: block; font-size: 8.5pt; color: #5F6B76; margin-top: 1mm; }
</style></head><body><div class="raster">${karten.map(k => `<div class="e"><img src="${k.bild}" alt=""><b>${escHtml(k.x.name)}</b>
<span>${escHtml(W_TYPEN[k.x.typ]?.name ?? "")}${k.x.halle ? `, ${escHtml(name(k.x.halle))}` : ""}</span><span>Scannen: Dokumentation im MRS-Werksplan</span></div>`).join("")}</div></body></html>`;
      const rahmenDruck = document.createElement("iframe");
      Object.assign(rahmenDruck.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
      rahmenDruck.onload = () => setTimeout(() => {
        const w = rahmenDruck.contentWindow;
        w.onafterprint = () => rahmenDruck.remove();
        w.focus(); w.print();
      }, 200);
      rahmenDruck.srcdoc = html;
      document.body.appendChild(rahmenDruck);
    } catch (e) { message.error(`Etiketten konnten nicht erstellt werden: ${e.message}`, 6); }
  }
  const a = liste.find(x => x.id === auswahl);
  const hallen = liste.filter(x => x.typ === "halle");
  const name = (id) => liste.find(x => x.id === id)?.name ?? "–";

  const senden = async (neu) => { const r = await api("/api/anlagen", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ liste: neu }) }); setD(r); return r; };

  function oeffnen(el) {
    setTour(null);
    form.resetFields();
    const start = el || { typ: "presse", halle: hallen[0]?.id ?? null, x: 0, z: 0, breite: 6, tiefe: 5, hoehe: 6, drehung: 0, daten: [], links: [] };
    form.setFieldsValue(start);
    setVorschau(null);
    setBearbeiten({ a: el || null });
  }
  function schliessen() { setBearbeiten(null); setVorschau(null); }
  async function speichern() {
    const w = await form.validateFields();
    const alt = bearbeiten.a;
    const id = alt?.id || `${kennung(w.name)}-${Date.now().toString(36)}`;
    const element = { ...(alt || { dokumente: [] }), ...w, id, halle: w.typ === "halle" ? null : (w.halle || null), seu: w.seu || null, daten: w.daten || [], links: w.links || [],
                      live: w.live?.tabelle ? w.live : null };
    setSpeichert(true);
    try {
      await senden(alt ? liste.map(x => (x.id === id ? element : x)) : [...liste, element]);
      notification.success({ message: alt ? "Element gespeichert" : "Element angelegt", description: w.name, placement: "topRight" });
      schliessen(); setAuswahl(id);
    } catch (e) { message.error(e.message, 6); }
    finally { setSpeichert(false); }
  }
  async function loeschen(el) {
    try {
      await senden(liste.filter(x => x.id !== el.id).map(x => (x.halle === el.id ? { ...x, halle: null } : x)));
      message.success(`${el.name} gelöscht`); setAuswahl(null);
    } catch (e) { message.error(e.message, 6); }
  }
  async function hochladen(datei) {
    if (datei.size > 25 * 1024 * 1024) { message.error(`${datei.name}: zu groß (höchstens 25 MB).`); return; }
    setLaedtHoch(true);
    try {
      setD(await api(`/api/anlagen/${a.id}/dokumente`, { method: "POST", headers: { "Content-Type": "application/octet-stream", "x-dateiname": encodeURIComponent(datei.name) }, body: datei }));
      message.success(`${datei.name} hochgeladen`);
    } catch (e) { message.error(e.message, 6); }
    finally { setLaedtHoch(false); }
  }
  async function dokLoeschen(dok) {
    try { setD(await api(`/api/anlagen/${a.id}/dokumente/${dok.id}`, { method: "DELETE" })); message.success("Dokument gelöscht"); }
    catch (e) { message.error(e.message, 6); }
  }

  // --- présentation : vue d'ensemble, puis chaque halle avec ses installations, puis l'extérieur (en boucle) ---
  const schritte = useMemo(() => {
    const nachX = (x, y) => x.x - y.x || x.z - y.z;
    const r = [{ id: null }];
    for (const h of liste.filter(x => x.typ === "halle").sort(nachX)) {
      r.push({ id: h.id });
      liste.filter(x => x.halle === h.id).sort(nachX).forEach(x => r.push({ id: x.id }));
    }
    liste.filter(x => x.typ !== "halle" && !x.halle).sort(nachX).forEach(x => r.push({ id: x.id }));
    return r;
  }, [liste]);
  const n = schritte.length;
  const schritt = tour ? schritte[tour.index % n] : null;
  useEffect(() => {
    if (!tour) return;
    setAuswahl(schritt.id);
    if (!schritt.id) setHeim(x => x + 1);
    setDoku(x => (x ? schritt.id || null : x));               // documentation ouverte : elle suit les flèches ← →
    setAnsicht(null);
  }, [tour?.index, !!tour]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!tour || tour.pause) return;
    const t = setTimeout(() => setTour(x => x && { ...x, index: (x.index + 1) % n }), dauer * 1000);
    return () => clearTimeout(t);
  }, [tour, dauer, n]);
  const weiter = (d) => setTour(x => x && { ...x, index: (x.index + d + n) % n });
  const starten = () => { if (bearbeiten) return; setAnimiert(true); setTour({ index: 0, pause: false }); };
  const beenden = () => { setTour(null); setDoku(null); setAnsicht(null); };
  // documentation dans la vue 3D (présentation ou plein écran) : la présentation se met en pause pour lire
  const dokuOeffnen = (id) => { setAuswahl(id); setDoku(id); setAnsicht(null); setTour(x => x && { ...x, pause: true }); };
  const fortsetzen = () => {
    const i = schritte.findIndex(x => x.id === doku);
    setDoku(null); setAnsicht(null);
    setTour(x => x && { index: i >= 0 ? i : x.index, pause: false });
  };
  useEffect(() => {
    if (!tour) return;
    const taste = (e) => {
      if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === "ArrowRight") weiter(1);
      else if (e.key === "ArrowLeft") weiter(-1);
      else if (e.key === " ") { e.preventDefault(); setTour(x => x && { ...x, pause: !x.pause }); }
      else if (e.key === "Escape" && !document.fullscreenElement) beenden();
    };
    addEventListener("keydown", taste);
    return () => removeEventListener("keydown", taste);
  }, [!!tour, n]); // eslint-disable-line react-hooks/exhaustive-deps
  // plein écran de la vue 3D
  useEffect(() => {
    const f = () => setVoll(document.fullscreenElement === rahmen.current);
    addEventListener("fullscreenchange", f);
    return () => removeEventListener("fullscreenchange", f);
  }, []);
  useEffect(() => { if (!tour && !voll) { setDoku(null); setAnsicht(null); } }, [!!tour, voll]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {                                        // Échap : d'abord fermer le document, puis la documentation
    if (!doku) return;
    const taste = (e) => { if (e.key !== "Escape") return; e.stopImmediatePropagation(); if (ansicht) setAnsicht(null); else setDoku(null); };
    addEventListener("keydown", taste, true);
    return () => removeEventListener("keydown", taste, true);
  }, [doku, ansicht]);
  const vollbild = () => (document.fullscreenElement ? document.exitFullscreen() : rahmen.current?.requestFullscreen?.())?.catch?.(() => {});

  if (fehler) return <Alert type="error" showIcon message="Werksplan konnte nicht geladen werden" description={fehler} />;

  // --- carte d'information de la présentation ---
  let tourKarte = null;
  if (tour) {
    const ta = schritt.id ? liste.find(x => x.id === schritt.id) : null;
    const kurz2 = (t, max = 230) => { const x = String(t || "").replace(/\*\*/g, "").replace(/^\s*-\s+/gm, "").replace(/\s+/g, " ").trim(); return x.length > max ? `${x.slice(0, max).replace(/\s+\S*$/, "")} …` : x; };
    const pz = (v) => (v == null ? "–" : `${v <= 0 ? "−" : "+"}${prozent(Math.abs(v))}`);
    const werte = [];
    let text = "";
    if (!ta) {
      text = "Rundgang durch alle Hallen und Anlagen. Ein Klick auf eine Halle oder Anlage öffnet ihre Dokumentation.";
      werte.push(["Hallen", liste.filter(x => x.typ === "halle").length], ["Anlagen", liste.filter(x => x.typ !== "halle").length]);
      if (en.kpi) werte.push([`Energieverbrauch ${jahr}`, kurz(en.kpi.gesamtV)], ["EnPI Standort", `${dez(en.kpi.standort.enpiAkt, 2)} (${pz(en.kpi.standort.veraenderung)})`]);
      else werte.push(["Dokumente", liste.reduce((x, y) => x + (y.dokumente?.length || 0), 0)]);
    } else {
      text = kurz2(ta.beschreibung);
      const kpi = ta.seu && en.kpi ? en.kpi.anlagen.find(x => x.key === ta.seu) : null;
      if (ta.typ === "halle") {
        const kinder = liste.filter(x => x.halle === ta.id);
        const verbrauch = en.kpi ? kinder.reduce((x, k) => x + (en.kpi.anlagen.find(y => y.key === k.seu)?.verbrauch || 0), 0) : 0;
        werte.push(["Anlagen", kinder.length], ["Grundfläche", `${zahl(ta.breite * ta.tiefe)} m²`]);
        if (verbrauch) werte.push([`Energie ${jahr} (erfasst)`, kurz(verbrauch)]);
        if (!text) text = kinder.length ? `Hier stehen: ${kinder.map(x => x.name).join(", ")}.` : "";
      } else if (kpi) {
        werte.push([`Verbrauch ${jahr}`, kurz(kpi.verbrauch)], ["Anteil am Standort", kpi.anteil == null ? "–" : prozent(kpi.anteil)],
                   [`EnPI je ${kpi.treiber}`, dez(kpi.enpiAkt, 3)], [`ggü. ${en.basisJahr}`, pz(kpi.veraenderung)]);
      } else {
        (ta.daten || []).slice(0, 3).forEach(x => werte.push([x.name, x.wert]));
      }
      if (werte.length < 4 && ta.dokumente?.length) werte.push(["Dokumente", ta.dokumente.length]);
      const z = zustand[ta.id];
      const lv = live[ta.id];
      if (lv && !["fehler", "keine"].includes(lv.status)) {
        (lv.werte || []).slice(0, 2).reverse().forEach(w => werte.unshift([w.name, `${liveZahl(w.wert)}${w.einheit ? ` ${w.einheit}` : ""}`]));
        werte.unshift(["Live", LIVE_STATUS[lv.status].name]);
      }
      if (z?.stufe) werte.unshift(["Zustand", z.meldungen.length ? `${z.meldungen.length} ${z.stufe === "kritisch" ? "kritisch" : z.meldungen.length === 1 ? "Warnung" : "Warnungen"}` : "in Ordnung"]);
    }
    tourKarte = (
      <div className="w3d-tour">
        {!doku && <div className="w3d-tour-karte" key={tour.index}>
          <span className="w3d-tour-schritt">Schritt {(tour.index % n) + 1} von {n}{ta ? `, ${W_TYPEN[ta.typ]?.name}${ta.halle ? ` in ${name(ta.halle)}` : ""}` : ""}</span>
          <h2>{ta ? ta.name : "Standort MRS"}</h2>
          {text && <p>{text}</p>}
          {werte.length > 0 && <div className="w3d-tour-werte">{werte.slice(0, 4).map(([l, v]) => <div key={l}><span>{l}</span><b>{v}</b></div>)}</div>}
          {ta && <button className="w3d-knopf primaer" onClick={() => dokuOeffnen(ta.id)}><FileTextOutlined /> Dokumentation{ta.dokumente?.length ? ` (${ta.dokumente.length} ${ta.dokumente.length === 1 ? "Datei" : "Dateien"})` : ""}</button>}
        </div>}
        <div className="w3d-tour-steuerung">
          <Button shape="circle" icon={<LeftOutlined />} onClick={() => weiter(-1)} title="Zurück (←)" aria-label="Zurück" />
          <Button shape="circle" type="primary" icon={tour.pause ? <CaretRightOutlined /> : <PauseOutlined />}
            onClick={() => setTour(x => ({ ...x, pause: !x.pause }))} title={tour.pause ? "Weiter (Leertaste)" : "Anhalten (Leertaste)"} aria-label={tour.pause ? "Weiter" : "Anhalten"} />
          <Button shape="circle" icon={<RightOutlined />} onClick={() => weiter(1)} title="Weiter (→)" aria-label="Nächster Schritt" />
          <Button shape="circle" icon={<CloseOutlined />} onClick={beenden} title="Präsentation beenden (Esc)" aria-label="Präsentation beenden" />
        </div>
        <div className="w3d-tour-fortschritt"><div key={`${tour.index}-${tour.pause}`} style={{ animationDuration: `${dauer}s`, animationPlayState: tour.pause ? "paused" : "running" }} /></div>
      </div>
    );
  }

  // --- documentation dans la vue 3D (fonctionne aussi en plein écran) ---
  let dokuPanel = null, ansichtPanel = null;
  const da = doku ? liste.find(x => x.id === doku) : null;
  if (da) {
    const dz = zustand[da.id];
    const dk = da.seu && en.kpi ? en.kpi.anlagen.find(x => x.key === da.seu) : null;
    const kinder = liste.filter(x => x.halle === da.id);
    const docs = [...(da.dokumente || [])].sort((x, y) => x.name.localeCompare(y.name, "de"));
    const pz = (v) => (v == null ? "–" : `${v <= 0 ? "−" : "+"}${prozent(Math.abs(v))}`);
    const url = (dok) => `/api/anlagen/${da.id}/dokumente/${dok.id}`;
    dokuPanel = (
      <div className="w3d-doku" role="dialog" aria-label={`Dokumentation ${da.name}`} key={da.id}>
        <div className="w3d-doku-kopf">
          <div style={{ minWidth: 0 }}>
            <span className="w3d-tour-schritt">{W_TYPEN[da.typ]?.name}{da.halle ? ` in ${name(da.halle)}` : ""}</span>
            <h3>{da.name}</h3>
          </div>
          <button className="w3d-knopf rund" onClick={() => { setDoku(null); setAnsicht(null); }} aria-label="Dokumentation schließen" title="Schließen (Esc)"><CloseOutlined /></button>
        </div>
        <div className="w3d-doku-inhalt">
          {dz?.stufe && (
            <div className={`w3d-doku-zustand ${dz.stufe}`}>
              <b>{dz.meldungen.length ? `${dz.meldungen.length} ${dz.meldungen.length === 1 ? "Meldung" : "Meldungen"} (${ZUSTAND_NAME[dz.stufe]})` : `In Ordnung, keine Meldungen ${jahr}`}</b>
              {dz.meldungen.length > 0 && <ul>{dz.meldungen.slice(0, 3).map(w => <li key={w.id}>{w.titel}</li>)}</ul>}
            </div>
          )}
          {da.beschreibung && <section><AntwortText text={da.beschreibung} /></section>}
          {kinder.length > 0 && (
            <section><h4>Anlagen in dieser Halle</h4>
              <div className="w3d-doku-chips">{kinder.map(x => <button key={x.id} className="w3d-chip" onClick={() => dokuOeffnen(x.id)}>{x.name}</button>)}</div></section>
          )}
          {dk && (
            <section><h4>Energie {jahr}</h4>
              <div className="w3d-tour-werte">
                {[["Verbrauch", kurz(dk.verbrauch)], ["Anteil am Standort", dk.anteil == null ? "–" : prozent(dk.anteil)],
                  [`EnPI je ${dk.treiber}`, dez(dk.enpiAkt, 3)], [`ggü. ${en.basisJahr}`, pz(dk.veraenderung)]].map(([l, v]) => <div key={l}><span>{l}</span><b>{v}</b></div>)}
              </div></section>
          )}
          {live[da.id] && (() => {
            const lv = live[da.id];
            return (
              <section><h4>Live ({LIVE_STATUS[lv.status]?.name}{lv.zeit ? `, ${alterText(lv.alterSek)}` : ""})</h4>
                {lv.status === "fehler" ? <p className="w3d-leise">{lv.fehler}</p> : lv.werte?.length > 0 && (
                  <div className="w3d-tour-werte">{lv.werte.map(w => <div key={w.name}><span>{w.name}</span><b>{liveZahl(w.wert)}{w.einheit ? ` ${w.einheit}` : ""}</b></div>)}</div>
                )}
              </section>
            );
          })()}
          {da.daten?.length > 0 && (
            <section><h4>Technische Daten</h4>
              <dl className="w3d-dl">{da.daten.map((x, i) => <React.Fragment key={i}><dt>{x.name}</dt><dd>{x.wert}</dd></React.Fragment>)}</dl></section>
          )}
          {(() => {
            const pl = wartung.plaene.filter(p => p.anlage === da.id), of = wartung.stoerungen.filter(s => s.anlage === da.id && !s.ende);
            if (!pl.length && !of.length) return null;
            return (
              <section><h4>Wartung und Störungen</h4>
                <div className="w3d-doku-liste">
                  {of.map(s => (
                    <div key={s.id} className="w3d-dok-knopf" style={{ cursor: "default", boxShadow: "inset 3px 0 0 #CF4B3B" }}>
                      <WarningOutlined style={{ fontSize: 18, color: "#F07A6A" }} />
                      <span><b>{STOER_STUFE[s.stufe].name}: {s.titel}</b><small>seit {dayjs(s.beginn).format("DD.MM. HH:mm")} ({dauerText(stoerStunden(s))})</small></span>
                    </div>
                  ))}
                  {pl.sort((x, y) => (naechsteWartung(x) || "0").localeCompare(naechsteWartung(y) || "0")).slice(0, 4).map(p => {
                    const st = wartungStatus(p), nx = naechsteWartung(p);
                    return (
                      <div key={p.id} className="w3d-dok-knopf" style={{ cursor: "default" }}>
                        <ToolOutlined style={{ fontSize: 18, color: st === "ueberfaellig" ? "#F07A6A" : st === "ok" ? "#4FC3B1" : "#F0AA2E" }} />
                        <span><b>{p.titel}</b><small>{nx ? `${st === "ueberfaellig" ? "überfällig seit" : "nächste am"} ${dayjs(nx).format("DD.MM.YYYY")}` : "noch nie durchgeführt"}, {intervallText(p)}</small></span>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })()}
          <section><h4>Dokumente ({docs.length})</h4>
            {!docs.length ? <p className="w3d-leise">Keine Dokumente hinterlegt.</p> : (
              <div className="w3d-doku-liste">
                {docs.map(dok => (
                  <button key={dok.id} className="w3d-dok-knopf" onClick={() => setAnsicht(dok)}>
                    {/\.pdf$/i.test(dok.name) ? <FilePdfOutlined style={{ color: "#F07A6A", fontSize: 18 }} /> : <PaperClipOutlined style={{ fontSize: 18 }} />}
                    <span><b>{dok.name}</b><small>{dateiGroesse(dok.groesse)}, {dayjs(dok.zeit).format("DD.MM.YYYY")}</small></span>
                  </button>
                ))}
              </div>
            )}
          </section>
          {da.links?.length > 0 && (
            <section><h4>Links</h4>
              <div className="w3d-doku-liste">{da.links.map((l, i) => /^https?:/i.test(l.url)
                ? <a key={i} className="w3d-dok-knopf" href={l.url} target="_blank" rel="noreferrer"><LinkOutlined style={{ fontSize: 18 }} /><span><b>{l.titel || l.url}</b><small>öffnet in neuem Tab</small></span></a>
                : <div key={i} className="w3d-dok-knopf" style={{ cursor: "default" }}><LinkOutlined style={{ fontSize: 18 }} /><span><b>{l.titel || "Netzwerkpfad"}</b><small style={{ userSelect: "all" }}>{l.url}</small></span></div>)}
              </div></section>
          )}
          {da.notizen && <section><h4>Notizen</h4><AntwortText text={da.notizen} /></section>}
          {!da.beschreibung && !da.daten?.length && !docs.length && !da.notizen && <p className="w3d-leise">Für dieses Element ist noch keine Dokumentation erfasst. Ergänzen über „Bearbeiten“ in der Fiche rechts.</p>}
        </div>
        {tour && <div className="w3d-doku-fuss"><button className="w3d-knopf primaer" onClick={fortsetzen}><CaretRightOutlined /> Präsentation ab hier fortsetzen</button></div>}
      </div>
    );
    if (ansicht) {
      const u = url(ansicht);
      const bild = /\.(png|jpe?g|webp|gif)$/i.test(ansicht.name), inline = /\.(pdf|txt)$/i.test(ansicht.name);
      ansichtPanel = (
        <div className="w3d-viewer" role="dialog" aria-label={ansicht.name}>
          <div className="w3d-viewer-kopf">
            <b>{ansicht.name}</b>
            <a className="w3d-knopf" href={u} target="_blank" rel="noreferrer"><LinkOutlined /> Neuer Tab</a>
            <a className="w3d-knopf" href={u} download={ansicht.name}><DownloadOutlined /> Herunterladen</a>
            <button className="w3d-knopf rund" onClick={() => setAnsicht(null)} aria-label="Vorschau schließen" title="Schließen (Esc)"><CloseOutlined /></button>
          </div>
          <div className="w3d-viewer-inhalt">
            {bild ? <img src={u} alt={ansicht.name} />
              : inline ? <iframe src={u} title={ansicht.name} />
              : <div className="w3d-viewer-leer"><PaperClipOutlined style={{ fontSize: 40 }} />
                  <p>Für {ansicht.name.split(".").pop().toUpperCase()}-Dateien gibt es keine Vorschau im Browser.</p>
                  <a className="w3d-knopf primaer" href={u} download={ansicht.name}><DownloadOutlined /> Herunterladen</a></div>}
          </div>
        </div>
      );
    }
  }

  // --- panneau de droite : liste ou détail ---
  const Eintrag = ({ x }) => (
    <button className="w3d-eintrag" onClick={() => setAuswahl(x.id)}>
      <Punkt farbe={wFarbe(x, f)} /><span className="w3d-eintrag-name">{x.name}</span>
      {zustandAn && zustand[x.id]?.meldungen?.length > 0 && <Tag bordered={false} color={zustand[x.id].stufe === "kritisch" ? "error" : "warning"} style={{ marginInlineEnd: 0 }}>{zustand[x.id].meldungen.length}</Tag>}
      {x.dokumente?.length > 0 && <Text type="secondary" style={{ fontSize: 12 }}><PaperClipOutlined /> {x.dokumente.length}</Text>}
    </button>
  );
  const passt = (x) => !suche || x.name.toLowerCase().includes(suche.toLowerCase());
  const gruppen = [...hallen.map(h => ({ h, kinder: liste.filter(x => x.halle === h.id) })), { h: null, kinder: liste.filter(x => x.typ !== "halle" && !x.halle) }]
    .map(g => ({ ...g, kinder: g.kinder.filter(passt), zeigen: (g.h && passt(g.h)) || g.kinder.some(passt) })).filter(g => g.zeigen);

  const listeKarte = (
    <Card title={<Space><OrderedListOutlined />Elemente</Space>} extra={<Text type="secondary">{liste.length}</Text>} styles={{ body: { paddingTop: 12 } }}>
      <Input allowClear prefix={<SearchOutlined />} placeholder="Element suchen" value={suche} onChange={e => setSuche(e.target.value)} style={{ marginBottom: 12 }} />
      {!d ? <Skeleton active /> : !liste.length ? <Empty description="Noch keine Elemente. Legen Sie die erste Halle an." /> : (
        <Flex vertical gap={12}>
          {gruppen.map(g => (
            <div key={g.h?.id ?? "aussen"}>
              {g.h ? <button className="w3d-eintrag w3d-halle" onClick={() => setAuswahl(g.h.id)}><HomeOutlined /><span className="w3d-eintrag-name">{g.h.name}</span>
                  <Text type="secondary" style={{ fontSize: 12 }}>{liste.filter(x => x.halle === g.h.id).length} Anlagen</Text></button>
                : <Text type="secondary" style={{ fontSize: 12, display: "block", padding: "4px 8px" }}>Außenbereich und ohne Halle</Text>}
              <div className="w3d-kinder">{g.kinder.map(x => <Eintrag key={x.id} x={x} />)}</div>
            </div>
          ))}
        </Flex>
      )}
    </Card>
  );

  let detail = null;
  if (a) {
    const kinder = liste.filter(x => x.halle === a.id);
    const kpi = a.seu && en.kpi ? en.kpi.anlagen.find(x => x.key === a.seu) : null;
    const offen = a.seu ? massnahmen.filter(x => x.anlage === a.seu && (x.status === "geplant" || x.status === "umsetzung")) : [];
    const z = zustand[a.id];
    const ueberblick = (
      <Flex vertical gap={16}>
        <LiveKarte l={live[a.id]} />
        {z?.stufe && (
          <Alert type={z.stufe === "kritisch" ? "error" : z.stufe === "warnung" ? "warning" : "success"} showIcon
            message={z.meldungen.length ? `${z.meldungen.length} ${z.meldungen.length === 1 ? "Meldung" : "Meldungen"} für ${jahr}` : `Keine Auffälligkeiten in ${jahr}`}
            description={z.meldungen.length ? <ul className="w3d-liste">{z.meldungen.slice(0, 5).map(w => <li key={w.id}>{w.titel}</li>)}</ul> : null}
            action={z.meldungen.length ? <Button size="small" onClick={() => gehe("warnungen")}>Warnungen</Button> : null} />
        )}
        {a.beschreibung ? <AntwortText text={a.beschreibung} /> : <Text type="secondary">Noch keine Beschreibung.{darf ? " Mit „Bearbeiten“ ergänzen." : ""}</Text>}
        {kinder.length > 0 && (
          <div><Text strong>Anlagen in dieser Halle</Text>
            <Flex wrap gap={6} style={{ marginTop: 6 }}>{kinder.map(x => <Tag key={x.id} style={{ cursor: "pointer" }} onClick={() => setAuswahl(x.id)}><Punkt farbe={wFarbe(x, f)} />{x.name}</Tag>)}</Flex></div>
        )}
        {a.seu && (
          <Card size="small" title={<Space><ThunderboltOutlined />Energie {jahr}</Space>}
            extra={<Button type="link" size="small" onClick={() => gehe("energie")} style={{ padding: 0 }}>Energie-Seite öffnen</Button>}>
            {!kpi ? <Text type="secondary">Keine Energiedaten für {jahr}.</Text> : (
              <Descriptions size="small" column={1} items={[
                { key: "v", label: "Verbrauch", children: <span className="zahl">{zahl(kpi.verbrauch)}</span> },
                { key: "a", label: "Anteil am Standort", children: kpi.anteil == null ? "–" : prozent(kpi.anteil) },
                { key: "e", label: `EnPI (je ${kpi.treiber})`, children: <Space size={8}><b className="zahl">{dez(kpi.enpiAkt, 3)}</b><Delta v={kpi.veraenderung} /><Text type="secondary">ggü. {en.basisJahr}</Text></Space> },
                { key: "s", label: "Normalisierte Einsparung", children: kpi.einsparung == null ? "–"
                    : <span className="zahl" style={{ color: kpi.einsparung >= 0 ? "#2F9E8F" : "#CF4B3B" }}>{kpi.einsparung >= 0 ? "+" : "−"}{zahl(Math.abs(kpi.einsparung))}</span> }
              ]} />
            )}
          </Card>
        )}
        {a.seu && (
          <div><Flex justify="space-between" align="center"><Text strong>Offene Maßnahmen ({offen.length})</Text>
            <Button type="link" size="small" onClick={() => gehe("massnahmen")} style={{ padding: 0 }}>Maßnahmenplan</Button></Flex>
            {offen.length ? <ul className="w3d-liste">{offen.slice(0, 5).map(x => <li key={x.id} style={{ color: istUeberfaellig(x) ? "#CF4B3B" : undefined }}>{x.titel}{istUeberfaellig(x) ? " (überfällig)" : ""}</li>)}</ul>
              : <Text type="secondary" style={{ display: "block" }}>Keine offenen Maßnahmen.</Text>}</div>
        )}
        <div><Text strong>Technische Daten</Text>
          {a.daten?.length ? <Descriptions size="small" bordered column={1} style={{ marginTop: 6 }} items={a.daten.map((x, i) => ({ key: i, label: x.name || "–", children: x.wert }))} />
            : <Text type="secondary" style={{ display: "block" }}>Noch keine Angaben.</Text>}</div>
        <Text type="secondary" style={{ fontSize: 12 }}>Abmessungen im Plan: {dez(a.breite, 1)} × {dez(a.tiefe, 1)} × {dez(a.hoehe, 1)} m (B × T × H)</Text>
      </Flex>
    );
    const dokumente = (
      <Flex vertical gap={12}>
        {darf && (
          <Upload.Dragger multiple accept={DOKU_ANNEHMEN} showUploadList={false} disabled={laedtHoch} beforeUpload={(datei) => { hochladen(datei); return false; }}>
            <p style={{ margin: 0 }}><UploadOutlined style={{ fontSize: 22 }} /></p>
            <p style={{ margin: "4px 0 0" }}>{laedtHoch ? "Wird hochgeladen …" : "Dateien hierher ziehen oder klicken"}</p>
            <Text type="secondary" style={{ fontSize: 12 }}>PDF, Bilder, Office, CAD (DWG, DXF, STEP), ZIP · höchstens 25 MB</Text>
          </Upload.Dragger>
        )}
        {!a.dokumente?.length ? <Text type="secondary">Noch keine Dokumente.</Text> : (
          <Flex vertical gap={4}>
            {[...a.dokumente].sort((x, y) => x.name.localeCompare(y.name, "de")).map(dok => (
              <Flex key={dok.id} align="center" gap={8} className="w3d-dok">
                {/\.pdf$/i.test(dok.name) ? <FilePdfOutlined style={{ color: "#CF4B3B" }} /> : <PaperClipOutlined />}
                <Flex vertical style={{ flex: 1, minWidth: 0 }}>
                  <a href={`/api/anlagen/${a.id}/dokumente/${dok.id}`} target="_blank" rel="noreferrer" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dok.name}</a>
                  <Text type="secondary" style={{ fontSize: 12 }}>{dateiGroesse(dok.groesse)}, {dayjs(dok.zeit).format("DD.MM.YYYY")}{dok.wer ? `, ${dok.wer}` : ""}</Text>
                </Flex>
                {darf && <Popconfirm title="Dokument löschen?" okText="Löschen" cancelText="Abbrechen" okButtonProps={{ danger: true }} onConfirm={() => dokLoeschen(dok)}>
                  <Button type="text" danger size="small" icon={<DeleteOutlined />} aria-label={`${dok.name} löschen`} /></Popconfirm>}
              </Flex>
            ))}
          </Flex>
        )}
        {a.links?.length > 0 && (
          <div><Text strong>Links</Text>
            <Flex vertical gap={4} style={{ marginTop: 6 }}>{a.links.map((l, i) => /^https?:/i.test(l.url)
              ? <a key={i} href={l.url} target="_blank" rel="noreferrer"><LinkOutlined /> {l.titel || l.url}</a>
              : <div key={i}><Text><LinkOutlined /> {l.titel || "Netzwerkpfad"}</Text><br /><Text code copyable style={{ fontSize: 12 }}>{l.url}</Text></div>)}
            </Flex>
            {a.links.some(l => !/^https?:/i.test(l.url)) && <Text type="secondary" style={{ fontSize: 12 }}>Netzwerkpfade kopieren und im Explorer einfügen (der Browser öffnet sie nicht direkt).</Text>}
          </div>
        )}
      </Flex>
    );
    detail = (
      <Card title={<Space size={4}><Button type="text" size="small" icon={<LeftOutlined />} onClick={() => setAuswahl(null)} aria-label="Zurück zur Liste" /><span>{a.name}</span></Space>}
        extra={<Space size={0}>
          <Tooltip title="QR-Code für das Handy"><Button type="text" icon={<QrcodeOutlined />} onClick={() => qrZeigen(a)} aria-label="QR-Code" /></Tooltip>
          {darf && <>
          <Tooltip title="Bearbeiten"><Button type="text" icon={<EditOutlined />} onClick={() => oeffnen(a)} aria-label="Bearbeiten" /></Tooltip>
          <Popconfirm title={`${a.name} löschen?`} description={<div style={{ maxWidth: 260 }}>Das Element und seine hochgeladenen Dokumente werden gelöscht.{a.typ === "halle" ? " Anlagen in der Halle bleiben erhalten." : ""}</div>}
            okText="Löschen" cancelText="Abbrechen" okButtonProps={{ danger: true }} onConfirm={() => loeschen(a)}>
            <Tooltip title="Löschen"><Button type="text" danger icon={<DeleteOutlined />} aria-label="Löschen" /></Tooltip>
          </Popconfirm></>}</Space>}>
        <Flex wrap gap={6} style={{ marginBottom: 8 }}>
          <Tag bordered={false} icon={W_TYPEN[a.typ]?.icon}>{W_TYPEN[a.typ]?.name}</Tag>
          {a.halle && <Tag bordered={false} icon={<HomeOutlined />} style={{ cursor: "pointer" }} onClick={() => setAuswahl(a.halle)}>{name(a.halle)}</Tag>}
          {a.seu && <Tag bordered={false} color="volcano" icon={<ThunderboltOutlined />}>Energiedaten: {ANLAGE_NAME[a.seu]}</Tag>}
        </Flex>
        <Tabs key={a.id} size="small" items={[
          { key: "u", label: "Übersicht", children: ueberblick },
          { key: "w", label: <Space size={4}>Wartung{wartung.stoerungen.some(s => s.anlage === a.id && !s.ende) ? <Badge status="error" /> : null}</Space>,
            children: <WartungAnlage a={a} wartung={wartung} darf={darf} setDialog={setWDialog} /> },
          { key: "d", label: <span>Dokumente{a.dokumente?.length ? ` (${a.dokumente.length})` : ""}</span>, children: dokumente },
          { key: "n", label: "Notizen", children: a.notizen ? <AntwortText text={a.notizen} /> : <Text type="secondary">Keine Notizen.</Text> }
        ]} />
      </Card>
    );
  }

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="flex-end" wrap gap={12}>
        <Kopf titel="Werksplan 3D" text="Hallen und Anlagen des Standorts. Ein Element anklicken, um Beschreibung, Energiedaten und Dokumente zu sehen." />
        <Space wrap>
          {hatLive && <Tooltip title="Die Live-Daten werden alle 10 Sekunden aus der Datenbank gelesen">
            <Tag bordered={false} color="processing" style={{ padding: "2px 10px" }}><Badge status="processing" /> Live{liveZeit ? ` ${liveZeit.toLocaleTimeString("de-DE")}` : ""}</Tag></Tooltip>}
          <Space size={6}><Switch size="small" checked={beschriftung} onChange={setBeschriftung} /><Text>Beschriftung</Text></Space>
          <Space size={6}><Switch size="small" checked={animiert} onChange={setAnimiert} /><Text>Animation</Text></Space>
          <Tooltip title="Farben nach Warnungen: grün in Ordnung, orange Warnung, rot kritisch, grau ohne Energiedaten">
            <Space size={6}><Switch size="small" checked={zustandAn} onChange={setZustandAn} /><Text>Zustand</Text></Space></Tooltip>
          <Tooltip title="Alle QR-Codes auf A4 drucken, zum Aufkleben an Hallen und Anlagen">
            <Button icon={<QrcodeOutlined />} disabled={!liste.length} onClick={() => etikettenDrucken(liste)}>QR-Etiketten</Button></Tooltip>
          <Button icon={<HomeOutlined />} onClick={() => { beenden(); setAuswahl(null); setHeim(x => x + 1); }}>Gesamtansicht</Button>
          {darf && <Button icon={<PlusOutlined />} onClick={() => { beenden(); oeffnen(null); }}>Neues Element</Button>}
          <Space.Compact>
            <Select value={dauer} onChange={setDauer} style={{ width: 92 }} aria-label="Dauer je Schritt"
              options={[8, 12, 20, 30].map(x => ({ value: x, label: `${x} s` }))} />
            {tour ? <Button icon={<CloseOutlined />} onClick={beenden}>Präsentation beenden</Button>
              : <Button type="primary" icon={<CaretRightOutlined />} onClick={starten} disabled={!!bearbeiten || !liste.length}>Präsentation starten</Button>}
          </Space.Compact>
        </Space>
      </Flex>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card styles={{ body: { padding: 0 } }} style={{ overflow: "hidden" }}>
            <div ref={rahmen} className="w3d-rahmen">
              <Werk3D anlagen={anzeigen} auswahl={bearbeiten ? (bearbeiten.a?.id ?? null) : auswahl}
                onWaehlen={(id) => {
                  if (bearbeiten) return;
                  if (tour || voll) { if (id) dokuOeffnen(id); else { setDoku(null); setAnsicht(null); } return; }
                  setAuswahl(id);
                }}
                dunkel={dunkel} beschriftung={beschriftung} heim={heim} animiert={animiert} hilfe={!tour} zustandAn={zustandAn} live={live}
                drehen={tour && !tour.pause ? (schritt?.id ? "normal" : "langsam") : false}>
                <div className="w3d-ecke">
                  <Button shape="circle" icon={voll ? <FullscreenExitOutlined /> : <FullscreenOutlined />} onClick={vollbild}
                    title={voll ? "Vollbild beenden" : "Vollbild"} aria-label={voll ? "Vollbild beenden" : "Vollbild"} />
                </div>
                {zustandAn && (
                  <div className="w3d-legende">
                    {[["ok", "in Ordnung"], ["warnung", "Warnung"], ["kritisch", "kritisch"]].map(([k, t]) => <span key={k}><i style={{ background: ZUSTAND_FARBE[k] }} />{t}</span>)}
                    <span><i style={{ background: dunkel ? "#55626e" : "#a7b0b8" }} />ohne Energiedaten</span>
                  </div>
                )}
                {tourKarte}
                {dokuPanel}
                {ansichtPanel}
              </Werk3D>
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={8} ref={detailRef} style={{ scrollMarginTop: 72 }}>{detail || listeKarte}</Col>
      </Row>

      <WartungDialog dialog={wDialog} schliessen={() => setWDialog(null)} anlagen={liste} fertig={(d) => d && setWartung?.(d)} />

      <Modal open={!!qr} onCancel={() => setQr(null)} title={<Space><QrcodeOutlined />{qr?.a.name}</Space>} width={420}
        footer={<Space>
          <Button icon={<DownloadOutlined />} onClick={() => Object.assign(document.createElement("a"), { href: qr.png, download: `QR_${kennung(qr.a.name)}.png` }).click()}>Als Bild</Button>
          <Button type="primary" icon={<PrinterOutlined />} onClick={() => etikettenDrucken([qr.a])}>Etikett drucken</Button></Space>}>
        {qr && (
          <Flex vertical align="center" gap={12}>
            <img src={qr.png} alt={`QR-Code für ${qr.a.name}`} style={{ width: 260, height: 260, imageRendering: "pixelated", background: "#fff", padding: 8, borderRadius: 8 }} />
            <Text type="secondary" style={{ fontSize: 12, textAlign: "center" }}>Mit der Handy-Kamera scannen: die Fiche von {qr.a.name} öffnet sich nach der Anmeldung.</Text>
            <Text code copyable style={{ fontSize: 12, wordBreak: "break-all" }}>{qr.link}</Text>
            {!qrBasis && <Alert type="warning" showIcon message="Mit dem Handy so nicht erreichbar"
              description={<>Die Adresse zeigt auf diesen PC (185.80.92.91). In der .env <Text code>WEB_HOST=0.0.0.0</Text> und <Text code>APP_URL=http://SERVERNAME:3000</Text> eintragen, neu starten und die Codes neu drucken.</>} />}
          </Flex>
        )}
      </Modal>

      <Drawer open={!!bearbeiten} onClose={schliessen} width={480} mask={false} destroyOnHidden
        title={<Space>{bearbeiten?.a ? <EditOutlined /> : <PlusOutlined />}{bearbeiten?.a ? `${bearbeiten.a.name} bearbeiten` : "Neues Element"}</Space>}
        footer={<Flex justify="space-between" align="center"><Text type="secondary" style={{ fontSize: 12 }}>Die 3D-Ansicht zeigt die Änderungen sofort.</Text>
          <Space><Button onClick={schliessen}>Abbrechen</Button><Button type="primary" loading={speichert} onClick={speichern}>{bearbeiten?.a ? "Speichern" : "Anlegen"}</Button></Space></Flex>}>
        <Form form={form} layout="vertical" requiredMark
          onValuesChange={(_, alle) => setVorschau({ ...(bearbeiten?.a || { dokumente: [] }), ...alle, id: bearbeiten?.a?.id ?? "__neu", name: alle.name || "Neues Element" })}>
          <Form.Item name="name" label="Name" rules={[{ required: true, message: "Bitte einen Namen eingeben" }]}><Input maxLength={80} placeholder="z. B. Presse III" /></Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="typ" label="Typ"><Select options={Object.entries(W_TYPEN).map(([k, t]) => ({ value: k, label: <Space size={6}>{t.icon}{t.name}</Space> }))} /></Form.Item></Col>
            <Col span={12}>{typWert !== "halle" && <Form.Item name="halle" label="Steht in"><Select allowClear placeholder="Außenbereich" options={hallen.filter(h => h.id !== bearbeiten?.a?.id).map(h => ({ value: h.id, label: h.name }))} /></Form.Item>}</Col>
          </Row>
          {typWert !== "halle" && (
            <Form.Item name="seu" label="Energiedaten verknüpfen" extra="Zeigt Verbrauch, EnPI und Maßnahmen dieser Anlage aus SEUWerte.">
              <Select allowClear placeholder="keine" options={SEU_DEF.map(x => ({ value: x.key, label: <span><Punkt farbe={f[x.farbe]} />{x.name}</span> }))} />
            </Form.Item>
          )}
          <Text strong>Lage und Größe (Meter)</Text>
          <Text type="secondary" style={{ display: "block", fontSize: 12, marginBottom: 8 }}>X nach rechts, Z nach vorne, Mittelpunkt des Plans = 0 / 0. Die Position ist der Mittelpunkt des Elements.</Text>
          <Row gutter={8}>
            {[["x", "X", -500, 500, 1], ["z", "Z", -500, 500, 1], ["drehung", "Drehung °", -360, 360, 15], ["breite", "Breite", 0.5, 300, 0.5], ["tiefe", "Tiefe", 0.5, 300, 0.5], ["hoehe", "Höhe", 0.5, 60, 0.5]].map(([n, l, mi, ma, st]) => (
              <Col span={8} key={n}><Form.Item name={n} label={l} rules={[{ required: true, message: "Pflicht" }]} style={{ marginBottom: 12 }}>
                <InputNumber min={mi} max={ma} step={st} decimalSeparator="," style={{ width: "100%" }} /></Form.Item></Col>
            ))}
          </Row>
          <Form.Item name="beschreibung" label="Beschreibung" extra="**fett** und Zeilen mit „- “ werden formatiert angezeigt.">
            <Input.TextArea autoSize={{ minRows: 3, maxRows: 10 }} maxLength={4000} placeholder="Aufgabe, Baujahr, Hersteller, Ansprechpartner …" />
          </Form.Item>
          <Text strong>Technische Daten</Text>
          <Form.List name="daten">{(felder, { add, remove }) => (
            <div style={{ marginTop: 8, marginBottom: 16 }}>
              {felder.map(({ key, name: n }) => (
                <Flex key={key} gap={8} align="start">
                  <Form.Item name={[n, "name"]} style={{ flex: 1, marginBottom: 8 }}><Input placeholder="z. B. Presskraft" maxLength={60} /></Form.Item>
                  <Form.Item name={[n, "wert"]} style={{ flex: 1.4, marginBottom: 8 }}><Input placeholder="z. B. 1.200 t" maxLength={200} /></Form.Item>
                  <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(n)} aria-label="Angabe entfernen" />
                </Flex>
              ))}
              <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ name: "", wert: "" })}>Angabe hinzufügen</Button>
            </div>
          )}</Form.List>
          <Text strong>Links</Text>
          <Form.List name="links">{(felder, { add, remove }) => (
            <div style={{ marginTop: 8, marginBottom: 16 }}>
              {felder.map(({ key, name: n }) => (
                <Flex key={key} gap={8} align="start">
                  <Form.Item name={[n, "titel"]} style={{ flex: 1, marginBottom: 8 }}><Input placeholder="Titel" maxLength={120} /></Form.Item>
                  <Form.Item name={[n, "url"]} style={{ flex: 1.6, marginBottom: 8 }}
                    rules={[{ pattern: /^(https?:\/\/|\\\\)/i, message: "http(s)://… oder \\\\server\\freigabe" }]}>
                    <Input placeholder="https://… oder \\server\freigabe\…" maxLength={500} /></Form.Item>
                  <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(n)} aria-label="Link entfernen" />
                </Flex>
              ))}
              <Button type="dashed" block icon={<LinkOutlined />} onClick={() => add({ titel: "", url: "" })}>Link hinzufügen</Button>
            </div>
          )}</Form.List>
          <Collapse size="small" style={{ marginBottom: 16 }} defaultActiveKey={bearbeiten?.a?.live?.tabelle ? ["l"] : []} items={[{ key: "l", forceRender: true,
            label: <Space><ThunderboltOutlined /><b>Live-Daten aus der Datenbank</b>{bearbeiten?.a?.live?.tabelle && <Tag bordered={false} color="processing">aktiv</Tag>}</Space>,
            children: <LiveEinstellung form={form} offen={!!bearbeiten} /> }]} />
          <Form.Item name="notizen" label="Notizen"><Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} maxLength={4000} placeholder="Wartung, Störungen, Hinweise …" /></Form.Item>
        </Form>
        {!bearbeiten?.a && <Alert type="info" showIcon message="Dokumente können nach dem Anlegen im Reiter „Dokumente“ hochgeladen werden." />}
      </Drawer>
    </Flex>
  );
}

const SEITEN = [
  { key: "uebersicht", label: "Übersicht", icon: <DashboardOutlined /> },
  { key: "werk", label: "Werksplan 3D", icon: <BuildOutlined /> },
  { key: "wartung", label: "Wartung & Störungen", icon: <ToolOutlined /> },
  { key: "monatswerte", label: "Monatswerte", icon: <TableOutlined /> },
  { key: "abschaum", label: "Abschaum", icon: <ExperimentOutlined /> },
  { key: "energie", label: "Energie (SEU)", icon: <ThunderboltOutlined /> },
  { key: "kpi", label: "SEU-KPI", icon: <FundOutlined /> },
  { key: "warnungen", label: "Warnungen", icon: <BellOutlined /> },
  { key: "massnahmen", label: "Maßnahmen", icon: <ProjectOutlined /> },
  { key: "kommentar", label: "Monatskommentar", icon: <CommentOutlined /> },
  { key: "bericht", label: "Energiebericht", icon: <FilePdfOutlined /> },
  { key: "monitor", label: "Hallenmonitor", icon: <DesktopOutlined /> },
  { key: "tabellen", label: "Alle Tabellen", icon: <DatabaseOutlined /> },
  { key: "assistent", label: "KI-Assistent", icon: <RobotOutlined /> },
  { key: "datenqualitaet", label: "Datenqualität", icon: <SafetyCertificateOutlined /> },
  { key: "benutzer", label: "Benutzer", icon: <TeamOutlined />, nurAdmin: true }
];
const ausHash = () => SEITEN.find(s => s.key === location.hash.slice(1).split("/")[0])?.key || "uebersicht";   // #werk/presse-1 → page werk

function App({ dunkel, setDunkel, benutzer, abmelden, profilGespeichert }) {
  const istAdmin = benutzer.rolle === "admin";
  const screens = Grid.useBreakpoint();
  const mobil = !screens.lg;
  const [menuOffen, setMenuOffen] = useState(false);
  const [seite, setSeite] = useState(ausHash);
  const [jahre, setJahre] = useState([]);
  const [jahr, setJahr] = useState(null);
  const [daten, setDaten] = useState(null);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState("");

  useEffect(() => {
    const f = () => setSeite(ausHash());
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);

  useEffect(() => {
    api("/api/jahre")
      .then(j => { setJahre(j); setJahr(j[0] ?? null); if (!j.length) setLaedt(false); })
      .catch(e => { setFehler(e.message); setLaedt(false); });
  }, []);

  // rechargement automatique toutes les 5 minutes en mode Hallenmonitor
  const [stand, setStand] = useState(0);
  const [standZeit, setStandZeit] = useState(new Date());
  useEffect(() => {
    if (seite !== "monitor") return;
    const t = setInterval(() => { setStand(x => x + 1); setStandZeit(new Date()); }, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [seite]);

  useEffect(() => {
    if (!jahr) return;
    if (!stand) setLaedt(true);
    api(`/api/produktion?jahr=${jahr}`)
      .then(d => { setDaten(d); setFehler(""); })
      .catch(e => setFehler(e.message))
      .finally(() => setLaedt(false));
  }, [jahr, stand]);

  const k = useMemo(() => berechne(daten), [daten]);
  // énergie (partagée), plan d'actions et alertes
  const darfSchreiben = ["bearbeiter", "admin"].includes(benutzer.rolle);
  const en = useEnergie(jahr, stand, darfSchreiben);
  const [massnahmen, setMassnahmen] = useState({ liste: [], schutz: false });
  const [massnahmeZiel, setMassnahmeZiel] = useState(null);
  const massnahmenLaden = () => api("/api/massnahmen").then(setMassnahmen).catch(() => {});
  const [wartung, setWartung] = useState(LEER_WARTUNG);
  const wartungLaden = () => api("/api/wartung").then(setWartung).catch(() => {});
  useEffect(() => { wartungLaden(); }, [stand]);
  useEffect(() => { massnahmenLaden(); }, [stand]);
  const warnungen = useMemo(() => {
    if (!jahr) return [];
    const rang = { kritisch: 0, warnung: 1, info: 2 };
    return [...warnungenBerechnen(en, massnahmen.liste, jahr), ...abschaumWarnungen(k)].sort((a, b) => rang[a.stufe] - rang[b.stufe] || (b.monat || 0) - (a.monat || 0));
  }, [en.kpi, en.daten, en.prognose, massnahmen, jahr, k]); // eslint-disable-line react-hooks/exhaustive-deps
  const kritisch = warnungen.filter(x => x.stufe === "kritisch").length;
  const offeneWarnungen = warnungen.filter(x => x.stufe !== "info").length;
  const zurMassnahme = (ziel) => { setMassnahmeZiel(ziel); gehe("massnahmen"); };
  const hinweise = useMemo(() => pruefe(k), [k]);
  const offen = hinweise.filter(h => h.stufe === "warnung" || h.stufe === "fehler").length;
  const verbunden = !fehler && jahre.length > 0;

  const items = SEITEN.filter(s => !s.nurAdmin || istAdmin).map(s => ({
    key: s.key, icon: s.icon,
    label: s.key === "datenqualitaet" && offen ? <Space>{s.label}<Badge count={offen} size="small" color="#E39A2D" /></Space>
      : s.key === "warnungen" && offeneWarnungen ? <Space>{s.label}<Badge count={offeneWarnungen} size="small" color={kritisch ? "#CF4B3B" : "#E39A2D"} /></Space>
      : s.key === "massnahmen" && massnahmen.liste.some(istUeberfaellig) ? <Space>{s.label}<Badge dot color="#CF4B3B" /></Space>
      : s.key === "wartung" && wartung.stoerungen.some(x => !x.ende) ? <Space>{s.label}<Badge count={wartung.stoerungen.filter(x => !x.ende).length} size="small" /></Space>
      : s.key === "wartung" && wartung.plaene.some(p => wartungStatus(p) === "ueberfaellig") ? <Space>{s.label}<Badge dot color="#E39A2D" /></Space>
      : s.label
  }));
  const gehe = (key) => { location.hash = key; setSeite(key); setMenuOffen(false); };

  const menu = (
    <>
      <Marke />
      <Menu theme="dark" mode="inline" selectedKeys={[seite]} items={items} onClick={e => gehe(e.key)} style={{ borderInlineEnd: 0, padding: "8px 8px" }} />
      <div style={{ position: "absolute", bottom: 16, left: 20, right: 20, color: "rgba(255,255,255,.45)", fontSize: 12 }}>
        <DatabaseOutlined /> Datenbank MRS_BI
      </div>
    </>
  );

  if (seite === "monitor") return (
    <Hallenmonitor k={k} en={en} warnungen={warnungen} massnahmen={massnahmen.liste} jahr={jahr} standZeit={standZeit} verlassen={() => gehe("uebersicht")} />
  );

  return (
    <Layout style={{ minHeight: "100dvh" }}>
      {mobil ? (
        <Drawer open={menuOffen} onClose={() => setMenuOffen(false)} placement="left" width={250}
          styles={{ body: { padding: 0, background: "#14212B", position: "relative" }, header: { display: "none" } }}>
          {menu}
        </Drawer>
      ) : (
        <Layout.Sider className="no-print" width={236} style={{ position: "sticky", top: 0, height: "100dvh" }}>{menu}</Layout.Sider>
      )}

      <Layout>
        <Layout.Header className="no-print" style={{ display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 10,
                                borderBottom: `1px solid ${dunkel ? "#232D36" : "#E6EAEE"}` }}>
          {mobil && <Button type="text" icon={<MenuOutlined />} onClick={() => setMenuOffen(true)} aria-label="Menü" />}
          <Title level={4} style={{ margin: 0, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {SEITEN.find(s => s.key === seite)?.label}
          </Title>
          <Select value={jahr} onChange={setJahr} options={jahre.map(j => ({ value: j, label: j }))}
                  style={{ width: 110 }} prefix={<CalendarOutlined />} aria-label="Jahr" />
          {!mobil && (
            <Tooltip title={verbunden ? "Mit SQL Server verbunden" : "Keine Verbindung zur Datenbank"}>
              <Badge status={verbunden ? "success" : "error"} text={verbunden ? "Verbunden" : "Offline"} />
            </Tooltip>
          )}
          <Tooltip title={dunkel ? "Helles Design" : "Dunkles Design"}>
            <Button shape="circle" icon={dunkel ? <SunOutlined /> : <MoonOutlined />} onClick={() => setDunkel(!dunkel)} aria-label="Design wechseln" />
          </Tooltip>
          <BenutzerMenue benutzer={benutzer} abmelden={abmelden} profilGespeichert={profilGespeichert} />
        </Layout.Header>

        <Layout.Content style={{ padding: mobil ? 16 : 24 }}>
          <div style={{ maxWidth: 1320, margin: "0 auto" }}>
            {fehler && <Alert className="no-print" type="error" showIcon message="Daten konnten nicht geladen werden" description={fehler} style={{ marginBottom: 16 }}
                              action={<Button size="small" icon={<SyncOutlined />} onClick={() => location.reload()}>Neu laden</Button>} />}
            {seite === "uebersicht" && <UebersichtSeite k={k} laedt={laedt} dunkel={dunkel} jahr={jahr} />}
            {seite === "wartung" && <WartungSeite wartung={wartung} setWartung={setWartung} laden={wartungLaden} jahr={jahr} dunkel={dunkel} />}
            {seite === "werk" && <Werksplan en={en} massnahmen={massnahmen.liste} warnungen={warnungen} wartung={wartung} setWartung={setWartung} jahr={jahr} dunkel={dunkel} darf={darfSchreiben} gehe={gehe} />}
            {seite === "monatswerte" && <Monatswerte k={k} dunkel={dunkel} />}
            {seite === "energie" && <Energie jahr={jahr} dunkel={dunkel} en={en} darf={darfSchreiben} massnahmen={massnahmen.liste} />}
            {seite === "warnungen" && <Warnungen warnungen={warnungen} en={en} massnahmen={massnahmen.liste} darf={massnahmen.darf} jahr={jahr} dunkel={dunkel} zurMassnahme={zurMassnahme} />}
            {seite === "massnahmen" && <Massnahmen liste={massnahmen.liste} schutz={massnahmen.schutz} darf={massnahmen.darf} laden={massnahmenLaden} en={en} jahr={jahr} dunkel={dunkel}
                                                   ziel={massnahmeZiel} setZiel={setMassnahmeZiel} />}
            {seite === "bericht" && <Bericht en={en} massnahmen={massnahmen.liste} jahr={jahr} />}
            {seite === "kommentar" && <Monatskommentar k={k} en={en} warnungen={warnungen} massnahmen={massnahmen.liste} jahr={jahr} darf={massnahmen.darf} />}
            {seite === "kpi" && <SeuKpiSeite jahr={jahr} dunkel={dunkel} />}
            {seite === "abschaum" && <Abschaum jahr={jahr} jahre={jahre} dunkel={dunkel} />}
            {seite === "tabellen" && <Tabellen jahr={jahr} dunkel={dunkel} />}
            {seite === "assistent" && <Assistent k={k} />}
            {seite === "datenqualitaet" && <Datenqualitaet hinweise={hinweise} jahr={jahr} />}
            {seite === "benutzer" && (istAdmin ? <Benutzerverwaltung ich={benutzer} />
              : <Result status="403" title="Kein Zugriff" subTitle="Diese Seite ist nur für Administratoren." />)}
          </div>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}

// =====================================================================
// 7. Démarrage : thème Ant Design (clair / sombre, mémorisé)
// =====================================================================
const CSS = `
body { margin: 0; font-variant-numeric: tabular-nums; }
.zahl { font-variant-numeric: tabular-nums; }
.antwort p { margin: 0 0 .6em; }
.antwort ul { margin: 0 0 .6em; padding-left: 1.2em; }
.antwort p:last-child, .antwort ul:last-child { margin-bottom: 0; }
.marke { display: flex; align-items: center; gap: 10px; height: 64px; padding: 0 20px; color: #fff; }
.marke-logo { width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center; flex-shrink: 0;
  background: linear-gradient(140deg, #3E7099, #21465D); box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
.marke-text b { display: block; font-size: 15px; line-height: 1.2; }
.marke-text span { display: block; font-size: 11px; opacity: .6; }
.kpi .ant-statistic-content { font-weight: 700; }
.chat-wrap { display: flex; flex-direction: column; height: calc(100dvh - 64px - 48px); max-width: 880px; margin: 0 auto; }
.chat-liste { flex: 1; min-height: 0; }
.legende { display: inline-flex; align-items: center; gap: 6px; }
.legende i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.hinweis.ant-alert { background: rgba(79,131,170,.08); border: 1px solid rgba(79,131,170,.28); }
.kopf-nowrap .ant-table-thead th { white-space: nowrap; }
/* --- Energiebericht (écran + impression A4) --- */
.bericht { background: #fff; color: #1F2A33; max-width: 794px; width: 100%; margin: 0 auto; padding: 40px 48px; border-radius: 4px;
  box-shadow: 0 1px 4px rgba(0,0,0,.14); font-size: 13px; line-height: 1.55; box-sizing: border-box;
  print-color-adjust: exact; -webkit-print-color-adjust: exact; }
.bericht h1 { font-size: 28px; margin: 24px 0 4px; color: #1F2A33; font-weight: 700; letter-spacing: -.01em; }
.bericht h2 { font-size: 17px; margin: 28px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #2B5874; color: #1F2A33; }
.bericht h3 { font-size: 13px; margin: 16px 0 6px; color: #1F2A33; }
.bericht p, .bericht li { color: #1F2A33; }
.bericht ul { padding-left: 1.2em; margin: 0 0 8px; }
.b-unter { color: #5F6B76 !important; margin: 0 0 18px; }
.b-kopf { display: flex; justify-content: space-between; align-items: center; padding-bottom: 14px; border-bottom: 1px solid #DDE3E8; }
.b-marke { display: flex; gap: 12px; align-items: center; }
.b-marke b { display: block; font-size: 15px; }
.b-marke span { display: block; font-size: 11px; color: #5F6B76; }
.b-meta { text-align: right; font-size: 11px; color: #5F6B76; }
.b-kacheln { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 6px 0 4px; }
.b-kachel { background: #F4F6F8; border-radius: 6px; padding: 10px 12px; border-top: 3px solid #2B5874; }
.b-kachel span { display: block; font-size: 11px; color: #5F6B76; }
.b-kachel b { display: block; font-size: 18px; margin: 2px 0; font-variant-numeric: tabular-nums; }
.b-kachel small { font-size: 11px; color: #5F6B76; }
.b-tab { width: 100%; border-collapse: collapse; font-size: 11.5px; margin: 6px 0 10px; font-variant-numeric: tabular-nums; }
.b-tab th { text-align: right; font-weight: 600; color: #5F6B76; border-bottom: 1px solid #1F2A33; padding: 5px 6px; white-space: nowrap; }
.b-tab td { text-align: right; padding: 5px 6px; border-bottom: 1px solid #DDE3E8; vertical-align: top; color: #1F2A33; }
.b-tab th:first-child, .b-tab td:first-child, .b-tab.b-text th, .b-tab.b-text td { text-align: left; }
.b-tab tfoot td, .b-tab .b-summe td { font-weight: 700; border-top: 1px solid #1F2A33; background: #F4F6F8; }
.b-kommentar { background: #F4F6F8; border-left: 3px solid #E39A2D; padding: 10px 12px; color: #1F2A33; }
.b-klein { font-size: 11px; color: #5F6B76 !important; }
.b-unterschriften { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 28px; }
.b-unterschriften span { font-weight: 600; }
.b-linie { border-bottom: 1px solid #1F2A33; height: 52px; }
.b-unterschriften small { color: #5F6B76; font-size: 11px; }
.b-fuss { margin-top: 32px; padding-top: 10px; border-top: 1px solid #DDE3E8; font-size: 10.5px; color: #5F6B76; text-align: center; }
.bericht .recharts-legend-item-text { color: #1F2A33 !important; }
@media screen and (max-width: 760px) { .bericht { padding: 20px; } .b-kacheln { grid-template-columns: repeat(2, 1fr); } }
@media print {
  @page { size: A4; margin: 14mm 13mm; }
  .no-print, .ant-layout-sider, .ant-layout-header, .ant-drawer, .ant-notification, .ant-message { display: none !important; }
  html, body, .ant-layout, .ant-layout-content { background: #fff !important; padding: 0 !important; }
  .ant-layout-content > div { max-width: none !important; }
  .bericht { box-shadow: none; padding: 0; max-width: none; border-radius: 0; }
  .b-umbruch { break-before: page; }
  .b-block, .b-tab tr { break-inside: avoid; }
  .bericht h2, .bericht h3 { break-after: avoid; }
}
.anmelden { display: grid; grid-template-columns: minmax(280px, 42%) 1fr; min-height: 100dvh; }
.anmelden-marke { background: #14212B; color: #fff; display: flex; flex-direction: column; justify-content: space-between; padding: 24px 28px;
  background-image: radial-gradient(circle at 85% 20%, rgba(62,112,153,.35), transparent 55%), radial-gradient(circle at 10% 90%, rgba(240,170,46,.12), transparent 50%); }
.anmelden-marke .marke { padding: 0; height: auto; }
.anmelden-text h2 { color: #fff; font-size: 30px; line-height: 1.2; margin: 0 0 12px; font-weight: 700; max-width: 420px; }
.anmelden-text p { color: rgba(255,255,255,.7); font-size: 15px; max-width: 400px; margin: 0; }
.anmelden-fuss { color: rgba(255,255,255,.45); font-size: 12px; }
.anmelden-form { display: grid; place-items: center; padding: 24px; }
@media (max-width: 800px) { .anmelden { grid-template-columns: 1fr; } .anmelden-marke { min-height: auto; gap: 24px; } .anmelden-text h2 { font-size: 22px; } }
@media (max-width: 700px) { .kopf-name { display: none; } }
.abgleich-zelle { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 24px; border-radius: 5px;
  color: #fff; font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }
.abgleich-zelle.leer { background: transparent; border: 1px dashed rgba(127,127,127,.3); }
/* --- Hallenmonitor --- */
.monitor { position: fixed; inset: 0; z-index: 100; display: grid; grid-template-rows: auto 1fr auto; gap: 2vh; padding: 2.4vh 2.6vw 1.6vh;
  color: #E8EEF2; overflow: hidden; font-variant-numeric: tabular-nums;
  background: radial-gradient(circle at 85% 0%, rgba(62,112,153,.28), transparent 45%), radial-gradient(circle at 0% 100%, rgba(240,170,46,.08), transparent 40%), #0E1820; }
.monitor.m-ohne-zeiger { cursor: none; }
.m-kopf { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; }
.m-marke { display: flex; align-items: center; gap: 12px; font-size: clamp(14px, 1.3vw, 22px); font-weight: 600; opacity: .85; }
.m-kopf h1 { margin: 0; color: #fff; font-size: clamp(22px, 2.4vw, 44px); font-weight: 700; display: flex; gap: .5em; align-items: center; animation: m-ein .6s ease; }
.m-zeit { justify-self: end; text-align: right; }
.m-zeit b { display: block; font-size: clamp(24px, 2.8vw, 52px); line-height: 1; font-weight: 700; }
.m-zeit span { font-size: clamp(12px, 1vw, 18px); color: rgba(232,238,242,.6); }
.m-inhalt { min-height: 0; animation: m-ein .6s ease; }
@keyframes m-ein { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .m-inhalt, .m-kopf h1 { animation: none; } }
.m-raster { display: grid; grid-template-columns: 1.3fr 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 2vh 1.6vw; height: 100%; }
.m-raster .m-gross { grid-row: span 2; }
.m-kachel { background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.07); border-radius: 18px; padding: 2.4vh 1.8vw;
  display: flex; flex-direction: column; justify-content: center; min-height: 0; min-width: 0; }
.m-titel { font-size: clamp(14px, 1.25vw, 24px); color: rgba(232,238,242,.65); display: flex; gap: .5em; align-items: center; }
.m-kachel > b { font-size: clamp(36px, 4.6vw, 96px); line-height: 1.05; font-weight: 700; margin: .15em 0; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.m-gross > b { font-size: clamp(52px, 6.4vw, 150px); }
.m-kachel > b.m-wort { font-size: clamp(26px, 2.8vw, 60px); white-space: normal; }
.m-unter { font-size: clamp(14px, 1.35vw, 26px); color: rgba(232,238,242,.75); }
.m-delta { font-weight: 600; } .m-delta small { font-weight: 400; color: rgba(232,238,242,.6); font-size: .85em; }
.m-quellen { justify-content: flex-start; gap: 1.6vh; }
.m-quelle { display: grid; grid-template-columns: 1fr auto; gap: .4vh .8vw; font-size: clamp(14px, 1.4vw, 28px); }
.m-quelle span { display: flex; align-items: center; gap: .5em; } .m-quelle i { width: .7em; height: .7em; border-radius: 3px; display: inline-block; }
.m-quelle b { font-weight: 700; }
.m-balken { grid-column: span 2; height: 10px; border-radius: 5px; background: rgba(255,255,255,.08); overflow: hidden; }
.m-balken div { height: 100%; border-radius: 5px; }
.m-diagramm { grid-column: span 2; justify-content: flex-start; }
.m-voll { height: 100%; display: flex; flex-direction: column; gap: 1.5vh; }
.m-legende { display: flex; gap: 2.4vw; flex-wrap: wrap; font-size: clamp(14px, 1.4vw, 26px); color: rgba(232,238,242,.8); }
.m-legende span { display: inline-flex; align-items: center; gap: .5em; } .m-legende i { width: .8em; height: .8em; border-radius: 3px; display: inline-block; }
.m-legende b { color: #fff; margin-left: .3em; }
.m-liste-raster { display: grid; grid-template-columns: minmax(220px, 26%) 1fr; gap: 1.6vw; height: 100%; min-height: 0; }
.m-zahlen { display: grid; gap: 2vh; }
.m-liste { list-style: none; margin: 0; padding: 0; display: grid; gap: 1.4vh; align-content: start; min-height: 0; overflow: hidden; }
.m-liste li { background: rgba(255,255,255,.045); border-radius: 14px; border-left: 8px solid; padding: 1.6vh 1.4vw; }
.m-liste li b { display: block; font-size: clamp(16px, 1.6vw, 32px); color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.m-liste li span { font-size: clamp(13px, 1.15vw, 22px); color: rgba(232,238,242,.65); } .m-liste li em { font-style: normal; }
.m-liste .m-mehr { border: none; background: none; color: rgba(232,238,242,.55); font-size: clamp(13px, 1.1vw, 20px); }
.m-leer { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.5vh; font-size: clamp(18px, 2vw, 36px); color: rgba(232,238,242,.6); }
.m-leer .anticon { font-size: clamp(48px, 7vw, 140px); }
.m-gut .anticon { color: #4FC3B1; } .m-gut span { color: #fff; font-weight: 700; font-size: clamp(28px, 3.6vw, 72px); } .m-gut small { font-size: clamp(14px, 1.3vw, 24px); }
.m-kommentar { height: 100%; max-width: 1500px; display: flex; flex-direction: column; gap: 2vh; overflow: hidden; }
.m-kommentar .antwort { font-size: clamp(16px, 1.55vw, 32px); line-height: 1.55; color: #E8EEF2; column-width: 38em; column-gap: 3vw; }
.m-kommentar .antwort b { color: #fff; }
.m-fuss { display: grid; grid-template-columns: 1fr auto; grid-template-rows: auto auto; gap: 1.2vh 1vw; align-items: center; }
.m-punkte { display: flex; gap: .6vw; flex-wrap: wrap; }
.m-punkte button { all: unset; cursor: pointer; display: inline-flex; gap: .5em; align-items: center; padding: .5vh .9vw; border-radius: 999px;
  font-size: clamp(12px, .95vw, 18px); color: rgba(232,238,242,.5); }
.m-punkte button.aktiv { background: rgba(255,255,255,.1); color: #fff; }
.m-punkte button:focus-visible { outline: 2px solid #4F83AA; }
.m-stand { font-size: clamp(12px, .95vw, 18px); color: rgba(232,238,242,.5); }
.m-fortschritt { grid-column: span 2; height: 4px; border-radius: 2px; background: rgba(255,255,255,.08); overflow: hidden; }
.m-fortschritt div { height: 100%; background: #4F83AA; width: 0; animation-name: m-lauf; animation-timing-function: linear; animation-fill-mode: forwards; }
@keyframes m-lauf { from { width: 0; } to { width: 100%; } }
.m-steuerung { position: fixed; right: 2.4vw; bottom: 9vh; display: flex; gap: 10px; padding: 10px; border-radius: 999px; background: rgba(20,33,43,.85);
  box-shadow: 0 8px 30px rgba(0,0,0,.4); opacity: 0; transform: translateY(10px); transition: opacity .25s, transform .25s; pointer-events: none; }
.m-steuerung.sichtbar { opacity: 1; transform: none; pointer-events: auto; }
@media (max-width: 900px) { .m-raster { grid-template-columns: 1fr 1fr; grid-template-rows: none; overflow: auto; } .m-raster .m-gross { grid-row: auto; grid-column: span 2; }
  .m-liste-raster { grid-template-columns: 1fr; } .m-kopf { grid-template-columns: 1fr auto; } .m-kopf h1 { display: none; } }
.zeile-blass > td { opacity: .55; }
.zeile-aktiv > td { background: rgba(79,131,170,.12) !important; }
.filter-leiste { padding: 10px 12px; margin-bottom: 4px; border-radius: 8px; background: rgba(127,127,127,.07); }
/* --- Werksplan 3D --- */
.w3d { position: relative; height: calc(100dvh - 230px); min-height: 460px; }
.w3d-buehne { position: absolute; inset: 0; }
.w3d-buehne canvas { display: block; touch-action: none; cursor: grab; }
.w3d-buehne canvas:active { cursor: grabbing; }
.w3d-labels { position: absolute; top: 0; left: 0; pointer-events: none; }
.w3d-label { padding: 3px 9px; border-radius: 999px; background: rgba(20,33,43,.84); color: #fff; font-size: 12px; font-weight: 600;
  white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,.22); transition: background .2s; }
.w3d-label.halle { background: rgba(43,88,116,.92); font-size: 13px; padding: 4px 12px; border-radius: 6px; }
.w3d-label.aktiv { background: #E39A2D; color: #14212B; }
.w3d-hinweis { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.w3d-hilfe { position: absolute; left: 12px; bottom: 10px; max-width: calc(100% - 24px); font-size: 12px; padding: 4px 10px; border-radius: 6px;
  background: rgba(20,33,43,.62); color: #fff; pointer-events: none; }
.w3d-eintrag { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
.w3d-eintrag:hover { background: rgba(127,127,127,.1); }
.w3d-eintrag:focus-visible { outline: 2px solid #4F83AA; }
.w3d-eintrag-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.w3d-halle { font-weight: 600; }
.w3d-kinder { padding-left: 14px; margin-left: 9px; border-left: 1px solid rgba(127,127,127,.25); }
.w3d-dok { padding: 6px 8px; border-radius: 6px; }
.w3d-dok:hover { background: rgba(127,127,127,.08); }
.w3d-liste { margin: 4px 0 0; padding-left: 1.2em; }
@media (max-width: 1200px) { .w3d { height: 60vh; min-height: 380px; } }
.w3d-badge { display: inline-block; margin-left: 6px; min-width: 18px; padding: 0 5px; border-radius: 999px; font-size: 11px; line-height: 18px; text-align: center; color: #fff; }
.w3d-badge.warnung { background: #E39A2D; color: #14212B; }
.w3d-badge.kritisch { background: #CF4B3B; }
.w3d-legende { position: absolute; top: 12px; left: 12px; display: flex; flex-wrap: wrap; gap: 6px 14px; max-width: calc(100% - 80px); padding: 6px 12px; border-radius: 8px;
  background: rgba(20,33,43,.68); color: #fff; font-size: 12px; pointer-events: none; }
.w3d-legende span { display: inline-flex; align-items: center; gap: 6px; }
.w3d-legende i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.w3d-knopf { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 999px;
  background: rgba(255,255,255,.12); color: #fff; font-size: 13px; cursor: pointer; white-space: nowrap; }
.w3d-knopf:hover { background: rgba(255,255,255,.22); color: #fff; }
.w3d-knopf.primaer { background: #E39A2D; color: #14212B; font-weight: 600; }
.w3d-knopf.primaer:hover { background: #F0AA2E; color: #14212B; }
.w3d-knopf.rund { width: 32px; height: 32px; padding: 0; justify-content: center; flex-shrink: 0; }
.w3d-knopf:focus-visible, .w3d-chip:focus-visible, .w3d-dok-knopf:focus-visible { outline: 2px solid #E39A2D; outline-offset: 2px; }
.w3d-tour-karte .w3d-knopf { pointer-events: auto; margin-top: 16px; }
.w3d-doku { position: absolute; top: 60px; right: 12px; bottom: 84px; width: min(420px, calc(100% - 24px)); z-index: 2; display: flex; flex-direction: column;
  border-radius: 12px; background: rgba(14,24,32,.92); color: #E8EEF2; backdrop-filter: blur(6px); box-shadow: 0 12px 32px rgba(0,0,0,.35); animation: w3d-ein .35s ease; }
.w3d-doku-kopf { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 16px 18px 12px; border-bottom: 1px solid rgba(255,255,255,.1); }
.w3d-doku-kopf h3 { margin: 2px 0 0; color: #fff; font-size: 22px; line-height: 1.2; overflow-wrap: anywhere; }
.w3d-doku-inhalt { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 18px 18px; display: flex; flex-direction: column; gap: 18px; font-size: 14px; line-height: 1.55; }
.w3d-doku-inhalt section h4 { margin: 0 0 8px; font-size: 12px; font-weight: 600; color: rgba(232,238,242,.6); }
.w3d-doku-inhalt .antwort, .w3d-doku-inhalt .antwort p, .w3d-doku-inhalt .antwort li { color: #E8EEF2; }
.w3d-doku-inhalt .antwort b { color: #fff; }
.w3d-leise { margin: 0; color: rgba(232,238,242,.6); }
.w3d-dl { display: grid; grid-template-columns: minmax(90px, auto) 1fr; gap: 6px 14px; margin: 0; }
.w3d-dl dt { color: rgba(232,238,242,.6); }
.w3d-dl dd { margin: 0; color: #fff; font-weight: 600; }
.w3d-doku-liste { display: flex; flex-direction: column; gap: 6px; }
.w3d-dok-knopf { all: unset; box-sizing: border-box; display: flex; gap: 10px; align-items: center; padding: 9px 11px; border-radius: 8px;
  background: rgba(255,255,255,.06); color: #E8EEF2; cursor: pointer; }
.w3d-dok-knopf:hover { background: rgba(255,255,255,.14); color: #E8EEF2; }
.w3d-dok-knopf span { min-width: 0; flex: 1; }
.w3d-dok-knopf b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #fff; font-weight: 600; }
.w3d-dok-knopf small { display: block; color: rgba(232,238,242,.6); font-size: 12px; overflow-wrap: anywhere; }
.w3d-doku-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.w3d-chip { all: unset; padding: 5px 12px; border-radius: 999px; background: rgba(255,255,255,.1); color: #fff; font-size: 13px; cursor: pointer; }
.w3d-chip:hover { background: rgba(255,255,255,.2); }
.w3d-doku-zustand { padding: 10px 12px; border-radius: 8px; border-left: 4px solid; background: rgba(255,255,255,.05); }
.w3d-doku-zustand.ok { border-color: #2F9E8F; } .w3d-doku-zustand.warnung { border-color: #E39A2D; } .w3d-doku-zustand.kritisch { border-color: #CF4B3B; }
.w3d-doku-zustand b { color: #fff; }
.w3d-doku-zustand ul { margin: 6px 0 0; padding-left: 1.2em; color: rgba(232,238,242,.85); }
.w3d-doku-fuss { padding: 12px 18px; border-top: 1px solid rgba(255,255,255,.1); }
.w3d-viewer { position: absolute; inset: 12px; z-index: 3; display: flex; flex-direction: column; border-radius: 12px; overflow: hidden;
  background: #0f1418; box-shadow: 0 16px 40px rgba(0,0,0,.45); animation: w3d-ein .3s ease; }
.w3d-viewer-kopf { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 12px; color: #fff; background: #14212B; }
.w3d-viewer-kopf b { flex: 1; min-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.w3d-viewer-inhalt { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; background: #2a3238; }
.w3d-viewer-inhalt iframe { width: 100%; height: 100%; border: 0; background: #fff; }
.w3d-viewer-inhalt img { max-width: 100%; max-height: 100%; object-fit: contain; }
.w3d-viewer-leer { text-align: center; color: #E8EEF2; padding: 24px; }
.w3d-rahmen:fullscreen .w3d-doku { width: min(500px, calc(100% - 24px)); }
.w3d-rahmen:fullscreen .w3d-doku-inhalt { font-size: 16px; }
@media (max-width: 700px) { .w3d-doku { top: auto; left: 8px; right: 8px; width: auto; bottom: 66px; max-height: 72%; } .w3d-viewer { inset: 0; border-radius: 0; } }
@media (prefers-reduced-motion: reduce) { .w3d-doku, .w3d-viewer { animation: none; } }
.w3d-live { display: block; margin-top: 2px; font-size: 11px; font-weight: 500; opacity: .95; }
.w3d-live::before { content: ""; display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; background: #4F83AA; vertical-align: 1px; }
.w3d-live.lauf::before { background: #4FC3B1; box-shadow: 0 0 0 0 rgba(79,195,177,.7); animation: w3d-puls 1.6s infinite; }
.w3d-live.stopp::before, .w3d-live.keine::before { background: #A6AFB8; }
.w3d-live.stoerung::before, .w3d-live.fehler::before { background: #F07A6A; }
.w3d-live.veraltet::before { background: #F0AA2E; }
@keyframes w3d-puls { 70% { box-shadow: 0 0 0 6px rgba(79,195,177,0); } 100% { box-shadow: 0 0 0 0 rgba(79,195,177,0); } }
@media (prefers-reduced-motion: reduce) { .w3d-live.lauf::before { animation: none; } }
.live-werte { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; }
.live-werte span { display: block; font-size: 12px; opacity: .65; }
.live-werte b { font-size: 20px; }
.live-werte small { font-size: 12px; font-weight: 400; opacity: .7; }
.w-karte { padding: 10px 12px; border-radius: 8px; background: rgba(127,127,127,.07); }
.w3d-rahmen:fullscreen { background: #0f1418; }
.w3d-rahmen:fullscreen .w3d { height: 100vh; min-height: 0; }
.w3d-ecke { position: absolute; top: 12px; right: 12px; }
.w3d-tour { position: absolute; inset: 0; pointer-events: none; }
.w3d-tour-karte { position: absolute; left: 20px; bottom: 28px; width: min(460px, calc(100% - 40px)); padding: 18px 20px; border-radius: 12px;
  background: rgba(14,24,32,.84); color: #E8EEF2; backdrop-filter: blur(6px); box-shadow: 0 12px 32px rgba(0,0,0,.35); animation: w3d-ein .5s ease; }
.w3d-tour-karte h2 { margin: 2px 0 6px; color: #fff; font-size: clamp(20px, 2vw, 32px); line-height: 1.15; }
.w3d-tour-karte p { margin: 0 0 14px; color: rgba(232,238,242,.82); font-size: 14px; line-height: 1.5; }
.w3d-tour-schritt { font-size: 12px; color: rgba(232,238,242,.6); }
.w3d-tour-werte { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 18px; }
.w3d-tour-werte span { display: block; font-size: 12px; color: rgba(232,238,242,.6); }
.w3d-tour-werte b { display: block; font-size: 19px; color: #fff; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.w3d-tour-steuerung { position: absolute; right: 16px; bottom: 28px; display: flex; gap: 8px; padding: 8px; border-radius: 999px;
  background: rgba(14,24,32,.72); pointer-events: auto; }
.w3d-tour-fortschritt { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: rgba(255,255,255,.12); }
.w3d-tour-fortschritt div { height: 100%; width: 0; background: #E39A2D; animation-name: m-lauf; animation-timing-function: linear; animation-fill-mode: forwards; }
.w3d-rahmen:fullscreen .w3d-tour-karte { left: 32px; bottom: 40px; width: min(560px, calc(100% - 64px)); padding: 24px 28px; }
.w3d-rahmen:fullscreen .w3d-tour-karte p { font-size: 17px; }
.w3d-rahmen:fullscreen .w3d-tour-werte b { font-size: 26px; }
@keyframes w3d-ein { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .w3d-tour-karte { animation: none; } }
@media (max-width: 700px) { .w3d-tour-steuerung { top: 12px; bottom: auto; right: 60px; } .w3d-tour-karte { left: 10px; bottom: 14px; width: calc(100% - 20px); padding: 12px 14px; }
  .w3d-tour-karte p { display: none; } }
.fragen-themen { overflow-x: auto; padding-bottom: 2px; }
.fragen-raster { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
.frage-knopf { all: unset; box-sizing: border-box; display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; padding: 12px 14px;
  border-radius: 10px; border: 1px solid rgba(127,127,127,.22); cursor: pointer; font-size: 14px; line-height: 1.45; transition: border-color .15s, background .15s; }
.frage-knopf:hover { border-color: #4F83AA; background: rgba(79,131,170,.07); }
.frage-knopf:focus-visible { outline: 2px solid #4F83AA; outline-offset: 2px; }
.frage-knopf .anticon { opacity: .4; margin-top: 4px; flex-shrink: 0; }
.frage-knopf:hover .anticon { opacity: 1; color: #4F83AA; }
.mini-balken { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: rgba(127,127,127,.15); }
`;

const startDunkel = () => {
  try { const g = localStorage.getItem("mrs-design"); if (g) return g === "dunkel"; } catch { /* sans stockage */ }
  return matchMedia("(prefers-color-scheme: dark)").matches;
};

function Root() {
  const [dunkel, setDunkel] = useState(startDunkel);
  useEffect(() => {
    try { localStorage.setItem("mrs-design", dunkel ? "dunkel" : "hell"); } catch { /* sans stockage */ }
    document.body.style.background = dunkel ? "#0F1418" : "#F2F4F6";
  }, [dunkel]);

  const primaer = dunkel ? "#4F83AA" : "#2B5874";
  return (
    <ConfigProvider
      locale={deDE}
      theme={{
        algorithm: dunkel ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: primaer, colorInfo: primaer, colorWarning: "#E39A2D", colorSuccess: "#2F9E8F", borderRadius: 8,
          fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, sans-serif",
          colorBgLayout: dunkel ? "#0F1418" : "#F2F4F6"
        },
        components: {
          Layout: { siderBg: "#14212B", triggerBg: "#1B2C38", headerBg: dunkel ? "#151C22" : "#FFFFFF", headerPadding: "0 24px" },
          Menu: { darkItemBg: "#14212B", darkSubMenuItemBg: "#14212B", darkItemSelectedBg: "#2B5874" },
          Card: { headerFontSize: 15 },
          Statistic: { contentFontSize: 28 }
        }
      }}
    >
      <style>{CSS}</style>
      <AntApp><Zugang dunkel={dunkel} setDunkel={setDunkel} /></AntApp>
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<React.StrictMode><Root /></React.StrictMode>);