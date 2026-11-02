import { Stack, Title, Text, Alert } from "@mantine/core";
import { IconAlertTriangle, IconCircleCheck, IconCircleX, IconInfoCircle } from "@tabler/icons-react";

const STIL = {
  ok:      { color: "teal",      icon: IconCircleCheck },
  warnung: { color: "bernstein", icon: IconAlertTriangle },
  fehler:  { color: "red",       icon: IconCircleX },
  info:    { color: "gray",      icon: IconInfoCircle }
};

export default function Datenqualitaet({ hinweise, jahr }) {
  return (
    <Stack gap="lg" maw={760}>
      <div>
        <Title order={2}>Datenqualität {jahr}</Title>
        <Text c="dimmed">Automatische Prüfung der Tabelle ProduktionMonat. Diese Punkte sollten mit der Fachabteilung geklärt werden.</Text>
      </div>
      {hinweise.map(h => {
        const { color, icon: Icon } = STIL[h.stufe];
        return (
          <Alert key={h.titel} color={color} title={h.titel} icon={<Icon size={20} />} variant="light" radius="md">
            {h.text}
          </Alert>
        );
      })}
    </Stack>
  );
}
