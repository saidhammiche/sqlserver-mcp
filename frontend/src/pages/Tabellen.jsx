import { useEffect, useMemo, useState } from "react";
import { Grid, Paper, Stack, Title, Text, TextInput, ScrollArea, UnstyledButton, Group, Badge, Tabs, Table, Button,
         Skeleton, Alert, Code, Center } from "@mantine/core";
import { IconSearch, IconDatabase, IconTable, IconColumns, IconDownload, IconEye, IconAlertTriangle } from "@tabler/icons-react";
import { api } from "../api.js";
import { kurz } from "../format.js";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

// Werte lesbar anzeigen (IDs und Jahre ohne Tausenderpunkt)
function wert(v, spalte) {
  if (v === null || v === undefined) return <Text span c="dimmed">–</Text>;
  if (typeof v === "boolean") return v ? "Ja" : "Nein";
  if (typeof v === "number") {
    if (/id$|^id|jahr|monat|nr$|nummer/i.test(spalte)) return String(v);
    return v.toLocaleString("de-DE", { maximumFractionDigits: 4 });
  }
  if (typeof v === "string" && ISO.test(v)) {
    const d = new Date(v);
    return /T00:00:00/.test(v) ? d.toLocaleDateString("de-DE") : d.toLocaleString("de-DE");
  }
  return String(v);
}

