import { SimpleGrid, Paper, Title, Text, Group, Grid, Stack, ColorSwatch, Skeleton } from "@mantine/core";
import { BarChart, DonutChart, LineChart } from "@mantine/charts";
import { IconStack2, IconCalendarStats, IconTrendingUp, IconArrowUpRight, IconArrowDownRight, IconMinus } from "@tabler/icons-react";
import StatCard from "../components/StatCard.jsx";
import { zahl, kurz, prozent, monatName, MONATE, QUELLEN, summe } from "../format.js";

export default function Uebersicht({ k, laedt }) {
  if (laedt || !k) return <Ladeansicht />;
  if (!k.aktuell.length) return <Text c="dimmed">Für {k?.jahr} liegen keine Daten vor.</Text>;

  const monatsDaten = k.aktuell.map(r => ({ monat: monatName(r).slice(0, 3), presse1: r.presse1, presse2: r.presse2, ubc: r.ubc }));
  const vergleich = MONATE.map((m, i) => ({
    monat: m.slice(0, 3),
    [k.jahr]: k.aktuell.find(r => r.Monat === i + 1)?.gesamt ?? null,
    [k.jahr - 1]: k.vorjahr.find(r => r.Monat === i + 1)?.gesamt ?? null
  }));
  const anteile = QUELLEN.map(q => ({ name: q.name, value: summe(k.aktuell, q.key), color: q.color }));

  const v = k.veraenderung;
  const vIcon = v === null ? IconMinus : v >= 0 ? IconArrowUpRight : IconArrowDownRight;

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Produktion {k.zeitraum}</Title>
        <Text c="dimmed">Verarbeitete Menge nach Quelle, Werte aus der Tabelle ProduktionMonat</Text>
      </div>

      <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }}>
        <StatCard titel="Gesamtmenge" wert={zahl(k.gesamt)} zusatz={`${k.mitDaten.length} Monate mit Daten`} icon={IconStack2} />
        <StatCard titel="Durchschnitt pro Monat" wert={zahl(k.schnitt)} zusatz={`Gesamt geteilt durch ${k.mitDaten.length}`} icon={IconCalendarStats} />
        <StatCard titel="Stärkster Monat" wert={zahl(k.best.gesamt)} zusatz={`${monatName(k.best)}, schwächster: ${monatName(k.schwach)}`}
                  icon={IconTrendingUp} farbe="bernstein" />
        <StatCard titel="Veränderung zum Vorjahr"
                  wert={v === null ? "–" : `${v >= 0 ? "+" : "−"}${prozent(Math.abs(v))}`}
                  zusatz={v === null ? `Keine vollständigen Daten für ${k.jahr - 1}` : `gegenüber ${zahl(k.gesamtVj)} im gleichen Zeitraum`}
                  icon={vIcon} farbe={v === null ? "gray" : v >= 0 ? "teal" : "red"} />
      </SimpleGrid>

      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" mb="md" wrap="wrap">
          <div>
            <Title order={4}>Menge pro Monat</Title>
            <Text size="sm" c="dimmed">Gestapelt nach Presse I, Presse II und UBC-Aufbereitung</Text>
          </div>
          <Group gap="lg">
            {QUELLEN.map(q => (
              <Group key={q.key} gap={6}>
                <ColorSwatch size={12} color={q.color} withShadow={false} />
                <Text size="sm">{q.name}</Text>
              </Group>
            ))}
          </Group>
        </Group>
        <BarChart
          h={340}
          data={monatsDaten}
          dataKey="monat"
          type="stacked"
          series={QUELLEN.map(q => ({ name: q.key, label: q.name, color: q.color }))}
          valueFormatter={zahl}
          yAxisProps={{ tickFormatter: kurz, width: 80 }}
          gridAxis="x"
          tickLine="none"
          barProps={{ radius: 2 }}
        />
      </Paper>

      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Paper withBorder p="lg" radius="md" h="100%">
            <Title order={4}>Anteile der Quellen</Title>
            <Text size="sm" c="dimmed" mb="md">{k.zeitraum}</Text>
            <Group justify="center" wrap="nowrap" gap="xl">
              <DonutChart data={anteile} size={170} thickness={26} valueFormatter={zahl}
                          chartLabel={kurz(k.gesamt)} tooltipDataSource="segment" />
              <Stack gap="sm">
                {anteile.map(a => (
                  <div key={a.name}>
                    <Group gap={6}>
                      <ColorSwatch size={10} color={a.color} withShadow={false} />
                      <Text size="sm" c="dimmed">{a.name}</Text>
                    </Group>
                    <Text fw={700} fz="lg" className="zahl">{prozent(a.value / k.gesamt)}</Text>
                  </div>
                ))}
              </Stack>
            </Group>
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Paper withBorder p="lg" radius="md" h="100%">
            <Title order={4}>Gesamtmenge {k.jahr} und {k.jahr - 1}</Title>
            <Text size="sm" c="dimmed" mb="md">Monat für Monat im Vergleich</Text>
            <LineChart
              h={220}
              data={vergleich}
              dataKey="monat"
              series={[
                { name: String(k.jahr), color: "var(--q-linie)" },
                { name: String(k.jahr - 1), color: "gray.5", strokeDasharray: "5 5" }
              ]}
              withLegend
              legendProps={{ verticalAlign: "bottom" }}
              valueFormatter={zahl}
              yAxisProps={{ tickFormatter: kurz, width: 80 }}
              curveType="monotone"
              gridAxis="x"
              tickLine="none"
            />
          </Paper>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

function Ladeansicht() {
  return (
    <Stack gap="lg">
      <Skeleton h={40} w={320} />
      <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }}>{[1, 2, 3, 4].map(i => <Skeleton key={i} h={110} />)}</SimpleGrid>
      <Skeleton h={420} />
    </Stack>
  );
}
