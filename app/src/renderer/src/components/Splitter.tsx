/**
 * A block boundary the user can move.
 *
 * Grove's two splitters are not extra chrome: each one *replaces* the 1px rule
 * that already divided those blocks, so an untouched window looks exactly as it
 * did and the only new thing is that the line can be dragged. §10 forbids
 * adding weight to the chrome, and a hatched grip bar beside a diff would be
 * precisely that.
 *
 * The rule stays 1px because that is the honest width of a panel edge. What
 * grows is the *target*: a full-height pseudo-element a few px to either side,
 * so the pointer finds it without the eye having to.
 *
 * State is brightness (§5). Hover and drag step the rule up the greyscale ramp;
 * keyboard focus additionally widens it to the same 2px rule every selected row
 * in the app uses. Nothing here moves a neighbour, and nothing transitions
 * except colour (§7).
 *
 * The component owns no size of its own. It reads the live geometry of the block
 * it controls at the moment it needs it and reports a new pixel size back — the
 * *rendered* size is the truth, since it already accounts for the CSS clamps and
 * for a panel that is still shrink-wrapping its content.
 */

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

import type { Drag } from '../data/drag';
import { coalesceDrag } from '../data/drag';

/** Live geometry of the block a splitter sizes, and of what contains it. */
export interface PaneGeometry {
  /** Current rendered size of the block, along the axis being dragged. */
  size: number;
  /** Size of the container it sits in, along the same axis. */
  total: number;
}

export function Splitter({
  orientation,
  side,
  step,
  label,
  measure,
  onResize,
  onReset,
}: {
  /** The bar's own direction: `vertical` is a tall bar dragged left and right. */
  orientation: 'vertical' | 'horizontal';
  /** Which side of the bar the block being sized is on. */
  side: 'before' | 'after';
  /** How far one arrow key moves it, in px. */
  step: number;
  label: string;
  measure: () => PaneGeometry;
  /** A new size for the controlled block, in px. The caller clamps. */
  onResize: (px: number) => void;
  /** Back to the design's own default. */
  onReset: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ from: number; origin: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [percent, setPercent] = useState(0);

  const vertical = orientation === 'vertical';
  /**
   * Pointer movement along the positive axis grows a block that sits before the
   * bar and shrinks one that sits after it. Both gestures then read the same
   * way: the edge follows your hand.
   */
  const dir = side === 'before' ? 1 : -1;

  // A focusable separator must report a value, and a percentage is the only unit
  // that means anything out loud: "the commit list is 32%" survives a window
  // resize, "360" does not. Measured after paint, and re-measured after every
  // render because the size can change without this component being told —
  // window resize, a working tree that grew a file.
  useEffect(() => {
    const { size, total } = measure();
    setPercent(total > 0 ? Math.round((size / total) * 100) : 0);
  });

  // One resize per frame, not one per pointer event. A pointer reports far
  // faster than the screen redraws, and every intermediate value would re-render
  // the diff pane — which can be tens of thousands of rows — only for the next
  // event to discard it. See data/drag.ts.
  const coalesced = useRef<Drag | null>(null);

  const start = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Focused deliberately rather than left to the click, so the arrow keys are
    // live the moment a drag ends. Text selection is held off by `user-select`
    // in CSS rather than by cancelling the event here: cancelling pointerdown
    // suppresses the compatibility mouse events, and the double-click that
    // resets the pane is built out of those.
    ref.current?.focus();
    const held = { from: vertical ? e.clientX : e.clientY, origin: measure().size };
    drag.current = held;
    coalesced.current = coalesceDrag((travel) => onResize(held.origin + travel * dir));
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const held = drag.current;
    if (!held) return;
    coalesced.current?.move((vertical ? e.clientX : e.clientY) - held.from);
  };

  const end = () => {
    if (!drag.current) return;
    // Flush before clearing, so the pane settles under the cursor rather than
    // wherever the last frame happened to leave it.
    coalesced.current?.stop();
    coalesced.current = null;
    drag.current = null;
    setDragging(false);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const back = vertical ? 'ArrowLeft' : 'ArrowUp';
    const forward = vertical ? 'ArrowRight' : 'ArrowDown';
    if (e.key !== back && e.key !== forward) return;

    e.preventDefault();
    // App's global handler reads the arrows as commit navigation (§8). Without
    // this, every nudge of a splitter would also move the selected commit and
    // reload the diff.
    e.stopPropagation();

    const travel = (e.key === back ? -step : step) * (e.shiftKey ? 4 : 1);
    onResize(measure().size + travel * dir);
  };

  return (
    <div
      ref={ref}
      className="splitter"
      data-orientation={orientation}
      data-dragging={dragging}
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      title={`${label}: drag, or focus and use the arrow keys. Double-click to reset.`}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
