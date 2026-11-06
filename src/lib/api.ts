// 前端请求封装：统一解析 { error: { code, message } }
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: init.body ? { 'content-type': 'application/json' } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') window.location.href = '/login';
    throw new ApiError(data?.error?.code ?? 'INTERNAL', data?.error?.message ?? `请求失败（${res.status}）`, res.status);
  }
  return data as T;
}
