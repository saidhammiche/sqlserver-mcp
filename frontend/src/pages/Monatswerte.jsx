import { Paper, Table, Title, Text, Group, Button, Stack, Badge, Progress, Tooltip } from "@mantine/core";
import { IconDownload } from "@tabler/icons-react";
import { zahl, monatName, prozent } from "../format.js";

export default function Monatswerte({ k }) {
  if (!k) return null;
  const max = Math.max(...k.aktuell.map(r => r.gesamt || 0), 1);

  function exportCsv() {
    const kopf = ["Monat", "Presse I", "Presse II", "UBC-Aufbereitung", "Gesamt", "Abschaum-Bewegungen"];
    const zeilen = k.aktuell.map(r => [monatName(r), r.presse1, r.presse2, r.ubc, r.gesamt, r.abschaum]);
    const csv = [kopf, ...zeilen].map(z => z.join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `Produktion_${k.jahr}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Title order={2}>Monatswerte {k.jahr}</Title>
          <Text c="dimmed">Alle Werte der Tabelle ProduktionMonat für das gewählte Jahr</Text>
        </div>
        <Button leftSection={<IconDownload size={18} />} variant="light" onClick={exportCsv} disabled={!k.aktuell.length}>
          Als CSV exportieren
        </Button>
      </Group>

      <Paper withBorder radius="md">
        <Table.ScrollContainer minWidth={760}>
          <Table striped highlightOnHover verticalSpacing="sm" horizontalSpacing="md" className="zahl">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Monat</Table.Th>
                <Table.Th ta="right">Presse I</Table.Th>
                <Table.Th ta="right">Presse II</Table.Th>
                <Table.Th ta="right">UBC-Aufbereitung</Table.Th>
                <Table.Th ta="right">Gesamt</Table.Th>
                <Table.Th w={160}>Im Verhältnis</Table.Th>
                <Table.Th ta="right">Abschaum-Bew.</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {k.aktuell.map(r => (
                <Table.Tr key={r.Monat}>
                  <Table.Td>
                    <Group gap="xs">
                      {monatName(r)}
                      {r === k.best && <Badge size="xs" color="bernstein" variant="light" tt="none">stärkster</Badge>}
                      {r === k.schwach && <Badge size="xs" color="gray" variant="light" tt="none">schwächster</Badge>}
                    </Group>
                  </Table.Td>
                  <Table.Td ta="right">{zahl(r.presse1)}</Table.Td>
                  <Table.Td ta="right">{zahl(r.presse2)}</Table.Td>
                  <Table.Td ta="right">{zahl(r.ubc)}</Table.Td>
                  <Table.Td ta="right" fw={700}>{zahl(r.gesamt)}</Table.Td>
                  <Table.Td>
                    <Tooltip label={`${prozent((r.gesamt || 0) / max)} des stärksten Monats`}>
                      <Progress.Root size="lg">
                        <Progress.Section value={((r.presse1 || 0) / max) * 100} color="var(--q-p1)" />
                        <Progress.Section value={((r.presse2 || 0) / max) * 100} color="var(--q-p2)" />
                        <Progress.Section value={((r.ubc || 0) / max) * 100} color="var(--q-ubc)" />
                      </Progress.Root>
                    </Tooltip>
                  </Table.Td>
                  <Table.Td ta="right">{zahl(r.abschaum)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
            {k.aktuell.length > 0 && (
              <Table.Tfoot>
                <Table.Tr fw={700}>
                  <Table.Td>Summe</Table.Td>
                  <Table.Td ta="right">{zahl(k.p1)}</Table.Td>
                  <Table.Td ta="right">{zahl(k.p2)}</Table.Td>
                  <Table.Td ta="right">{zahl(k.ubc)}</Table.Td>
                  <Table.Td ta="right">{zahl(k.gesamt)}</Table.Td>
                  <Table.Td />
                  <Table.Td ta="right">{zahl(k.aktuell.reduce((s, r) => s + (r.abschaum || 0), 0))}</Table.Td>
                </Table.Tr>
              </Table.Tfoot>
            )}
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </Stack>
  );
}
