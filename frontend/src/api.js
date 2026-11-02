export async function api(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.fehler || `Fehler ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return data;
}
