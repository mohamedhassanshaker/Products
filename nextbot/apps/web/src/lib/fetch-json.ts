"use client";

/**
 * QA Defect U3: a shared client-fetch helper that distinguishes a genuine `403
 * Forbidden` response from every other outcome (success, other errors) — the bug
 * QA found was components doing `const data = await res.json(); setX(data.x ??
 * [])`, which silently treats *any* non-2xx body (including a 403 problem+json
 * response with no `connectors`/`tools`/`roles` key) as "empty list" instead of
 * surfacing the fail-closed RBAC deny. Every list screen calling a permission-gated
 * `/api/v1/admin/**` route should go through this instead of a bare `fetch(...).
 * then(r => r.json())`.
 */
export type FetchJsonResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden"; message: string }
  | { kind: "error"; status: number; message: string };

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<FetchJsonResult<T>> {
  const res = await fetch(url, init);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (res.status === 403) {
    const title = isProblemBody(body) ? body.title : undefined;
    return { kind: "forbidden", message: title ?? "You don't have access to this section." };
  }
  if (!res.ok) {
    const title = isProblemBody(body) ? body.title : undefined;
    return { kind: "error", status: res.status, message: title ?? "Something went wrong. Please try again." };
  }
  return { kind: "ok", data: body as T };
}

function isProblemBody(body: unknown): body is { title?: string } {
  return typeof body === "object" && body !== null;
}
