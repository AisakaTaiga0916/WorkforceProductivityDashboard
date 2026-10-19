import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Legacy path — the task board now lives under the Work area (`/work/tasks`). */
export default async function AgentTasksRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) qs.append(key, item);
    } else if (value != null) {
      qs.set(key, value);
    }
  }
  const tail = qs.toString();
  redirect(tail ? `/work/tasks?${tail}` : "/work/tasks");
}
