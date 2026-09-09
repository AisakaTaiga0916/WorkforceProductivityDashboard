const fs = require("fs");
const path = "src/app/api/tickets/route.ts";
let s = fs.readFileSync(path, "utf8");
const start = s.indexOf('    if (requestType === "AUTHORITY_TO_CONDUCT_ACTIVITY") {');
const endMarker = "    const sessionCompanyId =";
const end = s.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error(`markers not found ${start} ${end}`);
const replacement = `    if (requestType === "AUTHORITY_TO_CONDUCT_ACTIVITY") {
      // Temporarily paused -- restore the full ACA intake block when re-enabling.
      return NextResponse.json(
        {
          error:
            "Authority to Conduct Activity is temporarily unavailable. Choose another request type.",
        },
        { status: 503 },
      );
    }

`;
s = s.slice(0, start) + replacement + s.slice(end);
s = s.replace(
  'if (requestType === "AUTHORITY_TO_CONDUCT_ACTIVITY" && acaCreateSeed)',
  "if (acaCreateSeed)",
);
fs.writeFileSync(path, s);
console.log("patched ok");
