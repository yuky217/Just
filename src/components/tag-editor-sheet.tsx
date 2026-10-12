import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { Idea } from '@/domain/idea';
import { useTheme } from '@/hooks/use-theme';

/** 单个标签最大长度 / 一条想法最多挂几个标签（防失控，也防界面被挤爆） */
const TAG_MAX_LEN = 24;
const TAG_MAX_COUNT = 12;

/**
 * 给一条想法加标签的轻量面板（想法页点「＋标签」弹出来）。
 *
 * 为什么是面板不是新页面：加标签是"顺手补一下"的动作，进一个详情页再退回来
 * 等于为这一下多绕一层。面板直接叠在想法列表上，打完即走。
 *
 * 标签怎么来：① 输入框打字、回车就成一个 chip；② 下面给"库里已有的标签"做联想，
 * 点一下直接加上（不用重新敲一遍同样的字）。两条路加的都是同一个归一化后的标签。
 */
export interface TagEditorSheetProps {
  visible: boolean;
  idea: Idea | null;
  /** 整个想法库里出现过的标签，用作联想（去重后传进来即可） */
  allTags: string[];
  /** 确认：把编辑后的标签交回去 */
  onSave: (tags: string[]) => void;
  onClose: () => void;
}

export function TagEditorSheet({ visible, idea, allTags, onSave, onClose }: TagEditorSheetProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  // 每次打开都从这条想法当前的标签重新开始，关掉再开另一条不会串
  useEffect(() => {
    if (!visible) return;
    setDraft('');
    setTags(idea ? [...idea.tags] : []);
  }, [visible, idea]);

  const normalized = (raw: string): string | null => {
    const t = raw.trim().replace(/^#+/, '').replace(/\s+/g, ' ').trim();
    return t.length ? t.slice(0, TAG_MAX_LEN) : null;
  };

  const addTag = (raw: string) => {
    const tag = normalized(raw);
    if (!tag) return;
    const key = tag.toLowerCase();
    if (tags.some((t) => t.toLowerCase() === key)) {
      setDraft('');
      return;
    }
    if (tags.length >= TAG_MAX_COUNT) return;
    setTags([...tags, tag]);
    setDraft('');
  };

  const removeTag = (index: number) => {
    setTags(tags.filter((_, i) => i !== index));
  };

  /** 联想：库里出现过、但当前还没加上的 */
  const suggestions = useMemo(
    () => allTags.filter((t) => !tags.some((have) => have.toLowerCase() === t.toLowerCase())),
    [allTags, tags],
  );

  if (!idea) return null;

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
              标签
            </ThemedText>

            {/* 当前标签：可逐个删 */}
            <View style={styles.chipRow}>
              {tags.length ? (
                tags.map((tag, i) => (
                  <View
                    key={`${tag}-${i}`}
                    style={[styles.chip, { borderColor: theme.backgroundSelected }]}>
                    <ThemedText type="small" themeColor="text">
                      {tag}
                    </ThemedText>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`去掉标签 ${tag}`}
                      hitSlop={6}
                      onPress={() => removeTag(i)}>
                      <Ionicons name="close" size={13} color={theme.textSecondary} />
                    </Pressable>
                  </View>
                ))
              ) : (
                <ThemedText type="small" themeColor="textSecondary">
                  还没有标签，加几个方便以后找
                </ThemedText>
              )}
            </View>

            {/* 输入：打字回车即成一个标签 */}
            <View
              style={[
                styles.inputRow,
                { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
              ]}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={() => addTag(draft)}
                placeholder="输入标签，回车添加"
                placeholderTextColor={theme.textSecondary}
                maxLength={TAG_MAX_LEN}
                style={[styles.input, { color: theme.text }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="添加标签"
                disabled={!draft.trim()}
                onPress={() => addTag(draft)}
                style={({ pressed }) => [
                  styles.addButton,
                  { opacity: draft.trim() ? (pressed ? 0.7 : 1) : 0.4 },
                ]}>
                <ThemedText type="smallBold" themeColor="tint">
                  添加
                </ThemedText>
              </Pressable>
            </View>

            {/* 联想：库里已有的标签，点一下加上 */}
            {suggestions.length ? (
              <View style={styles.chipRow}>
                {suggestions.map((tag) => (
                  <Pressable
                    key={tag}
                    accessibilityRole="button"
                    accessibilityLabel={`加上已有标签 ${tag}`}
                    onPress={() => addTag(tag)}
                    style={[styles.suggestion, { borderColor: theme.tint }]}>
                    <ThemedText type="small" themeColor="tint">
                      {tag}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="完成"
              onPress={() => onSave(tags)}
              style={[styles.done, { backgroundColor: theme.text }]}>
              <ThemedText type="smallBold" style={{ color: theme.background }}>
                完成
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
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: Spacing.two,
  },
  title: { textAlign: 'center' },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, fontSize: 15, paddingVertical: Spacing.one },
  addButton: { paddingHorizontal: Spacing.two },
  done: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    marginTop: Spacing.one,
  },
});
