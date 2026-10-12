import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { BREAKDOWN_STEP_MAX } from '@/domain/task-breakdown';
import { useTheme } from '@/hooks/use-theme';

/**
 * AI 拆出来的步骤 → 用户过一遍 → 才落库。
 *
 * **为什么非要这一屏**：模型拆出来的东西看着都对，但"对"和"我要的"是两回事
 * —— 它不知道你手上有多少时间、哪一步其实已经做了一半。让它直接进库等于
 * 替用户下结论，而拆出来的步骤是要去做的，做错的代价在用户身上。
 *
 * 三种状态，都能走到"落库"，没有死路：
 *
 * 1. **生成中**：转圈 + 一句在做什么（模型要 5~15 秒，不给反馈就是"点了没反应"）。
 * 2. **生成好了**：步骤摊开，可删、可改、可上下挪。确认才落库。
 * 3. **失败了**：显示原因 + 输入框还在，**自己写照样能用**。
 *    ⚠️ 这条最要紧 —— 拆解没有本地降级，失败若只给一个"重试"，
 *    用户就卡在这儿了。所以这个面板本身就是手写的那条路，
 *    AI 只是"先填一版"，不是"唯一入口"。
 */
export interface BreakdownSheetProps {
  visible: boolean;
  /** 要拆的那件事（任务的标题 / 备注） */
  subject: string;
  /** 备注，一并给模型作参考 */
  note?: string | null;
  /**
   * 发起生成。**抛错**表示失败（message 是能直接给用户看的中文）。
   * 每次点「重新拆」都会再调一次。
   */
  onGenerate: () => Promise<string[]>;
  /** 确认落库 */
  onSubmit: (steps: readonly string[]) => void;
  onClose: () => void;
}

