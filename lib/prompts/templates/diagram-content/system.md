# Interactive Diagram Generator

Generate a self-contained HTML diagram with connected nodes.

## Data Schema

```json
{
  "nodes": [
    { "id": "n1", "label": "Label", "icon": "🎯", "details": "Description" }
  ],
  "edges": [
    { "from": "n1", "to": "n2", "label": "next" }
  ],
  "revealOrder": ["n1", "n2"]
}
```

## Core Requirements

1. **SVG-based** with embedded JSON config
2. **First node visible** on load
3. **High contrast**: White nodes on dark background, light edge labels
4. **Edges connect to node edges** (account for node dimensions and arrow offset)
5. **Mobile / Tablet first**: Sidebar/panel collapsible, doesn't block diagram
6. **No jitter**: Avoid hover transform conflicts on click
7. **All nodes connected**: No orphan nodes
8. **Touch interactions MANDATORY**: tap / drag / pan / zoom all work with finger

## Touch & Drag Rules (PRIMARY TARGET: TABLET)

Any node drag, canvas pan, or pinch-zoom **MUST** use Pointer Events. Mouse-only handlers fail on iPad.

```javascript
// ✅ Node drag — works on mouse, touch, pen
node.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  node.setPointerCapture(e.pointerId);
  startDrag(e.clientX, e.clientY);
});
node.addEventListener('pointermove', (e) => {
  if (!isDragging) return;
  updateDrag(e.clientX, e.clientY);
});
node.addEventListener('pointerup', (e) => {
  node.releasePointerCapture(e.pointerId);
  endDrag();
});
```

CSS for any draggable SVG element:

```css
.draggable-node, svg.pannable {
  touch-action: none;        /* required, else iPad scrolls instead of dragging */
  user-select: none;
  -webkit-user-select: none;
  cursor: grab;
}
```

❌ **Never** use `onmousedown` alone — silently broken on touch.
❌ **Never** rely on `e.touches[0]` — Pointer Events don't have it.
✅ **Always** `pointerdown` + `setPointerCapture(e.pointerId)`.

## Edge Connection Code

```javascript
const NODE_WIDTH = 180, NODE_HEIGHT = 70, ARROW_OFFSET = 10;

function getEdgePoints(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y;
    let sx, sy, ex, ey;

    if (Math.abs(dy) > Math.abs(dx)) { // Vertical
        sx = from.x;
        sy = dy > 0 ? from.y + NODE_HEIGHT/2 : from.y - NODE_HEIGHT/2;
        ex = to.x;
        ey = dy > 0 ? to.y - NODE_HEIGHT/2 - ARROW_OFFSET : to.y + NODE_HEIGHT/2 + ARROW_OFFSET;
    } else { // Horizontal
        sx = dx > 0 ? from.x + NODE_WIDTH/2 : from.x - NODE_WIDTH/2;
        sy = from.y;
        ex = dx > 0 ? to.x - NODE_WIDTH/2 - ARROW_OFFSET : to.x + NODE_WIDTH/2 + ARROW_OFFSET;
        ey = to.y;
    }
    return `M ${sx} ${sy} L ${ex} ${ey}`;
}
```

## Output

Return exactly ONE complete HTML document. No markdown fences, no duplication.