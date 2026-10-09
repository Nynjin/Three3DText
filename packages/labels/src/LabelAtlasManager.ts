import { type Label, LabelChangeType, PLACEMENT_CHANGE } from './Label';
import type { FontKey } from './Shaping/FontKey';
import { SDFAtlas } from './Shaping/SDFAtlas';
import { needsShaping, reorderParagraph, rtlReady } from './Shaping/RTL';
import { analyze } from './Shaping/TextAnalysis';
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

const PLACEMENT_CHANGES = LabelChangeType.Font | LabelChangeType.Text | LabelChangeType.Layout
  | LabelChangeType.Transform | LabelChangeType.Visibility | PLACEMENT_CHANGE;

/** Dirty labels grouped by what the renderer has to do with them. */
export interface DirtyLabels {
  /** Something changed that can alter placement. */
  placement: boolean;
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

  /** Labels with a non-zero `dirtyLevel`, in the order they became dirty. */
  private _dirtyLabels: Label[] = [];
  /** Set by any change that can alter placement, until the next flush; a value that changes and comes back still leaves it set. */
  private _placementDirty = false;
  /** Shared by every tracked label, which passes itself in. */
  private readonly _onLabel = (changes: number, label: Label) => this._onLabelChange(label, changes);
  private readonly _listeners = new Set<() => void>();

  /**
   * @param config - Reads `atlasFontSize` once.
   * @param maxTextureSize - Largest texture side the device accepts, in texels.
   */
  constructor(config: LabelManagerConfig, maxTextureSize: number) {
    this.atlas = new SDFAtlas({
      fontSize: config.atlasFontSize,
      maxSize: maxTextureSize,
    });

    // Labels added before the shaper loaded were laid out from unshaped text.
    void rtlReady.then(() => this._relayoutShaped());

    fontSet()?.addEventListener('loadingdone', this._onFontsLoaded);
  }

  /** Whether anything is waiting for a sync. */
  get hasDirty(): boolean {
    return this._dirtyLabels.length > 0 || this._placementDirty;
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
      if ((label.dirtyLevel as DirtyLevel) === DirtyLevel.Dispose) {
        label.dirtyLevel = DirtyLevel.Relayout;
      } else {
        this._markDirty(label, DirtyLevel.Add);
      }
      label.onChange(this._onLabel);
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

      label.offChange(this._onLabel);
      this._markDirty(label, DirtyLevel.Dispose);
      removed = true;
    }

    if (removed) this._emit();
  }

  /**
   * Rasterizes the characters requested since the last call.
   *
   * @returns `dirty` if the texture contents changed; `resize` if the texture
   * was replaced by a taller one. Existing glyphs keep their position.
   */
  syncAtlas(): { dirty: boolean; resize: boolean } {
    if (this._pendingChars.size === 0) return { dirty: false, resize: false };

    const result = this.atlas.setChars([...this._pendingChars.values()]);
    this._pendingChars.clear();
    return result;
  }

  /** Marks the tracked ones among `labels` for a relayout on the next sync. */
  requeue(labels: Iterable<Label>) {
    for (const label of labels) {
      if (this.labels.has(label)) this._markDirty(label, DirtyLevel.Relayout);
    }
  }

  /** Takes the pending work, grouped by level, and clears it. The arrays are the caller's. */
  flushDirty(): DirtyLabels {
    const flushed: DirtyLabels = { placement: this._placementDirty, add: [], relayout: [], update: [], dispose: [] };
    this._placementDirty = false;
    for (const label of this._dirtyLabels) {
      const level = label.dirtyLevel as DirtyLevel;
      label.dirtyLevel = DirtyLevel.None;
      if (level === DirtyLevel.Add) flushed.add.push(label);
      else if (level === DirtyLevel.Relayout) flushed.relayout.push(label);
      else if (level === DirtyLevel.Update) flushed.update.push(label);
      else if (level === DirtyLevel.Dispose) flushed.dispose.push(label);
    }
    this._dirtyLabels = [];
    if (flushed.relayout.length > 0) flushed.placement = true;
    return flushed;
  }

  /**
   * Subscribe to "something needs a sync". Fires once per `addLabels` or
   * `removeLabels` call that changed anything, once per label change
   * notification, once when the RTL shaper loads if a tracked label needs
   * shaping, and once per font-loading event that loads a family a requested font lists.
   *
   * @returns Unsubscribe function.
   */
  onChange(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /** Drops every label and subscription, and disposes the atlas. */
  dispose() {
    for (const label of this.labels) label.offChange(this._onLabel);
    this.labels.clear();
    for (const label of this._dirtyLabels) label.dirtyLevel = DirtyLevel.None;
    this._dirtyLabels = [];
    this._fontChars.clear();
    this._pendingChars.clear();
    this._listeners.clear();
    fontSet()?.removeEventListener('loadingdone', this._onFontsLoaded);
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

    if (changes & PLACEMENT_CHANGES) this._placementDirty = true;
    const needsLayout = changes & (LabelChangeType.Font | LabelChangeType.Text | LabelChangeType.Layout);
    // A placement-only change leaves the mesh data as it is.
    if (changes & ~PLACEMENT_CHANGE) this._markDirty(label, needsLayout ? DirtyLevel.Relayout : DirtyLevel.Update);
    this._emit();
  }

  private readonly _onFontsLoaded = (event: Event) => {
    const { fontfaces } = event as FontFaceSetLoadEvent;
    if (fontfaces.some(face => this._usesFamily(face.family))) this._rasterizeAgain();
  };

  /** Whether any label font lists `family`, ignoring case and quotes. */
  private _usesFamily(family: string): boolean {
    const wanted = unquote(family);
    for (const { fontKey } of this._fontChars.values()) {
      if (fontKey.font.split(',').some(name => unquote(name) === wanted)) return true;
    }
    return false;
  }

  /** Rasterizes every requested character again, and relays out every label. */
  private _rasterizeAgain() {
    this.atlas.clearGlyphs();
    for (const [key, { fontKey, chars }] of this._fontChars) {
      this._pendingChars.set(key, { fontKey, chars: new Set(chars) });
    }
    for (const label of this.labels) this._markDirty(label, DirtyLevel.Relayout);
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

    const { shaped, rtl, split, chars } = analyze(label);
    const request = (list: string[]) => {
      for (const char of list) {
        if (known.chars.has(char)) continue;
        known.chars.add(char);
        this._pendingFor(label).chars.add(char);
      }
    };
    request(chars);
    // The bidi pass mirrors brackets in right-to-left runs: `(` draws as `)`.
    if (rtl) for (const line of reorderParagraph(shaped, [])) request(split(line));
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
    const current = label.dirtyLevel as DirtyLevel;
    if (level <= current) return;
    if (current === DirtyLevel.None) this._dirtyLabels.push(label);
    label.dirtyLevel = level;
  }

  /** Notifies every {@link LabelAtlasManager.onChange} listener. */
  private _emit() {
    for (const listener of this._listeners) listener();
  }
}

/** The page's font set, or `undefined` outside a browser page. */
function fontSet(): FontFaceSet | undefined {
  return (globalThis as { document?: { fonts?: FontFaceSet } }).document?.fonts;
}

function unquote(name: string): string {
  return name.trim().replace(/^["']|["']$/g, '').toLowerCase();
}
