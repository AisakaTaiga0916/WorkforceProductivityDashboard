/**
 * One-shot: align portal Admin / Personnel with current org-chart section heads.
 * Usage: npx tsx scripts/reconcile-org-chart-staff-roles.ts
 */
import { reconcilePortalStaffRolesFromOrgChart } from "../src/modules/platform/scope/org-chart-section-scope";

async function main() {
  const result = await reconcilePortalStaffRolesFromOrgChart();
  console.log(
    JSON.stringify(
      {
        ok: true,
        headCount: result.headCount,
        promoted: result.promoted,
        demoted: result.demoted,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
