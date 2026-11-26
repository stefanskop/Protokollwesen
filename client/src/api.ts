import type { UserInfo } from '../../shared/src/index';

const LS_TOKEN = 'pw.token';
const LS_USER = 'pw.user';

export function getToken() {
  try {
    return localStorage.getItem(LS_TOKEN);
  } catch {
    return null;
  }
}
export function getStoredUser(): UserInfo | null {
  try {
    const s = localStorage.getItem(LS_USER);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
export function storeLogin(token: string, user: UserInfo) {
  localStorage.setItem(LS_TOKEN, token);
  localStorage.setItem(LS_USER, JSON.stringify(user));
}
export function clearLogin() {
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_USER);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: any; raw?: BodyInit; contentType?: string; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  let body: BodyInit | undefined;
  if (opts.raw !== undefined) {
    body = opts.raw;
    headers['Content-Type'] = opts.contentType || 'application/octet-stream';
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, { method: opts.method || (body ? 'POST' : 'GET'), headers, body, signal: opts.signal });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).error || msg;
    } catch {}
    if (res.status === 401 && token) window.dispatchEvent(new Event('pw-unauthorized'));
    throw new ApiError(res.status, msg);
  }
  const ct = res.headers.get('content-type') || '';
  return (ct.includes('application/json') ? res.json() : res.blob()) as Promise<T>;
}
