// Zeigt Text mit **fett** und Aufzählungen ("- ") sicher an (ohne innerHTML)
function Fett({ text }) {
  const teile = text.split(/(\*\*[^*]+\*\*)/g);
  return teile.map((t, i) => t.startsWith("**") && t.endsWith("**") ? <b key={i}>{t.slice(2, -2)}</b> : t);
}

export default function AntwortText({ text }) {
  const bloecke = String(text).split(/\n{2,}/);
  return (
    <div className="antwort">
      {bloecke.map((b, i) => {
        const zeilen = b.split("\n");
        if (zeilen.every(z => /^\s*[-•*]\s+/.test(z))) {
          return <ul key={i}>{zeilen.map((z, j) => <li key={j}><Fett text={z.replace(/^\s*[-•*]\s+/, "")} /></li>)}</ul>;
        }
        return <p key={i}>{zeilen.map((z, j) => <span key={j}>{j > 0 && <br />}<Fett text={z} /></span>)}</p>;
      })}
    </div>
  );
}
