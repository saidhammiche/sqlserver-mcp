// Einfache Antworten OHNE KI (wenn Claude nicht erreichbar ist)
import { MONATE, zahl, prozent, summe, monatName, QUELLEN } from "./format.js";

const diff = (neu, alt) => `${neu >= alt ? "+" : "−"}${prozent(Math.abs(neu - alt) / alt)}`;
const liste = (zeilen) => zeilen.map(z => `- ${z}`).join("\n");

function antwortMonat(k, m) {
  const r = k.aktuell.find(x => x.Monat === m);
  if (!r) return `Für ${MONATE[m - 1]} ${k.jahr} liegen keine Daten vor.`;
  const v = k.vorjahr.find(x => x.Monat === m);
  return `Im **${monatName(r)} ${k.jahr}** wurden **${zahl(r.gesamt)}** verarbeitet (${diff(r.gesamt, k.schnitt)} zum Monatsdurchschnitt).\n\n` +
    liste(QUELLEN.map(q => `${q.name}: ${zahl(r[q.key])} (${prozent((r[q.key] || 0) / r.gesamt)})`)) +
    (v?.gesamt ? `\n\nIm ${monatName(v)} ${k.jahr - 1} waren es ${zahl(v.gesamt)}: **${diff(r.gesamt, v.gesamt)}**.` : "");
}

function antwortExtrem(k, stark) {
  const r = stark ? k.best : k.schwach;
  const treiber = QUELLEN.map(q => ({ ...q, abw: (r[q.key] || 0) - summe(k.mitDaten, q.key) / k.mitDaten.length }))
    .sort((a, b) => stark ? b.abw - a.abw : a.abw - b.abw)[0];
  return `${stark ? "Stärkster" : "Schwächster"} Monat ${k.jahr}: **${monatName(r)}** mit **${zahl(r.gesamt)}** (${diff(r.gesamt, k.schnitt)} zum Durchschnitt).\n\n` +
    liste(QUELLEN.map(q => `${q.name}: ${zahl(r[q.key])}`)) +
    `\n\nDen größten Ausschlag gibt **${treiber.name}**: ${zahl(Math.abs(treiber.abw))} ${treiber.abw >= 0 ? "über" : "unter"} dem eigenen Durchschnitt.`;
}

