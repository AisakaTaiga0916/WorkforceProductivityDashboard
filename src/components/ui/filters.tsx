"use client";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import {
  BookmarkPlus,
  Building2,
  Calendar,
  CalendarPlus,
  CalendarSync,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDotDashed,
  CircleEllipsis,
  CircleX,
  FileText,
  ListFilter,
  Network,
  Repeat,
  SignalHigh,
  SignalLow,
  SignalMedium,
  Star,
  Tag,
  Trash2,
  UserCircle,
  X,
} from "lucide-react";
import { Dispatch, Fragment, SetStateAction, useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { AnimatePresence, motion } from "motion/react";

interface AnimateChangeInHeightProps {
  children: React.ReactNode;
  className?: string;
}

export const AnimateChangeInHeight: React.FC<AnimateChangeInHeightProps> = ({
  children,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | "auto">("auto");

  useEffect(() => {
    if (containerRef.current) {
      const resizeObserver = new ResizeObserver((entries) => {
        // We only have one entry, so we can use entries[0].
        const observedHeight = entries[0].contentRect.height;
        setHeight(observedHeight);
      });

      resizeObserver.observe(containerRef.current);

      return () => {
        // Cleanup the observer when the component is unmounted
        resizeObserver.disconnect();
      };
    }
  }, []);

  return (
    <motion.div
      className={cn(className, "overflow-hidden")}
      style={{ height }}
      animate={{ height }}
      transition={{ duration: 0.1, damping: 0.2, ease: "easeIn" }}
    >
      <div ref={containerRef}>{children}</div>
    </motion.div>
  );
};

export enum FilterType {
  STATUS = "Status",
  ASSIGNEE = "Assignee",
  LABELS = "Labels",
  PRIORITY = "Priority",
  DUE_DATE = "Due date",
  CREATED_DATE = "Created date",
  UPDATED_DATE = "Updated date",
}

export enum FilterOperator {
  IS = "is",
  IS_NOT = "is not",
  IS_ANY_OF = "is any of",
  INCLUDE = "include",
  DO_NOT_INCLUDE = "do not include",
  INCLUDE_ALL_OF = "include all of",
  INCLUDE_ANY_OF = "include any of",
  EXCLUDE_ALL_OF = "exclude all of",
  EXCLUDE_IF_ANY_OF = "exclude if any of",
  BEFORE = "before",
  AFTER = "after",
}

export enum Status {
  BACKLOG = "Backlog",
  TODO = "Todo",
  IN_PROGRESS = "In Progress",
  IN_REVIEW = "In Review",
  DONE = "Done",
  CANCELLED = "Cancelled",
}

export enum Assignee {
  ANDREW_LUO = "Andrew Luo",
  NO_ASSIGNEE = "No assignee",
}

export enum Labels {
  BUG = "Bug",
  FEATURE = "Feature",
  HOTFIX = "Hotfix",
  RELEASE = "Release",
}

export enum Priority {
  URGENT = "Urgent",
  HIGH = "High",
  MEDIUM = "Medium",
  LOW = "Low",
}

export enum DueDate {
  IN_THE_PAST = "in the past",
  IN_24_HOURS = "24 hours from now",
  IN_3_DAYS = "3 days from now",
  IN_1_WEEK = "1 week from now",
  IN_1_MONTH = "1 month from now",
  IN_3_MONTHS = "3 months from now",
}

export type FilterOption = {
  name: string;
  icon: React.ReactNode | undefined;
  label?: string;
  /** Stable unique id when `name` can repeat (e.g. duplicate people). */
  id?: string;
};

export type Filter = {
  id: string;
  type: string;
  operator: FilterOperator;
  value: string[];
};

export type SavedFilter = {
  id: string;
  name: string;
  params: Record<string, string>;
  createdAt: number;
};

export function loadSavedFilters(storageKey: string): SavedFilter[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (f) =>
        f &&
        typeof f.id === "string" &&
        typeof f.name === "string" &&
        typeof f.params === "object" &&
        !Array.isArray(f.params)
    );
  } catch {
    return [];
  }
}

