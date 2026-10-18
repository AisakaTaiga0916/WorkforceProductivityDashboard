import { NextResponse } from "next/server";
import { createReadStream, existsSync } from "fs";
import path from "path";
import { Readable } from "stream";
import { requireRole } from "@/lib/access";
import { isIntakeAttachmentImage } from "@/modules/requests/ticket-intake-screenshots-meta";
import { findTravelOrderById, travelOrderExistsForKpi } from "@/modules/work-plans/travel-order-db";
import { travelOrderUploadDir } from "@/modules/work-plans/travel-order-uploads";

function guessMimeFromStoredName(storedFileName: string): string {
  const lower = storedFileName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".xlsx"))
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".pptx"))
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

/** GET attachment for a travel order (order-level or location visit image). */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; travelOrderId: string; file: string }> },
) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;
  const { id, travelOrderId, file } = await ctx.params;
  const storedFileName = path.basename(file);
  if (!storedFileName || storedFileName !== file) {
    return NextResponse.json({ error: "Invalid file name." }, { status: 400 });
  }

  const exists = await travelOrderExistsForKpi(travelOrderId, id);
  if (!exists) return NextResponse.json({ error: "Travel order not found." }, { status: 404 });

  const fullPath = path.join(travelOrderUploadDir(id, travelOrderId), storedFileName);
  if (!existsSync(fullPath)) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  const order = await findTravelOrderById(travelOrderId);
  const orderAtt = order?.attachments?.find((a) => a.storedFileName === storedFileName);
  const locationAtt = order?.locations
    .flatMap((loc) => loc.attachments)
    .find((a) => a.storedFileName === storedFileName);

  const mimeType =
    orderAtt?.mimeType ||
    locationAtt?.mimeType ||
    guessMimeFromStoredName(storedFileName);
  const originalName =
    orderAtt?.originalName || locationAtt?.originalName || storedFileName;
  const isImage = isIntakeAttachmentImage({
    mimeType,
    originalName,
  });
  const safeDownloadName = originalName.replace(/"/g, "").slice(0, 180) || storedFileName;

  const stream = createReadStream(fullPath);
  const webStream = Readable.toWeb(stream) as unknown as ReadableStream;
  return new NextResponse(webStream, {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `${isImage ? "inline" : "attachment"}; filename="${safeDownloadName}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
