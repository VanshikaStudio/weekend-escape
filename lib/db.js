// Tiny Supabase REST helper. Server only: it uses the service role key.

async function db(path, { method = "GET", body, prefer } = {}) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
  if (!SUPABASE_URL || !key) throw new Error("Supabase variables missing");
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${method} ${path.split("?")[0]}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

module.exports = { db };
