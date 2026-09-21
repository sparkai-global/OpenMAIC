Create a simulation widget for: {{conceptName}}

## Concept Overview

{{conceptOverview}}

## Key Points

{{keyPoints}}

## Variables to Expose

{{variables}}

## Design Idea

{{designIdea}}

## Language

{{language}}

---

Generate a complete, interactive HTML simulation with these MANDATORY features:

### Structure
1. **Embedded JSON config** in `<script type="application/json" id="widget-config">`
2. **Control panel** with sliders for each variable
3. **Canvas visualization** with proper sizing
4. **Preset buttons** for common scenarios

### Tablet Layout (CRITICAL)
1. **Target a 1024×576 pad landscape viewport**
2. **Control panel MUST NOT overlap canvas**
3. Keep a stable tablet layout; do NOT switch into phone-style stacked layout at narrow widths
4. If the displayed area is smaller, the host app scales the whole widget
5. Touch-friendly controls (44px minimum touch targets)

### Button Logic (CRITICAL)
1. **Main button MUST handle all states correctly:**
   - "启动" → Starts simulation
   - "暂停" → Pauses running simulation
   - "重新开始" → Resets to initial state, then starts fresh
2. **Reset function MUST reset ALL state variables** (position, velocity, time, etc.)
3. Use clear state tracking: `{ running: boolean, ended: boolean, paused: boolean }`

### Canvas
1. Auto-resize on window resize
2. Clear visualization with grid or guides
3. Real-time data display overlay
4. Proper scaling inside the fixed tablet layout

### Interactivity
1. Real-time updates when sliders change
2. Presets apply and reset simulation
3. Keyboard shortcuts (Space = toggle, R = reset)
4. Touch gestures for tablet

### Visual Polish
1. Show current simulation state (running/paused/ended)
2. Animate transitions
3. Clear feedback when simulation ends
4. High contrast colors for visibility
