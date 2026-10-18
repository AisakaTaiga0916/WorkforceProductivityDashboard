import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { departmentTaskCsvSampleContent } from "@/modules/tasks/department-task-csv";

/**
 * GET /api/kpis/department-task-csv/sample
 * Download the Departments view task-import sample CSV.
 */
export async function GET() {
  const { unauthorized } = await requireRole([
    "SuperAdmin",
    "HighAdmin",
    "Admin",
    "Personnel",
  ]);
  if (unauthorized) return unauthorized;

  const body = departmentTaskCsvSampleContent();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition":
        'attachment; filename="department-task-import-sample.csv"',
      "cache-control": "private, no-store, max-age=0",
    },
  });
}
