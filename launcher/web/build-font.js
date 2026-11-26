'use strict';

const FontBuilder = (() => {
  const bytes = (length) => new Uint8Array(length);
  const view = (array) => new DataView(array.buffer, array.byteOffset, array.byteLength);
  const join = (parts) => {
    const result = bytes(parts.reduce((size, part) => size + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  };

  function readTables(buffer) {
    const d = new DataView(buffer);
    const tables = new Map();
    for (let i = 0; i < d.getUint16(4); i++) {
      const p = 12 + i * 16;
      const tag = String.fromCharCode(...new Uint8Array(buffer, p, 4));
      const offset = d.getUint32(p + 8);
      const length = d.getUint32(p + 12);
      if (offset + length > buffer.byteLength) throw new Error('Tệp phông có bảng dữ liệu lỗi.');
      tables.set(tag, new Uint8Array(buffer.slice(offset, offset + length)));
    }
    return tables;
  }

  function checksum(data) {
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum = (sum + ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3])) >>> 0;
    }
    return sum;
  }

  function pack(tables) {
    const entries = [...tables].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    let offset = 12 + 16 * entries.length;
    const output = bytes(offset + entries.reduce((size, [, arr]) => size + Math.ceil(arr.length / 4) * 4, 0));
    const d = view(output), power = 2 ** Math.floor(Math.log2(entries.length));
    d.setUint32(0, 0x10000);
    d.setUint16(4, entries.length);
    d.setUint16(6, power * 16);
    d.setUint16(8, Math.log2(power));
    d.setUint16(10, (entries.length - power) * 16);
    let headOffset = 0;
    entries.forEach(([tag, arr], i) => {
      const p = 12 + i * 16;
      output.set([...tag].map((c) => c.charCodeAt(0)), p);
      d.setUint32(p + 4, checksum(arr));
      d.setUint32(p + 8, offset);
      d.setUint32(p + 12, arr.length);
      output.set(arr, offset);
      if (tag === 'head') headOffset = offset;
      offset += Math.ceil(arr.length / 4) * 4;
    });
    d.setUint32(headOffset + 8, (0xb1b0afba - checksum(output)) >>> 0);
    return output;
  }

  function buildCmap(lookup, additions, original) {
    const groups = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      const glyph = additions.get(cp) || lookup(cp);
      if (!glyph) continue;
      const last = groups.at(-1);
      if (last && last[1] + 1 === cp && last[2] + cp - last[0] === glyph) last[1] = cp;
      else groups.push([cp, cp, glyph]);
    }
    const full = bytes(16 + 12 * groups.length), f = view(full);
    f.setUint16(0, 12);
    f.setUint32(4, full.length);
    f.setUint32(12, groups.length);
    groups.forEach((group, i) => group.forEach((v, j) => f.setUint32(16 + i * 12 + j * 4, v)));

    // Format 4 retains compatibility with consumers that use the BMP subtable.
    const bmp = groups.filter(([first]) => first < 65535).map(([first, last, glyph]) => [first, Math.min(last, 65534), (glyph - first) & 65535]);
    bmp.push([65535, 65535, 1]);
    const records = [[0, 4, full], [3, 10, full]];
    if (bmp.length < 8190) {
      const n = bmp.length, power = 2 ** Math.floor(Math.log2(n));
      const short = bytes(16 + 8 * n), s = view(short);
      s.setUint16(0, 4);
      s.setUint16(2, short.length);
      s.setUint16(6, 2 * n);
      s.setUint16(8, 2 * power);
      s.setUint16(10, Math.log2(power));
      s.setUint16(12, 2 * (n - power));
      bmp.forEach(([first, last, delta], i) => {
        s.setUint16(14 + 2 * i, last);
        s.setUint16(16 + 2 * (n + i), first);
        s.setUint16(16 + 2 * (2 * n + i), delta);
      });
      records.push([0, 3, short], [3, 1, short]);
    }

    const old = view(original);
    for (let i = 0; i < old.getUint16(2); i++) {
      const p = 4 + 8 * i, platform = old.getUint16(p), encoding = old.getUint16(p + 2);
      const start = old.getUint32(p + 4);
      if (start + 2 > original.length) continue;
      const format = old.getUint16(start);
      if (platform === 0 && format !== 14 || platform === 3 && [1, 10].includes(encoding)) continue;
      const length = format === 14 ? old.getUint32(start + 2) : format >= 8 ? old.getUint32(start + 4) : old.getUint16(start + 2);
      if (start + length <= original.length) records.push([platform, encoding, original.subarray(start, start + length)]);
    }
    records.sort(([a, b], [c, d]) => a - c || b - d);
    const header = bytes(4 + 8 * records.length), h = view(header);
    const offsets = new Map(), parts = [header];
    let offset = header.length;
    h.setUint16(2, records.length);
    records.forEach(([platform, encoding, data], i) => {
      if (!offsets.has(data)) {
        offsets.set(data, offset);
        parts.push(data);
        offset += data.length;
      }
      const p = 4 + 8 * i;
      h.setUint16(p, platform);
      h.setUint16(p + 2, encoding);
      h.setUint32(p + 4, offsets.get(data));
    });
    return join(parts);
  }

  function updateNames(original, family) {
    const data = original.slice();
    const d = view(data);
    const storage = d.getUint16(4);
    const postscript = family.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9-]/g, '') || 'PhongViet';
    const names = { 1: family, 3: postscript + ';Vietnamese', 4: family, 6: postscript, 16: family, 18: family, 21: family };
    const parts = [data];
    let offset = data.length - storage;
    for (let i = 0; i < d.getUint16(2); i++) {
      const p = 6 + 12 * i, platform = d.getUint16(p), name = names[d.getUint16(p + 6)];
      if (!name || ![0, 1, 3].includes(platform)) continue;
      const str = platform === 1 ? name.replace(/[^\x20-\x7E]/g, '') || postscript : name;
      const encoded = bytes(str.length * (platform === 1 ? 1 : 2));
      if (platform === 1) {
        for (let j = 0; j < str.length; j++) encoded[j] = str.charCodeAt(j);
      } else {
        const e = view(encoded);
        for (let j = 0; j < str.length; j++) e.setUint16(j * 2, str.charCodeAt(j));
      }
      if (offset + encoded.length > 65535) throw new Error('Bảng tên phông quá lớn để đổi tên.');
      d.setUint16(p + 8, encoded.length);
      d.setUint16(p + 10, offset);
      parts.push(encoded);
      offset += encoded.length;
    }
    return join(parts);
  }

  function outline(contours) {
    const points = contours.flat();
    const allX = points.map(([x]) => x), allY = points.map(([, y]) => y);
    const box = [Math.min(...allX), Math.min(...allY), Math.max(...allX), Math.max(...allY)];
    const flagStart = 12 + 2 * contours.length;
    const data = bytes(flagStart + 5 * points.length), d = view(data);
    d.setInt16(0, contours.length);
    box.forEach((value, i) => d.setInt16(2 + 2 * i, value));
    let length = 0;
    contours.forEach((contour, i) => {
      length += contour.length;
      d.setUint16(10 + i * 2, length - 1);
    });
    let px = 0, py = 0;
    points.forEach(([x, y, on], i) => {
      data[flagStart + i] = (i === 0 ? 0x40 : 0) | on;
      d.setInt16(flagStart + points.length + i * 2, x - px);
      d.setInt16(flagStart + points.length * 3 + i * 2, y - py);
      px = x;
      py = y;
    });
    return { data, box, points: points.length, contours: contours.length };
  }

  function polygon(points) {
    const area = points.reduce((sum, [x, y], i) => {
      const [nx, ny] = points[(i + 1) % points.length];
      return sum + x * ny - nx * y;
    }, 0);
    return outline([(area > 0 ? points.slice().reverse() : points).map(([x, y]) => [x, y, 1])]);
  }

  function readSimpleContours(d, count) {
    if (!count) return [];
    const ends = Array.from({ length: count }, (_, i) => d.getUint16(10 + i * 2));
    const size = ends.at(-1) + 1;
    let pos = 10 + count * 2;
    pos += 2 + d.getUint16(pos);
    const flags = [];
    while (flags.length < size) {
      const flag = d.getUint8(pos++);
      const repeat = flag & 8 ? d.getUint8(pos++) : 0;
      for (let i = 0; i <= repeat; i++) flags.push(flag);
    }
    if (flags.length !== size) throw new Error('Đường viền glyph có dữ liệu điểm không hợp lệ.');
    function axis(short, same) {
      let previous = 0;
      return flags.map((flag) => {
        if (flag & short) previous += (flag & same ? 1 : -1) * d.getUint8(pos++);
        else if (!(flag & same)) {
          previous += d.getInt16(pos);
          pos += 2;
        }
        return previous;
      });
    }
    const x = axis(2, 16), y = axis(4, 32);
    let start = 0;
    return ends.map((end) => {
      const points = [];
      for (let i = start; i <= end; i++) points.push([x[i], y[i], flags[i] & 1]);
      start = end + 1;
      return points;
    });
  }

  function withoutDot(data) {
    const d = view(data), count = d.getInt16(0);
    if (count < 2) return null;
    const contours = readSimpleContours(d, count);
    const limits = contours.map((contour) => {
      const heights = contour.map((point) => point[1]);
      return [Math.min(...heights), Math.max(...heights)];
    });
    const highest = limits.findIndex(([low], i) => limits.every(([, high], j) => j === i || low > high));
    return highest < 0 ? null : outline(contours.filter((_, i) => i !== highest));
  }

  function readCompoundContours(d, contoursFor) {
    const contours = [];
    const points = [];
    let pos = 10;
    let flags;
    do {
      flags = d.getUint16(pos);
      const id = d.getUint16(pos + 2);
      pos += 4;
      const words = flags & 1;
      const xy = flags & 2;
      const arg = (offset) => words
        ? (xy ? d.getInt16(offset) : d.getUint16(offset))
        : (xy ? d.getInt8(offset) : d.getUint8(offset));
      const a = arg(pos);
      const b = arg(pos + (words ? 2 : 1));
      pos += words ? 4 : 2;
      const scale = () => {
        const value = d.getInt16(pos) / 16384;
        pos += 2;
        return value;
      };
      let xx = 1, yy = 1, xyScale = 0, yxScale = 0;
      if (flags & 8) xx = yy = scale();
      else if (flags & 64) {
        xx = scale();
        yy = scale();
      } else if (flags & 128) {
        xx = scale();
        xyScale = scale();
        yxScale = scale();
        yy = scale();
      }
      const transform = ([x, y, on]) => [xx * x + yxScale * y, xyScale * x + yy * y, on];
      const child = contoursFor(id).map((contour) => contour.map(transform));
      let dx = a, dy = b;
      if (!xy) {
        const childPoint = child.flat()[b];
        if (!points[a] || !childPoint) throw new Error('Điểm lắp ghép glyph không hợp lệ.');
        dx = points[a][0] - childPoint[0];
        dy = points[a][1] - childPoint[1];
      } else if (flags & 0x800) {
        [dx, dy] = transform([a, b]);
      }
      for (const contour of child) {
        const translated = contour.map(([x, y, on]) => [x + dx, y + dy, on]);
        contours.push(translated);
        for (const point of translated) points.push(point);
      }
    } while (flags & 32);
    return contours;
  }

  function svgPath(contours) {
    const coords = ([x, y]) => `${Math.round(x * 1000) / 1000} ${Math.round(y * 1000) / 1000}`;
    const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return contours.map((contour) => {
      const first = contour[0], last = contour.at(-1);
      const start = first[2] ? first : last[2] ? last : midpoint(last, first);
      const commands = ['M' + coords(start)];
      const from = first[2] ? 1 : 0;
      const to = !first[2] && last[2] ? contour.length - 1 : contour.length;
      let control;
      for (let i = from; i < to; i++) {
        const point = contour[i];
        if (point[2]) {
          commands.push(control ? 'Q' + coords(control) + ' ' + coords(point) : 'L' + coords(point));
          control = undefined;
        } else {
          if (control) commands.push('Q' + coords(control) + ' ' + coords(midpoint(control, point)));
          control = point;
        }
      }
      if (control) commands.push('Q' + coords(control) + ' ' + coords(start));
      return commands.join(' ') + ' Z';
    }).join(' ');
  }

  const shapes = {
    '\u0300': [[0, 100], [29, 100], [88, 0], [59, 0]],
    '\u0301': [[5, 0], [34, 0], [93, 100], [64, 100]],
    '\u0302': [[0, 0], [50, 100], [100, 0], [73, 0], [50, 58], [27, 0]],
    '\u0303': [[0, 12], [20, 78], [42, 82], [66, 47], [83, 49], [100, 90], [100, 52], [83, 10], [60, 10], [35, 44], [20, 43], [0, 0]],
    '\u0306': [[0, 86], [22, 86], [31, 39], [50, 21], [69, 39], [78, 86], [100, 86], [92, 44], [75, 12], [50, 0], [25, 12], [8, 44]],
    '\u0309': [[38, 0], [39, 25], [67, 61], [66, 78], [53, 86], [38, 86], [24, 73], [13, 73], [13, 88], [33, 100], [66, 100], [89, 85], [92, 63], [73, 40], [57, 25], [53, 0]],
    '\u031b': [[0, 0], [0, 30], [43, 43], [63, 66], [69, 100], [100, 100], [90, 60], [71, 31], [44, 13]],
    '\u0323': [[22, 0], [78, 0], [100, 22], [100, 78], [78, 100], [22, 100], [0, 78], [0, 22]],
    bar: [[0, 0], [100, 0], [100, 100], [0, 100]]
  };
  const sources = {
    '\u0300': ['`'], '\u0301': ['´'], '\u0302': ['ˆ'], '\u0303': ['˜', '~'],
    '\u0306': ['˘'], '\u0309': [], '\u031b': [], '\u0323': ['.']
  };

  function synthesize(buffer, characters, family, gapPercent, lookup, edits = {}) {
    const tables = readTables(buffer);
    const mandatory = ['head', 'maxp', 'glyf', 'loca', 'hhea', 'hmtx', 'name', 'cmap'];
    if (tables.has('fvar') || mandatory.some((tag) => !tables.has(tag))) {
      throw new Error('Dựng dấu hỗ trợ phông TrueType tĩnh có bảng glyf. Hãy chọn bản TTF tĩnh.');
    }
    const head = view(tables.get('head')), maxp = view(tables.get('maxp')), hhea = view(tables.get('hhea'));
    const loca = view(tables.get('loca')), metrics = view(tables.get('hmtx')), glyf = tables.get('glyf');
    const count = maxp.getUint16(4), hCount = hhea.getUint16(34), upm = head.getUint16(18);
    const getOffset = head.getInt16(50) === 0 ? (i) => loca.getUint16(i * 2) * 2 : (i) => loca.getUint32(i * 4);
    const horizontal = (i) => [metrics.getUint16(Math.min(i, hCount - 1) * 4), metrics.getInt16(i < hCount ? i * 4 + 2 : 4 * hCount + (i - hCount) * 2)];
    const oldGlyph = (id) => {
      const at = getOffset(id), end = getOffset(id + 1);
      if (at + 10 > end || end > glyf.length) return null;
      const d = view(glyf.subarray(at, at + 10));
      const box = [2, 4, 6, 8].map((p) => d.getInt16(p));
      return box[0] < box[2] && box[1] < box[3] ? { id, box } : null;
    };
    const newGlyphs = [], added = new Map(), missed = [], marks = new Map();
    const model = { upm, glyphs: {} };
    const contourCache = new Map(), pathCache = new Map(), activeGlyphs = new Set();
    function contoursFor(id) {
      if (contourCache.has(id)) return contourCache.get(id);
      if (activeGlyphs.has(id) || activeGlyphs.size >= 64) {
        throw new Error('Cấu trúc ghép glyph lồng nhau không được hỗ trợ.');
      }
      const data = id < count ? glyf.subarray(getOffset(id), getOffset(id + 1)) : newGlyphs[id - count].data;
      if (data.length < 10) return [];
      const d = view(data), contourCount = d.getInt16(0);
      activeGlyphs.add(id);
      try {
        const contours = contourCount < 0
          ? readCompoundContours(d, contoursFor)
          : readSimpleContours(d, contourCount);
        contourCache.set(id, contours);
        return contours;
      } finally {
        activeGlyphs.delete(id);
      }
    }
    function pathFor(id) {
      if (!pathCache.has(id)) pathCache.set(id, svgPath(contoursFor(id)));
      return pathCache.get(id);
    }
    const gap = Math.round(upm * gapPercent / 100);
    const postTable = tables.get('post');
    const italic = postTable?.length >= 8 ? Math.tan(-view(postTable).getInt32(4) / 65536 * Math.PI / 180) : 0;
    let dotless;
    const markSizes = {
      '\u0300': [.20, .14], '\u0301': [.20, .14], '\u0302': [.30, .13],
      '\u0303': [.29, .12], '\u0306': [.30, .12], '\u0309': [.17, .17],
      '\u031b': [.19, .15], '\u0323': [.09, .09], bar: [.32, .06]
    };
    function push(glyph, metric) {
      const id = count + newGlyphs.length;
      if (id >= 65535) throw new Error('Phông đã đạt giới hạn số glyph.');
      newGlyphs.push({ ...glyph, metric });
      return { id, box: glyph.box };
    }
    function getMark(mark) {
      if (marks.has(mark)) return marks.get(mark);
      let glyph;
      for (const candidate of mark === 'bar' ? [] : [mark, ...sources[mark]]) {
        const id = lookup(candidate.codePointAt(0));
        if (id && (glyph = oldGlyph(id))) break;
      }
      if (!glyph) {
        const [width, height] = markSizes[mark];
        const drawn = polygon(shapes[mark].map(([x, y]) => [Math.round(upm * width * x / 100), Math.round(upm * height * y / 100)]));
        glyph = push(drawn, [0, drawn.box[0]]);
      }
      marks.set(mark, glyph);
      return glyph;
    }
    for (const ch of characters) {
      const cp = ch.codePointAt(0);
      if (lookup(cp)) continue;
      const [letter, ...accents] = [...ch.normalize('NFD')];
      const stroke = ch === 'đ' || ch === 'Đ';
      const root = stroke ? (ch === 'đ' ? 'd' : 'D') : letter;
      let baseId = lookup(root.codePointAt(0));
      let base = baseId && oldGlyph(baseId);
      let remaining = accents;
      if (accents.length > 1) {
        // Keep any existing breve, circumflex or horn as part of the base.
        const shape = accents.find((mark) => ['\u0302', '\u0306', '\u031b'].includes(mark));
        const precomposed = shape && (letter + shape).normalize('NFC');
        const existing = precomposed?.length === 1 && oldGlyph(lookup(precomposed.codePointAt(0)));
        if (existing && existing.id) {
          base = existing;
          remaining = accents.filter((mark) => mark !== shape);
        }
      }
      if (root === 'i' && accents.some((accent) => accent !== '\u0323')) {
        const sourceDotless = lookup(0x131);
        if (sourceDotless) base = oldGlyph(sourceDotless);
        else if (base) {
          if (dotless === undefined) {
            const shape = withoutDot(glyf.subarray(getOffset(baseId), getOffset(baseId + 1)));
            dotless = shape ? push(shape, horizontal(baseId)) : null;
          }
          base = dotless;
        }
      }
      if (!base) {
        missed.push(ch);
        continue;
      }
      const components = [{ id: base.id, mark: null, x: 0, y: 0 }];
      const box = base.box.slice();
      const [advance, lsb] = base.id < count ? horizontal(base.id) : newGlyphs[base.id - count].metric;
      let top = box[3];
      for (const mark of stroke ? ['bar'] : remaining) {
        const glyph = getMark(mark);
        const [x0, y0, x1, y1] = glyph.box;
        const [left, bottom, right, cap] = base.box;
        let x = (left + right - x0 - x1) / 2;
        let y = top + gap - y0;
        if (mark === '\u0323') y = Math.min(0, bottom) - gap - y1;
        else if (mark === '\u031b') {
          x = right - (x1 - x0) * .65 - x0;
          y = cap - (y1 - y0) * .55 - y0;
        } else if (mark === 'bar') {
          x = (root === 'd' ? right - upm * .08 : left + upm * .06) - (x0 + x1) / 2;
          y = bottom + (cap - bottom) * (root === 'd' ? .76 : .52) - (y0 + y1) / 2;
        } else if (italic) {
          x += (y + y0 - cap) * italic;
        }
        if (mark !== '\u031b' && mark !== 'bar' && mark !== '\u0323') top = Math.round(y) + y1;
        const group = edits.groups?.[mark], local = edits.glyphs?.[ch]?.[mark];
        const offset = (axis) => (Number.isFinite(group?.[axis]) ? group[axis] : 0)
          + (Number.isFinite(local?.[axis]) ? local[axis] : 0);
        x = Math.round(x) + Math.round(offset('x'));
        y = Math.round(y) + Math.round(offset('y'));
        components.push({ id: glyph.id, mark, x, y });
        box[0] = Math.min(box[0], x + x0);
        box[1] = Math.min(box[1], y + y0);
        box[2] = Math.max(box[2], x + x1);
        box[3] = Math.max(box[3], y + y1);
      }
      if (box.some((n) => n < -32768 || n > 32767)
        || components.some(({ x, y }) => x < -32768 || x > 32767 || y < -32768 || y > 32767)) {
        missed.push(ch);
        continue;
      }
      const data = bytes(10 + components.length * 8), d = view(data);
      d.setInt16(0, -1);
      box.forEach((value, i) => d.setInt16(2 + 2 * i, value));
      components.forEach(({ id, x, y }, i) => {
        const p = 10 + 8 * i;
        d.setUint16(p, 0x1003 | (i === 0 ? 0x0400 : 0) | (i + 1 < components.length ? 0x20 : 0));
        d.setUint16(p + 2, id);
        d.setInt16(p + 4, x);
        d.setInt16(p + 6, y);
      });
      added.set(cp, push({ data, box }, [advance, lsb + box[0] - base.box[0]]).id);
      model.glyphs[ch] = {
        box,
        advance,
        parts: components.map(({ id, mark, x, y }) => ({ mark, x, y, path: pathFor(id) }))
      };
    }
    if (!added.size) return { added: [], missed, model };
    const total = count + newGlyphs.length;
    const offsets = bytes(4 * (total + 1)), o = view(offsets);
    for (let i = 0; i <= count; i++) o.setUint32(i * 4, getOffset(i));
    let nextOffset = getOffset(count);
    const glyphParts = [glyf.subarray(0, nextOffset)];
    const hmtx = bytes(4 * total), h = view(hmtx);
    for (let i = 0; i < count; i++) {
      const [advance, lsb] = horizontal(i);
      h.setUint16(i * 4, advance);
      h.setInt16(i * 4 + 2, lsb);
    }
    const fontBox = [36, 38, 40, 42].map((p) => head.getInt16(p));
    let addedTop = 0, addedBottom = 0;
    let advanceMax = hhea.getUint16(10), minLsb = hhea.getInt16(12), minRsb = hhea.getInt16(14), extent = hhea.getInt16(16);
    newGlyphs.forEach(({ data, box, metric: [advance, lsb] }, i) => {
      glyphParts.push(data);
      if (data.length % 2) glyphParts.push(bytes(1));
      nextOffset += data.length + data.length % 2;
      o.setUint32(4 * (count + i + 1), nextOffset);
      h.setUint16(4 * (count + i), advance);
      h.setInt16(4 * (count + i) + 2, lsb);
      fontBox[0] = Math.min(fontBox[0], box[0]);
      fontBox[1] = Math.min(fontBox[1], box[1]);
      fontBox[2] = Math.max(fontBox[2], box[2]);
      fontBox[3] = Math.max(fontBox[3], box[3]);
      addedTop = Math.max(addedTop, box[3]);
      addedBottom = Math.min(addedBottom, box[1]);
      const edge = lsb + box[2] - box[0];
      advanceMax = Math.max(advanceMax, advance);
      minLsb = Math.min(minLsb, lsb);
      minRsb = Math.min(minRsb, advance - edge);
      extent = Math.max(extent, edge);
    });
    fontBox.forEach((val, i) => head.setInt16(36 + 2 * i, val));
    head.setUint32(8, 0);
    head.setInt16(50, 1);
    hhea.setUint16(34, total);
    hhea.setInt16(4, Math.max(hhea.getInt16(4), addedTop));
    hhea.setInt16(6, Math.min(hhea.getInt16(6), addedBottom));
    hhea.setUint16(10, advanceMax);
    hhea.setInt16(12, minLsb);
    hhea.setInt16(14, minRsb);
    hhea.setInt16(16, extent);
    maxp.setUint16(4, total);
    // New composites may wrap source composites. These conservative maxima
    // keep the values at least as large as the original resource requirements.
    const existingPoints = Math.max(maxp.getUint16(6), maxp.getUint16(10), 16);
    const existingContours = Math.max(maxp.getUint16(8), maxp.getUint16(12), 1);
    maxp.setUint16(6, Math.max(maxp.getUint16(6), ...newGlyphs.map((glyph) => glyph.points || 0)));
    maxp.setUint16(8, Math.max(maxp.getUint16(8), ...newGlyphs.map((glyph) => glyph.contours || 0)));
    maxp.setUint16(10, Math.min(65535, existingPoints * 4));
    maxp.setUint16(12, Math.min(65535, existingContours * 4));
    maxp.setUint16(28, Math.max(maxp.getUint16(28), 4));
    maxp.setUint16(30, maxp.getUint16(30) + 1);
    const os2 = tables.get('OS/2');
    if (os2 && os2.length >= 78) {
      const d = view(os2);
      d.setUint16(74, Math.max(d.getUint16(74), addedTop));
      d.setUint16(76, Math.max(d.getUint16(76), -addedBottom));
      d.setUint16(66, Math.max(d.getUint16(66), ...added.keys()));
      if (d.getUint16(62) & 0x80) {
        d.setInt16(68, Math.max(d.getInt16(68), addedTop));
        d.setInt16(70, Math.min(d.getInt16(70), addedBottom));
      }
      if (missed.length === 0) {
        d.setUint32(42, d.getUint32(42) | (1 << 29));
        if (d.byteLength >= 86) d.setUint32(78, d.getUint32(78) | 256);
      }
    }
    const post = tables.get('post');
    if (post && post.length >= 32 && view(post).getUint32(0) !== 0x30000) {
      const header = post.slice(0, 32);
      view(header).setUint32(0, 0x30000);
      tables.set('post', header);
    }
    for (const tag of ['DSIG', 'hdmx', 'LTSH', 'VDMX']) tables.delete(tag);
    tables.set('glyf', join(glyphParts));
    tables.set('loca', offsets);
    tables.set('hmtx', hmtx);
    tables.set('cmap', buildCmap(lookup, added, tables.get('cmap')));
    tables.set('name', updateNames(tables.get('name'), family));
    return { data: pack(tables), added: [...added.keys()].map((cp) => String.fromCodePoint(cp)), missed, model };
  }

  function supports(buffer) {
    const tables = readTables(buffer);
    return tables.has('glyf') && !['fvar', 'gvar', 'vmtx', 'COLR', 'CBDT', 'sbix', 'SVG '].some((tag) => tables.has(tag));
  }
  return { synthesize, supports };
})();
