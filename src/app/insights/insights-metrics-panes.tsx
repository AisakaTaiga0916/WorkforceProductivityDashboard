"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { EmblaCarouselType } from "embla-carousel";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";

export type InsightsMetricsPane = "request" | "task";

function shouldIgnorePaneDrag(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (
    target.closest(
      "a, button, input, textarea, select, label, [role='button'], [role='link'], [role='tab'], [role='combobox'], [role='dialog'], [contenteditable='true'], [data-chart], [data-metrics-inspect], canvas, svg, [data-radix-popper-content-wrapper]",
    )
  ) {
    return true;
  }
  return false;
}

type InsightsMetricsPanesProps = {
  pane: InsightsMetricsPane;
  onPaneChange: (pane: InsightsMetricsPane) => void;
  requestMetrics: ReactNode;
  taskMetrics: ReactNode;
};

export function InsightsMetricsPanes({
  pane,
  onPaneChange,
  requestMetrics,
  taskMetrics,
}: InsightsMetricsPanesProps) {
  const [api, setApi] = useState<CarouselApi>();

  useEffect(() => {
    if (!api) return;

    const onSelect = (embla: EmblaCarouselType) => {
      const next: InsightsMetricsPane = embla.selectedScrollSnap() === 1 ? "task" : "request";
      onPaneChange(next);
    };

    api.on("select", onSelect);
    return () => {
      api.off("select", onSelect);
    };
  }, [api, onPaneChange]);

  useEffect(() => {
    if (!api) return;
    const want = pane === "task" ? 1 : 0;
    if (api.selectedScrollSnap() !== want) {
      api.scrollTo(want);
    }
  }, [api, pane]);

  return (
    <Carousel
      setApi={setApi}
      opts={{
        align: "start",
        containScroll: "trimSnaps",
        dragFree: false,
        skipSnaps: false,
        watchDrag: (_embla, event) => !shouldIgnorePaneDrag(event.target),
      }}
      className="w-full"
    >
      <CarouselContent className="-ml-0">
        <CarouselItem className="pl-0">
          <div className="min-w-0 space-y-8">{requestMetrics}</div>
        </CarouselItem>
        <CarouselItem className="pl-0">
          <div className="min-w-0 space-y-6">{taskMetrics}</div>
        </CarouselItem>
      </CarouselContent>
    </Carousel>
  );
}
