import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView, type TextInput, type View } from 'react-native';

/** All coordinates are in the same modal window, not relative to a row. */
export function memoryEditorScrollTarget({
  offset, contentHeight, viewportY, viewportHeight, inputY, inputHeight, keyboardY,
}: {
  offset: number;
  contentHeight: number;
  viewportY: number;
  viewportHeight: number;
  inputY: number;
  inputHeight: number;
  keyboardY: number | null;
}): number {
  if (viewportHeight <= 0 || inputHeight <= 0) return offset;
  const top = viewportY + 24; // Keep the item's label visible too.
  const bottom = Math.min(viewportY + viewportHeight, keyboardY ?? Infinity) - 12;
  if (bottom <= top) return offset;
  let delta = 0;
  if (inputY < top || inputHeight > bottom - top) delta = inputY - top;
  else if (inputY + inputHeight > bottom) delta = inputY + inputHeight - bottom;
  return Math.max(0, Math.min(offset + delta, Math.max(0, contentHeight - viewportHeight)));
}

/** KAV resizes the editor; this brings the focused input into its actual
 * scroll viewport (which also excludes the Done button and footer).
 * Event-driven only: no polling, extra requests, or draft/cache changes.
 */
export function useMemoryEditorKeyboard() {
  const scrollRef = useRef<ScrollView>(null);
  const viewportRef = useRef<View>(null);
  const inputs = useRef(new Map<string, TextInput>());
  const focused = useRef<string | null>(null);
  const offset = useRef(0);
  const contentHeight = useRef(0);
  const keyboardY = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const generation = useRef(0);
  const [inputMaxHeight, setInputMaxHeight] = useState(140);

  const revealFocused = useCallback(() => {
    const ticket = ++generation.current;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const id = focused.current;
      const input = id ? inputs.current.get(id) : null;
      if (!input) return;
      viewportRef.current?.measureInWindow((_x, viewportY, _width, viewportHeight) => {
        input.measureInWindow((_ix, inputY, _iw, inputHeight) => {
          if (ticket !== generation.current || focused.current !== id) return;
          const y = memoryEditorScrollTarget({
            offset: offset.current, contentHeight: contentHeight.current,
            viewportY, viewportHeight, inputY, inputHeight, keyboardY: keyboardY.current,
          });
          if (Math.abs(y - offset.current) < 1) return;
          offset.current = y;
          scrollRef.current?.scrollTo({ y, animated: false });
        });
      });
    });
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      keyboardY.current = event.endCoordinates.screenY;
      revealFocused();
    });
    const change = Keyboard.addListener('keyboardDidChangeFrame', (event) => {
      keyboardY.current = event.endCoordinates.height > 0 ? event.endCoordinates.screenY : null;
      revealFocused();
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardY.current = null;
    });
    return () => {
      show.remove(); change.remove(); hide.remove();
      generation.current++;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [revealFocused]);

  return {
    scrollRef, viewportRef, inputMaxHeight, revealFocused,
    setInputRef(id: string, node: TextInput | null) {
      if (node) inputs.current.set(id, node); else inputs.current.delete(id);
    },
    onFocus(id: string) { focused.current = id; revealFocused(); },
    onBlur(id: string) { if (focused.current === id) focused.current = null; },
    onViewportLayout(event: LayoutChangeEvent) {
      setInputMaxHeight(Math.max(34, Math.min(140, event.nativeEvent.layout.height - 36)));
      revealFocused();
    },
    onContentSizeChange(_width: number, height: number) {
      contentHeight.current = height;
      revealFocused();
    },
    onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
      offset.current = event.nativeEvent.contentOffset.y;
    },
  };
}
