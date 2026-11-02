import { useEffect, useRef, useState } from "react";
import { Group, Title, Text, Textarea, ActionIcon, Button, Badge, Tooltip, Code, Collapse, SimpleGrid, ScrollArea,
         Stack, UnstyledButton, ThemeIcon, Kbd, CopyButton } from "@mantine/core";
import { IconArrowUp, IconSparkles, IconBuildingFactory2, IconBolt, IconDatabase, IconCopy, IconCheck,
         IconCode, IconPlus, IconPlayerStopFilled, IconInfoCircle, IconChevronRight } from "@tabler/icons-react";
import AntwortText from "../components/AntwortText.jsx";
import { api } from "../api.js";
import { antwortOhneKI, antwortEnergieOhneKI, istEnergieFrage } from "../antworten.js";

const THEMEN = [
  { titel: "Produktion", icon: IconBuildingFactory2, farbe: "stahl", fragen: [
    "Warum war der Mai so schwach?",
    "Vergleiche Presse I und Presse II im ersten Halbjahr."
  ]},
  { titel: "Energie (SEU)", icon: IconBolt, farbe: "bernstein", fragen: [
    "Welche Anlage verbraucht am meisten Energie?",
    "Wie hoch ist der spezifische Verbrauch je Anlage?"
  ]},
  { titel: "Datenbank", icon: IconDatabase, farbe: "teal", fragen: [
    "Welche Tabellen gibt es in der Datenbank?",
    "Passt der Energieverbrauch zur produzierten Menge?"
  ]}
];
const NACHFRAGEN = ["Und im Vergleich zum Vorjahr?", "Erklär das genauer.", "Was sollten wir daraus ableiten?"];
const uhrzeit = () => new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

export default function Assistent({ k }) {
  const [nachrichten, setNachrichten] = useState([]);
  const [frage, setFrage] = useState("");
  const [laedt, setLaedt] = useState(false);
  const [status, setStatus] = useState(null);
  const ende = useRef(null);
  const eingabe = useRef(null);
  const abbruch = useRef(null);

  useEffect(() => { api("/api/status").then(setStatus).catch(() => setStatus({ ki: false })); }, []);
  useEffect(() => { ende.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [nachrichten, laedt]);

  async function senden(text) {
    text = text.trim();
    if (!text || laedt) return;
    const neu = [...nachrichten, { rolle: "nutzer", text, zeit: uhrzeit() }];
    setNachrichten(neu);
    setFrage("");
    setLaedt(true);
    abbruch.current = new AbortController();
    try {
      const verlauf = neu.filter(n => !n.fehler && !n.ohneKI).map(n => ({ rolle: n.rolle, text: n.text }));
      const { antwort, abfragen } = await api("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verlauf, jahr: k?.jahr }),
        signal: abbruch.current.signal
      });
      setNachrichten(n => [...n, { rolle: "assistent", text: antwort, abfragen, zeit: uhrzeit() }]);
    } catch (err) {
      if (err.name === "AbortError") {
        setNachrichten(n => [...n, { rolle: "assistent", text: "Abgebrochen.", fehler: true, zeit: uhrzeit() }]);
      } else if (err.status === 503) {
        const antwort = istEnergieFrage(text)
          ? antwortEnergieOhneKI(text, await api(`/api/energie?jahr=${k?.jahr}`).catch(() => null))
          : antwortOhneKI(text, k);
        setNachrichten(n => [...n, { rolle: "assistent", text: antwort, ohneKI: err.message, zeit: uhrzeit() }]);
      } else {
        setNachrichten(n => [...n, { rolle: "assistent", text: err.message, fehler: true, zeit: uhrzeit() }]);
      }
    } finally {
      setLaedt(false);
      eingabe.current?.focus();
    }
  }

  const letzteKI = [...nachrichten].reverse().find(n => n.rolle === "assistent");

  return (
    <div className="chat-seite">
      {/* Kopfzeile */}
      <Group justify="space-between" mb="sm" maw={820} w="100%" mx="auto" wrap="nowrap">
        <Group gap="sm" wrap="nowrap">
          <div className="chat-avatar-ki"><IconSparkles size={18} /></div>
          <div>
            <Group gap={8}>
              <Title order={3} lh={1.2}>KI-Assistent</Title>
              {status && (
                <Tooltip label={status.ki ? `Modell: ${status.modell}` : "Ohne Guthaben oder Schlüssel: einfache Antworten ohne KI"}>
                  <Badge size="sm" variant="dot" tt="none" color={status.ki ? "teal" : "bernstein"}>
                    {status.ki ? "Claude aktiv" : "Ohne KI"}
                  </Badge>
                </Tooltip>
              )}
            </Group>
            <Text size="xs" c="dimmed">Liest alle Tabellen von MRS_BI, ändert nichts. Bezug ohne Jahresangabe: {k?.jahr}</Text>
          </div>
        </Group>
        {nachrichten.length > 0 && (
          <Button variant="default" size="xs" radius="xl" leftSection={<IconPlus size={14} />} onClick={() => setNachrichten([])}>
            Neues Gespräch
          </Button>
        )}
      </Group>

      {/* Verlauf */}
      <ScrollArea className="chat-verlauf" offsetScrollbars type="auto">
        <div className="chat-inhalt">
          {nachrichten.length === 0 ? (
            <Stack align="center" gap={6} pt="xl">
              <ThemeIcon size={64} radius={18} variant="light"><IconSparkles size={34} stroke={1.5} /></ThemeIcon>
              <Title order={2} ta="center" mt="md">Guten Tag! Was möchten Sie wissen?</Title>
              <Text c="dimmed" ta="center" maw={520}>
                Fragen Sie in eigenen Worten nach Produktion, Energie oder anderen Tabellen. Die Antwort kommt direkt aus der Datenbank.
              </Text>
              <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md" mt="xl" w="100%">
                {THEMEN.map(t => (
                  <Stack key={t.titel} gap="xs">
                    <Group gap={8}>
                      <ThemeIcon size={26} radius="md" variant="light" color={t.farbe}><t.icon size={16} /></ThemeIcon>
                      <Text fw={600} size="sm">{t.titel}</Text>
                    </Group>
                    {t.fragen.map(f => (
                      <UnstyledButton key={f} className="chat-karte" onClick={() => senden(f)}>
                        <Group justify="space-between" wrap="nowrap" gap="xs">
                          <Text size="sm">{f}</Text>
                          <IconChevronRight size={16} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0 }} />
                        </Group>
                      </UnstyledButton>
                    ))}
                  </Stack>
                ))}
              </SimpleGrid>
            </Stack>
          ) : (
            <Stack gap={28}>
              {nachrichten.map((n, i) => n.rolle === "nutzer"
                ? <NutzerNachricht key={i} n={n} />
                : <KiNachricht key={i} n={n} />)}

              {laedt && (
                <Group align="flex-start" gap="sm" wrap="nowrap">
                  <div className="chat-avatar-ki"><IconSparkles size={18} /></div>
                  <Stack gap={6}>
                    <div className="chat-punkte" aria-label="Antwort wird erstellt"><span /><span /><span /></div>
                    <Text size="xs" c="dimmed">Durchsucht die Datenbank und rechnet nach</Text>
                  </Stack>
                </Group>
              )}

              {!laedt && letzteKI && !letzteKI.fehler && (
                <Group gap="xs" pl={46}>
                  {NACHFRAGEN.map(f => (
                    <Button key={f} size="xs" radius="xl" variant="light" fw={500} onClick={() => senden(f)}>{f}</Button>
                  ))}
                </Group>
              )}
            </Stack>
          )}
          <div ref={ende} />
        </div>
      </ScrollArea>

      {/* Eingabe */}
      <div className="chat-eingabe">
        <Group align="flex-end" gap="xs" wrap="nowrap">
          <Textarea
            ref={eingabe}
            flex={1}
            variant="unstyled"
            autosize minRows={1} maxRows={7}
            size="md"
            placeholder="Frage stellen …"
            value={frage}
            onChange={e => setFrage(e.currentTarget.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); senden(frage); } }}
            aria-label="Frage"
            autoFocus
          />
          {laedt ? (
            <Tooltip label="Abbrechen">
              <ActionIcon size={40} radius="xl" color="gray" variant="filled" onClick={() => abbruch.current?.abort()} aria-label="Abbrechen">
                <IconPlayerStopFilled size={16} />
              </ActionIcon>
            </Tooltip>
          ) : (
            <ActionIcon size={40} radius="xl" variant="filled" onClick={() => senden(frage)} disabled={!frage.trim()} aria-label="Frage senden">
              <IconArrowUp size={20} stroke={2.2} />
            </ActionIcon>
          )}
        </Group>
      </div>
      <Text size="xs" c="dimmed" ta="center" mt={6}>
        <Kbd size="xs">Enter</Kbd> senden, <Kbd size="xs">Umschalt</Kbd> + <Kbd size="xs">Enter</Kbd> neue Zeile. Antworten der KI bitte bei wichtigen Entscheidungen prüfen.
      </Text>
    </div>
  );
}

