/**
 * Apply HighAdmin elevated privilege replacements across src/.
 * Skips role-assignment SuperAdmin-only gates.
 */
import fs from "fs";
import path from "path";

const ROOT = path.resolve("src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function addImport(content: string, symbol: string, from: string): string {
  if (new RegExp(`\\b${symbol}\\b`).test(content) === false) return content;
  if (new RegExp(`import\\s*{[^}]*\\b${symbol}\\b[^}]*}\\s*from\\s*["']${from.replace("/", "\\/")}["']`).test(content)) {
    return content;
  }
  const fromRe = new RegExp(`import\\s*{([^}]*)}\\s*from\\s*["']${from.replace("/", "\\/")}["']`);
  if (fromRe.test(content)) {
    return content.replace(fromRe, (m, inner: string) => {
      if (inner.includes(symbol)) return m;
      const trimmed = inner.trim().replace(/,$/, "");
      return `import { ${trimmed}, ${symbol} } from "${from}"`;
    });
  }
  return `import { ${symbol} } from "${from}";\n` + content;
}

const SKIP_SUBSTR = [
  `${path.sep}lib${path.sep}staff-role.ts`,
  `${path.sep}lib${path.sep}auth.ts`,
  `${path.sep}lib${path.sep}access.ts`,
  `${path.sep}lib${path.sep}ops-permissions.ts`,
  `${path.sep}lib${path.sep}auth${path.sep}portal-permissions.ts`,
  `${path.sep}lib${path.sep}auth${path.sep}portal-to-merged-role.ts`,
  `${path.sep}lib${path.sep}auth${path.sep}role-mapping.ts`,
  `${path.sep}lib${path.sep}auth${path.sep}sync-portal-profile.ts`,
];

let changed = 0;
for (const file of walk(ROOT)) {
  if (SKIP_SUBSTR.some((s) => file.endsWith(s) || file.includes(s))) continue;
  let text = fs.readFileSync(file, "utf8");
  const before = text;

  text = text.replaceAll(
    '["SuperAdmin", "Admin", "Personnel"]',
    '["SuperAdmin", "HighAdmin", "Admin", "Personnel"]',
  );
  text = text.replaceAll(
    "['SuperAdmin', 'Admin', 'Personnel']",
    "['SuperAdmin', 'HighAdmin', 'Admin', 'Personnel']",
  );
  text = text.replaceAll(
    '["SuperAdmin", "Admin"]',
    '["SuperAdmin", "HighAdmin", "Admin"]',
  );
  text = text.replaceAll(
    'new Set(["SuperAdmin", "Admin", "Personnel"])',
    'new Set(["SuperAdmin", "HighAdmin", "Admin", "Personnel"])',
  );

  text = text.replaceAll(
    'session?.user?.role === "SuperAdmin"',
    "isElevatedUserRole(session?.user?.role)",
  );
  text = text.replaceAll(
    'session.user.role === "SuperAdmin"',
    "isElevatedUserRole(session.user.role)",
  );
  text = text.replaceAll(
    'session.user.role !== "SuperAdmin"',
    "!isElevatedUserRole(session.user.role)",
  );
  text = text.replaceAll(
    'session?.user?.role !== "SuperAdmin"',
    "!isElevatedUserRole(session?.user?.role)",
  );

  // Avoid rewriting SuperAdmin-only assignment gates
  const lines = text.split("\n");
  text = lines
    .map((line) => {
      if (line.includes("Only a SuperAdmin may assign")) return line;
      if (line.includes("may assign the HighAdmin")) return line;
      if (line.includes("may assign the platform SuperAdmin")) return line;
      if (line.includes('role === "SuperAdmin" && session.user.role')) return line;
      if (line.includes("isPlatformSuperAdminPortalRole")) return line;
      if (line.includes('portalRole === "SuperAdmin"')) return line;
      if (line.includes('effective === "SuperAdmin"')) return line;
      if (line.includes('return "SuperAdmin"')) return line;
      if (line.includes('createdByRole: "SuperAdmin"')) return line;
      if (line.includes('role: "SuperAdmin"')) return line;

      let l = line;
      l = l.replace(
        /role === "SuperAdmin" \|\| role === "Admin"/g,
        'isElevatedUserRole(role) || role === "Admin"',
      );
      l = l.replace(
        /role === "Admin" \|\| role === "SuperAdmin"/g,
        'role === "Admin" || isElevatedUserRole(role)',
      );
      l = l.replace(/input\.role === "SuperAdmin"/g, "isElevatedUserRole(input.role)");
      // Generic role === SuperAdmin privilege
      if (
        /\brole === "SuperAdmin"/.test(l) &&
        !l.includes("isElevatedUserRole") &&
        !l.includes("isElevatedPlatformRole")
      ) {
        l = l.replace(/\brole === "SuperAdmin"/g, "isElevatedUserRole(role)");
      }
      return l;
    })
    .join("\n");

  if (text.includes("isElevatedUserRole(")) {
    text = addImport(text, "isElevatedUserRole", "@/lib/auth");
  }

  if (text !== before) {
    fs.writeFileSync(file, text);
    changed += 1;
    console.log(path.relative(process.cwd(), file));
  }
}
console.log("changed", changed);
