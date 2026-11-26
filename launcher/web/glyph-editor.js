'use strict';

const GlyphEditor = (() => {
  const byId = (id) => document.getElementById(id);
  const stage = byId('glyph-stage'), scene = byId('glyph-scene');
  const glyphInput = byId('edit-glyph'), markInput = byId('edit-mark'), scopeInput = byId('edit-scope');
  const xInput = byId('edit-x'), yInput = byId('edit-y');
  const width = 640, height = 400;
  const labels = {
    '\u0300': 'Dấu huyền', '\u0301': 'Dấu sắc', '\u0302': 'Dấu mũ', '\u0303': 'Dấu ngã',
    '\u0306': 'Dấu trăng', '\u0309': 'Dấu hỏi', '\u031b': 'Râu', '\u0323': 'Dấu nặng', bar: 'Nét ngang Đ/đ'
  };
  const newEdits = () => ({ groups: {}, glyphs: {} });
  let edits = newEdits(), undo = [], redo = [];
  let model, char, mark, onEdit = () => {};
  let pan = false, space = false, drag = null;
  let scale = 1, fitScale = 1, tx = 0, ty = 0;

  function svg(tag, attrs) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    return node;
  }

  function currentOffset() {
    return (scopeInput.value === 'group' ? edits.groups[mark] : edits.glyphs[char]?.[mark]) ?? { x: 0, y: 0 };
  }

  function constrain(value) {
    const cap = Math.floor(model.upm / 2);
    return Math.max(-cap, Math.min(cap, Math.round(value)));
  }

  function commit({ x, y }) {
    x = constrain(x);
    y = constrain(y);
    const old = currentOffset();
    if (x === old.x && y === old.y) {
      syncControls();
      draw();
      return;
    }
    undo.push(edits);
    if (undo.length > 80) undo.shift();
    redo = [];
    edits = structuredClone(edits);
    const offsets = scopeInput.value === 'group' ? edits.groups : (edits.glyphs[char] ??= {});
    if (x || y) offsets[mark] = { x, y };
    else delete offsets[mark];
    if (scopeInput.value === 'glyph' && !Object.keys(offsets).length) delete edits.glyphs[char];
    syncControls();
    onEdit();
  }

  function stepHistory(from, to) {
    if (!from.length) return;
    to.push(edits);
    edits = from.pop();
    syncControls();
    onEdit();
  }

  function selectOptions(input, choices, selected) {
    input.replaceChildren(...choices.map(([value, label]) => new Option(label, value)));
    input.value = selected;
  }

  function setGlyph(next, preserveMark) {
    char = next;
    glyphInput.value = char;
    const marks = model.glyphs[char].parts.map((part) => part.mark).filter(Boolean);
    mark = preserveMark && marks.includes(mark) ? mark : marks.at(-1);
    selectOptions(markInput, marks.map((value) => [value, labels[value] || value]), mark);
    const hex = char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
    byId('glyph-summary').textContent = char + ' · U+' + hex;
    if (!preserveMark) fit();
    syncControls();
    draw();
  }

  function syncControls() {
    const offset = currentOffset();
    xInput.value = offset.x;
    yInput.value = offset.y;
    if (model) {
      const cap = Math.floor(model.upm / 2);
      for (const input of [xInput, yInput]) {
        input.min = -cap;
        input.max = cap;
      }
    }
    byId('reset-offset').disabled = !offset.x && !offset.y;
    byId('undo-edit').disabled = !undo.length;
    byId('redo-edit').disabled = !redo.length;
  }

  function fit() {
    if (!model?.glyphs[char]) return;
    const { box, advance } = model.glyphs[char];
    const left = Math.min(0, box[0]), right = Math.max(advance, box[2]);
    const bottom = Math.min(-model.upm * 0.15, box[1]), top = Math.max(box[3], model.upm * 0.75);
    fitScale = Math.min((width - 112) / (right - left), (height - 90) / (top - bottom));
    scale = fitScale;
    tx = width / 2 - scale * (right + left) / 2;
    ty = height / 2 + scale * (top + bottom) / 2;
    draw();
  }

  function draw() {
    if (!model?.glyphs[char]) return;
    const { advance, box, parts } = model.glyphs[char];
    scene.setAttribute('transform', 'translate(' + tx + ' ' + ty + ') scale(' + scale + ' ' + -scale + ')');
    byId('zoom-label').textContent = Math.round(scale / fitScale * 100) + '%';
    const guide = [
      svg('rect', { x: box[0], y: box[1], width: box[2] - box[0], height: box[3] - box[1], class: 'glyph-guide secondary-guide' }),
      svg('line', { x1: -model.upm, x2: advance + model.upm, y1: 0, y2: 0, class: 'glyph-guide' }),
      ...[0, advance].map((x) => svg('line', { x1: x, x2: x, y1: -model.upm * .25, y2: Math.max(model.upm, box[3]), class: 'glyph-guide secondary-guide' }))
    ];
    const paths = parts.flatMap((part) => {
      const moving = drag?.kind === 'mark' && part.mark === drag.mark;
      const x = part.x + (moving ? drag.dx : 0), y = part.y + (moving ? drag.dy : 0);
      const transform = 'translate(' + x + ' ' + y + ')';
      const path = svg('path', {
        d: part.path, transform,
        class: part.mark ? 'glyph-mark' + (part.mark === mark ? ' selected' : '') : 'glyph-base'
      });
      if (!part.mark) return [path];
      path.dataset.mark = part.mark;
      const hit = svg('path', { d: part.path, transform, class: 'glyph-hit' });
      hit.dataset.mark = part.mark;
      return [hit, path];
    });
    scene.replaceChildren(...guide, ...paths);
    stage.classList.toggle('pan', pan || space);
    stage.classList.toggle('dragging', Boolean(drag));
  }

  function coordinates(event) {
    const point = stage.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(stage.getScreenCTM().inverse());
  }

  function zoom(factor, x = width / 2, y = height / 2) {
    if (!model || drag) return;
    const next = Math.min(fitScale * 8, Math.max(fitScale * .25, scale * factor));
    tx = x - (x - tx) * next / scale;
    ty = y - (y - ty) * next / scale;
    scale = next;
    draw();
  }

  function finishDrag(event, canceled = false) {
    if (event.pointerId !== drag?.id) return;
    const gesture = drag;
    drag = null;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    if (!canceled && gesture.kind === 'mark' && (gesture.dx || gesture.dy)) {
      const offset = currentOffset();
      commit({ x: offset.x + gesture.dx, y: offset.y + gesture.dy });
    }
    draw();
  }

  stage.addEventListener('wheel', (event) => {
    if (!model) return;
    event.preventDefault();
    const cursor = coordinates(event);
    zoom(Math.exp(Math.max(-.45, Math.min(.45, -event.deltaY * .002))), cursor.x, cursor.y);
  }, { passive: false });
  stage.addEventListener('pointerdown', (event) => {
    if (!model || event.button !== 0 || drag) return;
    const target = event.target.dataset.mark;
    const kind = pan || space || !target ? 'pan' : 'mark';
    const cursor = coordinates(event);
    event.preventDefault();
    stage.focus({ preventScroll: true });
    if (kind === 'mark') {
      mark = target;
      markInput.value = target;
      syncControls();
    }
    drag = { kind, id: event.pointerId, mark, x: cursor.x, y: cursor.y, tx, ty, dx: 0, dy: 0 };
    stage.setPointerCapture(event.pointerId);
    draw();
  });
  stage.addEventListener('pointermove', (event) => {
    if (event.pointerId !== drag?.id) return;
    const cursor = coordinates(event);
    const dx = cursor.x - drag.x, dy = cursor.y - drag.y;
    if (drag.kind === 'pan') {
      tx = drag.tx + dx;
      ty = drag.ty + dy;
    } else {
      const offset = currentOffset();
      drag.dx = constrain(offset.x + dx / scale) - offset.x;
      drag.dy = constrain(offset.y - dy / scale) - offset.y;
    }
    draw();
  });
  stage.addEventListener('pointerup', (event) => finishDrag(event));
  stage.addEventListener('pointercancel', (event) => finishDrag(event, true));
  stage.addEventListener('lostpointercapture', (event) => finishDrag(event, true));

  function setHand(active) {
    pan = active;
    byId('hand-tool').setAttribute('aria-pressed', String(pan));
    draw();
  }

  document.addEventListener('keydown', (event) => {
    if (!model || event.target.closest('input, textarea, select, [contenteditable]')) return;
    const key = event.key.toLowerCase();
    if (event.code === 'Space' && !event.target.closest('button, a')) {
      event.preventDefault();
      space = true;
      draw();
    } else if (key === 'h' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
      setHand(!pan);
    } else if (stage === document.activeElement && (event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y')) {
      event.preventDefault();
      if (key === 'y' || event.shiftKey) stepHistory(redo, undo);
      else stepHistory(undo, redo);
    } else if (stage === document.activeElement && key.startsWith('arrow') && mark && !pan && !drag) {
      const shifts = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, 1], arrowdown: [0, -1] };
      if (!shifts[key]) return;
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const offset = currentOffset(), [x, y] = shifts[key];
      commit({ x: offset.x + x * step, y: offset.y + y * step });
    }
  });
  function releaseSpace() {
    if (!space) return;
    space = false;
    draw();
  }
  document.addEventListener('keyup', (event) => {
    if (event.code === 'Space') releaseSpace();
  });
  window.addEventListener('blur', releaseSpace);

  byId('zoom-out').addEventListener('click', () => zoom(1 / 1.25));
  byId('zoom-in').addEventListener('click', () => zoom(1.25));
  byId('fit-view').addEventListener('click', fit);
  byId('hand-tool').addEventListener('click', () => setHand(!pan));
  byId('undo-edit').addEventListener('click', () => stepHistory(undo, redo));
  byId('redo-edit').addEventListener('click', () => stepHistory(redo, undo));
  byId('reset-offset').addEventListener('click', () => commit({ x: 0, y: 0 }));
  glyphInput.addEventListener('change', () => setGlyph(glyphInput.value, false));
  markInput.addEventListener('change', () => {
    mark = markInput.value;
    syncControls();
    draw();
  });
  scopeInput.addEventListener('change', syncControls);
  for (const input of [xInput, yInput]) {
    input.addEventListener('change', () => commit({ x: Number(xInput.value), y: Number(yInput.value) }));
  }

  function load(next, callback) {
    onEdit = callback;
    const choices = Object.entries(next.glyphs).filter(([, glyph]) => glyph.parts.some((part) => part.mark && part.path));
    if (!choices.length) {
      byId('editor').hidden = true;
      model = null;
      return;
    }
    const keepView = model && choices.some(([value]) => value === char);
    const selected = keepView ? char : choices.find(([value]) => value === 'Ấ')?.[0] ?? choices[0][0];
    model = next;
    byId('editor').hidden = false;
    selectOptions(glyphInput, choices.map(([value]) => [value, value]), selected);
    setGlyph(selected, keepView);
  }

  function clear() {
    model = char = mark = null;
    drag = null;
    space = false;
    setHand(false);
    scopeInput.value = 'glyph';
    edits = newEdits();
    undo = [];
    redo = [];
    byId('editor').hidden = true;
  }

  return { load, clear, adjustments: () => edits };
})();
