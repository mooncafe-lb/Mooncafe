// fetch wrapper: JSON in, JSON out, errors carry status and body
export class ApiError extends Error {
  constructor(status, body) { super((body && body.error) || `http_${status}`); this.status = status; this.body = body || {}; }
}

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch (_) {
    throw new ApiError(0, { error: 'network' });
  }
  let data = null;
  try { data = await res.json(); } catch (_) { /* empty body */ }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