export function persistSavedFilters(storageKey: string, filters: SavedFilter[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(filters));
  } catch {
    // Ignore storage failures (private mode / quota).
  }
}

export const FilterIcon = ({
  type,
}: {
  type: string;
}) => {
  switch (type) {
    case Assignee.ANDREW_LUO:
      return (
        <Avatar className="size-3.5 rounded-full text-[9px] text-white">
          <AvatarFallback className="bg-orange-300">AL</AvatarFallback>
        </Avatar>
      );
    case Assignee.NO_ASSIGNEE:
      return <UserCircle className="size-3.5" />;
    case FilterType.STATUS:
      return <CircleDashed className="size-3.5" />;
    case FilterType.ASSIGNEE:
      return <UserCircle className="size-3.5" />;
    case FilterType.LABELS:
      return <Tag className="size-3.5" />;
    case FilterType.PRIORITY:
      return <SignalHigh className="size-3.5" />;
    case FilterType.DUE_DATE:
      return <Calendar className="size-3.5" />;
    case FilterType.CREATED_DATE:
      return <CalendarPlus className="size-3.5" />;
    case FilterType.UPDATED_DATE:
      return <CalendarSync className="size-3.5" />;
    case "Company":
      return <Building2 className="size-3.5" />;
    case "Department":
    case "Departments":
    case "Section":
      return <Network className="size-3.5" />;
    case "Sent by":
      return <Building2 className="size-3.5" />;
    case "Received":
      return <Network className="size-3.5" />;
    case "Request type":
      return <FileText className="size-3.5" />;
    case "Assigned":
      return <UserCircle className="size-3.5" />;
    case "Priority":
      return <SignalHigh className="size-3.5" />;
    case "Status":
      return <CircleDashed className="size-3.5" />;
    case "Category":
      return <Tag className="size-3.5" />;
    case "Frequency":
      return <Repeat className="size-3.5" />;
    case "Task":
    case "Task type":
      return <Tag className="size-3.5" />;
    case "Cadence":
      return <Calendar className="size-3.5" />;
    case Status.BACKLOG:
      return <CircleDashed className="size-3.5 text-muted-subtle" />;
    case Status.TODO:
      return <Circle className="size-3.5 text-brand" />;
    case Status.IN_PROGRESS:
      return <CircleDotDashed className="size-3.5 text-yellow-400" />;
    case Status.IN_REVIEW:
      return <CircleEllipsis className="size-3.5 text-green-400" />;
    case Status.DONE:
      return <CircleCheck className="size-3.5 text-blue-400" />;
    case Status.CANCELLED:
      return <CircleX className="size-3.5 text-muted-subtle" />;
    case Priority.URGENT:
      return <CircleAlert className="size-3.5" />;
    case Priority.HIGH:
      return <SignalHigh className="size-3.5" />;
    case Priority.MEDIUM:
      return <SignalMedium className="size-3.5" />;
    case Priority.LOW:
      return <SignalLow className="size-3.5" />;
    case Labels.BUG:
      return <div className="bg-red-400 rounded-full size-2.5" />;
    case Labels.FEATURE:
      return <div className="bg-blue-400 rounded-full size-2.5" />;
    case Labels.HOTFIX:
      return <div className="bg-amber-400 rounded-full size-2.5" />;
    case Labels.RELEASE:
      return <div className="bg-green-400 rounded-full size-2.5" />;
  }
};

