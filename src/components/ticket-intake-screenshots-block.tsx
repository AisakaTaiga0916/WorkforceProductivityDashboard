import { FileText } from "lucide-react";
import {
  isIntakeAttachmentImage,
  parseIntakeScreenshotMeta,
} from "@/modules/requests/ticket-intake-screenshots-meta";

export function TicketIntakeScreenshotsBlock({
  ticketId,
  meta,
  headingClassName,
  cardClassName,
  title = "Attachments",
}: {
  ticketId: string;
  meta: unknown;
  headingClassName?: string;
  cardClassName?: string;
  title?: string;
}) {
  const items = parseIntakeScreenshotMeta(meta);
  if (items.length === 0) return null;

  const h2 = headingClassName ?? "text-sm font-semibold text-white";
  const card =
    cardClassName ??
    "rounded-2xl border border-zinc-800 bg-[#0b1220] p-5 shadow-sm";

  return (
    <article className={card}>
      <h2 className={h2}>{title}</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Submitted with the intake form. Click a file to open or download.
      </p>
      <ul className="mt-3 flex flex-wrap gap-3">
        {items.map((m) => {
          const href = `/api/tickets/${ticketId}/screenshots/${encodeURIComponent(m.storedFileName)}`;
          const isImage = isIntakeAttachmentImage(m);
          return (
            <li key={m.storedFileName} className="w-[5.5rem]">
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="group flex flex-col items-center gap-1.5 rounded-lg p-1 outline-none transition hover:bg-zinc-900/80 focus-visible:ring-2 focus-visible:ring-orange-500/40"
                title={m.originalName}
              >
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element -- auth cookies; external API route
                  <img
                    src={href}
                    alt={m.originalName}
                    className="size-12 rounded-md border border-zinc-700 object-cover object-top"
                    loading="lazy"
                  />
                ) : (
                  <span className="flex size-12 items-center justify-center rounded-md border border-zinc-700 bg-zinc-950 text-orange-400">
                    <FileText className="size-7" strokeWidth={1.5} aria-hidden />
                    <span className="sr-only">Document</span>
                  </span>
                )}
                <span className="w-full truncate text-center text-[11px] text-zinc-500 group-hover:text-zinc-300">
                  {m.originalName}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
