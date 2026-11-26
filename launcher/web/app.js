'use strict';

const $ = (id) => document.getElementById(id);
const lower = [...'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ'];
const chars = [...lower.map((c) => c.toUpperCase()), ...lower];
const texts = {
  sample: $('copy').value,
  stack: 'Ấ Ẫ Ể Ễ Ổ Ỗ Ữ Ỡ Ễ\nNguyễn Trãi · Buổi chiều ở Huế'
};
const state = { primary: null, reference: null };
const requests = { primary: 0, reference: 0 };
let nextFamily = 0;
let buildResult = null;
let buildToken = 0;
let buildTimer;
let startedBuild = false;
let sampleRequested = false;

function unicodeMaps(buffer, glyphIds = false) {
  const data = new DataView(buffer);
  const u16 = (p) => data.getUint16(p);
  const u32 = (p) => data.getUint32(p);
  const magic = u32(0);
  if (magic !== 0x00010000 && magic !== 0x4f54544f && magic !== 0x74727565) {
    throw new Error('Hãy chọn phông TTF hoặc OTF hợp lệ.');
  }
  let start, end, glyphCount;
  for (let i = 0; i < u16(4); i++) {
    const record = 12 + i * 16;
    const tag = u32(record);
    const offset = u32(record + 8);
    const length = u32(record + 12);
    if (offset + length > data.byteLength) throw new Error('Bảng phông vượt quá kích thước tệp.');
    if (tag === 0x636d6170 && length >= 4) {
      start = offset;
      end = start + length;
    }
    if (tag === 0x6d617870 && length >= 6) glyphCount = u16(offset + 4);
  }
  if (start === undefined || !glyphCount) throw new Error('Thiếu bảng cmap hoặc maxp.');
  const maps = [];
  const records = u16(start + 2);
  if (start + 4 + records * 8 > end) throw new Error('Bảng cmap không hợp lệ.');
  for (let i = 0; i < records; i++) {
    const record = start + 4 + 8 * i;
    const platform = u16(record);
    const encoding = u16(record + 2);
    if (platform !== 0 && !(platform === 3 && [1, 10].includes(encoding))) continue;
    const pos = start + u32(record + 4);
    if (pos + 2 > end) continue;
    const format = u16(pos);
    if (format === 4 && pos + 16 <= end) {
      const limit = pos + u16(pos + 2);
      const n = u16(pos + 6) / 2;
      if (!Number.isInteger(n) || limit > end || pos + 16 + 8 * n > limit) continue;
      maps.push((cp) => {
        if (cp > 65535) return 0;
        const ends = pos + 14;
        let lo = 0, hi = n;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (cp > u16(ends + mid * 2)) lo = mid + 1;
          else hi = mid;
        }
        if (lo === n) return 0;
        const shift = lo * 2;
        const first = u16(ends + 2 + 2 * n + shift);
        if (cp < first) return 0;
        const delta = u16(ends + 2 + 4 * n + shift);
        const ptr = ends + 2 + 6 * n + shift;
        const range = u16(ptr);
        if (!range) return (cp + delta) & 65535;
        const target = ptr + range + 2 * (cp - first);
        if (target + 2 > limit) return 0;
        const glyph = u16(target);
        return glyph ? (glyph + delta) & 65535 : 0;
      });
    }
    if ([12, 13].includes(format) && pos + 16 <= end) {
      const limit = pos + u32(pos + 4);
      const groups = u32(pos + 12);
      if (limit > end || pos + 16 + 12 * groups > limit) continue;
      maps.push((cp) => {
        let lo = 0, hi = groups - 1;
        while (lo <= hi) {
          const mid = Math.floor((lo + hi) / 2);
          const group = pos + 16 + mid * 12;
          const first = u32(group);
          const last = u32(group + 4);
          if (cp < first) hi = mid - 1;
          else if (cp > last) lo = mid + 1;
          else return u32(group + 8) + (format === 12 ? cp - first : 0);
        }
        return 0;
      });
    }
  }
  if (!maps.length) throw new Error('Không tìm thấy bảng ánh xạ Unicode được hỗ trợ (cmap 4, 12 hoặc 13).');
  const getGlyph = (cp) => {
    for (const lookup of maps) {
      const glyph = lookup(cp);
      if (glyph > 0 && glyph < glyphCount) return glyph;
    }
    return 0;
  };
  return glyphIds ? getGlyph : (cp) => Boolean(getGlyph(cp));
}