const KURZ = ["jan", "feb", "mär|maer|mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "dez"];

export function antwortOhneKI(frage, k) {
  if (!k || !k.aktuell.length) return "Für das gewählte Jahr liegen keine Daten vor.";
  const t = frage.toLowerCase();
  const m = KURZ.findIndex(x => new RegExp(`\\b(${x})`).test(t));
  if (m >= 0) return antwortMonat(k, m + 1);
  if (/vorjahr|vergleich|letzte[sn]? jahr/.test(t)) {
    if (k.veraenderung === null) return `Für ${k.jahr - 1} fehlen Daten für denselben Zeitraum.`;
    return `${k.zeitraum}: **${zahl(k.gesamt)}**, gleicher Zeitraum ${k.jahr - 1}: ${zahl(k.gesamtVj)} → **${diff(k.gesamt, k.gesamtVj)}**.\n\n` +
      liste(QUELLEN.map(q => `${q.name}: ${zahl(summe(k.aktuell, q.key))} statt ${zahl(summe(k.vjGleich, q.key))}`));
  }
  if (/schwäch|schwach|schlecht|niedrig|wenigst/.test(t)) return antwortExtrem(k, false);
  if (/stärk|stark|best|höchst|meist|rekord/.test(t))     return antwortExtrem(k, true);
  if (/ubc|dose|aufbereitung/.test(t)) {
    return `Die UBC-Aufbereitung hat (${k.zeitraum}) **${zahl(k.ubc)}** verarbeitet, das sind **${prozent(k.ubc / k.gesamt)}** der Gesamtmenge.`;
  }
  if (/presse/.test(t)) {
    return `${k.zeitraum}: **${k.p2 > k.p1 ? "Presse II" : "Presse I"}** hat mehr verarbeitet.\n\n` +
      liste([`Presse I: ${zahl(k.p1)}`, `Presse II: ${zahl(k.p2)}`, `Unterschied: ${zahl(Math.abs(k.p1 - k.p2))}`]);
  }
  if (/anteil|verteil|aufteil|quelle/.test(t)) {
    return `Verteilung (${k.zeitraum}):\n\n` + liste(QUELLEN.map(q => `${q.name}: ${zahl(summe(k.aktuell, q.key))} (${prozent(summe(k.aktuell, q.key) / k.gesamt)})`));
  }
  if (/gesamt|summe|insgesamt|total|wie ?viel/.test(t)) {
    return `${k.zeitraum}: **${zahl(k.gesamt)}** verarbeitet, im Schnitt **${zahl(k.schnitt)}** pro Monat.`;
  }
  return "Ohne KI kann ich das nicht beantworten. Möglich sind Fragen zu Gesamtmenge, stärkstem oder schwächstem Monat, " +
         "Verteilung, Pressen, UBC-Aufbereitung, Vorjahresvergleich und einzelnen Monaten.";
}

// ---------- Energie (SEUWerte) ohne KI ----------
const ANLAGEN = [
  { id: "P1", name: "Presse I",         v: "P1_Verbrauch", w: "P1_Wert" },
  { id: "P2", name: "Presse II",        v: "P2_Verbrauch", w: "P2_Wert" },
  { id: "UB", name: "UBC-Aufbereitung", v: "UB_Verbrauch", w: "UB_Wert" },
  { id: "ME", name: "ME",               v: "ME_Verbrauch", w: "ME_Wert" }
];
const dez = (v) => Number(v).toLocaleString("de-DE", { maximumFractionDigits: 2 });

export const istEnergieFrage = (t) => /energie|verbrauch|strom|kwh|seu|iso 50001|\bme\b|betriebsstunde|stunden|spezifisch/i.test(t);

export function antwortEnergieOhneKI(frage, seu) {
  const rows = seu?.aktuell || [];
  if (!rows.length) return `In der Tabelle SEUWerte gibt es keine Daten für ${seu?.jahr ?? "das gewählte Jahr"}.`;
  const t = frage.toLowerCase();
  const s = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const proAnlage = ANLAGEN.map(a => ({ ...a, summe: s(a.v) }));
  const gesamt = proAnlage.reduce((a, b) => a + b.summe, 0);
  const jahr = seu.jahr;

  const m = KURZ.findIndex(x => new RegExp(`\\b(${x})`).test(t));
  if (m >= 0) {
    const r = rows.find(x => x.Monat === m + 1);
    if (!r) return `Für ${MONATE[m]} ${jahr} gibt es keine Energiedaten.`;
    const g = ANLAGEN.reduce((a, x) => a + (Number(r[x.v]) || 0), 0);
    return `Energieverbrauch im **${MONATE[m]} ${jahr}**: **${zahl(g)}**.\n\n` +
      liste(ANLAGEN.map(a => `${a.name}: ${zahl(r[a.v])} (spezifisch ${dez(r[a.w])})`));
  }
  if (/stunde/.test(t)) {
    const h = s("ME_Stunden");
    return `Die Anlage ME lief ${jahr} insgesamt **${zahl(h)} Stunden**` + (h ? `, mit **${dez(s("ME_Verbrauch") / h)}** Verbrauch je Stunde.` : ".");
  }
  if (/spezifisch|pro tonne|je tonne|effizien|wert/.test(t)) {
    return `Durchschnittlicher spezifischer Verbrauch ${jahr} (Spalten *_Wert):\n\n` +
      liste(ANLAGEN.map(a => `${a.name}: ${dez(s(a.w) / rows.length)}`));
  }
  const groesster = [...proAnlage].sort((a, b) => b.summe - a.summe)[0];
  return `Energieverbrauch ${jahr} (${rows.length} Monate): **${zahl(gesamt)}**. Größter Verbraucher ist **${groesster.name}** mit ${prozent(groesster.summe / gesamt)}.\n\n` +
    liste(proAnlage.map(a => `${a.name}: ${zahl(a.summe)} (${prozent(a.summe / gesamt)})`));
}
