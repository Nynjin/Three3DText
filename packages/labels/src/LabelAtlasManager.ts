import { type Label, LabelChangeType } from './Label';
import type { FontKey } from './Shaping/FontKey';
import { SDFAtlas } from './Shaping/SDFAtlas';
import { applyShaping, needsShaping, rtlReady } from './Shaping/RTL';
import { charSplitter } from './Shaping/Graphemes';
import type { LabelManagerConfig } from './Types/LabelConfig';

/**
 * What a label needs on the next sync. A label marked twice before a flush
 * keeps the higher level, so an add followed by a style change stays an add.
 * A dispose outranks everything except a later re-add, which turns it into a
 * relayout.
 */
export const enum DirtyLevel {
  None = 0,
  /** Label data only: style, transform or visibility changed. */
  Update = 1,
  /** Glyph instances are stale: text, font or layout changed. */
  Relayout = 2,
  /** Newly added, so it needs buffer slots and a first layout. */
  Add = 3,
  /** Gone: free its buffer slots. */
  Dispose = 4,
}

/** Dirty labels grouped by what the renderer has to do with them. */
export interface DirtyLabels {
  add: Label[];
  relayout: Label[];
  update: Label[];
  dispose: Label[];
}

interface FontCharSet {
  fontKey: FontKey;
  chars: Set<string>;
}

/**
 * Owns the SDF atlas shared by every font, and tracks which labels need work
 * before the next draw.
 */
export class LabelAtlasManager {
  readonly atlas: SDFAtlas;
  readonly labels = new Set<Label>();

  /** Every character requested so far, per font. */
  private readonly _fontChars = new Map<string, FontCharSet>();
  /** Characters requested since the last {@link syncAtlas}, per font. */
  private readonly _pendingChars = new Map<string, FontCharSet>();

  private readonly _dirty = new Map<Label, DirtyLevel>();
  private readonly _unsubs = new Map<Label, () => void>();
  private readonly _listeners = new Set<() => void>();

  /**
   * @param config - Reads `atlasFontSize` and `atlasCapacityMultiplier` once.
   * @param maxTextureSize - Largest texture side the device accepts, in texels.
   */
  constructor(config: LabelManagerConfig, maxTextureSize: number) {
    this.atlas = new SDFAtlas({
      fontSize: config.atlasFontSize,
      capacityMultiplier: config.atlasCapacityMultiplier,
      maxSize: maxTextureSize,
    });

    // Labels added before the shaper loaded were laid out from unshaped text.
    void rtlReady.then(() => this._relayoutShaped());
  }

  /** Whether anything is waiting for a sync. */
  get hasDirty(): boolean {
    return this._dirty.size > 0;
  }

  /**
   * Start tracking labels: request their characters, mark them for a first
   * layout, and subscribe to their changes.
   *
   * @param labels - Labels to add; any already tracked are ignored.
   */
  addLabels(labels: Iterable<Label>) {
    let added = false;

    for (const label of labels) {
      if (this.labels.has(label)) continue;

      this.labels.add(label);
      this._requestChars(label);
      // Removed and re-added before a flush: it may still hold its slots, or
      // never have had any; a relayout rewrites or allocates as needed.
      if (this._dirty.get(label) === DirtyLevel.Dispose) {
        this._dirty.set(label, DirtyLevel.Relayout);
      } else {
        this._markDirty(label, DirtyLevel.Add);
      }
      this._unsubs.set(label, label.onChange(changes => this._onLabelChange(label, changes)));
      added = true;
    }

    if (added) this._emit();
  }

  /**
   * Stop tracking labels and mark them for disposal, so the next flush frees
   * their buffer slots. Their atlas glyphs stay.
   *
   * @param labels - Labels to remove; any not tracked are ignored.
   */
  removeLabels(labels: Iterable<Label>) {
    let removed = false;

    for (const label of labels) {
      if (!this.labels.delete(label)) continue;

      this._unsubs.get(label)?.();
      this._unsubs.delete(label);
      this._markDirty(label, DirtyLevel.Dispose);
      removed = true;
    }

    if (removed) this._emit();
  }

