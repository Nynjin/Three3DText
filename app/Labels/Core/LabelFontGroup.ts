
import { Label, LabelChangeType } from "./Label";
import { FontKey, fontKeyString } from "../Font/FontKey";
import { SDFAtlas } from "../Font/SDFAtlas";

// TODO : prevent case where one label is added to multiple dirty levels (added then updated then deleted should do nothing)
export const enum DirtyLevel {
  None = 0,
  Update = 1,
  Add = 2,
  Dispose = 3,
  ChangeGroup = 4,
}

export class LabelFontGroup {
  readonly key: FontKey;
  readonly labels: Set<Label> = new Set();
  readonly dirtyLabelsMap: Map<DirtyLevel, Set<Label>> = new Map([
    [DirtyLevel.Update, new Set()],
    [DirtyLevel.Add, new Set()],
    [DirtyLevel.Dispose, new Set()],
    [DirtyLevel.ChangeGroup, new Set()],
  ]);

  private atlas: SDFAtlas | null = null;
  private uniqueChars = new Set<string>();
  private _charsDirty = false;
  private _listeners = new Set<() => void>();
  private _unsubs = new Map<Label, () => void>();

  constructor(key: FontKey) {
    this.key = key;
    // Fallback char and space should always be present
    this.uniqueChars.add("?").add(" ");
  }

  private _recomputeUniqueChars(): boolean {
    const next = new Set<string>().add("?").add(" ");
    for (const label of this.labels) {
      for (const c of label.getDisplayText()) next.add(c);
    }
    if (next.size === this.uniqueChars.size) {
      let changed = false;
      for (const c of next) if (!this.uniqueChars.has(c)) { changed = true; break; }
      if (!changed) return false;
    }
    this.uniqueChars = next;
    return true;
  }

  private _addChars(label: Label): boolean {
    let newChars = false;
    for (const c of label.getDisplayText()) {
      if (!this.uniqueChars.has(c)) { this.uniqueChars.add(c); newChars = true; }
    }
    return newChars;
  }

  addLabel(label: Label) { this.addLabels([label]); }

  addLabels(labels: Label[]) {
    const added: Label[] = [];
    for (const label of labels) {
      if (this.labels.has(label)) {
        console.warn(`Label already exists in group for font ${fontKeyString(this.key)}`);
        continue;
      }
      if (this._addChars(label)) {
        this._charsDirty = true;
      }
      this.labels.add(label);
      added.push(label);

      const unsub = label.onChange((changes) => {
        // Removed labels return immediately to avoid conflicts
        if (changes & LabelChangeType.Font) {
          this.removeLabel(label);
          this._markDirty([label], DirtyLevel.ChangeGroup);
          this._emit();
          return;
        }
        
        if (changes & LabelChangeType.Dispose) {
          this.removeLabel(label);
          this._markDirty([label], DirtyLevel.Dispose);
          this._emit();
          return;
        }
        // Changes that affect glyphs and may require atlas update
        if (changes & LabelChangeType.Text) {
          if (this._addChars(label)) {
            this._charsDirty = true;
          }
          this._markDirty([label], DirtyLevel.Update);
        }
        // Changes that only affect label, glyphs are the same
        if (changes & (LabelChangeType.Layout | LabelChangeType.Style | LabelChangeType.Transform | LabelChangeType.Visibility)) {
          this._markDirty([label], DirtyLevel.Update);
        }

        this._emit();
      });
      this._unsubs.set(label, unsub);
    }
    if (added.length > 0) {
      this._markDirty(added, DirtyLevel.Add);
      this._emit();
    }
  }

  removeLabel(label: Label) { 
    this.removeLabels([label]); 
  }

  removeLabels(labels: Label[]) {
    let removed = false;
    for (const label of labels) {
      if (!this.labels.delete(label)) {
        console.warn(`Label ${label.id} not found in group for font ${fontKeyString(this.key)}`);
        continue;
      }
      this._unsubs.get(label)?.();
      this._unsubs.delete(label);

      for (const set of this.dirtyLabelsMap.values()) set.delete(label);
      removed = true;
    }
    if (removed) {
      this._charsDirty = true;
      this._markDirty(labels, DirtyLevel.Dispose);
      this._emit();
    }
  }

  /** Returns the current atlas, creating or updating it if needed. */
  getAtlas(): { atlas: SDFAtlas; dirty: boolean } {
    if (this._charsDirty) {
      this._recomputeUniqueChars();
      this._charsDirty = false;
    }
    if (!this.atlas) {
      this.atlas = new SDFAtlas([...this.uniqueChars], this.key);
      return { atlas: this.atlas, dirty: true };
    }
    const dirty = this.atlas.addChars(this.uniqueChars);
    return { atlas: this.atlas, dirty };
  }

  dispose() {
    this._unsubs.forEach(unsub => unsub());
    this._unsubs.clear();
    this.labels.clear();
    this.dirtyLabelsMap.forEach(set => set.clear());
    this.atlas?.dispose();
    this.atlas = null;
    this.uniqueChars.clear();
    this._listeners.clear();
  }

  onChange(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  flushDirty() {
    this.dirtyLabelsMap.forEach(set => set.clear());
  }

  private _markDirty(labels: Label[], level: DirtyLevel) {
    const set = this.dirtyLabelsMap.get(level)!;
    for (const label of labels) set.add(label);
  }

  private _emit() {
    for (const listener of this._listeners) listener();
  }
}
