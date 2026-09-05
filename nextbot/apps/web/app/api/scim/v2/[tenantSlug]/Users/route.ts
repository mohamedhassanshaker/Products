import { NextResponse, type NextRequest } from "next/server";
import { handleScimCreateUser, handleScimListUsers } from "@nextbot/iam";
import { ScimAuthenticationFailedError, ScimConflictError, InvalidRoleAssignmentError } from "@nextbot/contracts";

const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
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

/**
 * `GET/POST /api/scim/v2/{tenantSlug}/Users` (Phase 4, BL-36, FR-SEC-10) — the
 * SCIM 2.0 Users resource an enterprise IdP provisions against. Authenticated
 * by a per-tenant bearer token (`verifyScimBearerToken`, resolved from
 * `tenantSlug` in the URL — see `scim-token.ts`'s module doc), never a session
 * cookie — this is a distinct, IdP-facing external auth boundary.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const token = bearerToken(request);
  if (!token) return scimError(401, "Missing bearer token.");
  const filter = new URL(request.url).searchParams.get("filter");
  // Minimal SCIM filter support: `userName eq "value"` (the one real IdPs send
  // most often when checking for an existing user before create).
  const match = filter ? /userName eq "([^"]+)"/.exec(filter) : null;
  try {
    const users = await handleScimListUsers(tenantSlug, token, match?.[1]);
    return NextResponse.json({ schemas: [SCIM_LIST_SCHEMA], totalResults: users.length, Resources: users.map(toScimUser) });
  } catch (err) {
    if (err instanceof ScimAuthenticationFailedError) return scimError(401, err.message);
    return scimError(500, "Internal error.");
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const token = bearerToken(request);
  if (!token) return scimError(401, "Missing bearer token.");
  const body = await request.json().catch(() => null);
  if (!body || typeof body.userName !== "string") return scimError(400, "Invalid SCIM User resource.");

  try {
    const user = await handleScimCreateUser(tenantSlug, token, {
      userName: body.userName,
      displayName: typeof body.displayName === "string" ? body.displayName : body.userName,
      active: body.active,
      roleIds: Array.isArray(body.nextbotRoleIds) ? body.nextbotRoleIds : undefined,
    });
    return NextResponse.json(toScimUser(user), { status: 201 });
  } catch (err) {
    if (err instanceof ScimAuthenticationFailedError) return scimError(401, err.message);
    if (err instanceof ScimConflictError) return scimError(409, err.message);
    if (err instanceof InvalidRoleAssignmentError) return scimError(400, err.message);
    return scimError(500, "Internal error.");
  }
}
