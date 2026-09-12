import {
  ADJUST_LABELS,
  type AdjustType,
  FREE_TIER_PERIODS,
  PERIOD_LABELS,
  type Period,
  TIME_SPANS,
} from "@wyckoff/shared";
import type { ReactNode } from "react";
import {
  Crosshair,
  Eraser,
  Eye,
  EyeOff,
  MousePointer2,
  Trash2,
} from "lucide-react";
import { DRAWING_TOOLS, INDICATORS, useWorkbench } from "@/store.js";
import { cn } from "@/lib/utils.js";

const ALL_PERIODS = Object.keys(PERIOD_LABELS) as Period[];
const ADJUSTS: AdjustType[] = ["forward", "backward", "none"];

export function ChartToolbar() {
  const period = useWorkbench((s) => s.period);
  const adjust = useWorkbench((s) => s.adjust);
  const timeSpan = useWorkbench((s) => s.timeSpan);
  const indicators = useWorkbench((s) => s.indicators);
  const activeTool = useWorkbench((s) => s.activeTool);
  const selectionMode = useWorkbench((s) => s.selectionMode);
  const freeTier = useWorkbench((s) => s.freeTier);
  const annotationGroups = useWorkbench((s) => s.annotationGroups);
  const setPeriod = useWorkbench((s) => s.setPeriod);
  const setAdjust = useWorkbench((s) => s.setAdjust);
  const setTimeSpan = useWorkbench((s) => s.setTimeSpan);
  const toggleIndicator = useWorkbench((s) => s.toggleIndicator);
  const setActiveTool = useWorkbench((s) => s.setActiveTool);
  const toggleSelectionMode = useWorkbench((s) => s.toggleSelectionMode);
  const toggleAnnotationGroup = useWorkbench((s) => s.toggleAnnotationGroup);
  const removeAnnotationGroup = useWorkbench((s) => s.removeAnnotationGroup);
  const clearAllAnnotations = useWorkbench((s) => s.clearAllAnnotations);
  const notify = useWorkbench((s) => s.notify);

  return (
    <div className="chart-toolbar flex flex-col gap-1.5 border-b border-line-soft px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1">
        <ToolGroup label="周期">
          {ALL_PERIODS.map((p) => {
            const locked = freeTier && !FREE_TIER_PERIODS.includes(p);
            return (
              <Chip
                key={p}
                active={period === p}
                disabled={locked}
                title={locked ? "免费档不支持分钟线，请升级 TickFlow" : PERIOD_LABELS[p]}
                onClick={() => {
                  if (locked) {
                    notify("免费档仅支持日线及以上周期", "error");
                    return;
                  }
                  setPeriod(p);
                }}
              >
                {PERIOD_LABELS[p]}
              </Chip>
            );
          })}
        </ToolGroup>

        <Divider />

        <ToolGroup label="复权">
          {ADJUSTS.map((a) => (
            <Chip key={a} active={adjust === a} onClick={() => setAdjust(a)}>
              {ADJUST_LABELS[a]}
            </Chip>
          ))}
        </ToolGroup>

        <Divider />

        <ToolGroup label="跨度">
          {TIME_SPANS.map((s) => (
            <Chip key={s.id} active={timeSpan === s.id} onClick={() => setTimeSpan(s.id)}>
              {s.label}
            </Chip>
          ))}
        </ToolGroup>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <ToolGroup label="指标">
          {INDICATORS.map((ind) => (
            <Chip key={ind.id} active={indicators.includes(ind.id)} onClick={() => toggleIndicator(ind.id)}>
              {ind.label}
            </Chip>
          ))}
        </ToolGroup>

        <Divider />

        <ToolGroup label="绘图">
          <Chip
            active={!activeTool && !selectionMode}
            title="选择 / 平移"
            onClick={() => setActiveTool(null)}
          >
            <MousePointer2 size={12} />
          </Chip>
          <Chip active={selectionMode} title="框选区间提问" onClick={() => toggleSelectionMode()}>
            <Crosshair size={12} />
            <span>框选</span>
          </Chip>
          {DRAWING_TOOLS.map((tool) => (
            <Chip
              key={tool.id}
              active={activeTool === tool.id}
              title={tool.label}
              onClick={() => setActiveTool(activeTool === tool.id ? null : tool.id)}
            >
              {tool.label}
            </Chip>
          ))}
        </ToolGroup>

        {annotationGroups.length > 0 && (
          <>
            <Divider />
            <ToolGroup label="标注">
              {annotationGroups.map((g) => (
                <span key={g.groupId} className="inline-flex items-center gap-0.5">
                  <Chip
                    active={g.visible}
                    title={g.visible ? "隐藏" : "显示"}
                    onClick={() => void toggleAnnotationGroup(g.groupId)}
                  >
                    {g.visible ? <Eye size={11} /> : <EyeOff size={11} />}
                    <span className="max-w-[7rem] truncate">{g.title}</span>
                  </Chip>
                  <button
                    type="button"
                    className="rounded p-0.5 text-ink-faint hover:text-up"
                    title="删除该组"
                    onClick={() => void removeAnnotationGroup(g.groupId)}
                  >
                    <Trash2 size={11} />
                  </button>
                </span>
              ))}
              <Chip title="清空全部标注" onClick={() => void clearAllAnnotations()}>
                <Eraser size={12} />
                <span>清空</span>
              </Chip>
            </ToolGroup>
          </>
        )}
      </div>
    </div>
  );
}

function ToolGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-1 font-mono text-[8px] font-semibold uppercase tracking-[0.14em] text-ink-faint">{label}</span>
      {children}
    </div>
  );
}

function Divider() {
  return <span className="mx-1 hidden h-4 w-px bg-line sm:inline-block" />;
}

function Chip({
  children,
  active,
  disabled,
  title,
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "glass-chip inline-flex items-center gap-1 rounded-[8px] px-2.5 py-0.5 text-[10px]",
        disabled && "cursor-not-allowed opacity-35",
        active && "glass-chip-active",
      )}
    >
      {children}
    </button>
  );
}