export const filterViewOptions: FilterOption[][] = [
  [
    {
      name: FilterType.STATUS,
      icon: <FilterIcon type={FilterType.STATUS} />,
    },
    {
      name: FilterType.ASSIGNEE,
      icon: <FilterIcon type={FilterType.ASSIGNEE} />,
    },
    {
      name: FilterType.LABELS,
      icon: <FilterIcon type={FilterType.LABELS} />,
    },
    {
      name: FilterType.PRIORITY,
      icon: <FilterIcon type={FilterType.PRIORITY} />,
    },
  ],
  [
    {
      name: FilterType.DUE_DATE,
      icon: <FilterIcon type={FilterType.DUE_DATE} />,
    },
    {
      name: FilterType.CREATED_DATE,
      icon: <FilterIcon type={FilterType.CREATED_DATE} />,
    },
    {
      name: FilterType.UPDATED_DATE,
      icon: <FilterIcon type={FilterType.UPDATED_DATE} />,
    },
  ],
];

export const statusFilterOptions: FilterOption[] = Object.values(Status).map(
  (status) => ({
    name: status,
    icon: <FilterIcon type={status} />,
  })
);

export const assigneeFilterOptions: FilterOption[] = Object.values(
  Assignee
).map((assignee) => ({
  name: assignee,
  icon: <FilterIcon type={assignee} />,
}));

export const labelFilterOptions: FilterOption[] = Object.values(Labels).map(
  (label) => ({
    name: label,
    icon: <FilterIcon type={label} />,
  })
);

export const priorityFilterOptions: FilterOption[] = Object.values(
  Priority
).map((priority) => ({
  name: priority,
  icon: <FilterIcon type={priority} />,
}));

export const dateFilterOptions: FilterOption[] = Object.values(DueDate).map(
  (date) => ({
    name: date,
    icon: undefined,
  })
);

export const filterViewToFilterOptions: Record<FilterType, FilterOption[]> = {
  [FilterType.STATUS]: statusFilterOptions,
  [FilterType.ASSIGNEE]: assigneeFilterOptions,
  [FilterType.LABELS]: labelFilterOptions,
  [FilterType.PRIORITY]: priorityFilterOptions,
  [FilterType.DUE_DATE]: dateFilterOptions,
  [FilterType.CREATED_DATE]: dateFilterOptions,
  [FilterType.UPDATED_DATE]: dateFilterOptions,
};

const filterOperators = ({
  filterType,
  filterValues,
}: {
  filterType: string;
  filterValues: string[];
}) => {
  switch (filterType) {
    case FilterType.STATUS:
    case FilterType.ASSIGNEE:
    case FilterType.PRIORITY:
      if (Array.isArray(filterValues) && filterValues.length > 1) {
        return [FilterOperator.IS_ANY_OF, FilterOperator.IS_NOT];
      } else {
        return [FilterOperator.IS, FilterOperator.IS_NOT];
      }
    case FilterType.LABELS:
      if (Array.isArray(filterValues) && filterValues.length > 1) {
        return [
          FilterOperator.INCLUDE_ANY_OF,
          FilterOperator.INCLUDE_ALL_OF,
          FilterOperator.EXCLUDE_ALL_OF,
          FilterOperator.EXCLUDE_IF_ANY_OF,
        ];
      } else {
        return [FilterOperator.INCLUDE, FilterOperator.DO_NOT_INCLUDE];
      }
    case FilterType.DUE_DATE:
    case FilterType.CREATED_DATE:
    case FilterType.UPDATED_DATE:
      if (filterValues?.includes(DueDate.IN_THE_PAST)) {
        return [FilterOperator.IS, FilterOperator.IS_NOT];
      } else {
        return [FilterOperator.BEFORE, FilterOperator.AFTER];
      }
    default:
      return [];
  }
};

