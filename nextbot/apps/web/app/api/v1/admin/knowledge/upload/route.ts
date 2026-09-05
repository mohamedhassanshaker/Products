import { NextResponse, type NextRequest } from "next/server";
import { handleUploadFile } from "@nextbot/knowledge";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/knowledge/upload` (multipart/form-data, field `file`) —
 *  stores the raw bytes and returns a ready-to-use `Upload` locator for a
 *  subsequent `POST .../sources` call. RBAC: knowledge=Write. */
export async function POST(request: NextRequest) {
  const guard = await requireApi("knowledge", "Write");
  if (guard instanceof Response) return guard;
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ type: "about:blank", title: "Missing 'file' field.", status: 422 }, { status: 422 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const locator = await handleUploadFile(guard.ctx, file.name, file.type || "application/octet-stream", buffer);
    return NextResponse.json({ locator }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
