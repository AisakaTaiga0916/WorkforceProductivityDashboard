import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import { permissionDenied } from "@/modules/platform/rbac/permissions";
import {
  MAX_FAQ_DESCRIPTION,
  MAX_FAQ_ITEMS,
  MAX_FAQ_TITLE,
  type FaqItem,
  type FaqItemKind,
} from "@/lib/faq";
import { loadFaqCatalog, saveFaqCatalog } from "@/lib/faq-store";
import { persistFaqPresentation, validateFaqUrl } from "@/lib/faq-uploads";

/** SuperAdmin-only guard. Writes additionally require the given RBAC permission. */
async function guardSuperAdmin(permissionKey?: string) {
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "SuperAdmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (permissionKey) {
    const denied = await permissionDenied(session, permissionKey);
    if (denied) return denied;
  }
  return null;
}

function parseKind(value: unknown): FaqItemKind | null {
  return value === "video" || value === "presentation" ? value : null;
}

export async function GET() {
  const denied = await guardSuperAdmin();
  if (denied) return denied;
  const catalog = await loadFaqCatalog();
  return NextResponse.json(catalog);
}

export async function POST(req: Request) {
  const denied = await guardSuperAdmin("settings.update");
  if (denied) return denied;

  const catalog = await loadFaqCatalog();
  if (catalog.items.length >= MAX_FAQ_ITEMS) {
    return NextResponse.json(
      { error: `You can add up to ${MAX_FAQ_ITEMS} FAQ items.` },
      { status: 400 },
    );
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const kind = parseKind(String(form.get("kind") ?? "").trim());
  if (!kind) {
    return NextResponse.json({ error: "Choose Presentation or Video." }, { status: 400 });
  }

  const title = String(form.get("title") ?? "").trim().slice(0, MAX_FAQ_TITLE);
  const description = String(form.get("description") ?? "").trim().slice(0, MAX_FAQ_DESCRIPTION);
  const url = String(form.get("url") ?? "").trim().slice(0, 2000);
  const fileValue = form.get("file");
  const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;

  const urlError = validateFaqUrl(url, kind === "video" || !file);
  if (urlError) {
    return NextResponse.json({ error: urlError }, { status: 400 });
  }
  if (kind === "presentation" && !file && !url) {
    return NextResponse.json(
      { error: "Upload a presentation or paste a link (PDF, PowerPoint, Google Slides)." },
      { status: 400 },
    );
  }
  if (!title) {
    return NextResponse.json({ error: "Enter a title." }, { status: 400 });
  }

  let savedFile = null;
  if (file) {
    if (kind !== "presentation") {
      return NextResponse.json({ error: "Only presentations can be uploaded as files." }, { status: 400 });
    }
    const persisted = await persistFaqPresentation(file);
    if ("error" in persisted) {
      return NextResponse.json({ error: persisted.error }, { status: 400 });
    }
    savedFile = persisted;
  }

  const now = new Date().toISOString();
  const item: FaqItem = {
    id: randomUUID(),
    kind,
    title,
    description,
    url,
    file: savedFile,
    sortOrder: catalog.items.length,
    createdAt: now,
    updatedAt: now,
  };

  const next = await saveFaqCatalog({ version: 1, items: [...catalog.items, item] });
  return NextResponse.json({ catalog: next, item });
}
