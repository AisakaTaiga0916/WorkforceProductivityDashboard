import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ensureInternalAuditBeforeAuditCommittee } from "../../src/lib/work-plan-org-chart-path";
import type { TravelOrderOrgChartAncestor } from "../../src/lib/travel-order";

describe("ensureInternalAuditBeforeAuditCommittee", () => {
  const sections = [
    {
      id: "corp",
      name: "CORPORATE",
      parentId: null,
      headNodeId: "ceo-node",
    },
    {
      id: "audit-committee",
      name: "AUDIT COMMITTEE",
      parentId: "corp",
      headNodeId: "juan-node",
    },
    {
      id: "internal-audit",
      name: "INTERNAL AUDIT",
      parentId: "audit-committee",
      headNodeId: "ailyn-node",
    },
  ];

  const nodeById = new Map([
    [
      "juan-node",
      {
        id: "juan-node",
        mergedSourceUserId: "1677",
        personName: "Uykimpang, Juan Miguel Go",
      },
    ],
    [
      "ailyn-node",
      {
        id: "ailyn-node",
        mergedSourceUserId: "1704",
        personName: "Silana, Ailyn Lorono",
      },
    ],
  ]);

  const agentByMergedId = new Map([
    ["1677", { agentId: "agent-juan", name: "Juan Miguel Uykimpang" }],
    ["1704", { agentId: "agent-ailyn", name: "Ailyn Silana" }],
  ]);

  const layerByNodeId = new Map([
    ["juan-node", 2],
    ["ailyn-node", 3],
  ]);

  it("inserts Ailyn immediately before Juan Miguel when Audit Committee is in the path", () => {
    const ancestors: TravelOrderOrgChartAncestor[] = [
      {
        orgChartLayer: 4,
        agentId: "agent-mgr",
        agentName: "Manager",
        mergedSourceUserId: "999",
        alternateAgents: [],
      },
      {
        orgChartLayer: 2,
        agentId: "agent-juan",
        agentName: "Juan Miguel Uykimpang",
        mergedSourceUserId: "1677",
        alternateAgents: [],
      },
    ];

    const out = ensureInternalAuditBeforeAuditCommittee({
      ancestors,
      requestorAgentId: "agent-requestor",
      sections,
      nodeById,
      agentByMergedId,
      layerByNodeId,
    });

    assert.equal(out.length, 3);
    assert.equal(out[1]?.agentId, "agent-ailyn");
    assert.equal(out[2]?.agentId, "agent-juan");
  });

  it("does not duplicate Ailyn when she is already before Juan Miguel", () => {
    const ancestors: TravelOrderOrgChartAncestor[] = [
      {
        orgChartLayer: 3,
        agentId: "agent-ailyn",
        agentName: "Ailyn Silana",
        mergedSourceUserId: "1704",
        alternateAgents: [],
      },
      {
        orgChartLayer: 2,
        agentId: "agent-juan",
        agentName: "Juan Miguel Uykimpang",
        mergedSourceUserId: "1677",
        alternateAgents: [],
      },
    ];

    const out = ensureInternalAuditBeforeAuditCommittee({
      ancestors,
      requestorAgentId: "agent-requestor",
      sections,
      nodeById,
      agentByMergedId,
      layerByNodeId,
    });

    assert.equal(out.length, 2);
    assert.equal(out[0]?.agentId, "agent-ailyn");
    assert.equal(out[1]?.agentId, "agent-juan");
  });

  it("moves Ailyn before Juan Miguel when she appears after him", () => {
    const ancestors: TravelOrderOrgChartAncestor[] = [
      {
        orgChartLayer: 2,
        agentId: "agent-juan",
        agentName: "Juan Miguel Uykimpang",
        mergedSourceUserId: "1677",
        alternateAgents: [],
      },
      {
        orgChartLayer: 3,
        agentId: "agent-ailyn",
        agentName: "Ailyn Silana",
        mergedSourceUserId: "1704",
        alternateAgents: [],
      },
    ];

    const out = ensureInternalAuditBeforeAuditCommittee({
      ancestors,
      requestorAgentId: "agent-requestor",
      sections,
      nodeById,
      agentByMergedId,
      layerByNodeId,
    });

    assert.equal(out.map((a) => a.agentId).join(","), "agent-ailyn,agent-juan");
  });

  it("leaves the chain alone when Audit Committee is not present", () => {
    const ancestors: TravelOrderOrgChartAncestor[] = [
      {
        orgChartLayer: 3,
        agentId: "agent-mgr",
        agentName: "Manager",
        mergedSourceUserId: "111",
        alternateAgents: [],
      },
    ];

    const out = ensureInternalAuditBeforeAuditCommittee({
      ancestors,
      requestorAgentId: "agent-requestor",
      sections,
      nodeById,
      agentByMergedId,
      layerByNodeId,
    });

    assert.deepEqual(out, ancestors);
  });
});
