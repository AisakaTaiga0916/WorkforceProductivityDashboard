import { describe, expect, it } from "vitest";
import {
  checklistProgressFromChecks,
  parseItSalfDateCell,
  pillarFromItSalfFilename,
} from "@/modules/tasks/kpi-daily-csv-import";

describe("kpi-daily-csv-import", () => {
  it("maps filenames to pillars", () => {
    expect(pillarFromItSalfFilename("IT SALF - DATA BACKUP.csv")).toBe("DATA BACKUP");
    expect(pillarFromItSalfFilename("IT SALF - SYSTEM MAINTENANCE.csv")).toBe("SYSTEM MAINTENANCE");
    expect(pillarFromItSalfFilename("IT SALF - DOCUMENTATION.csv")).toBe("DOCUMENTATION");
  });

  it("parses IT SALF date cells", () => {
    expect(parseItSalfDateCell('"Monday, March 2, 2026"', "Asia/Manila")).toBe("2026-03-02");
  });

  it("derives checklist progress from company checks", () => {
    const p = checklistProgressFromChecks(
      ["ALI", "ACI", "MCHISI", "AWIC", "EASYGAS"],
      { ALI: true, ACI: true, MCHISI: true, AWIC: false, EASYGAS: true },
      80,
    );
    expect(p.done).toBe(4);
    expect(p.percent).toBe(80);
  });
});
