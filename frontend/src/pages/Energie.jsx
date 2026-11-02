import { useEffect, useMemo, useState } from "react";
import { Stack, Title, Text, SimpleGrid, Paper, Group, ColorSwatch, Chip, Table, Alert, Skeleton, Grid, Badge } from "@mantine/core";
import { BarChart, LineChart } from "@mantine/charts";
import { IconBolt, IconGauge, IconFlame, IconClock, IconCircleCheck, IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import StatCard from "../components/StatCard.jsx";
import { api } from "../api.js";
import { zahl, kurz, prozent, MONATE } from "../format.js";

const ANLAGEN = [
  { id: "P1", name: "Presse I",         color: "var(--q-p1)",  verbrauch: "P1_Verbrauch", menge: "P1_Verarbeitung", wert: "P1_Wert" },
  { id: "P2", name: "Presse II",        color: "var(--q-p2)",  verbrauch: "P2_Verbrauch", menge: "P2_Verarbeitung", wert: "P2_Wert" },
  { id: "UB", name: "UBC-Aufbereitung", color: "var(--q-ubc)", verbrauch: "UB_Verbrauch", menge: "UB_Verarbeitung", wert: "UB_Wert" },
  { id: "ME", name: "ME",               color: "var(--q-me)",  verbrauch: "ME_Verbrauch", menge: null,              wert: "ME_Wert" }
];
const sum = (rows, k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
const dez = (v, n = 2) => v === null || v === undefined || Number.isNaN(v) ? "–" : Number(v).toLocaleString("de-DE", { maximumFractionDigits: n });
const name = (r) => r.Monatname || MONATE[r.Monat - 1];

// Prüft, ob *_Wert = *_Verbrauch / *_Verarbeitung (evtl. mit Faktor, z. B. 1000)
function pruefeWerte(rows) {
  return ANLAGEN.filter(a => a.menge).map(a => {
    const faktoren = rows
      .filter(r => r[a.menge] && r[a.verbrauch] && r[a.wert])
      .map(r => r[a.wert] / (r[a.verbrauch] / r[a.menge]));
    if (!faktoren.length) return { anlage: a.name, status: "leer" };
    const mittel = faktoren.reduce((s, f) => s + f, 0) / faktoren.length;
    const stabil = faktoren.every(f => Math.abs(f / mittel - 1) < 0.01);
    return { anlage: a.name, status: stabil ? "ok" : "abweichend", faktor: mittel };
  });
}

export default function Energie({ jahr }) {
  const [daten, setDaten] = useState(null);
  const [fehler, setFehler] = useState("");
  const [sichtbar, setSichtbar] = useState(["P1", "P2", "UB"]);

  useEffect(() => {
    if (!jahr) return;
    setDaten(null); setFehler("");
    api(`/api/energie?jahr=${jahr}`).then(setDaten).catch(e => setFehler(e.message));
  }, [jahr]);

  const k = useMemo(() => {
    if (!daten?.aktuell.length) return null;
    const rows = daten.aktuell;
    const proAnlage = ANLAGEN.map(a => ({ ...a, summe: sum(rows, a.verbrauch) }));
    const gesamt = proAnlage.reduce((s, a) => s + a.summe, 0);
    const menge = sum(rows, "Gesamtmenge");
    const groesster = [...proAnlage].sort((a, b) => b.summe - a.summe)[0];
    return { rows, proAnlage, gesamt, menge, groesster, stunden: sum(rows, "ME_Stunden"), pruefung: pruefeWerte(rows) };
  }, [daten]);

  if (fehler) return <Alert color="red" icon={<IconAlertTriangle size={20} />} title="Energiedaten konnten nicht geladen werden">{fehler}</Alert>;
  if (!daten) return <Stack><Skeleton h={40} w={300} /><SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }}>{[1, 2, 3, 4].map(i => <Skeleton key={i} h={110} />)}</SimpleGrid><Skeleton h={380} /></Stack>;
  if (!k) return (
    <Stack>
      <Title order={2}>Energie (SEU) {jahr}</Title>
      <Alert color="gray" icon={<IconInfoCircle size={20} />}>In der Tabelle SEUWerte gibt es keine Daten für {jahr}. Wählen Sie oben ein anderes Jahr.</Alert>
    </Stack>
  );

  const zeitraum = k.rows.length === 12 ? `Jahr ${jahr}` : `${name(k.rows[0])} – ${name(k.rows.at(-1))} ${jahr}`;
  const verbrauchDaten = k.rows.map(r => ({ monat: name(r).slice(0, 3), ...Object.fromEntries(ANLAGEN.map(a => [a.id, r[a.verbrauch]])) }));
  const wertDaten = k.rows.map(r => ({ monat: name(r).slice(0, 3), ...Object.fromEntries(ANLAGEN.map(a => [a.id, r[a.wert]])) }));

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Energie (SEU) {zeitraum}</Title>
        <Text c="dimmed">Wesentliche Energieeinsätze nach ISO 50001, Werte aus der Tabelle SEUWerte</Text>
      </div>

      <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }}>
        <StatCard titel="Energieverbrauch gesamt" wert={zahl(k.gesamt)} zusatz="Summe aller vier Anlagen" icon={IconBolt} />
        <StatCard titel="Verbrauch je Gesamtmenge" wert={dez(k.menge ? k.gesamt / k.menge : null)}
                  zusatz={`bei ${zahl(k.menge)} verarbeiteter Menge`} icon={IconGauge} />
        <StatCard titel="Größter Verbraucher" wert={k.groesster.name}
                  zusatz={`${prozent(k.groesster.summe / k.gesamt)} des Verbrauchs`} icon={IconFlame} farbe="bernstein" />
        <StatCard titel="Betriebsstunden ME" wert={zahl(k.stunden)}
                  zusatz={k.stunden ? `${dez(sum(k.rows, "ME_Verbrauch") / k.stunden)} Verbrauch je Stunde` : "keine Stunden erfasst"}
                  icon={IconClock} farbe="gray" />
      </SimpleGrid>

      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" mb="md" wrap="wrap">
          <div>
            <Title order={4}>Energieverbrauch pro Monat</Title>
            <Text size="sm" c="dimmed">Gestapelt nach Anlage</Text>
          </div>
          <Group gap="lg">
            {ANLAGEN.map(a => <Group key={a.id} gap={6}><ColorSwatch size={12} color={a.color} withShadow={false} /><Text size="sm">{a.name}</Text></Group>)}
          </Group>
        </Group>
        <BarChart h={320} data={verbrauchDaten} dataKey="monat" type="stacked"
          series={ANLAGEN.map(a => ({ name: a.id, label: a.name, color: a.color }))}
          valueFormatter={zahl} yAxisProps={{ tickFormatter: kurz, width: 80 }} gridAxis="x" tickLine="none" barProps={{ radius: 2 }} />
      </Paper>

      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Paper withBorder p="lg" radius="md" h="100%">
            <Group justify="space-between" mb="md" wrap="wrap" align="flex-start">
              <div>
                <Title order={4}>Spezifischer Verbrauch</Title>
                <Text size="sm" c="dimmed">Verbrauch je verarbeiteter Menge (Spalten *_Wert)</Text>
              </div>
              <Chip.Group multiple value={sichtbar} onChange={v => v.length && setSichtbar(v)}>
                <Group gap={6}>{ANLAGEN.map(a => <Chip key={a.id} value={a.id} size="xs">{a.name}</Chip>)}</Group>
              </Chip.Group>
            </Group>
            <LineChart h={260} data={wertDaten} dataKey="monat" curveType="monotone"
              series={ANLAGEN.filter(a => sichtbar.includes(a.id)).map(a => ({ name: a.id, label: a.name, color: a.color }))}
              valueFormatter={v => dez(v, 3)} yAxisProps={{ width: 70 }} gridAxis="x" tickLine="none" connectNulls />
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 5 }}>
          <Paper withBorder p="lg" radius="md" h="100%">
            <Title order={4}>Prüfung der Kennzahlen</Title>
            <Text size="sm" c="dimmed" mb="md">Stimmt *_Wert mit Verbrauch geteilt durch Verarbeitung überein?</Text>
            <Stack gap="xs">
              {k.pruefung.map(p => (
                <Alert key={p.anlage} variant="light" p="sm"
                  color={p.status === "ok" ? "teal" : p.status === "leer" ? "gray" : "bernstein"}
                  icon={p.status === "ok" ? <IconCircleCheck size={18} /> : <IconAlertTriangle size={18} />}>
                  <b>{p.anlage}:</b>{" "}
                  {p.status === "leer" ? "keine vollständigen Werte."
                    : p.status === "ok"
                      ? (Math.abs(p.faktor - 1) < 0.01 ? "Wert = Verbrauch ÷ Verarbeitung, bestätigt."
                         : `Wert = Verbrauch ÷ Verarbeitung × ${dez(p.faktor, 2)}, bestätigt.`)
                      : "der Wert passt nicht immer zu Verbrauch ÷ Verarbeitung. Berechnung mit der Fachabteilung klären."}
                </Alert>
              ))}
              <Alert variant="light" color="gray" p="sm" icon={<IconInfoCircle size={18} />}>
                Einheiten sind in der Datenbank nicht hinterlegt (vermutlich kWh und Tonnen). „ME“ bitte mit der Fachabteilung benennen.
              </Alert>
            </Stack>
          </Paper>
        </Grid.Col>
      </Grid>

      <Paper withBorder radius="md">
        <Table.ScrollContainer minWidth={980}>
          <Table striped highlightOnHover verticalSpacing="sm" className="zahl" fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Monat</Table.Th>
                {ANLAGEN.map(a => <Table.Th key={a.id} ta="right">Verbrauch {a.name}</Table.Th>)}
                <Table.Th ta="right">Gesamtmenge</Table.Th>
                <Table.Th ta="right">ME Stunden</Table.Th>
                {ANLAGEN.map(a => <Table.Th key={a.id + "w"} ta="right">Wert {a.id}</Table.Th>)}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {k.rows.map(r => (
                <Table.Tr key={r.Monat}>
                  <Table.Td>{name(r)}</Table.Td>
                  {ANLAGEN.map(a => <Table.Td key={a.id} ta="right">{zahl(r[a.verbrauch])}</Table.Td>)}
                  <Table.Td ta="right">{zahl(r.Gesamtmenge)}</Table.Td>
                  <Table.Td ta="right">{zahl(r.ME_Stunden)}</Table.Td>
                  {ANLAGEN.map(a => <Table.Td key={a.id + "w"} ta="right">{dez(r[a.wert], 3)}</Table.Td>)}
                </Table.Tr>
              ))}
            </Table.Tbody>
            <Table.Tfoot>
              <Table.Tr fw={700}>
                <Table.Td>Summe</Table.Td>
                {k.proAnlage.map(a => <Table.Td key={a.id} ta="right">{zahl(a.summe)}</Table.Td>)}
                <Table.Td ta="right">{zahl(k.menge)}</Table.Td>
                <Table.Td ta="right">{zahl(k.stunden)}</Table.Td>
                <Table.Td colSpan={4} />
              </Table.Tr>
            </Table.Tfoot>
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </Stack>
  );
}
