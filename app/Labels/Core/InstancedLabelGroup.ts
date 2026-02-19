
import { Label } from "../Core/Label";
import { FontKey, fontKeyString } from "../Font/FontKey";
import buildSDFAtlas, { SDFAtlas } from "../Font/SDFAtlas";

export class InstancedLabelGroup {
  dirtyAtlas = false;
  dirtyUniqueChars = false;
  
  readonly key: FontKey;
  readonly labels: Set<Label> = new Set();

  private atlas: SDFAtlas | null = null;
  private uniqueChars: Set<string> = new Set();

  constructor(key: FontKey) {
    this.key = key;

    // fallback char and space should always be present
    this.uniqueChars.add("?").add(" ");
  }

  recomputeUniqueChars() {
    // Ensure fallback and space are always included
    const uniqueChars = new Set<string>().add("?").add(" "); 

    for (const label of this.labels) {
      const chars = label.getDisplayText().split("");
      for (const c of chars) {
        uniqueChars.add(c);
      }
    }

    if (uniqueChars.size !== this.uniqueChars.size || [...uniqueChars].some((c) => !this.uniqueChars.has(c))) {
      this.uniqueChars = uniqueChars;
    }
  }

  addLabel(label: Label) {
    if (this.labels.has(label)) {
      console.warn(`Label already exists in group for font ${fontKeyString(this.key)}`);
      return;
    };

    for (const c of label.getDisplayText()) {
      if (!this.uniqueChars.has(c)) {
        this.uniqueChars.add(c);
        this.dirtyAtlas = true;
      }
    }

    this.labels.add(label);
  }

  addLabels(labels: Label[]) {
    for (const label of labels) {
      if (this.labels.has(label)) {
        console.warn(`Label ${label.id} already exists in group for font ${fontKeyString(this.key)}`);
        continue;
      }

      for (const c of label.getDisplayText()) {
        if (!this.uniqueChars.has(c)) {
          this.uniqueChars.add(c);
          this.dirtyAtlas = true;
        }
      }

      this.labels.add(label);
    }
  }

  removeLabel(label: Label) {
    if (!this.labels.delete(label)) {
      console.warn(`Label ${label.id} not found in group for font ${fontKeyString(this.key)}`);
      return;
    }

    this.dirtyUniqueChars = true;
  }

  removeLabels(labels: Label[]) {
    for (const label of labels) {
      if (!this.labels.delete(label)) {
        console.warn(`Label ${label.id} not found in group for font ${fontKeyString(this.key)}`);
      }
    }
    
    this.dirtyUniqueChars = true;
  }

  generateAtlas(): SDFAtlas {
    if (this.labels.size === 0) {
      console.warn(`No labels in group for font ${fontKeyString(this.key)}`);
    }

    if (!this.dirtyAtlas && this.atlas) {
      console.warn(`Atlas for font ${fontKeyString(this.key)} is already up to date.`);
      return this.atlas;
    }

    if (this.dirtyUniqueChars) {
      this.dirtyUniqueChars = false;
      this.recomputeUniqueChars();
    }

    try {
      this.atlas = buildSDFAtlas(
        [...this.uniqueChars],
        this.key
      );
      this.dirtyAtlas = false;
      return this.atlas;

    } catch (e) {
      console.error(`Failed to build SDF atlas for font ${fontKeyString(this.key)}`, e);
      // TODO: have a fallback atlas
      throw e;
    }
  }
}