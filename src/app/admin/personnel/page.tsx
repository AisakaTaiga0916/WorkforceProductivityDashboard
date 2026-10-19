import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Personnel registry folded into Workforce → Org. Chart (people live there). */
export default async function PersonnelPage() {
  redirect("/admin/workforce?view=sections");
}