export function BreakdownSheet({
  visible,
  subject,
  note,
  onGenerate,
  onSubmit,
  onClose,
}: BreakdownSheetProps) {
  const theme = useTheme();
  /**
   * 步骤带一个**稳定 id**，不用 index 也不拿文本拼 key。
   *
   * 拿文本当 key 的话，改一个字 key 就变 → 那一行输入框被 React 整个重建，
   * 打字打到一半焦点就掉了。这是"列表可编辑"的经典坑，光看界面看不出来。
   */
  const [steps, setSteps] = useState<Array<{ id: number; text: string }>>([]);
  const [draft, setDraft] = useState('');
  /** 'idle' 已有一版（或自己写的）/ 'loading' 在等 / 'error' 失败了（但还能自己写） */
  const [phase, setPhase] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');
  const nextId = useRef(0);

  /**
   * `onGenerate` 每次渲染都可能是新的闭包，但"打开面板就开拆"这个 effect
   * 只该在 visible 变化时跑 —— 所以把它放进 ref，effect 不依赖它。
   */
  const generateRef = useRef(onGenerate);
  generateRef.current = onGenerate;

  /*
   * 打开即开拆。**不再让用户点一次"生成"**：他点「AI 拆」这个动作本身
   * 就已经表达了"我要它拆"，再给一个按钮是让他把同一件事说两遍。
   */
  useEffect(() => {
    if (!visible) return;
    setSteps([]);
    setDraft('');
    setPhase('loading');
    setError('');
    void (async () => {
      try {
        const list = await generateRef.current();
        setSteps(list.map((text) => ({ id: nextId.current++, text })));
        setPhase('idle');
      } catch (err) {
        setError(err instanceof Error ? err.message : '没拆出来');
        setPhase('error');
      }
    })();
  }, [visible]);

  const full = steps.length >= BREAKDOWN_STEP_MAX;

  const generate = async () => {
    setPhase('loading');
    setError('');
    try {
      const list = await generateRef.current();
      setSteps(list.map((text) => ({ id: nextId.current++, text })));
      setPhase('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : '没拆出来');
      setPhase('error');
    }
  };

  const addStep = () => {
    const text = draft.trim();
    if (!text || full || steps.some((step) => step.text === text)) {
      setDraft('');
      return;
    }
    setSteps([...steps, { id: nextId.current++, text }]);
    setDraft('');
  };

  const removeStep = (index: number) => {
    setSteps(steps.filter((_, i) => i !== index));
  };

  const changeStep = (index: number, text: string) => {
    setSteps(steps.map((step, i) => (i === index ? { ...step, text } : step)));
  };

  /**
   * 上下挪一步。
   *
   * 为什么要有这个：模型给的"先后"是按常理排的，而用户此刻知道哪一步
   * 能先做（"等老师回复"就得往后放）。不改顺序的话，用户只能删了重加。
   * 刻意不用拖拽 —— 在这里拖一个输入框跟打字手势打架，两颗箭头在手机上
   * 点得准得多。
   */
  const moveStep = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    setSteps(next);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable
            style={[styles.sheet, { backgroundColor: theme.background }]}
            onPress={(event) => event.stopPropagation()}>
            <View style={[styles.handle, { backgroundColor: theme.backgroundSelected }]} />

            <ThemedText type="smallBold" style={styles.title}>
              {phase === 'loading' ? '正在拆…' : '拆成几步'}
            </ThemedText>

            <View style={[styles.origin, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="small" numberOfLines={3}>
                {subject}
              </ThemedText>
            </View>

            {phase === 'loading' ? (
              <View style={styles.center}>
                <ActivityIndicator size="small" color={theme.text} />
                <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
                  让它先给一版，等会儿你自己改
                </ThemedText>
              </View>
            ) : null}

            {phase === 'error' ? (
              <View style={[styles.notice, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="small" themeColor="textSecondary">
                  {error}
                </ThemedText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="重新拆一次"
                  hitSlop={6}
                  onPress={() => void generate()}>
                  <ThemedText type="smallBold" style={styles.retry}>
                    再试一次
                  </ThemedText>
                </Pressable>
              </View>
            ) : null}

            {phase !== 'loading' && steps.length ? (
              <ScrollView style={styles.steps} showsVerticalScrollIndicator={false}>
                {steps.map((step, index) => (
                  <View
                    key={step.id}
                    style={[styles.stepRow, { backgroundColor: theme.backgroundElement }]}>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.stepIndex}>
                      {index + 1}
                    </ThemedText>
                    <TextInput
                      value={step.text}
                      onChangeText={(text) => changeStep(index, text)}
                      multiline={false}
                      style={[styles.stepInput, { color: theme.text }]}
                    />
                    <View style={styles.stepTools}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`把第 ${index + 1} 步往上挪`}
                        disabled={index === 0}
                        hitSlop={4}
                        onPress={() => moveStep(index, -1)}
                        style={{ opacity: index === 0 ? 0.25 : 1 }}>
                        <Ionicons name="chevron-up" size={14} color={theme.textSecondary} />
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`把第 ${index + 1} 步往下挪`}
                        disabled={index === steps.length - 1}
                        hitSlop={4}
                        onPress={() => moveStep(index, 1)}
                        style={{ opacity: index === steps.length - 1 ? 0.25 : 1 }}>
                        <Ionicons name="chevron-down" size={14} color={theme.textSecondary} />
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`删掉第 ${index + 1} 步`}
                        hitSlop={6}
                        onPress={() => removeStep(index)}>
                        <Ionicons name="close" size={15} color={theme.textSecondary} />
                      </Pressable>
                    </View>
                  </View>
                ))}
              </ScrollView>
            ) : null}

            {phase !== 'loading' ? (
              <View style={[styles.inputRow, { backgroundColor: theme.backgroundElement }]}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  onSubmitEditing={addStep}
                  editable={!full}
                  returnKeyType="done"
                  blurOnSubmit={false}
                  placeholder={
                    full ? `最多 ${BREAKDOWN_STEP_MAX} 步` : steps.length ? '再加一步' : '下一步要做什么'
                  }
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.input, { color: theme.text }]}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="加上这一步"
                  disabled={!draft.trim() || full}
                  hitSlop={6}
                  onPress={addStep}
                  style={({ pressed }) => [
                    styles.addButton,
                    {
                      backgroundColor: theme.backgroundSelected,
                      opacity: !draft.trim() || full ? 0.35 : pressed ? 0.6 : 1,
                    },
                  ]}>
                  <Ionicons name="add" size={17} color={theme.text} />
                </Pressable>
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={!steps.length || phase === 'loading'}
              onPress={() =>
                onSubmit(steps.map((step) => step.text.trim()).filter(Boolean))
              }
              style={({ pressed }) => [
                styles.submit,
                {
                  backgroundColor: theme.text,
                  opacity: steps.length && phase !== 'loading' ? (pressed ? 0.75 : 1) : 0.35,
                },
              ]}>
              <ThemedText type="smallBold" style={{ color: theme.background }}>
                {steps.length ? `拆成 ${steps.length} 步` : '还没写步骤'}
              </ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2 },
  title: { marginTop: Spacing.one },
  origin: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  hint: { fontSize: 12, lineHeight: 17, paddingHorizontal: Spacing.one },
  center: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.four },
  centerText: { fontSize: 12 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  retry: { fontSize: 13 },
  steps: { maxHeight: 232 },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.three,
    marginBottom: Spacing.two,
  },
  stepIndex: { fontSize: 12, width: 16 },
  stepInput: { flex: 1, fontSize: 14, paddingVertical: 0 },
  stepTools: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  input: { flex: 1, fontSize: 14, paddingVertical: Spacing.two },
  addButton: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  submit: {
    alignItems: 'center',
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    marginTop: Spacing.one,
  },
});