  /**
   * Rasterizes the characters requested since the last call. Must run before
   * {@link flushDirty}: a resize moves every existing glyph, which marks all
   * labels for relayout.
   *
   * @returns `dirty` if the texture contents changed; `resize` if the texture
   * was replaced and every glyph moved.
   */
  syncAtlas(): { dirty: boolean; resize: boolean } {
    if (this._pendingChars.size === 0) return { dirty: false, resize: false };

    const result = this.atlas.setChars([...this._pendingChars.values()]);
    this._pendingChars.clear();

    if (result.resize) {
      for (const label of this.labels) this._markDirty(label, DirtyLevel.Relayout);
    }

    return result;
  }

  /** Takes the pending work, grouped by level, and clears it. The arrays are the caller's. */
  flushDirty(): DirtyLabels {
    const flushed: DirtyLabels = { add: [], relayout: [], update: [], dispose: [] };
    const byLevel = new Map<DirtyLevel, Label[]>([
      [DirtyLevel.Add, flushed.add],
      [DirtyLevel.Relayout, flushed.relayout],
      [DirtyLevel.Update, flushed.update],
      [DirtyLevel.Dispose, flushed.dispose],
    ]);

    for (const [label, level] of this._dirty) byLevel.get(level)?.push(label);

    this._dirty.clear();
    return flushed;
  }

  /**
   * Subscribe to "something needs a sync". Fires once per `addLabels` or
   * `removeLabels` call that changed anything, once per label change
   * notification, and once when the RTL shaper loads if a tracked label needs
   * shaping.
   *
   * @returns Unsubscribe function.
   */
  onChange(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /** Drops every label and subscription, and disposes the atlas. */
  dispose() {
    for (const unsub of this._unsubs.values()) unsub();
    this._unsubs.clear();
    this.labels.clear();
    this._dirty.clear();
    this._fontChars.clear();
    this._pendingChars.clear();
    this._listeners.clear();
    this.atlas.dispose();
  }

  /** Translates a {@link LabelChangeType} bitmask into a dirty level. */
  private _onLabelChange(label: Label, changes: number) {
    if (changes & LabelChangeType.Dispose) {
      this.removeLabels([label]);
      return;
    }

    if (changes & (LabelChangeType.Font | LabelChangeType.Text)) {
      this._requestChars(label);
    }

    const needsLayout = changes & (LabelChangeType.Font | LabelChangeType.Text | LabelChangeType.Layout);
    this._markDirty(label, needsLayout ? DirtyLevel.Relayout : DirtyLevel.Update);
    this._emit();
  }

  /** Re-requests characters and relays out the labels the shaper changes. */
  private _relayoutShaped() {
    let marked = false;

    for (const label of this.labels) {
      if (!needsShaping(label.getDisplayText())) continue;
      this._requestChars(label);
      this._markDirty(label, DirtyLevel.Relayout);
      marked = true;
    }

    if (marked) this._emit();
  }

  /**
   * Queues the label's characters its font has not been asked for yet. A new
   * font is queued even with no characters, so the atlas registers it.
   */
  private _requestChars(label: Label) {
    const key = label.fontKeyStr;
    let known = this._fontChars.get(key);
    if (!known) {
      known = { fontKey: label.fontKey, chars: new Set() };
      this._fontChars.set(key, known);
      this._pendingFor(label);
    }

    const shaped = applyShaping(label.getDisplayText());
    for (const char of charSplitter(shaped)(shaped)) {
      if (known.chars.has(char)) continue;
      known.chars.add(char);
      this._pendingFor(label).chars.add(char);
    }
  }

  private _pendingFor(label: Label): FontCharSet {
    let pending = this._pendingChars.get(label.fontKeyStr);
    if (!pending) {
      pending = { fontKey: label.fontKey, chars: new Set() };
      this._pendingChars.set(label.fontKeyStr, pending);
    }
    return pending;
  }

  /** Raise the label's pending work to `level`; never lowers it. */
  private _markDirty(label: Label, level: DirtyLevel) {
    const current = this._dirty.get(label) ?? DirtyLevel.None;
    if (level > current) this._dirty.set(label, level);
  }

  /** Notifies every {@link LabelAtlasManager.onChange} listener. */
  private _emit() {
    for (const listener of this._listeners) listener();
  }
}
