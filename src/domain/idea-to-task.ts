/**
 * 想法 → 一条任务。
 *
 * 想法库的出口只有这一个。它**不是拆解** —— 拆解（把一件事切成几步）是任务
 * 那边的事（`domain/task-breakdown`、任务详情页的「拆解」）；想法这一步只做
 * "把一个念头变成一件要去做的事"。想再切细，去那条任务的详情页切。
 *
 * 为什么必须有这条出口：想法库在此之前是一条死路 —— 记进去的东西只能归档，
 * 没有任何办法变成"要做的"。于是"不丢"这个承诺只兑现了一半：没丢，但也没用。
 *
 * 三条口径：
 *
 * 1. **标题取第一个非空行，不取整段。** 想法常常是"一句标题 + 一段展开"，
 *    把整段塞进任务标题，待办里就会出现一条糊成一团的巨长行。
 * 2. **第一行过长要截断，但一个字都不丢。** 任务标题的用途是"扫一眼认出来"；
 *    截掉的部分进 note —— 截断是为了好看，不是为了省地方。
 * 3. **想法原文完整留在 note 里。** 转成任务不该丢掉任何字，正文与标题一致时
 *    才写 null（一样的话写两遍是噪音）。
 */

/** 任务标题的字数上限。超出的部分不丢，进 note */
export const IDEA_TASK_TITLE_MAX = 40;

export interface IdeaTaskPlan {
  /** 任务标题（想法第一个非空行，必要时截断） */
  title: string;
  /** 想法原文。与标题一致时为 null —— 一样的话写两遍是噪音 */
  note: string | null;
}

/**
 * 把一条想法整理成"要落库的那条任务"。
 *
 * 返回 null 表示**这次什么都不该做**（想法是空的）。让调用方拿到 null 就停手，
 * 比返回一个半成品再去判空安全。
 */
export function planIdeaTask(content: string): IdeaTaskPlan | null {
  const trimmed = content.trim();
  // 第一个**非空**行才是标题：想法前面拖了几个空行是很常见的
  const firstLine = trimmed.split(/\r?\n/).find((line) => line.trim()) ?? '';
  const title = firstLine.trim().slice(0, IDEA_TASK_TITLE_MAX);
  if (!title) return null;

  return { title, note: trimmed === title ? null : trimmed };
}