const FilterOperatorDropdown = ({
  filterType,
  operator,
  filterValues,
  setOperator,
}: {
  filterType: string;
  operator: FilterOperator;
  filterValues: string[];
  setOperator: (operator: FilterOperator) => void;
}) => {
  const operators = filterOperators({ filterType, filterValues });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="bg-surface-muted hover:bg-surface-muted/70 px-1.5 py-1 text-muted-subtle hover:text-brand transition shrink-0">
        {operator}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-fit min-w-fit">
        {operators.map((operator) => (
          <DropdownMenuItem
            key={operator}
            onClick={() => setOperator(operator)}
          >
            {operator}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const FilterValueCombobox = ({
  filterType,
  filterValues,
  setFilterValues,
  filterOptions = filterViewToFilterOptions,
}: {
  filterType: string;
  filterValues: string[];
  setFilterValues: (filterValues: string[]) => void;
  filterOptions?: Partial<Record<string, FilterOption[]>>;
}) => {
  const [open, setOpen] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const commandInputRef = useRef<HTMLInputElement>(null);
  const nonSelectedFilterValues = filterOptions[filterType]?.filter(
    (filter) => !filterValues.includes(filter.name)
  );
  return (
    <Popover
      open={open}
      onOpenChange={(open) => {
        setOpen(open);
        if (!open) {
          setTimeout(() => {
            setCommandInput("");
          }, 200);
        }
      }}
    >
      <PopoverTrigger
        className="rounded-none px-1.5 py-1 bg-surface-muted hover:bg-surface-muted/70 transition
  text-muted-subtle hover:text-brand shrink-0"
      >
        <div className="flex gap-1.5 items-center">
          {filterType !== FilterType.PRIORITY && (
            <div
              className={cn(
                "flex items-center flex-row",
                filterType === FilterType.LABELS ? "-space-x-1" : "-space-x-1.5"
              )}
            >
              <AnimatePresence mode="popLayout">
                {filterValues?.slice(0, 3).map((value) => (
                  <motion.div
                    key={value}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <FilterIcon type={value as FilterType} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
          {filterValues?.length === 1
            ? filterValues?.[0]
            : `${filterValues?.length} selected`}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0">
        <AnimateChangeInHeight>
          <Command>
            <CommandInput
              placeholder={filterType}
              className="h-9"
              value={commandInput}
              onInputCapture={(e) => {
                setCommandInput(e.currentTarget.value);
              }}
              ref={commandInputRef}
            />
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
              <CommandGroup>
                {filterValues.map((value) => (
                  <CommandItem
                    key={value}
                    className="group flex gap-2 items-center"
                    onSelect={() => {
                      setFilterValues(filterValues.filter((v) => v !== value));
                      setTimeout(() => {
                        setCommandInput("");
                      }, 200);
                      setOpen(false);
                    }}
                  >
                    <Checkbox checked={true} />
                    <FilterIcon type={value as FilterType} />
                    {value}
                  </CommandItem>
                ))}
              </CommandGroup>
              {nonSelectedFilterValues && nonSelectedFilterValues.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    {nonSelectedFilterValues.map((filter: FilterOption) => (
                      <CommandItem
                        className="group flex gap-2 items-center"
                        key={filter.id ?? filter.name}
                        value={filter.name}
                        onSelect={() => {
                          setFilterValues([...filterValues, filter.name]);
                          setTimeout(() => {
                            setCommandInput("");
                          }, 200);
                          setOpen(false);
                        }}
                      >
                        <Checkbox
                          checked={false}
                          className="opacity-0 group-data-[selected=true]:opacity-100"
                        />
                        {filter.icon}
                        <span className="text-foreground">
                          {filter.name}
                        </span>
                        {filter.label && (
                          <span className="text-muted-subtle text-xs ml-auto">
                            {filter.label}
                          </span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </AnimateChangeInHeight>
      </PopoverContent>
    </Popover>
  );
};

const FilterValueDateCombobox = ({
  filterType,
  filterValues,
  setFilterValues,
  filterOptions = filterViewToFilterOptions,
}: {
  filterType: string;
  filterValues: string[];
  setFilterValues: (filterValues: string[]) => void;
  filterOptions?: Partial<Record<string, FilterOption[]>>;
}) => {
  const [open, setOpen] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const commandInputRef = useRef<HTMLInputElement>(null);
  return (
    <Popover
      open={open}
      onOpenChange={(open) => {
        setOpen(open);
        if (!open) {
          setTimeout(() => {
            setCommandInput("");
          }, 200);
        }
      }}
    >
      <PopoverTrigger
        className="rounded-none px-1.5 py-1 bg-surface-muted hover:bg-surface-muted/70 transition
  text-muted-subtle hover:text-brand shrink-0"
      >
        {filterValues?.[0]}
      </PopoverTrigger>
      <PopoverContent className="w-fit p-0">
        <AnimateChangeInHeight>
          <Command>
            <CommandInput
              placeholder={filterType}
              className="h-9"
              value={commandInput}
              onInputCapture={(e) => {
                setCommandInput(e.currentTarget.value);
              }}
              ref={commandInputRef}
            />
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
              <CommandGroup>
                {filterOptions[filterType]?.map(
                  (filter: FilterOption) => (
                    <CommandItem
                      className="group flex gap-2 items-center"
                      key={filter.id ?? filter.name}
                      value={filter.name}
                      onSelect={() => {
                        setFilterValues([filter.name]);
                        setTimeout(() => {
                          setCommandInput("");
                        }, 200);
                        setOpen(false);
                      }}
                    >
                      <span className="text-foreground">
                        {filter.name}
                      </span>
                      <Check
                        className={cn(
                          "ml-auto",
                          filterValues.includes(filter.name)
                            ? "opacity-100"
                            : "opacity-0"
                        )}
                      />
                    </CommandItem>
                  )
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </AnimateChangeInHeight>
      </PopoverContent>
    </Popover>
  );
};

export default function Filters({
  filters,
  setFilters,
  filterOptions = filterViewToFilterOptions,
  showOperators = true,
}: {
  filters: Filter[];
  setFilters: Dispatch<SetStateAction<Filter[]>>;
  filterOptions?: Partial<Record<string, FilterOption[]>>;
  showOperators?: boolean;
}) {
  return (
    <div className="flex gap-2">
      {filters
        .filter((filter) => filter.value?.length > 0)
        .map((filter) => (
          <div key={filter.id} className="flex gap-[1px] items-center text-xs">
            <div className="flex gap-1.5 shrink-0 rounded-l bg-surface-muted px-1.5 py-1 items-center">
              <FilterIcon type={filter.type} />
              {filter.type}
            </div>
            {showOperators ? (
              <FilterOperatorDropdown
                filterType={filter.type}
                operator={filter.operator}
                filterValues={filter.value}
                setOperator={(operator) => {
                  setFilters((prev) =>
                    prev.map((f) => (f.id === filter.id ? { ...f, operator } : f))
                  );
                }}
              />
            ) : null}
            {filter.type === FilterType.CREATED_DATE ||
            filter.type === FilterType.UPDATED_DATE ||
            filter.type === FilterType.DUE_DATE ? (
              <FilterValueDateCombobox
                filterType={filter.type}
                filterValues={filter.value}
                filterOptions={filterOptions}
                setFilterValues={(filterValues) => {
                  setFilters((prev) =>
                    prev.map((f) =>
                      f.id === filter.id ? { ...f, value: filterValues } : f
                    )
                  );
                }}
              />
            ) : (
              <FilterValueCombobox
                filterType={filter.type}
                filterValues={filter.value}
                filterOptions={filterOptions}
                setFilterValues={(filterValues) => {
                  setFilters((prev) =>
                    prev.map((f) =>
                      f.id === filter.id ? { ...f, value: filterValues } : f
                    )
                  );
                }}
              />
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setFilters((prev) => prev.filter((f) => f.id !== filter.id));
              }}
              className="bg-surface-muted rounded-l-none rounded-r-sm h-6 w-6 text-muted-subtle hover:text-brand hover:bg-surface-muted/70 transition shrink-0"
            >
              <X className="size-3" />
            </Button>
          </div>
        ))}
    </div>
  );
}

export function FiltersTrigger({
  viewOptions,
  filterOptions,
  onSelect,
  className,
  onSaveFilter,
  onApplySavedFilter,
  onDeleteSavedFilter,
  savedFilters,
  canSaveCurrent = true,
}: {
  viewOptions: FilterOption[][];
  filterOptions: Partial<Record<string, FilterOption[]>>;
  onSelect: (type: string, value: string) => void;
  className?: string;
  onSaveFilter?: (name: string) => void;
  onApplySavedFilter?: (filter: SavedFilter) => void;
  onDeleteSavedFilter?: (id: string) => void;
  savedFilters?: SavedFilter[];
  canSaveCurrent?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selectedView, setSelectedView] = useState<string | null>(null);
  const [commandInput, setCommandInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const commandInputRef = useRef<HTMLInputElement>(null);
  const saveNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (saving) {
      const timeout = setTimeout(() => saveNameRef.current?.focus(), 50);
      return () => clearTimeout(timeout);
    }
  }, [saving]);

  function commitSave() {
    const name = saveName.trim();
    if (!name || !onSaveFilter) return;
    onSaveFilter(name);
    setSaving(false);
    setSaveName("");
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(open) => {
        setOpen(open);
        if (!open) {
          setTimeout(() => {
            setSelectedView(null);
            setCommandInput("");
            setSaving(false);
            setSaveName("");
          }, 200);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          size="sm"
          className={cn(
            "group flex h-6 items-center gap-1.5 rounded-sm text-xs transition",
            className
          )}
        >
          <ListFilter className="size-3 shrink-0 text-muted-subtle transition-all group-hover:text-brand" />
          Filter
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0 shadow-lg">
        <AnimateChangeInHeight>
          {saving ? (
            <Command>
              <CommandInput
                placeholder="Name this filter set…"
                className="h-9"
                value={saveName}
                onInputCapture={(e) => {
                  setSaveName(e.currentTarget.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setSaving(false);
                    setSaveName("");
                    return;
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitSave();
                  }
                }}
                ref={saveNameRef}
              />
              <CommandList>
                <CommandEmpty>Enter a name to save.</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    className="flex items-center gap-2"
                    disabled={!saveName.trim()}
                    onSelect={commitSave}
                  >
                    <BookmarkPlus className="size-3.5 shrink-0 text-muted-subtle" />
                    <span className="text-foreground">Save filter</span>
                  </CommandItem>
                  <CommandItem
                    className="flex items-center gap-2"
                    onSelect={() => {
                      setSaving(false);
                      setSaveName("");
                    }}
                  >
                    <ChevronLeft className="size-3.5 shrink-0 text-muted-subtle" />
                    <span className="text-foreground">Cancel</span>
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          ) : (
            <Command>
              <CommandInput
                placeholder={selectedView ? `Search ${selectedView.toLowerCase()}…` : "Search filters…"}
                className="h-9"
                value={commandInput}
                onInputCapture={(e) => {
                  setCommandInput(e.currentTarget.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && !commandInput && selectedView) {
                    e.preventDefault();
                    setSelectedView(null);
                  }
                }}
                ref={commandInputRef}
              />
              <CommandList>
                <CommandEmpty>No results found.</CommandEmpty>
                {selectedView ? (
                  <CommandGroup>
                    <CommandItem
                      className="flex items-center gap-2 text-muted-subtle"
                      value="__back__"
                      onSelect={() => {
                        setSelectedView(null);
                        setCommandInput("");
                        commandInputRef.current?.focus();
                      }}
                    >
                      <ChevronLeft className="size-3.5 shrink-0" />
                      <span>Back to filters</span>
                    </CommandItem>
                    {filterOptions[selectedView]?.map((filter: FilterOption) => (
                      <CommandItem
                        className="group flex items-center gap-2"
                        key={filter.id ?? filter.name}
                        value={`${filter.name} ${filter.id ?? ""}`}
                        onSelect={() => {
                          // Prefer option name (original casing). cmdk lowercases `currentValue`.
                          onSelect(selectedView, filter.name);
                          setTimeout(() => {
                            setSelectedView(null);
                            setCommandInput("");
                          }, 200);
                          setOpen(false);
                        }}
                      >
                        {filter.icon}
                        <span className="min-w-0 flex-1 truncate text-foreground">
                          {filter.name}
                        </span>
                        {filter.label ? (
                          <span className="ml-auto shrink-0 text-xs text-muted-subtle">
                            {filter.label}
                          </span>
                        ) : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : (
                  <>
                    {viewOptions.map((group: FilterOption[], index: number) => (
                      <Fragment key={index}>
                        <CommandGroup heading={index === 0 ? "Add filter" : undefined}>
                          {group.map((filter: FilterOption) => (
                            <CommandItem
                              className="group flex items-center gap-2"
                              key={filter.id ?? filter.name}
                              value={filter.name}
                              onSelect={(currentValue) => {
                                setSelectedView(currentValue);
                                setCommandInput("");
                                commandInputRef.current?.focus();
                              }}
                            >
                              <span className="flex size-5 shrink-0 items-center justify-center text-muted-subtle">
                                {filter.icon}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-foreground">
                                {filter.name}
                              </span>
                              <ChevronRight className="size-3.5 shrink-0 text-muted-subtle opacity-60 group-data-[selected=true]:opacity-100" />
                            </CommandItem>
                          ))}
                        </CommandGroup>
                        {index < viewOptions.length - 1 && (
                          <CommandSeparator />
                        )}
                      </Fragment>
                    ))}
                    {savedFilters !== undefined ? (
                      <>
                        <CommandSeparator />
                        <CommandGroup>
                          <CommandItem
                            className={cn(
                              "flex items-start gap-2 py-2",
                              !canSaveCurrent && "opacity-70",
                            )}
                            disabled={!canSaveCurrent}
                            onSelect={() => {
                              if (!canSaveCurrent) return;
                              setSaving(true);
                              setCommandInput("");
                            }}
                          >
                            <BookmarkPlus className="mt-0.5 size-3.5 shrink-0 text-muted-subtle" />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm text-foreground">
                                Save current filters
                              </span>
                              <span className="mt-0.5 block text-xs text-muted-subtle">
                                {canSaveCurrent
                                  ? "Keep this combination for later"
                                  : "Add a filter or search first"}
                              </span>
                            </span>
                          </CommandItem>
                        </CommandGroup>
                        <CommandSeparator />
                        <CommandGroup heading="Favorites">
                          {savedFilters.length === 0 ? (
                            <p className="px-2 py-2 text-xs leading-relaxed text-muted-subtle">
                              No saved filters yet. Save a combination to reuse it here.
                            </p>
                          ) : (
                            savedFilters.map((filter) => (
                              <CommandItem
                                key={filter.id}
                                className="group flex items-center gap-2"
                                value={`Saved: ${filter.name}`}
                                onSelect={() => {
                                  onApplySavedFilter?.(filter);
                                  setOpen(false);
                                }}
                              >
                                <Star className="size-3.5 shrink-0 fill-amber-500/20 text-amber-500" />
                                <span className="min-w-0 flex-1 truncate text-foreground">
                                  {filter.name}
                                </span>
                                <span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-subtle">
                                  {Object.keys(filter.params).length}
                                </span>
                                <button
                                  type="button"
                                  aria-label={`Delete saved filter ${filter.name}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onDeleteSavedFilter?.(filter.id);
                                  }}
                                  className="rounded-sm p-0.5 text-muted-subtle opacity-70 transition hover:bg-surface-muted hover:text-red-500 hover:opacity-100"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </CommandItem>
                            ))
                          )}
                        </CommandGroup>
                      </>
                    ) : null}
                  </>
                )}
              </CommandList>
            </Command>
          )}
        </AnimateChangeInHeight>
      </PopoverContent>
    </Popover>
  );
}
