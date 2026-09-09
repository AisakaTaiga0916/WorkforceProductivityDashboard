import fs from "fs";

const files = [
  "src/components/SidebarOpsWidget.tsx",
  "src/components/OrchestrationQueueNav.tsx",
  "src/components/Nav.tsx",
  "src/components/GlobalSidebar.tsx",
  "src/app/tickets/new/page.tsx",
  "src/app/insights/page.tsx",
  "src/app/admin/personnel/ui.tsx",
  "src/app/admin/account/account-settings-shell.tsx",
];

for (const f of files) {
  let t = fs.readFileSync(f, "utf8");
  const re = /^import \{ isElevatedUserRole \} from "@\/lib\/auth";\r?\n"use client";\r?\n/;
  if (!re.test(t)) {
    console.log("skip", f);
    continue;
  }
  t = t.replace(re, '"use client";\n\nimport { isElevatedUserRole } from "@/lib/auth";\n');
  fs.writeFileSync(f, t);
  console.log("fixed", f);
}
