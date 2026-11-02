import { useEffect, useMemo, useState } from "react";
import { AppShell, Burger, Group, NavLink, Select, ActionIcon, Text, ThemeIcon, Badge, Tooltip, Alert, Stack,
         useMantineColorScheme, useComputedColorScheme } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconLayoutDashboard, IconTable, IconMessageChatbot, IconShieldCheck, IconRecycle, IconSun, IconMoon,
         IconCalendar, IconAlertTriangle, IconDatabase, IconBolt } from "@tabler/icons-react";
import { api } from "./api.js";
import { berechne, pruefe } from "./kennzahlen.js";
import Uebersicht from "./pages/Uebersicht.jsx";
import Monatswerte from "./pages/Monatswerte.jsx";
import Assistent from "./pages/Assistent.jsx";
import Datenqualitaet from "./pages/Datenqualitaet.jsx";
import Tabellen from "./pages/Tabellen.jsx";
import Energie from "./pages/Energie.jsx";

const SEITEN = [
  { id: "uebersicht",     label: "Übersicht",     icon: IconLayoutDashboard },
  { id: "monatswerte",    label: "Monatswerte",   icon: IconTable },
  { id: "energie",        label: "Energie (SEU)", icon: IconBolt },
  { id: "tabellen",       label: "Alle Tabellen", icon: IconDatabase },
  { id: "assistent",      label: "KI-Assistent",  icon: IconMessageChatbot },
  { id: "datenqualitaet", label: "Datenqualität", icon: IconShieldCheck }
];
const ausHash = () => SEITEN.find(s => s.id === location.hash.slice(1))?.id || "uebersicht";

export default function App() {
  const [offen, { toggle, close }] = useDisclosure();
  const [seite, setSeite] = useState(ausHash);
  const [jahre, setJahre] = useState([]);
  const [jahr, setJahr] = useState(null);
  const [daten, setDaten] = useState(null);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState("");

  const { setColorScheme } = useMantineColorScheme();
  const schema = useComputedColorScheme("light");

  useEffect(() => {
    const f = () => setSeite(ausHash());
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);

  useEffect(() => {
    api("/api/jahre")
      .then(j => { setJahre(j); setJahr(j[0] ?? null); if (!j.length) setLaedt(false); })
      .catch(e => { setFehler(e.message); setLaedt(false); });
  }, []);

  useEffect(() => {
    if (!jahr) return;
    setLaedt(true);
    api(`/api/produktion?jahr=${jahr}`)
      .then(d => { setDaten(d); setFehler(""); })
      .catch(e => setFehler(e.message))
      .finally(() => setLaedt(false));
  }, [jahr]);

  const k = useMemo(() => berechne(daten), [daten]);
  const hinweise = useMemo(() => pruefe(k), [k]);
  const offenePunkte = hinweise.filter(h => h.stufe === "warnung" || h.stufe === "fehler").length;
  const verbunden = !fehler && jahre.length > 0;

  function gehe(id) { location.hash = id; setSeite(id); close(); }

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 250, breakpoint: "sm", collapsed: { mobile: !offen } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={offen} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Menü" />
            <ThemeIcon size={36} radius="md" variant="filled"><IconRecycle size={22} /></ThemeIcon>
            <div>
              <Text fw={700} lh={1.1}>MRS Produktion</Text>
              <Text size="xs" c="dimmed" lh={1.1} visibleFrom="xs">Aluminium-Recycling</Text>
            </div>
          </Group>
          <Group gap="sm" wrap="nowrap">
            <Select
              w={120}
              data={jahre.map(String)}
              value={jahr ? String(jahr) : null}
              onChange={v => v && setJahr(+v)}
              leftSection={<IconCalendar size={16} />}
              allowDeselect={false}
              aria-label="Jahr"
              comboboxProps={{ withinPortal: true }}
            />
            <Tooltip label={verbunden ? "Mit SQL Server verbunden" : "Keine Verbindung zur Datenbank"}>
              <Badge visibleFrom="sm" variant="dot" tt="none" fw={500} color={verbunden ? "teal" : "red"} size="lg">
                {verbunden ? "Verbunden" : "Offline"}
              </Badge>
            </Tooltip>
            <Tooltip label={schema === "dark" ? "Helles Design" : "Dunkles Design"}>
              <ActionIcon variant="default" size={36} radius="md" aria-label="Design wechseln"
                          onClick={() => setColorScheme(schema === "dark" ? "light" : "dark")}>
                {schema === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <AppShell.Section grow>
          {SEITEN.map(s => (
            <NavLink
              key={s.id}
              href={`#${s.id}`}
              label={s.label}
              leftSection={<s.icon size={20} stroke={1.6} />}
              active={seite === s.id}
              onClick={e => { e.preventDefault(); gehe(s.id); }}
              rightSection={s.id === "datenqualitaet" && offenePunkte > 0
                ? <Badge size="sm" circle color="bernstein">{offenePunkte}</Badge> : null}
              variant="light"
              style={{ borderRadius: "var(--mantine-radius-md)" }}
              mb={4}
            />
          ))}
        </AppShell.Section>
        <AppShell.Section>
          <Group gap="xs" p="xs" wrap="nowrap">
            <IconDatabase size={16} color="var(--mantine-color-dimmed)" />
            <Text size="xs" c="dimmed">Datenbank MRS_BI, nur Lesezugriff</Text>
          </Group>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        <Stack maw={1280} mx="auto">
          {fehler && (
            <Alert color="red" icon={<IconAlertTriangle size={20} />} title="Daten konnten nicht geladen werden">
              {fehler}
            </Alert>
          )}
          {seite === "uebersicht"     && <Uebersicht k={k} laedt={laedt} />}
          {seite === "monatswerte"    && <Monatswerte k={k} />}
          {seite === "assistent"      && <Assistent k={k} />}
          {seite === "datenqualitaet" && <Datenqualitaet hinweise={hinweise} jahr={jahr} />}
          {seite === "tabellen"       && <Tabellen />}
          {seite === "energie"        && <Energie jahr={jahr} />}
        </Stack>
      </AppShell.Main>
    </AppShell>
  );
}