function updatePreview() {
  const text = $('copy').value.normalize($('nfd').checked ? 'NFD' : 'NFC');
  $('sizeout').textContent = $('size').value + ' px';
  for (const id of ['sampleview', 'refview', 'builtview']) {
    $(id).textContent = text;
    $(id).style.fontSize = $('sizeout').textContent;
  }
}

function updateCoverage() {
  $('glyphs').replaceChildren();
  const font = state.primary;
  $('report').disabled = !font;
  if (!font) return;
  const count = chars.length - font.missing.length;
  $('count').textContent = count;
  $('progress').value = count;
  $('status').textContent = count === chars.length ? 'Đủ ánh xạ cho bộ ký tự kiểm tra.' : 'Thiếu ánh xạ cho ' + font.missing.length + ' ký tự.';
  const shown = $('missing').checked ? font.missing : chars;
  $('empty').hidden = shown.length > 0;
  $('empty').textContent = 'Không có ký tự thiếu.';
  const cells = document.createDocumentFragment();
  for (const char of shown) {
    const cell = document.createElement('span');
    const absent = font.missing.includes(char);
    cell.textContent = char;
    cell.title = 'U+' + char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0') + (absent ? ' · Thiếu ánh xạ' : ' · Có ánh xạ');
    if (absent) cell.className = 'absent';
    else cell.style.fontFamily = font.face.family;
    cells.append(cell);
  }
  $('glyphs').append(cells);
}

function notify(message) {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}

async function load(slot, file, demo = false) {
  const request = ++requests[slot];
  notify('');
  try {
    if (file.size > 32 * 1024 * 1024) throw new Error('Tệp vượt giới hạn 32 MB.');
    const buffer = await file.arrayBuffer();
    const supports = unicodeMaps(buffer);
    const face = new FontFace('FontPreview' + ++nextFamily, buffer);
    await face.load();
    if (request !== requests[slot]) return;
    if (state[slot]) document.fonts.delete(state[slot].face);
    document.fonts.add(face);
    state[slot] = { face, name: file.name, buffer: slot === 'primary' ? buffer : null, missing: chars.filter((c) => !supports(c.codePointAt(0))) };
    if (slot === 'primary') {
      $('source').textContent = file.name;
      $('previewlabel').textContent = demo ? 'PHÔNG MINH HOẠ' : 'PHÔNG ĐANG KIỂM';
      $('sampleview').style.fontFamily = face.family + ', Georgia, serif';
      updateCoverage();
      updateBuilder(demo);
    } else {
      $('refname').textContent = file.name + ' · ' + (chars.length - state.reference.missing.length) + '/' + chars.length + ' ký tự';
      $('refname').hidden = $('remove').hidden = $('refpanel').hidden = false;
      $('refview').style.fontFamily = face.family + ', Georgia, serif';
    }
  } catch (error) {
    if (request !== requests[slot]) return;
    notify(error instanceof RangeError ? 'Tệp phông bị cắt hoặc có cấu trúc không hợp lệ.' : error.message || 'Trình duyệt không mở được phông này.');
    if (!state.primary) {
      $('source').textContent = 'Chưa có phông.';
      $('status').textContent = 'Chọn phông để kiểm tra độ phủ.';
    }
  }
}

