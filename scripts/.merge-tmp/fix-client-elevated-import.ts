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
  const before = t;

  // Drop auth import of isElevatedUserRole
  t = t.replace(
    /^import \{ isElevatedUserRole \} from "@\/lib\/auth";\r?\n/m,
    "",
  );

  // Rename usages
  t = t.replace(/\bisElevatedUserRole\b/g, "isElevatedPlatformRole");

  // Ensure staff-role import
  if (!/isElevatedPlatformRole/.test(t.match(/import\s*{[^}]*}\s*from\s*["']@\/lib\/staff-role["']/)?.[0] ?? "")) {
    if (/from ["']@\/lib\/staff-role["']/.test(t)) {
      t = t.replace(
        /import\s*{([^}]*)}\s*from\s*["']@\/lib\/staff-role["']/,
        (m, inner: string) => {
          if (inner.includes("isElevatedPlatformRole")) return m;
          return `import { ${inner.trim().replace(/,$/, "")}, isElevatedPlatformRole } from "@/lib/staff-role"`;
        },
      );
    } else {
      // After "use client"
      if (t.startsWith('"use client"')) {
        t = t.replace(
          /^"use client";\r?\n\r?\n?/,
          '"use client";\n\nimport { isElevatedPlatformRole } from "@/lib/staff-role";\n',
        );
      } else {
        t = `import { isElevatedPlatformRole } from "@/lib/staff-role";\n` + t;
      }
    }
  }

  if (t !== before) {
    fs.writeFileSync(f, t);
    console.log("fixed", f);
  } else {
    console.log("unchanged", f);
  }
}
