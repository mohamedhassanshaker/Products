import { NextResponse, type NextRequest } from "next/server";
import { handleScimDeleteUser, handleScimGetUser, handleScimReplaceUser, handleScimSetActive } from "@nextbot/iam";
import { ScimAuthenticationFailedError, ScimUserNotFoundError, InvalidRoleAssignmentError } from "@nextbot/contracts";

const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";

function scimError(status: number, detail: string) {
  return NextResponse.json({ schemas: [SCIM_ERROR_SCHEMA], status: String(status), detail }, { status });
}

function toScimUser(u: { id: string; userName: string; displayName: string; active: boolean; roleIds: string[] }) {
  return { schemas: [SCIM_USER_SCHEMA], id: u.id, userName: u.userName, displayName: u.displayName, active: u.active, nextbotRoleIds: u.roleIds };
}

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

function mapError(err: unknown) {
  if (err instanceof ScimAuthenticationFailedError) return scimError(401, err.message);
  if (err instanceof ScimUserNotFoundError) return scimError(404, err.message);
  if (err instanceof InvalidRoleAssignmentError) return scimError(400, err.message);
  return scimError(500, "Internal error.");
}

/**
 * `GET/PUT/PATCH/DELETE /api/scim/v2/{tenantSlug}/Users/{id}` (Phase 4, BL-36).
 * `DELETE` deactivates rather than hard-deletes (README decision #7) — RFC 7644
 * §3.6 only requires the resource become inaccessible, not physically erased.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantSlug: string; id: string }> }) {
  const { tenantSlug, id } = await params;
  const token = bearerToken(request);
  if (!token) return scimError(401, "Missing bearer token.");
  try {
    return NextResponse.json(toScimUser(await handleScimGetUser(tenantSlug, token, id)));
  } catch (err) {
    return mapError(err);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ tenantSlug: string; id: string }> }) {
  const { tenantSlug, id } = await params;
  const token = bearerToken(request);
  if (!token) return scimError(401, "Missing bearer token.");
  const body = await request.json().catch(() => null);
  if (!body) return scimError(400, "Invalid SCIM User resource.");
  try {
    const user = await handleScimReplaceUser(tenantSlug, token, id, {
      displayName: typeof body.displayName === "string" ? body.displayName : body.userName ?? "",
      active: body.active !== false,
      roleIds: Array.isArray(body.nextbotRoleIds) ? body.nextbotRoleIds : [],
    });
    return NextResponse.json(toScimUser(user));
  } catch (err) {
    return mapError(err);
  }
}

/** `PATCH` — the deprovisioning operation most IdPs actually send:
 * `{"Operations":[{"op":"replace","path":"active","value":false}]}`. Only that
 * shape is supported this phase (the one real IdPs use for deprovisioning);
 * anything else is rejected with 400 rather than silently ignored. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tenantSlug: string; id: string }> }) {
  const { tenantSlug, id } = await params;
  const token = bearerToken(request);
  if (!token) return scimError(401, "Missing bearer token.");
  const body = await request.json().catch(() => null);
  const op = body?.Operations?.[0];
  if (!op || op.path !== "active" || typeof op.value !== "boolean") {
    return scimError(400, "Only a `replace active` PATCH operation is supported.");
  }
  try {
    const user = await handleScimSetActive(tenantSlug, token, id, op.value);
    return NextResponse.json(toScimUser(user));
  } catch (err) {
    return mapError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ tenantSlug: string; id: string }> }) {
  const { tenantSlug, id } = await params;
  const token = bearerToken(request);
  if (!token) return scimError(401, "Missing bearer token.");
  try {
    await handleScimDeleteUser(tenantSlug, token, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return mapError(err);
  }
}
