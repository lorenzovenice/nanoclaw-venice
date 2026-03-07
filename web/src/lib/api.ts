const API_BASE = "/api";

async function request(
  path: string,
  options: RequestInit & { body?: object } = {}
): Promise<unknown> {
  const { body, ...init } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    body: body ? JSON.stringify(body) : init.body,
  });
  if (!res.ok) {
    const text = await res.text();
    let err: Error;
    try {
      const json = JSON.parse(text);
      err = new Error(json.message ?? json.error ?? text);
    } catch {
      err = new Error(text || res.statusText);
    }
    throw err;
  }
  const contentType = res.headers.get("Content-Type");
  if (contentType?.includes("application/json")) {
    return res.json();
  }
  return res.text();
}

export const api = {
  get: (path: string) => request(path, { method: "GET" }),
  post: (path: string, body?: object) =>
    request(path, { method: "POST", body }),
};

export const setupApi = {
  checkEnvironment: () => api.get("/setup/environment"),
  validateVeniceKey: (apiKey: string) =>
    api.post("/setup/venice", { apiKey }),
  configureChannels: (channel: string, telegramToken?: string) =>
    api.post("/setup/channels", { channel, telegramToken }),
  buildContainer: (runtime: string) =>
    api.post("/setup/container", { runtime }),
  startWhatsAppAuth: (method: string, phone?: string) =>
    api.post("/setup/whatsapp-auth", { method, phone }),
  syncGroups: () => api.post("/setup/groups"),
  saveConfig: (triggerWord: string, mounts?: Record<string, string>) =>
    api.post("/setup/config", { triggerWord, mounts }),
  launchService: () => api.post("/setup/service"),
  verify: () => api.post("/setup/verify"),
};

export const dashboardApi = {
  getStatus: () => api.get("/status"),
  getMessages: (params?: { channel?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return api.get(`/messages${q ? `?${q}` : ""}`);
  },
  getSettings: () => api.get("/settings"),
  updateSettings: (data: Record<string, unknown>) =>
    request("/settings", { method: "PUT", body: data }),
  getLogs: (source: string, lines?: number) =>
    api.get(
      `/logs?source=${encodeURIComponent(source)}${lines != null ? `&lines=${lines}` : ""}`
    ),
};