function NutzerNachricht({ n }) {
  return (
    <Stack gap={4} align="flex-end">
      <div className="chat-nutzer">{n.text}</div>
      <span className="chat-zeit">{n.zeit}</span>
    </Stack>
  );
}

function KiNachricht({ n }) {
  const [sqlOffen, setSqlOffen] = useState(false);
  return (
    <Group align="flex-start" gap="sm" wrap="nowrap">
      <div className="chat-avatar-ki"><IconSparkles size={18} /></div>
      <div className="chat-ki">
        <Group gap={8} mb={4}>
          <Text fw={600} size="sm">{n.ohneKI ? "Assistent" : "Claude"}</Text>
          <span className="chat-zeit">{n.zeit}</span>
          {n.ohneKI && (
            <Tooltip label={n.ohneKI} multiline w={260}>
              <Badge size="xs" variant="light" color="bernstein" tt="none" leftSection={<IconInfoCircle size={11} />}>ohne KI</Badge>
            </Tooltip>
          )}
        </Group>
        {n.fehler ? <Text c="red">{n.text}</Text> : <AntwortText text={n.text} />}
        {!n.fehler && (
          <Group gap={4} mt={8}>
            <CopyButton value={n.text}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? "Kopiert" : "Antwort kopieren"}>
                  <ActionIcon variant="subtle" color={copied ? "teal" : "gray"} size="sm" onClick={copy} aria-label="Antwort kopieren">
                    {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
            {n.abfragen?.length > 0 && (
              <Button variant="subtle" color="gray" size="compact-xs" leftSection={<IconCode size={14} />} onClick={() => setSqlOffen(o => !o)}>
                {sqlOffen ? "SQL ausblenden" : `SQL anzeigen (${n.abfragen.length})`}
              </Button>
            )}
          </Group>
        )}
        <Collapse expanded={sqlOffen}>
          <Stack gap={6} mt={6}>
            {n.abfragen?.map((a, j) => <Code key={j} block style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{a}</Code>)}
          </Stack>
        </Collapse>
      </div>
    </Group>
  );
}
