import { useEffect } from 'react';
import { addAfterEffect, addEffect, useThree } from '@react-three/fiber';
import Stats from 'stats-gl';

const CORNERS = {
  'top-left': { top: '0', left: '0' },
  'top-right': { top: '0', right: '0' },
  'bottom-left': { bottom: '0', left: '0' },
  'bottom-right': { bottom: '0', right: '0' },
} as const;

export interface StatsPanelProps {
  /** Corner of the canvas the panel is pinned to. */
  position?: keyof typeof CORNERS;
  /**
   * Sample GPU time through `EXT_disjoint_timer_query_webgl2`, falling back
   * to CPU-only panels where the extension is unavailable.
   */
  trackGPU?: boolean;
  horizontal?: boolean;
}

/**
 * FPS/CPU/GPU panels driven by stats-gl.
 *
 * stats-gl is a plain three.js panel, so it hooks the render loop directly:
 * {@link addEffect} runs ahead of every frame and {@link addAfterEffect} once
 * the frame is submitted, which brackets the actual draw calls. `end()` closes
 * the GPU query but leaves its result unread, so `update()` has to follow to
 * collect the timings and repaint the panels.
 */
export function StatsPanel({
  position = 'top-left',
  trackGPU = true,
  horizontal = false,
}: StatsPanelProps) {
  const renderer = useThree(state => state.gl);

  useEffect(() => {
    const stats = new Stats({
      trackGPU,
      horizontal,
      logsPerSecond: 4,
      samplesLog: 60,
      samplesGraph: 10,
      precision: 2,
    });

    let detach: (() => void) | undefined;
    let cancelled = false;

    // init() patches the renderer and sets the panels up, so nothing may be
    // sampled until it resolves. The effect can be torn down before then.
    void stats.init(renderer).then(() => {
      if (cancelled) return;

      const panel = stats.domElement;
      Object.assign(panel.style, {
        position: 'absolute',
        zIndex: '1',
        ...CORNERS[position],
      });
      renderer.domElement.parentElement?.appendChild(panel);

      const stopBegin = addEffect(() => {
        stats.begin();
      });
      const stopEnd = addAfterEffect(() => {
        stats.end();
        stats.update();
      });

      detach = () => {
        stopBegin();
        stopEnd();
        panel.remove();
      };
    });

    return () => {
      cancelled = true;
      detach?.();
    };
  }, [renderer, position, trackGPU, horizontal]);

  return null;
}
