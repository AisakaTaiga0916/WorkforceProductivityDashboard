import { redirect } from "next/navigation";

/** Legacy route — request analytics live on Requests → Reports. */
export default function ReportsPage() {
  redirect("/agent/reports");
}
