/** Portrait half-bond (~5.5in × 9in) print layout for ticket / request details. */

export type TicketPrintField = {
  label: string;
  value: string;
};

export type TicketPrintApproval = {
  label: string;
  name: string;
  done?: boolean;
};

export type TicketPrintTable = {
  headers: string[];
  rows: string[][];
};

export type TicketPrintModel = {
  ticketNumber: string;
  requestTypeLabel: string;
  priority: string;
  status: string;
  proceduralLabel?: string | null;
  createdAtLabel: string;
  title: string;
  fields: TicketPrintField[];
  table?: TicketPrintTable | null;
  notes?: string | null;
  approvals?: TicketPrintApproval[];
  meta?: TicketPrintField[];
};

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cell(value: string): string {
  const trimmed = value.trim();
  return escapeHtml(trimmed || "—");
}

function fieldGridHtml(fields: TicketPrintField[]): string {
  if (fields.length === 0) return "";
  return `<div class="fields">${fields
    .map(
      (f) =>
        `<div class="field"><div class="label">${escapeHtml(f.label)}</div><div class="value">${cell(
          f.value,
        )}</div></div>`,
    )
    .join("")}</div>`;
}

function tableHtml(table: TicketPrintTable): string {
  const head = table.headers
    .map((h) => `<th>${escapeHtml(h)}</th>`)
    .join("");
  const body = table.rows
    .map(
      (row) =>
        `<tr>${row.map((c) => `<td>${cell(c)}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<table class="items"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function approvalsHtml(approvals: TicketPrintApproval[]): string {
  if (approvals.length === 0) return "";
  return `<div class="approvals">${approvals
    .map(
      (a) =>
        `<div class="approval"><div class="label">${escapeHtml(a.label)}</div><div class="value${
          a.done ? " done" : ""
        }">${cell(a.name)}</div></div>`,
    )
    .join("")}</div>`;
}

/**
 * Compact print stylesheet for portrait half short-bond paper.
 * Short bond is 8.5" × 11"; half bond portrait targets ~5.5" × 9" (slightly taller).
 */
export const TICKET_PRINT_STYLES = `
  @page {
    size: 5.5in 9in portrait;
    margin: 0.28in;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    font-family: "Segoe UI", Arial, Helvetica, sans-serif;
    color: #111;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet {
    width: 100%;
    max-width: none;
    min-height: 8.2in;
    overflow: visible;
    font-size: 11pt;
    line-height: 1.35;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    border-bottom: 1.5px solid #222;
    padding-bottom: 8px;
    margin-bottom: 12px;
  }
  .ticket-no {
    font-size: 13pt;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .type {
    font-size: 9pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #444;
    margin-top: 3px;
  }
  .meta-right {
    text-align: right;
    font-size: 9pt;
    color: #333;
    white-space: nowrap;
  }
  .badge {
    display: inline-block;
    border: 1px solid #666;
    border-radius: 999px;
    padding: 1px 7px;
    margin-left: 5px;
    font-size: 8pt;
    font-weight: 700;
    text-transform: uppercase;
  }
  .title {
    font-size: 14pt;
    font-weight: 700;
    margin: 0 0 8px;
    line-height: 1.3;
  }
  .procedural {
    display: inline-block;
    border: 1px solid #b45309;
    color: #92400e;
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 8pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 12px;
  }
  .fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 18px;
    margin-bottom: 12px;
    width: 100%;
  }
  .field .label,
  .approval .label,
  .meta-row .label {
    font-size: 8pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #555;
  }
  .field .value,
  .approval .value,
  .meta-row .value {
    font-size: 11pt;
    font-weight: 600;
    word-break: break-word;
  }
  .approval .value.done { color: #047857; }
  table.items {
    width: 100%;
    border-collapse: collapse;
    margin: 6px 0 12px;
    font-size: 9pt;
  }
  table.items th,
  table.items td {
    border: 1px solid #ccc;
    padding: 4px 6px;
    text-align: left;
    vertical-align: top;
  }
  table.items th {
    background: #f3f4f6;
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .notes {
    margin: 6px 0 12px;
    white-space: pre-wrap;
    font-size: 10.5pt;
  }
  .notes .label {
    font-size: 8pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #555;
    margin-bottom: 3px;
  }
  .approvals {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px 18px;
    border-top: 1px solid #ccc;
    padding-top: 12px;
    margin-top: 10px;
    width: 100%;
  }
  .meta-bar {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 10px 14px;
    border-top: 1px dashed #bbb;
    margin-top: 14px;
    padding-top: 10px;
    width: 100%;
  }
  .footer {
    margin-top: 14px;
    font-size: 8pt;
    color: #777;
  }
`.trim();

export function buildTicketPrintHtml(model: TicketPrintModel): string {
  const procedural = model.proceduralLabel?.trim()
    ? `<div class="procedural">${escapeHtml(model.proceduralLabel.trim())}</div>`
    : "";
  const table = model.table ? tableHtml(model.table) : "";
  const notes = model.notes?.trim()
    ? `<div class="notes"><div class="label">Details</div><div>${escapeHtml(
        model.notes.trim(),
      )}</div></div>`
    : "";
  const approvals = model.approvals?.length ? approvalsHtml(model.approvals) : "";
  const meta = model.meta?.length
    ? `<div class="meta-bar">${model.meta
        .map(
          (m) =>
            `<div class="meta-row"><div class="label">${escapeHtml(
              m.label,
            )}</div><div class="value">${cell(m.value)}</div></div>`,
        )
        .join("")}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(model.ticketNumber)} — print</title>
  <style>${TICKET_PRINT_STYLES}</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div>
        <div class="ticket-no">${escapeHtml(model.ticketNumber)}<span class="badge">${escapeHtml(
          model.priority,
        )}</span></div>
        <div class="type">${escapeHtml(model.requestTypeLabel)}</div>
      </div>
      <div class="meta-right">
        <div>${escapeHtml(model.createdAtLabel)}</div>
        <div>${escapeHtml(model.status)}</div>
      </div>
    </div>
    <h1 class="title">${escapeHtml(model.title)}</h1>
    ${procedural}
    ${fieldGridHtml(model.fields)}
    ${table}
    ${notes}
    ${approvals}
    ${meta}
    <div class="footer">Printed ${escapeHtml(new Date().toLocaleString())} · half bond portrait (5.5&quot; × 9&quot;)</div>
  </div>
</body>
</html>`;
}

/** Open a print window sized for half bond and trigger the browser print dialog. */
export function openTicketDetailsPrint(model: TicketPrintModel): void {
  if (typeof window === "undefined") return;
  const html = buildTicketPrintHtml(model);
  const popup = window.open("", "_blank", "noopener,noreferrer,width=720,height=960");
  if (!popup) {
    // Popup blocked — fall back to an iframe print.
    const iframe = document.createElement("iframe");
    iframe.setAttribute("title", "Print ticket details");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(iframe);
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    const win = iframe.contentWindow;
    if (!win) {
      document.body.removeChild(iframe);
      return;
    }
    const cleanup = () => {
      setTimeout(() => {
        if (iframe.parentNode) document.body.removeChild(iframe);
      }, 500);
    };
    win.focus();
    win.onafterprint = cleanup;
    setTimeout(() => {
      win.print();
      cleanup();
    }, 50);
    return;
  }
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  popup.onafterprint = () => {
    popup.close();
  };
  setTimeout(() => {
    popup.print();
  }, 50);
}
