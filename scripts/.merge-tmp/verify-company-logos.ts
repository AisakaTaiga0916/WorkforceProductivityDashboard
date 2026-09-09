import { COMPANY_ROSTER } from "../../src/lib/company-roster";
import { companyHasLocalLogo, resolveCompanyLogoByName } from "../../src/lib/company-logo";

for (const name of COMPANY_ROSTER) {
  const path = resolveCompanyLogoByName(name);
  console.log(`${name}: ${companyHasLocalLogo(name) ? path : "MISSING"}`);
}