for (const id of ['primary', 'reference']) {
  $(id).addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) load(id, file);
    event.target.value = '';
  });
}
for (const event of ['dragenter', 'dragover']) $('drop').addEventListener(event, (e) => {
  e.preventDefault();
  $('drop').classList.add('hot');
});
for (const event of ['dragleave', 'drop']) $('drop').addEventListener(event, (e) => {
  e.preventDefault();
  $('drop').classList.remove('hot');
  if (e.dataTransfer.files[0]) load('primary', e.dataTransfer.files[0]);
});
$('remove').addEventListener('click', () => {
  requests.reference++;
  document.fonts.delete(state.reference.face);
  state.reference = null;
  $('refview').style.fontFamily = '';
  $('refname').hidden = $('remove').hidden = $('refpanel').hidden = true;
});
$('missing').addEventListener('change', updateCoverage);
$('try-editor').addEventListener('click', async () => {
  const button = $('try-editor');
  sampleRequested = true;
  const request = requests.primary;
  button.disabled = true;
  try {
    const response = await fetch('demo-latin.ttf');
    if (!response.ok) throw new Error('Không tải được phông mẫu.');
    const blob = await response.blob();
    if (request !== requests.primary) return;
    await load('primary', new File([blob], 'DejaVu Serif · mẫu thiếu dấu.ttf'));
    if (state.primary?.name === 'DejaVu Serif · mẫu thiếu dấu.ttf') {
      $('family').value = 'Studio Viet Demo';
      syncBuildButton();
      $('family').focus({ preventScroll: true });
      $('buildcontrols').scrollIntoView({ block: 'nearest' });
    }
  } catch (error) {
    if (request === requests.primary) notify(error.message || 'Không tải được phông mẫu.');
  } finally {
    button.disabled = false;
  }
});
for (const id of ['copy', 'size', 'nfd']) $(id).addEventListener('input', updatePreview);
const presets = document.querySelectorAll('[data-sample]');
for (const preset of presets) preset.addEventListener('click', () => {
  for (const button of presets) button.setAttribute('aria-pressed', String(button === preset));
  $('copy').value = texts[preset.dataset.sample];
  updatePreview();
});
$('copy').addEventListener('input', () => {
  for (const button of presets) button.setAttribute('aria-pressed', String(texts[button.dataset.sample] === $('copy').value));
});
function canBuild() {
  return !$('buildcontrols').hidden && $('licensed').checked && Boolean($('family').value.trim());
}

function syncBuildButton(active = false) {
  $('build').disabled = active || !canBuild();
}

function resetBuild() {
  buildToken++;
  clearTimeout(buildTimer);
  startedBuild = false;
  if (buildResult) document.fonts.delete(buildResult.face);
  buildResult = null;
  GlyphEditor.clear();
  $('builtview').style.fontFamily = '';
  $('builtpanel').hidden = $('fontdownload').hidden = $('buildstatus').hidden = true;
}

function updateBuilder(demo) {
  const font = state.primary;
  $('licensed').checked = false;
  $('family').value = '';
  resetBuild();
  const supported = !demo && FontBuilder.supports(font.buffer);
  $('buildcontrols').hidden = !supported || !font.missing.length;
  $('buildhint').textContent = demo
    ? 'Chọn phông của bạn để dựng dấu.'
    : !supported
      ? 'Dựng dấu hỗ trợ TTF tĩnh. Bạn vẫn có thể kiểm tra phông này.'
      : font.missing.length
        ? 'Dựng thử ' + font.missing.length + ' chữ thiếu, rồi chỉnh dấu trong khung soi.'
        : 'Phông đã có ánh xạ cho đủ bộ ký tự kiểm tra.';
  syncBuildButton();
}

function scheduleBuild({ delay = 0, reveal = false } = {}) {
  const token = ++buildToken;
  clearTimeout(buildTimer);
  $('fontdownload').disabled = true;
  if (!canBuild()) {
    syncBuildButton();
    $('buildstatus').hidden = !startedBuild;
    $('buildstatus').textContent = 'Nhập tên phông và xác nhận quyền sửa để xuất bản chỉnh sửa.';
    return;
  }
  startedBuild = true;
  syncBuildButton(true);
  $('buildstatus').textContent = buildResult ? 'Đang cập nhật bản chỉnh…' : 'Đang dựng dấu…';
  $('buildstatus').hidden = false;
  buildTimer = setTimeout(() => compile(token, reveal), delay || 25);
}

