export const MONATE = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
export const zahl = (v) => (v === null || v === undefined || Number.isNaN(v)) ? "–" : Math.round(v).toLocaleString("de-DE");
export const kurz = (v) => {
  if (v === null || v === undefined) return "–";
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " Mio.";
  if (a >= 1e3) return (v / 1e3).toLocaleString("de-DE", { maximumFractionDigits: 0 }) + " Tsd.";
  return zahl(v);
};
export const prozent = (v) => (v * 100).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %";
export const monatName = (r) => r.Monatname || MONATE[r.Monat - 1];
export const summe = (rows, k) => rows.reduce((s, r) => s + (r[k] || 0), 0);

export const QUELLEN = [
  { key: "presse1", name: "Presse I",         color: "var(--q-p1)" },
  { key: "presse2", name: "Presse II",        color: "var(--q-p2)" },
  { key: "ubc",     name: "UBC-Aufbereitung", color: "var(--q-ubc)" }
];