export default function Tabellen() {
  const [liste, setListe] = useState(null);
  const [suche, setSuche] = useState("");
  const [gewaehlt, setGewaehlt] = useState(null);
  const [daten, setDaten] = useState(null);
  const [laedt, setLaedt] = useState(false);
  const [filter, setFilter] = useState("");
  const [fehler, setFehler] = useState("");

  useEffect(() => {
    api("/api/tabellen").then(setListe).catch(e => setFehler(e.message));
  }, []);

  useEffect(() => {
    if (!gewaehlt) return;
    setLaedt(true); setDaten(null); setFilter(""); setFehler("");
    api(`/api/tabellen/${encodeURIComponent(gewaehlt)}`)
      .then(setDaten)
      .catch(e => setFehler(e.message))
      .finally(() => setLaedt(false));
  }, [gewaehlt]);

  const gefiltert = useMemo(() => (liste || []).filter(t =>
    `${t.schema}.${t.tabelle}`.toLowerCase().includes(suche.toLowerCase())), [liste, suche]);

  const spalten = daten?.spalten.map(s => s.spalte) || [];
  const zeilen = useMemo(() => {
    if (!daten) return [];
    if (!filter) return daten.zeilen;
    const f = filter.toLowerCase();
    return daten.zeilen.filter(z => Object.values(z).some(v => String(v ?? "").toLowerCase().includes(f)));
  }, [daten, filter]);

  function exportCsv() {
    const esc = (v) => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [spalten.map(esc).join(";"), ...zeilen.map(z => spalten.map(s => esc(z[s])).join(";"))].join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    Object.assign(document.createElement("a"), { href: url, download: `${gewaehlt}.csv` }).click();
    URL.revokeObjectURL(url);
  }

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Tabellen</Title>
        <Text c="dimmed">Alle Tabellen der Datenbank MRS_BI. Nur Lesen, nichts kann verändert werden.</Text>
      </div>

      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 4, lg: 3 }}>
          <Paper withBorder radius="md" p="sm">
            <TextInput placeholder="Tabelle suchen" leftSection={<IconSearch size={16} />} value={suche}
                       onChange={e => setSuche(e.currentTarget.value)} mb="sm" aria-label="Tabelle suchen" />
            <Text size="xs" c="dimmed" mb={6} px={4}>{liste ? `${gefiltert.length} von ${liste.length} Tabellen` : "Wird geladen"}</Text>
            <ScrollArea.Autosize mah="calc(100dvh - 300px)">
              {!liste && !fehler && <Stack gap={6}>{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} h={34} />)}</Stack>}
              {gefiltert.map(t => {
                const id = `${t.schema}.${t.tabelle}`;
                const aktiv = id === gewaehlt;
                return (
                  <UnstyledButton key={id} onClick={() => setGewaehlt(id)} w="100%" p="xs" mb={2}
                    style={{ borderRadius: "var(--mantine-radius-sm)", background: aktiv ? "var(--mantine-primary-color-light)" : undefined }}>
                    <Group justify="space-between" wrap="nowrap" gap="xs">
                      <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                        {t.typ === "VIEW" ? <IconEye size={16} style={{ flexShrink: 0 }} /> : <IconTable size={16} style={{ flexShrink: 0 }} />}
                        <Text size="sm" fw={aktiv ? 600 : 400} truncate>{t.tabelle}</Text>
                      </Group>
                      {t.zeilen_ca != null && <Badge size="sm" variant="light" color="gray" tt="none">{kurz(Number(t.zeilen_ca))}</Badge>}
                    </Group>
                  </UnstyledButton>
                );
              })}
            </ScrollArea.Autosize>
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 8, lg: 9 }}>
          {fehler && <Alert color="red" icon={<IconAlertTriangle size={20} />} mb="md">{fehler}</Alert>}

          {!gewaehlt && !fehler && (
            <Paper withBorder radius="md" p="xl">
              <Center><Stack align="center" gap="xs">
                <IconDatabase size={40} stroke={1.3} color="var(--mantine-color-dimmed)" />
                <Text fw={600}>Tabelle auswählen</Text>
                <Text c="dimmed" size="sm" ta="center">Links eine Tabelle anklicken, um Spalten und Daten zu sehen.</Text>
              </Stack></Center>
            </Paper>
          )}

          {laedt && <Stack><Skeleton h={50} /><Skeleton h={400} /></Stack>}

          {daten && (
            <Paper withBorder radius="md" p="md">
              <Group justify="space-between" mb="md" wrap="wrap">
                <div>
                  <Title order={4}>{daten.tabelle}</Title>
                  <Group gap="xs" mt={4}>
                    <Badge variant="light" tt="none">{daten.zeilen_gesamt.toLocaleString("de-DE")} Zeilen</Badge>
                    <Badge variant="light" color="gray" tt="none">{daten.spalten.length} Spalten</Badge>
                  </Group>
                </div>
                <Button variant="light" leftSection={<IconDownload size={18} />} onClick={exportCsv} disabled={!zeilen.length}>
                  Angezeigte Zeilen als CSV
                </Button>
              </Group>

              <Tabs defaultValue="daten" keepMounted={false}>
                <Tabs.List mb="md">
                  <Tabs.Tab value="daten" leftSection={<IconTable size={16} />}>Daten</Tabs.Tab>
                  <Tabs.Tab value="spalten" leftSection={<IconColumns size={16} />}>Spalten</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="daten">
                  <Group justify="space-between" mb="sm" wrap="wrap">
                    <TextInput placeholder="In den Daten suchen" leftSection={<IconSearch size={16} />} value={filter}
                               onChange={e => setFilter(e.currentTarget.value)} w={280} aria-label="In den Daten suchen" />
                    <Text size="sm" c="dimmed">
                      {zeilen.length} von {daten.zeilen.length} angezeigt
                      {daten.zeilen_gesamt > daten.zeilen.length && ` (neueste ${daten.zeilen.length} von ${daten.zeilen_gesamt.toLocaleString("de-DE")})`}
                    </Text>
                  </Group>
                  <Table.ScrollContainer minWidth={Math.max(600, spalten.length * 130)} maxHeight="calc(100dvh - 420px)">
                    <Table striped highlightOnHover stickyHeader withTableBorder fz="sm" className="zahl">
                      <Table.Thead>
                        <Table.Tr>{spalten.map(s => <Table.Th key={s} style={{ whiteSpace: "nowrap" }}>{s}</Table.Th>)}</Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {zeilen.map((z, i) => (
                          <Table.Tr key={i}>
                            {spalten.map(s => (
                              <Table.Td key={s} ta={typeof z[s] === "number" ? "right" : "left"} style={{ whiteSpace: "nowrap" }}>
                                {wert(z[s], s)}
                              </Table.Td>
                            ))}
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                  {!zeilen.length && <Text c="dimmed" ta="center" py="lg">Keine Zeilen gefunden.</Text>}
                </Tabs.Panel>

                <Tabs.Panel value="spalten">
                  <Table striped withTableBorder fz="sm">
                    <Table.Thead>
                      <Table.Tr><Table.Th>Spalte</Table.Th><Table.Th>Typ</Table.Th><Table.Th>Leer erlaubt</Table.Th></Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {daten.spalten.map(s => (
                        <Table.Tr key={s.spalte}>
                          <Table.Td fw={500}>{s.spalte}</Table.Td>
                          <Table.Td><Code>{s.typ}{s.laenge ? `(${s.laenge === -1 ? "max" : s.laenge})` : ""}</Code></Table.Td>
                          <Table.Td>{s.nullable === "YES" ? "Ja" : "Nein"}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Tabs.Panel>
              </Tabs>
            </Paper>
          )}
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
