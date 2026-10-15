import { ChoiceSheet } from '@/components/choice-sheet';
import { SEMANTIC_TARGETS, type SemanticTarget } from '@/domain/schedule-presets';

export interface ScheduleActionSheetProps {
  /** 是否出现 */
  visible: boolean;
  /** 选中的条数，用于标题「为选中的 N 条排期」 */
  count: number;
  /** 关掉面板 */
  onClose: () => void;
  /** 选了某个语义目标（今天/明天/周末…），由调用方应用到全部选中项 */
  onApply: (target: SemanticTarget) => void;
}

/**
 * 多选「排期」弹出的面板（2026-10-15）。
 *
 * 和单条长按菜单是**同一组按"哪天"说话的词片**（SEMANTIC_TARGETS），
 * 区别只在于：单条菜单排的是那一条，这里排的是选中的一批。
 * 自定义时间暂不做——多选下"统一设一个具体钟点"本就少见，已有的
 * 单条详情页与底部日期条覆盖了需要精确时间的场景。
 *
 * 调用方负责把 target 翻译成每条任务的时间（buildSemanticTime → scheduleTask）。
 */
export function ScheduleActionSheet({ visible, count, onClose, onApply }: ScheduleActionSheetProps) {
  return (
    <ChoiceSheet
      visible={visible}
      title={count > 0 ? `为选中的 ${count} 条排期` : '排期'}
      options={SEMANTIC_TARGETS.map((target) => ({ key: target.id, label: target.label }))}
      onClose={onClose}
      onSelect={(key) => onApply(key as SemanticTarget)}
    />
  );
}
