// Thin fetch wrapper. A 409 means a gate is not met: the server says why and what is required.
export class ApiError extends Error {
  status: number;
  required: string[];
  constructor(status: number, reason: string, required: string[] = []) {
    super(reason);
    this.status = status;
    this.required = required;
  }
}

async function handle(r: Response) {
  if (r.ok) {
    const ct = r.headers.get("content-type") || "";
    return ct.includes("application/json") ? r.json() : r.text();
  }
  let reason = r.status >= 500 ? "The server did not answer properly. Please try again." : `Request failed (${r.status})`;
  let required: string[] = [];
  try {
    const j = await r.json();
    reason = j.reason || reason;
    required = j.required || [];
  } catch {
    /* not json */
  }
  if (r.status === 401) window.dispatchEvent(new Event("rw-auth"));
  throw new ApiError(r.status, reason, required);
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "The app could not reach its server. Check the connection and try again.");
  }
  return handle(r);
}

export async function upload<T = any>(path: string, form: FormData): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api${path}`, { method: "POST", body: form, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "The app could not reach its server. Check the connection and try again.");
  }
  return handle(r);
}
