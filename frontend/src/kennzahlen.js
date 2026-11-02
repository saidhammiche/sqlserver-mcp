import { MONATE, summe, monatName } from "./format.js";

// Alle Kennzahlen eines Jahres an einer Stelle berechnet
export function berechne(daten) {
  if (!daten) return null;
  const { jahr, aktuell, vorjahr } = daten;
  const mitDaten = aktuell.filter(r => r.gesamt);
  const gesamt = summe(aktuell, "gesamt");
  const p1 = summe(aktuell, "presse1"), p2 = summe(aktuell, "presse2"), ubc = summe(aktuell, "ubc");

  const best    = mitDaten.reduce((a, b) => (!a || b.gesamt > a.gesamt ? b : a), null);
  const schwach = mitDaten.reduce((a, b) => (!a || b.gesamt < a.gesamt ? b : a), null);

  const monate = new Set(aktuell.map(r => r.Monat));
  const vjGleich = vorjahr.filter(r => monate.has(r.Monat));
  const vergleichbar = aktuell.length > 0 && vjGleich.length === aktuell.length;
  const gesamtVj = summe(vjGleich, "gesamt");
  const veraenderung = vergleichbar && gesamtVj ? (gesamt - gesamtVj) / gesamtVj : null;

  const zeitraum = aktuell.length === 12 ? `Jahr ${jahr}`
    : aktuell.length ? `${monatName(aktuell[0])} – ${monatName(aktuell.at(-1))} ${jahr}` : String(jahr);

  return {
    jahr, aktuell, vorjahr, mitDaten, gesamt, p1, p2, ubc, best, schwach,
    schnitt: mitDaten.length ? gesamt / mitDaten.length : null,
    veraenderung, gesamtVj, vjGleich, zeitraum
  };
}

// Hinweise zur Datenqualität
export function pruefe(k) {
  if (!k || !k.aktuell.length) return [];
  const h = [];
  if (k.aktuell.every(r => !r.Arbeitstage)) {
    h.push({ stufe: "warnung", titel: "Arbeitstage nicht gepflegt",
      text: "Die Spalte Arbeitstage ist leer oder 0. Werte pro Arbeitstag lassen sich nicht berechnen." });
  }
  if (k.aktuell.every(r => !r.abschaum)) {
    h.push({ stufe: "warnung", titel: "Keine Abschaum-Bewegungen erfasst",
      text: `Für ${k.jahr} steht bei allen Monaten 0. Entweder wird nicht mehr erfasst oder der Prozess hat sich geändert.` });
  }
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
