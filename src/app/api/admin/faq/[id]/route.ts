import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import { permissionDenied } from "@/modules/platform/rbac/permissions";
import { MAX_FAQ_DESCRIPTION, MAX_FAQ_TITLE, type FaqItemKind } from "@/lib/faq";
import { loadFaqCatalog, saveFaqCatalog } from "@/lib/faq-store";
import { persistFaqPresentation, removeFaqFile, validateFaqUrl } from "@/lib/faq-uploads";

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

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await guardSuperAdmin("settings.update");
  if (denied) return denied;

  const { id } = await ctx.params;
  const catalog = await loadFaqCatalog();
  const index = catalog.items.findIndex((item) => item.id === id);
  if (index < 0) {
    return NextResponse.json({ error: "FAQ item not found." }, { status: 404 });
  }
  const existing = catalog.items[index]!;

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const kind = parseKind(String(form.get("kind") ?? existing.kind).trim()) ?? existing.kind;
  const title = String(form.get("title") ?? existing.title).trim().slice(0, MAX_FAQ_TITLE);
  const description = String(form.get("description") ?? existing.description)
    .trim()
    .slice(0, MAX_FAQ_DESCRIPTION);
  const url = String(form.get("url") ?? existing.url).trim().slice(0, 2000);
  const fileValue = form.get("file");
  const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;
  const clearFile = String(form.get("clearFile") ?? "") === "1";
  const sortRaw = form.get("sortOrder");
  const sortOrder =
    sortRaw == null || String(sortRaw).trim() === ""
      ? existing.sortOrder
      : Number(sortRaw);

  if (!title) {
    return NextResponse.json({ error: "Enter a title." }, { status: 400 });
  }

  let nextFile = existing.file;
  if (file) {
    if (kind !== "presentation") {
      return NextResponse.json({ error: "Only presentations can be uploaded as files." }, { status: 400 });
    }
    const persisted = await persistFaqPresentation(file);
    if ("error" in persisted) {
      return NextResponse.json({ error: persisted.error }, { status: 400 });
    }
    await removeFaqFile(existing.file?.storedFileName);
    nextFile = persisted;
  } else if (clearFile || kind === "video") {
    await removeFaqFile(existing.file?.storedFileName);
    nextFile = null;
  }

  const urlError = validateFaqUrl(url, kind === "video" || !nextFile);
  if (urlError) {
    return NextResponse.json({ error: urlError }, { status: 400 });
  }
  if (kind === "presentation" && !nextFile && !url) {
    return NextResponse.json(
      { error: "Upload a presentation or paste a link (PDF, PowerPoint, Google Slides)." },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const items = catalog.items.map((item, i) =>
    i === index
      ? {
          ...item,
          kind,
          title,
          description,
          url,
          file: nextFile,
          sortOrder: Number.isFinite(sortOrder) ? sortOrder : item.sortOrder,
          updatedAt: now,
        }
      : item,
  );

  const next = await saveFaqCatalog({ version: 1, items });
  const item = next.items.find((row) => row.id === id) ?? null;
  return NextResponse.json({ catalog: next, item });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await guardSuperAdmin("settings.update");
  if (denied) return denied;

  const { id } = await ctx.params;
  const catalog = await loadFaqCatalog();
  const existing = catalog.items.find((item) => item.id === id);
  if (!existing) {
    return NextResponse.json({ error: "FAQ item not found." }, { status: 404 });
  }

  await removeFaqFile(existing.file?.storedFileName);
  const next = await saveFaqCatalog({
    version: 1,
    items: catalog.items.filter((item) => item.id !== id),
  });
  return NextResponse.json({ catalog: next });
}
