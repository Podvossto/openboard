// Shared motion presets (motion/react). Keep timings consistent across the app.
import type { Transition, Variants } from "motion/react";

export const spring = {
  /** cards, sheets — soft overshoot */
  soft: { type: "spring", stiffness: 380, damping: 30, mass: 0.9 } as Transition,
  /** small UI (pills, menus) — snappy */
  snappy: { type: "spring", stiffness: 620, damping: 34, mass: 0.6 } as Transition,
  /** layout shifts (pills reordering, dock) */
  layout: { type: "spring", stiffness: 500, damping: 40 } as Transition,
};

/** Node (console/tile/group) mount + exit. */
export const nodeVariants: Variants = {
  // no `filter` here: a lingering filter/compositing layer makes Chromium rasterise the card
  // at a fixed scale, which is exactly the "blurry text when zoomed" problem
  initial: { opacity: 0, scale: 0.86, y: 14 },
  animate: { opacity: 1, scale: 1, y: 0, transition: spring.soft, transitionEnd: { transform: "none" } },
  exit: { opacity: 0, scale: 0.9, y: 8, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } },
};

/** Popover / menu. Origin set per use. */
export const popVariants: Variants = {
  initial: { opacity: 0, scale: 0.94, y: 6 },
  animate: { opacity: 1, scale: 1, y: 0, transition: spring.snappy },
  exit: { opacity: 0, scale: 0.96, y: 4, transition: { duration: 0.12 } },
};

/** Side sheet from the right. */
export const sheetVariants: Variants = {
  initial: { opacity: 0, x: 36 },
  animate: { opacity: 1, x: 0, transition: spring.soft },
  exit: { opacity: 0, x: 36, transition: { duration: 0.16 } },
};

export const fadeVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.18 } },
  exit: { opacity: 0, transition: { duration: 0.14 } },
};

/** Ids whose node is playing its exit animation; the store removes them afterwards. */
export const EXIT_MS = 190;
