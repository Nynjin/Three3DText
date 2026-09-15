import { type Label, LabelChangeType } from './Label';
import type { FontKey } from './Shaping/FontKey';
import { FALLBACK_CHAR, SDFAtlas } from './Shaping/SDFAtlas';
import { applyShaping, needsShaping, rtlReady } from './Shaping/RTL';
import type { LabelManagerConfig } from './Types/LabelConfig';

/**
 * What a label needs on the next sync. Ordered by precedence: a label marked
 * twice before a flush keeps the higher level, so an add followed by a style
 * change stays an add, and a dispose always wins.
 */
export const enum DirtyLevel {
  None = 0,
  /** Label data only — style, transform or visibility changed. */
  Update = 1,
  /** Glyph instances are stale — text, font or layout changed. */
  Relayout = 2,
  /** Newly added — needs buffer slots and a first layout. */
  Add = 3,
  /** Gone — free its buffer slots. */
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
 * Owns the single SDF atlas shared by every font, and tracks which labels need
 * work before the next draw.
 *
 * Glyphs are keyed by font *and* character, so one atlas serves all fonts and a
 * label changing weight no longer moves between per-font groups — it just asks
 * for glyphs under a different key and re-runs layout.
 */
export class LabelAtlasManager {
  readonly atlas: SDFAtlas;
  readonly labels = new Set<Label>();

  /**
   * Characters requested per font, accumulated and never pruned. The atlas only
   * ever adds glyphs — a removed label cannot free a slot — so tracking which
   * characters are still referenced would buy nothing.
   */
  private readonly _fontChars = new Map<string, FontCharSet>();
  private _charsDirty = false;

  private readonly _dirty = new Map<Label, DirtyLevel>();
  private readonly _unsubs = new Map<Label, () => void>();
  private readonly _listeners = new Set<() => void>();

  constructor(config: LabelManagerConfig) {
    this.atlas = new SDFAtlas({
      fontSize: config.atlasFontSize,
      scale: config.sdfScale,
      capacityMultiplier: config.atlasCapacityMultiplier,
    });

    // The shaper loads asynchronously, so labels added before it lands were
    // laid out from unshaped text and have to be redone once it is live.
    void rtlReady.then(() => this._relayoutShaped());
  }

  /** Whether anything is waiting for a sync. */
  get hasDirty(): boolean {
    return this._dirty.size > 0;
  }

  /** Adds one label. See {@link LabelAtlasManager.addLabels}. */
  addLabel(label: Label) {
    this.addLabels([label]);
  }

  /**
   * Start tracking labels: request their characters, mark them for a first
   * layout, and subscribe to their changes.
   *
   * @param labels - Labels to add; any already tracked are ignored.
   */
  addLabels(labels: Label[]) {
    let added = false;

    for (const label of labels) {
      if (this.labels.has(label)) continue;

      this.labels.add(label);
      this._requestChars(label);
      this._markDirty(label, DirtyLevel.Add);
      this._unsubs.set(label, label.onChange(changes => this._onLabelChange(label, changes)));
      added = true;
    }

    if (added) this._emit();
  }

  /** Removes one label. See {@link LabelAtlasManager.removeLabels}. */
  removeLabel(label: Label) {
    this.removeLabels([label]);
  }

  /**
   * Stop tracking labels and mark them for disposal, so the next flush frees
   * their buffer slots. Their atlas glyphs stay — the atlas never frees slots.
   *
   * @param labels - Labels to remove; any not tracked are ignored.
   */
  removeLabels(labels: Label[]) {
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
   * Rasterizes any characters requested since the last call. Must run before
   * {@link flushDirty}: a resize moves every existing glyph, which marks all
   * labels for relayout.
   *
   * @returns `dirty` if the texture changed, `resize` if glyphs moved within it.
   */
  syncAtlas(): { dirty: boolean; resize: boolean } {
    if (!this._charsDirty) return { dirty: false, resize: false };
    this._charsDirty = false;

    const result = this.atlas.setChars([...this._fontChars.values()]);

    if (result.resize) {
      for (const label of this.labels) this._markDirty(label, DirtyLevel.Relayout);
    }

    return result;
  }

  /** Takes the pending work, grouped by level, and clears it. */
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
   * Subscribe to "something needs a sync". Fires once per mutation batch, not
   * once per label.
   *
   * @param listener - Called after any change that leaves work pending.
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
    this._listeners.clear();
    this.atlas.dispose();
  }

  /**
   * Translate a label's own change notification into a dirty level.
   *
   * @param label - The label that changed.
   * @param changes - Bitmask of {@link LabelChangeType}.
   */
  private _onLabelChange(label: Label, changes: number) {
    if (changes & LabelChangeType.Dispose) {
      this.removeLabels([label]);
      return;
    }

    // A font change leaves the label here — only its glyph keys change.
    if (changes & (LabelChangeType.Font | LabelChangeType.Text)) {
      this._requestChars(label);
    }

    const needsLayout = changes & (LabelChangeType.Font | LabelChangeType.Text | LabelChangeType.Layout);
    this._markDirty(label, needsLayout ? DirtyLevel.Relayout : DirtyLevel.Update);
    this._emit();
  }

  /**
   * Re-request characters and force a relayout for the labels whose text the
   * newly-loaded shaper can actually change. Pure-LTR text shapes to itself, so
   * skipping it keeps a large label set from re-laying out for nothing.
   */
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
   * Queues the label's characters for rasterization under its own font. Marks
   * the char set dirty only for characters the font has not seen yet.
   *
   * @param label - Label whose display text is scanned.
   */
  private _requestChars(label: Label) {
    let entry = this._fontChars.get(label.fontKeyStr);

    if (!entry) {
      // Every font carries the fallback so layout always has a glyph to use.
      entry = { fontKey: label.fontKey, chars: new Set([FALLBACK_CHAR]) };
      this._fontChars.set(label.fontKeyStr, entry);
      this._charsDirty = true;
    }

    for (const char of applyShaping(label.getDisplayText())) {
      if (entry.chars.has(char)) continue;
      entry.chars.add(char);
      this._charsDirty = true;
    }
  }

  /**
   * Raise the label's pending work to `level`. Never lowers it, so the highest
   * level marked before a flush is the one that runs.
   *
   * @param label - Label to mark.
   * @param level - Work the label needs on the next sync.
   */
  private _markDirty(label: Label, level: DirtyLevel) {
    const current = this._dirty.get(label) ?? DirtyLevel.None;
    if (level > current) this._dirty.set(label, level);
  }

  /** Notifies every {@link LabelAtlasManager.onChange} listener. */
  private _emit() {
    for (const listener of this._listeners) listener();
  }
}
