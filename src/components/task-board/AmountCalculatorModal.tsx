"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Calculator, Delete, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatWorkPlanAmount } from "@/lib/work-plan";

type AmountCalculatorModalProps = {
  open: boolean;
  initialValue?: string;
  onClose: () => void;
  /** Called with a formatted amount string (e.g. "1,250.00"). */
  onApply: (amount: string) => void;
};

type Op = "+" | "-" | "×" | "÷" | null;

function sanitizeDisplay(n: number): string {
  if (!Number.isFinite(n)) return "Error";
  // Keep enough precision while typing; format on apply.
  const rounded = Math.round(n * 1e8) / 1e8;
  return String(rounded);
}

export function AmountCalculatorModal({
  open,
  initialValue = "",
  onClose,
  onApply,
}: AmountCalculatorModalProps) {
  const [mounted, setMounted] = useState(false);
  const [display, setDisplay] = useState("0");
  const [stored, setStored] = useState<number | null>(null);
  const [op, setOp] = useState<Op>(null);
  const [fresh, setFresh] = useState(true);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const cleaned = initialValue.replace(/[^\d.-]/g, "").trim();
    const n = cleaned ? Number(cleaned) : 0;
    setDisplay(Number.isFinite(n) && cleaned ? sanitizeDisplay(n) : "0");
    setStored(null);
    setOp(null);
    setFresh(true);
  }, [open, initialValue]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || !mounted) return null;

  function inputDigit(d: string) {
    setDisplay((prev) => {
      if (fresh || prev === "0" || prev === "Error") {
        setFresh(false);
        return d === "." ? "0." : d;
      }
      if (d === "." && prev.includes(".")) return prev;
      if (prev.replace(/^-/, "").replace(".", "").length >= 14) return prev;
      return prev + d;
    });
  }

  function applyPending(): number | null {
    const current = Number(display);
    if (!Number.isFinite(current) || display === "Error") return null;
    if (stored == null || !op) return current;
    let result = current;
    if (op === "+") result = stored + current;
    else if (op === "-") result = stored - current;
    else if (op === "×") result = stored * current;
    else if (op === "÷") {
      if (current === 0) return null;
      result = stored / current;
    }
    return Number.isFinite(result) ? result : null;
  }

  function pressOp(next: Op) {
    const result = applyPending();
    if (result == null) {
      setDisplay("Error");
      setStored(null);
      setOp(null);
      setFresh(true);
      return;
    }
    setStored(result);
    setDisplay(sanitizeDisplay(result));
    setOp(next);
    setFresh(true);
  }

  function pressEquals() {
    const result = applyPending();
    if (result == null) {
      setDisplay("Error");
      setStored(null);
      setOp(null);
      setFresh(true);
      return;
    }
    setDisplay(sanitizeDisplay(result));
    setStored(null);
    setOp(null);
    setFresh(true);
  }

  function clearAll() {
    setDisplay("0");
    setStored(null);
    setOp(null);
    setFresh(true);
  }

  function backspace() {
    if (fresh || display === "Error") {
      clearAll();
      return;
    }
    setDisplay((prev) => {
      const next = prev.slice(0, -1);
      return next === "" || next === "-" ? "0" : next;
    });
  }

  function apply() {
    const result = applyPending();
    if (result == null || result < 0) {
      setDisplay("Error");
      return;
    }
    onApply(formatWorkPlanAmount(result));
    onClose();
  }

  const keys: Array<{ label: string; onClick: () => void; className?: string }> = [
    { label: "C", onClick: clearAll, className: "bg-zinc-200 dark:bg-zinc-700" },
    { label: "⌫", onClick: backspace, className: "bg-zinc-200 dark:bg-zinc-700" },
    { label: "÷", onClick: () => pressOp("÷"), className: "bg-amber-500/20 text-amber-900 dark:text-amber-100" },
    { label: "×", onClick: () => pressOp("×"), className: "bg-amber-500/20 text-amber-900 dark:text-amber-100" },
    { label: "7", onClick: () => inputDigit("7") },
    { label: "8", onClick: () => inputDigit("8") },
    { label: "9", onClick: () => inputDigit("9") },
    { label: "−", onClick: () => pressOp("-"), className: "bg-amber-500/20 text-amber-900 dark:text-amber-100" },
    { label: "4", onClick: () => inputDigit("4") },
    { label: "5", onClick: () => inputDigit("5") },
    { label: "6", onClick: () => inputDigit("6") },
    { label: "+", onClick: () => pressOp("+"), className: "bg-amber-500/20 text-amber-900 dark:text-amber-100" },
    { label: "1", onClick: () => inputDigit("1") },
    { label: "2", onClick: () => inputDigit("2") },
    { label: "3", onClick: () => inputDigit("3") },
    { label: "=", onClick: pressEquals, className: "bg-primary text-primary-foreground" },
    { label: "0", onClick: () => inputDigit("0"), className: "col-span-2" },
    { label: ".", onClick: () => inputDigit(".") },
    {
      label: "±",
      onClick: () =>
        setDisplay((prev) => {
          if (prev === "0" || prev === "Error") return prev;
          return prev.startsWith("-") ? prev.slice(1) : `-${prev}`;
        }),
      className: "bg-zinc-200 dark:bg-zinc-700",
    },
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50 px-3 py-6 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Amount calculator"
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-zinc-500" aria-hidden />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Amount calculator
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Close calculator"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-right dark:border-zinc-700 dark:bg-zinc-900">
          {op && stored != null ? (
            <p className="text-[11px] text-zinc-500">
              {sanitizeDisplay(stored)} {op}
            </p>
          ) : null}
          <p className="truncate font-mono text-2xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
            {display}
          </p>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {keys.map((key) => (
            <button
              key={key.label}
              type="button"
              onClick={key.onClick}
              className={cn(
                "min-h-11 rounded-xl border border-zinc-200 text-base font-semibold text-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800",
                key.className,
              )}
            >
              {key.label === "⌫" ? <Delete className="mx-auto h-4 w-4" /> : key.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={apply}
          className="mt-3 w-full rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          Use amount
        </button>
      </div>
    </div>,
    document.body,
  );
}

type AmountCalculatorButtonProps = {
  disabled?: boolean;
  value: string;
  onApply: (amount: string) => void;
  className?: string;
};

/** Icon button that opens {@link AmountCalculatorModal} and writes the result back. */
export function AmountCalculatorButton({
  disabled,
  value,
  onApply,
  className,
}: AmountCalculatorButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        title="Open calculator"
        aria-label="Open calculator"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
          className,
        )}
      >
        <Calculator className="h-4 w-4" />
      </button>
      <AmountCalculatorModal
        open={open}
        initialValue={value}
        onClose={() => setOpen(false)}
        onApply={onApply}
      />
    </>
  );
}
