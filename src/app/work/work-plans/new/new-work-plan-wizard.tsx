"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { TravelOrderRequestModal } from "@/components/task-board/TravelOrderRequestModal";
import { TravelOrderRfpEditModal } from "@/components/task-board/TravelOrderRfpEditModal";

const LIST_HREF = "/work/work-plans";

function planHref(travelOrderId: string) {
  return `${LIST_HREF}?plan=${encodeURIComponent(travelOrderId)}`;
}

/** Work → Work Plans → New: full-page multi-step Work Plan / Travel Order create. */
export function NewWorkPlanWizard({
  operatorAgentId,
  resumeDraftId,
}: {
  operatorAgentId: string | null;
  resumeDraftId: string | null;
}) {
  const router = useRouter();
  // The wizard calls onClose right after onCreated; keep the RFP review step instead of leaving.
  const createdRef = useRef(false);
  const [rfpReview, setRfpReview] = useState<{
    taskId: string;
    travelOrderId: string;
    linkedRfpTicketId: string | null;
  } | null>(null);

  return (
    <section className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">New Work Plan</h2>
        <Link
          href={LIST_HREF}
          className="inline-flex items-center gap-1 text-xs font-semibold text-orange-700 underline-offset-2 hover:underline dark:text-orange-300"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          All work plans
        </Link>
      </div>
      <TravelOrderRequestModal
        open
        variant="page"
        mainTaskName=""
        allowEditDetails
        companyScopeAgentId={operatorAgentId}
        resumeLocalId={resumeDraftId}
        onClose={() => {
          if (!createdRef.current) router.push(LIST_HREF);
        }}
        onDraftSaved={() => router.push(LIST_HREF)}
        onCreated={({ kpiId, travelOrderId, linkedRfpTicketId, offlineQueued }) => {
          createdRef.current = true;
          if (offlineQueued || !travelOrderId) {
            router.push(LIST_HREF);
            return;
          }
          // Review the auto-created Request for Payment, then land on the plan detail.
          setRfpReview({
            taskId: kpiId,
            travelOrderId,
            linkedRfpTicketId: linkedRfpTicketId ?? null,
          });
        }}
      />
      <TravelOrderRfpEditModal
        open={Boolean(rfpReview)}
        taskId={rfpReview?.taskId ?? null}
        travelOrderId={rfpReview?.travelOrderId ?? null}
        initialTicketId={rfpReview?.linkedRfpTicketId ?? null}
        onClose={() => {
          if (rfpReview) router.push(planHref(rfpReview.travelOrderId));
        }}
      />
    </section>
  );
}
