# Three.js 3D Text Benchmark

[![License](https://img.shields.io/badge/license-CeCILL--B%20%2F%20MIT-yellow.svg)](./LICENSE)
![Three.js](https://img.shields.io/badge/Three.js-0.182-green)
![React](https://img.shields.io/badge/React-19-blue)
![Next.js](https://img.shields.io/badge/Next.js-16-black)

This project serves as a prototype and benchmark for a future overhaul of the [iTowns](http://www.itowns-project.org/) labelling system. 

It implements a custom SDF-based instanced text renderer for Three.js, alongside a React Three Fiber testbed to benchmark it against existing 3D text solutions.

<img src="https://github.com/user-attachments/assets/7eb8b804-ce66-4e13-8663-4a28a120e538" alt="Custom renderer example" width="400">

## Motivation and Context
iTowns' current labelling system does not scale well past a few thousand labels. Existing instanced 3D text renderers for Three.js rely on static font files (`.ttf`, `.woff`) that must be shipped or hosted alongside the application.

This repository explores an alternative approach: a custom text renderer that generates SDF atlases at runtime from system fonts using [`@mapbox/tiny-sdf`](https://github.com/mapbox/tiny-sdf). Labels are drawn using instanced meshes driven by data textures. 

### Key Features
* Dynamic SDF generation without shipping font files
* Support for text justification, anchors, colors, and halo effects
* RTL and Arabic character support via [`@mapbox/mapbox-gl-rtl-text`](https://github.com/mapbox/mapbox-gl-rtl-text)
* Real-time benchmarking UI against Troika, Batched Troika, UIKit, and CSS3DRenderer

## Getting Started

> **Note:** This repository uses **Git LFS** for font and SVG assets. Please ensure `git lfs` is installed before cloning.

First, install the dependencies, then run the development server:

```bash
npm install / npm ci
npm run dev
```

## License

This project inherits the dual **CeCILL-B / MIT** licensing of the iTowns project. 

Third-party dependencies (Three.js, `@mapbox/tiny-sdf`, `@mapbox/mapbox-gl-rtl-text`) carry their own respective open-source licenses. See the [LICENSE](./LICENSE) file for full details.

## Acknowledgements & Context

**Author:** [Moncef Hassani](https://github.com/nynjin)

This project was developed at [Ciril Group](https://www.cirilgroup.com/), specifically as a research and optimization effort for the iTowns project. 

---
Copyright (c) 2026 Moncef Hassani | Ciril Group
