"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NewTicketIntake } from "@/app/tickets/new/page";
import { cn } from "@/lib/cn";
import type { RequestTypeId } from "@/modules/requests/request-types";

type CreateRequestModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CreateRequestModal({ open, onOpenChange }: CreateRequestModalProps) {
  const router = useRouter();
  const [selectedType, setSelectedType] = useState<RequestTypeId | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setSelectedType(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const resetScroll = () => {
      const el = scrollRef.current;
      if (el) el.scrollTop = 0;
    };
    resetScroll();
    const frame = requestAnimationFrame(resetScroll);
    return () => cancelAnimationFrame(frame);
  }, [open, selectedType]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={(event) => event.preventDefault()}
        className={cn(
          "!fixed !inset-x-0 !top-[max(1rem,4dvh)] !bottom-auto !mx-auto !max-h-[min(calc(100dvh-2rem),920px)] !translate-x-0 !translate-y-0",
          "!flex w-[calc(100vw-1.25rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl",
          selectedType ? "sm:max-w-4xl" : "sm:max-w-xl",
        )}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Create request</DialogTitle>
          <DialogDescription>
            Choose a request type, then complete the intake form.
          </DialogDescription>
        </DialogHeader>
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8 pt-5 sm:px-5 sm:pt-6"
        >
          {open ? (
            <NewTicketIntake
              mode="modal"
              controlledType={selectedType}
              onControlledTypeChange={setSelectedType}
              onClose={() => onOpenChange(false)}
              onCreated={() => {
                router.refresh();
              }}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type CreateRequestButtonProps = {
  className?: string;
  label?: string;
  showPlusIcon?: boolean;
};

/** Opens the create-request modal (type list → type form). */
export function CreateRequestButton({
  className,
  label = "Create Request",
  showPlusIcon = false,
}: CreateRequestButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "inline-flex h-10 items-center gap-2 rounded-lg bg-[#f97316] px-4 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(249,115,22,0.32)] transition hover:bg-[#fb923c] active:translate-y-px"
        }
      >
        {showPlusIcon ? <Plus className="size-4" aria-hidden /> : null}
        {label}
      </button>
      <CreateRequestModal open={open} onOpenChange={setOpen} />
    </>
  );
}
