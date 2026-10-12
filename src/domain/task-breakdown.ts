/**
 * 拆解的口径（**只属于任务**）：一件事 → 几步能动手的步骤。
 *
 * 这里放的是"落库前最后一道闸"：不管步骤是用户手写的一行行输入，还是 AI 吐的
 * JSON，都得先过 `cleanBreakdownSteps`。
 *
 * ⚠️ 想法**不走这条路**。想法转任务只建一条任务（`domain/idea-to-task`），
 * 想拆步骤是那条任务详情页的事 —— 同一个动作有两个入口，最后一定会出现
 * "从这边加的和从那边加的对不上"。
 */

/** 一次最多拆几步。再多就该分成两件事了，待办也不是堆料场 */
export const BREAKDOWN_STEP_MAX = 20;

/**
 * 洗一遍步骤：
 * - 空串直接去掉（手机上多敲一个换行太容易了）；
 * - 重复的合并（同一步写两遍是误操作，不是"要做两次"）；
 * - 顺序原样保留；
 * - 顶到 `BREAKDOWN_STEP_MAX` 就收手。
 */
export function cleanBreakdownSteps(rawSteps: readonly string[]): string[] {
  const seen = new Set<string>();
  const steps: string[] = [];

  for (const raw of rawSteps) {
    const step = raw.trim();
    if (!step || seen.has(step)) continue;
    seen.add(step);
    steps.push(step);
    if (steps.length >= BREAKDOWN_STEP_MAX) break;
  }

  return steps;
}
