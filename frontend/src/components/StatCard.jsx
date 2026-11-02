import { Paper, Group, Text, ThemeIcon } from "@mantine/core";

export default function StatCard({ titel, wert, zusatz, icon: Icon, farbe = "stahl", zusatzFarbe = "dimmed" }) {
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div>
          <Text size="sm" c="dimmed">{titel}</Text>
          <Text fw={700} fz={28} lh={1.2} mt={4} className="zahl">{wert}</Text>
        </div>
        <ThemeIcon variant="light" color={farbe} size={42} radius="md">
          <Icon size={24} stroke={1.6} />
        </ThemeIcon>
      </Group>
      {zusatz && <Text size="sm" c={zusatzFarbe} mt={6}>{zusatz}</Text>}
    </Paper>
  );
}