async function compile(token, reveal) {
  const family = $('family').value.trim();
  const font = state.primary;
  const adjustments = GlyphEditor.adjustments();
  try {
    font.lookup ??= unicodeMaps(font.buffer, true);
    const result = FontBuilder.synthesize(font.buffer, chars, family, Number($('gap').value), font.lookup, adjustments);
    if (!result.data) throw new Error('Thiếu chữ nền cần thiết để dựng. Các chữ chưa dựng: ' + result.missed.join(' '));
    const face = await new FontFace('FontPreview' + ++nextFamily, result.data).load();
    if (token !== buildToken) return;
    const supports = unicodeMaps(result.data.buffer);
    const missing = chars.filter((c) => !supports(c.codePointAt(0)));
    if (buildResult) document.fonts.delete(buildResult.face);
    document.fonts.add(face);
    buildResult = { data: result.data, added: result.added, face, family, missing, token, adjustments };
    $('builtview').style.fontFamily = face.family + ', Georgia, serif';
    $('builtpanel').hidden = $('fontdownload').hidden = false;
    $('fontdownload').disabled = false;
    $('buildstatus').textContent = 'Đã thêm ' + result.added.length + ' chữ. Độ phủ bản dựng ' + (chars.length - missing.length) + '/' + chars.length + '.'
      + (missing.length ? ' Chưa dựng được: ' + missing.join(' ') : '');
    GlyphEditor.load(result.model, () => scheduleBuild({ delay: 80 }));
    if (reveal && !$('editor').hidden) $('editor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    if (token === buildToken) {
      const details = error.message || 'Không dựng được phông này.';
      $('buildstatus').textContent = details + (buildResult ? ' Bản xem thử đang hiển thị lần dựng trước.' : '');
    }
  } finally {
    if (token === buildToken) syncBuildButton();
  }
}

for (const id of ['licensed', 'family', 'gap']) {
  $(id).addEventListener('input', () => {
    $('gapout').textContent = $('gap').value + '%';
    if (startedBuild) scheduleBuild({ delay: 180 });
    else syncBuildButton();
  });
}
$('build').addEventListener('click', () => scheduleBuild({ reveal: !buildResult }));

function download(data, type, name) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('fontdownload').addEventListener('click', () => {
  if (buildResult?.token !== buildToken) return;
  const name = buildResult.family.replace(/[<>:"/\\|?*]/g, '-').replace(/^[. ]+|[. ]+$/g, '') || 'Phong-Viet';
  download(buildResult.data, 'font/ttf', name + '.ttf');
});

$('report').addEventListener('click', () => {
  const inspect = (font) => ({ tep: font.name, tongKyTu: chars.length, coAnhXa: chars.length - font.missing.length, thieu: font.missing });
  const result = { phong: inspect(state.primary), doiChieu: state.reference ? inspect(state.reference) : null, vanBan: $('sampleview').textContent, unicode: $('nfd').checked ? 'NFD' : 'NFC', coChuPx: Number($('size').value) };
  if (buildResult?.token === buildToken) {
    result.banDung = { ten: buildResult.family, them: buildResult.added, thieu: buildResult.missing, doLech: buildResult.adjustments };
  }
  download(JSON.stringify(result, null, 2), 'application/json', 'bao-cao-phong-viet.json');
});
updatePreview();
fetch('demo.ttf').then((r) => {
  if (!r.ok) throw new Error('Demo unavailable');
  return r.blob();
}).then((blob) => {
  if (!sampleRequested && !requests.primary) load('primary', new File([blob], 'DejaVu Serif · bản minh hoạ.ttf'), true);
}).catch(() => {
  if (!requests.primary) {
    $('source').textContent = 'Chưa có phông.';
    $('status').textContent = 'Chọn phông để kiểm tra độ phủ.';
  }
});
