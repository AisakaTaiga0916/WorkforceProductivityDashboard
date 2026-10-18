"use client";

import { EventManager, type Event } from "@/components/ui/event-manager";
import { DEFAULT_TIME_ZONE, getPeriodEndExclusive } from "@/modules/tasks/kpi-recurrence";
import { getTaskTargetDueDate } from "@/modules/tasks/kpi-subkpis";
import { useEffect, useMemo, useState } from "react";

type CalendarTask = {
  id: string;
  title: string;
  subKpis: unknown;
  frequency: string;
  isRecurring?: boolean;
  nonRecurringEndAt?: string | null;
  createdAt?: string | null;
  recurrenceWeekday?: number | null;
  recurrenceMonthDay?: number | null;
};

type CalendarTravelOrder = {
  id: string;
  orderRequest: string;
  estDepartureAt?: string | null;
  estArrivalAt?: string | null;
};

function dateFromTaskValue(value: string | null | undefined) {
  if (!value?.trim()) return null;
  const input = value.trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input) ? new Date(`${input}T09:00:00`) : new Date(input);
  return Number.isFinite(date.getTime()) ? date : null;
}

function taskDueDate(task: CalendarTask) {
  const explicitDueDate = dateFromTaskValue(getTaskTargetDueDate(task.subKpis));
  if (explicitDueDate) return explicitDueDate;

  const nonRecurringDueDate = dateFromTaskValue(task.nonRecurringEndAt);
  if (nonRecurringDueDate) return nonRecurringDueDate;

  if (task.isRecurring === false) {
    return dateFromTaskValue(task.createdAt) ?? new Date();
  }

  const frequency = ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "SEMI_ANNUAL", "YEARLY"].includes(task.frequency)
    ? task.frequency
    : "DAILY";

  const periodEnd = getPeriodEndExclusive(
    frequency as Parameters<typeof getPeriodEndExclusive>[0],
    task.recurrenceWeekday ?? null,
    task.recurrenceMonthDay ?? null,
    new Date(),
    DEFAULT_TIME_ZONE,
  );
  periodEnd.setMilliseconds(periodEnd.getMilliseconds() - 1);
  return periodEnd;
}

export function DashboardEventCalendar({ storageKey }: { storageKey: string }) {
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [travelOrders, setTravelOrders] = useState<CalendarTravelOrder[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadCalendarItems() {
      const [tasksResponse, travelOrdersResponse] = await Promise.all([
        fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(DEFAULT_TIME_ZONE)}`, { cache: "no-store" }),
        fetch("/api/travel-orders", { cache: "no-store" }),
      ]);
      if (cancelled) return;

      if (tasksResponse.ok) {
        const payload = (await tasksResponse.json()) as { rows?: CalendarTask[] };
        setTasks(Array.isArray(payload.rows) ? payload.rows : []);
      }
      if (travelOrdersResponse.ok) {
        const payload = (await travelOrdersResponse.json()) as { travelOrders?: CalendarTravelOrder[] };
        setTravelOrders(Array.isArray(payload.travelOrders) ? payload.travelOrders : []);
      }
    }

    void loadCalendarItems();
    return () => {
      cancelled = true;
    };
  }, []);

  const externalEvents = useMemo<Event[]>(() => {
    const taskEvents = tasks.map((task) => {
      const startTime = taskDueDate(task);
      return {
        id: `task-${task.id}`,
        title: `Task: ${task.title}`,
        description: "Scheduled task — select to open the Task Board.",
        startTime,
        endTime: new Date(startTime.getTime() + 60 * 60 * 1000),
        color: "orange",
        category: "Task",
        tags: ["Work"],
        readOnly: true,
        href: `/agent/tasks?task=${encodeURIComponent(task.id)}`,
      };
    });

    const travelEvents = travelOrders.flatMap((order) => {
      const departure = dateFromTaskValue(order.estDepartureAt);
      const arrival = dateFromTaskValue(order.estArrivalAt);
      const startTime = departure ?? arrival;
      if (!startTime) return [];
      const endTime = arrival && arrival >= startTime ? arrival : new Date(startTime.getTime() + 60 * 60 * 1000);
      return [
        {
          id: `travel-order-${order.id}`,
          title: `Travel: ${order.orderRequest || "Travel Order"}`,
          description: "Estimated departure and arrival — select to open Travel Orders.",
          startTime,
          endTime,
          color: "blue",
          category: "Travel Order",
          tags: ["Work"],
          readOnly: true,
          href: "/travel-orders",
        },
      ];
    });

    return [...taskEvents, ...travelEvents];
  }, [tasks, travelOrders]);

  return (
    <EventManager
      storageKey={storageKey}
      externalEvents={externalEvents}
      taskBoardHref="/agent/tasks"
      categories={["Meeting", "Task", "Travel Order", "Reminder", "Personal"]}
      className="rounded-xl border border-zinc-200 bg-white p-3 shadow-[0_8px_28px_rgba(0,0,0,0.06)] sm:p-5 dark:border-zinc-800 dark:bg-surface dark:shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
    />
  );
}
