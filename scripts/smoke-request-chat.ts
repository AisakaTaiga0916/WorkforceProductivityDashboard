/**
 * Smoke test: request chat persistence, access rules, HTTP auth gate.
 *
 * Usage:
 *   npx tsx scripts/smoke-request-chat.ts
 *   npx tsx scripts/smoke-request-chat.ts --base-url=http://localhost:3000
 */
import { prisma } from "../src/lib/prisma";
import {
  createChatMessage,
  listChatMessages,
  markChatMessagesRead,
  sanitizeChatBody,
} from "../src/lib/request-chat";
import {
  canAccessRequestChat,
  collectRequestChatParticipantAgentIds,
  loadTicketForChatAccess,
} from "../src/lib/ticket-chat-access";
import { pingRedis } from "../src/lib/redis";

function fail(message: string): never {
  console.error("FAIL:", message);
  process.exit(1);
}

function pass(message: string) {
  console.log("PASS:", message);
}

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main() {
  console.log("=== Request chat smoke test ===\n");

  const stamp = Date.now();
  const requestorEmail = `smoke.chat.req.${stamp}@example.com`;
  const assigneeEmail = `smoke.chat.assignee.${stamp}@example.com`;
  const outsiderEmail = `smoke.chat.out.${stamp}@example.com`;
  const baseUrl = (argValue("base-url") ?? process.env.SMOKE_BASE_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );

  // --- sanitize ---
  const cleaned = sanitizeChatBody("<b>hello</b>");
  if (cleaned !== "hello") {
    fail(`sanitizeChatBody should strip tags, got ${JSON.stringify(cleaned)}`);
  }
  pass("sanitizeChatBody strips HTML");

  // --- redis (optional for chat HTTP; required for multi-instance sockets) ---
  const redisOk = await pingRedis();
  if (redisOk) pass("Redis PING ok");
  else console.log("WARN: Redis unreachable (chat HTTP still works; sockets degrade)");

  // --- fixture: team + agent + ISSUE ticket ---
  const team = await prisma.team.create({
    data: { name: `Smoke Chat Team ${stamp}` },
  });
  const agent = await prisma.agent.create({
    data: {
      name: "Smoke Assignee",
      email: assigneeEmail,
      teamId: team.id,
    },
  });
  const due = new Date(Date.now() + 86_400_000);
  const ticket = await prisma.ticket.create({
    data: {
      ticketNumber: `SMOKE-CHAT-${stamp}`,
      title: "Smoke request chat",
      description: "Temporary ticket for chat smoke test.",
      category: "GENERAL",
      requestType: "ISSUE_CONCERN_TICKET",
      priority: "LOW",
      status: "OPEN",
      contactName: "Smoke Requestor",
      contactEmail: requestorEmail,
      requestorEmail,
      assignedAgentId: agent.id,
      teamId: team.id,
      firstResponseDueAt: due,
      resolutionDueAt: due,
    },
  });

  let messageId = "";
  try {
    const accessRow = await loadTicketForChatAccess(ticket.id);
    if (!accessRow) fail("loadTicketForChatAccess returned null");

    const participantIds = collectRequestChatParticipantAgentIds(accessRow);
    if (!participantIds.has(agent.id)) {
      fail(`ISSUE participants should include assignee ${agent.id}, got ${[...participantIds]}`);
    }
    pass("ISSUE/CONCERN participant set includes assignee");

    const requestorOk = await canAccessRequestChat({
      role: "Customer",
      email: requestorEmail,
      ticket: accessRow,
    });
    if (!requestorOk) fail("requestor should access chat");
    pass("requestor can access chat");

    const assigneeOk = await canAccessRequestChat({
      role: "Agent",
      email: assigneeEmail,
      name: "Smoke Assignee",
      ticket: accessRow,
    });
    if (!assigneeOk) fail("assignee should access chat");
    pass("assignee can access chat");

    const outsiderDenied = await canAccessRequestChat({
      role: "Agent",
      email: outsiderEmail,
      name: "Outsider",
      ticket: accessRow,
    });
    if (outsiderDenied) fail("outsider agent should be denied");
    pass("outsider agent denied");

    const customerOutsiderDenied = await canAccessRequestChat({
      role: "Customer",
      email: outsiderEmail,
      ticket: accessRow,
    });
    if (customerOutsiderDenied) fail("non-requestor customer should be denied");
    pass("non-requestor customer denied");

    // --- create / list / read ---
    const created = await createChatMessage({
      ticketId: ticket.id,
      senderId: "smoke-requestor-id",
      senderName: "Smoke Requestor",
      senderRole: "Customer",
      body: `hello from smoke ${stamp}`,
    });
    messageId = created.id;
    pass(`created message ${created.id}`);

    await createChatMessage({
      ticketId: ticket.id,
      senderId: agent.id,
      senderName: "Smoke Assignee",
      senderRole: "Agent",
      body: `reply from assignee ${stamp}`,
    });
    pass("created assignee reply");

    const listed = await listChatMessages({
      ticketId: ticket.id,
      viewerId: "smoke-requestor-id",
      limit: 40,
    });
    if (listed.messages.length < 2) {
      fail(`expected >=2 messages, got ${listed.messages.length}`);
    }
    const mine = listed.messages.find((m) => m.id === messageId);
    if (!mine?.isMine) fail("sender should see isMine=true on own message");
    if (!listed.messages.some((m) => m.body.includes(`reply from assignee ${stamp}`))) {
      fail("list missing assignee reply");
    }
    pass(`listChatMessages returned ${listed.messages.length} messages`);

    const marked = await markChatMessagesRead({
      ticketId: ticket.id,
      readerId: "smoke-requestor-id",
    });
    if (marked.marked < 1) fail(`expected to mark >=1 message read, got ${marked.marked}`);
    pass(`markChatMessagesRead marked ${marked.marked}`);

    // empty body rejected
    let rejected = false;
    try {
      await createChatMessage({
        ticketId: ticket.id,
        senderId: "x",
        senderName: "x",
        body: "   ",
      });
    } catch {
      rejected = true;
    }
    if (!rejected) fail("empty body should reject");
    pass("empty body rejected");

    // --- HTTP gate (no session → 401) ---
    try {
      const res = await fetch(`${baseUrl}/api/tickets/${ticket.id}/chat?limit=5`, {
        headers: { Accept: "application/json" },
      });
      if (res.status !== 401) {
        fail(`GET chat without session expected 401, got ${res.status}`);
      }
      pass(`HTTP GET chat unauthenticated → 401 (${baseUrl})`);

      const post = await fetch(`${baseUrl}/api/tickets/${ticket.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ body: "should fail" }),
      });
      if (post.status !== 401) {
        fail(`POST chat without session expected 401, got ${post.status}`);
      }
      pass("HTTP POST chat unauthenticated → 401");
    } catch (e) {
      console.log(
        "WARN: HTTP gate skipped (dev server not reachable at",
        baseUrl + "):",
        e instanceof Error ? e.message : e,
      );
    }

    // --- RFP participant mapping quick check (in-memory meta, no extra DB) ---
    const rfpIds = collectRequestChatParticipantAgentIds({
      ...accessRow,
      requestType: "REQUEST_FOR_PAYMENT",
      assignedAgentId: null,
      paymentApprovalMeta: {
        proceduralStep: "NOTED_BY",
        completed: {},
        stepApproved: {},
        notedByAgentId: "n1",
        approvedByAgentId: "a1",
        accountingAgentId: "bk",
        financeAgentId: "ac",
      },
    });
    for (const id of ["n1", "a1", "bk", "ac"]) {
      if (!rfpIds.has(id)) fail(`RFP participants missing ${id}`);
    }
    pass("RFP participant mapping (approvers/bookkeeper/accounting)");

    console.log("\n=== ALL CHAT SMOKE CHECKS PASSED ===");
  } finally {
    await prisma.chatMessageRead.deleteMany({
      where: { message: { ticketId: ticket.id } },
    });
    await prisma.chatMessage.deleteMany({ where: { ticketId: ticket.id } });
    await prisma.ticket.delete({ where: { id: ticket.id } }).catch(() => undefined);
    await prisma.agent.delete({ where: { id: agent.id } }).catch(() => undefined);
    await prisma.team.delete({ where: { id: team.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
