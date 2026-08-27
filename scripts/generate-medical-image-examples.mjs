import dcmjs from 'dcmjs';

const ctPath = 'apps/app/src/assets/example-ct.dcm';
const mriPath = 'apps/app/src/assets/example-mri.nii';
const sources = {
  ct: {
    url: 'https://github.com/Slicer/SlicerTestingData/releases/download/SHA256/4507b664690840abb6cb9af2d919377ffc4ef75b167cb6fd0f747befdb12e38e',
    sha256: '4507b664690840abb6cb9af2d919377ffc4ef75b167cb6fd0f747befdb12e38e',
  },
  mri: {
    url: 'https://github.com/Slicer/SlicerTestingData/releases/download/SHA256/cc211f0dfd9a05ca3841ce1141b292898b2dd2d3f08286affadf823a7e58df93',
    sha256: 'cc211f0dfd9a05ca3841ce1141b292898b2dd2d3f08286affadf823a7e58df93',
  },
};

dcmjs.log.getLogger('validation.dcmjs').setLevel('silent');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function download(source) {
  const response = await fetch(source.url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${source.url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  assert(sha256 === source.sha256, `Checksum mismatch for ${source.url}`);
  return bytes;
}

function parseVector(value) {
  return value.slice(1, -1).split(',').map(Number);
}

function parseNrrd(bytes) {
  let headerEnd = -1;
  for (let index = 0; index < bytes.length - 1; index += 1) {
    if (bytes[index] === 10 && bytes[index + 1] === 10) {
      headerEnd = index + 2;
      break;
    }
  }
  assert(headerEnd > 0, 'Invalid NRRD header.');

  const fields = new Map();
  const header = new TextDecoder().decode(bytes.subarray(0, headerEnd));
  for (const line of header.split('\n')) {
    if (!line || line.startsWith('#') || !line.includes(':')) continue;
    const separator = line.indexOf(':');
    fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }

  const sizes = fields.get('sizes')?.split(/\s+/).map(Number);
  const directions = fields
    .get('space directions')
    ?.match(/\([^)]*\)/g)
    ?.map(parseVector);
  const origin = fields.get('space origin') ? parseVector(fields.get('space origin')) : [0, 0, 0];
  assert(sizes?.length === 3, 'Expected a 3D NRRD volume.');
  assert(directions?.length === 3, 'Expected NRRD space directions.');

  const encoded = bytes.subarray(headerEnd);
  const data = fields.get('encoding') === 'gzip' ? Bun.gunzipSync(encoded) : encoded;
  return { data, directions, fields, origin, sizes };
}

function vectorLength(vector) {
  return Math.hypot(...vector);
}

function frameHash(values, offset, length) {
  let hash = 2166136261;
  for (let index = offset; index < offset + length; index += 1) {
    hash = Math.imul(hash ^ values[index], 16777619);
  }
  return hash >>> 0;
}

async function writeCt(source) {
  const volume = parseNrrd(source);
  assert(volume.fields.get('type') === 'int', 'Expected signed 32-bit CT pixels.');
  assert(volume.fields.get('endian') === 'little', 'Expected little-endian CT pixels.');
  const [sourceColumns, sourceRows, frames] = volume.sizes;
  assert(volume.data.byteLength === sourceColumns * sourceRows * frames * 4, 'Invalid CT pixels.');

  const columns = Math.ceil(sourceColumns / 2);
  const rows = Math.ceil(sourceRows / 2);
  const frameSize = columns * rows;
  const pixels = new Int16Array(frameSize * frames);
  const sourceView = new DataView(
    volume.data.buffer,
    volume.data.byteOffset,
    volume.data.byteLength,
  );
  for (let frame = 0; frame < frames; frame += 1) {
    const sourceFrameOffset = frame * sourceColumns * sourceRows;
    const targetFrameOffset = frame * frameSize;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const sourceIndex = sourceFrameOffset + y * 2 * sourceColumns + x * 2;
        const value = sourceView.getInt32(sourceIndex * 4, true);
        pixels[targetFrameOffset + y * columns + x] = Math.max(-32768, Math.min(32767, value));
      }
    }
  }
  assert(
    new Set(
      Array.from({ length: frames }, (_, frame) => frameHash(pixels, frame * frameSize, frameSize)),
    ).size > 10,
    'CT source does not contain distinct slices.',
  );
  let firstFrameTissuePixels = 0;
  for (let index = 0; index < frameSize; index += 1) {
    if (pixels[index] > -700) firstFrameTissuePixels += 1;
  }
  assert(
    firstFrameTissuePixels > frameSize * 0.4,
    'CT first slice does not contain enough visible anatomy.',
  );

  const template = dcmjs.data.DicomMessage.readFile(await Bun.file(ctPath).arrayBuffer());
  const sopUid = '2.25.20260826000000000000000000000000001';
  template.meta['00020003'].Value = [sopUid];
  template.meta['00020016'].Value = ['MINIMED'];
  template.dict['00080018'].Value = [sopUid];
  template.dict['00080060'].Value = ['CT'];
  template.dict['00081030'] = { vr: 'LO', Value: ['CT chest'] };
  template.dict['0008103E'] = { vr: 'LO', Value: ['3D Slicer CTChest sample'] };
  template.dict['00100010'].Value = [{ Alphabetic: 'ANONYMIZED^SLICER^SAMPLE' }];
  template.dict['00100020'].Value = ['SLICER-CT-CHEST'];
  template.dict['0020000D'].Value = ['2.25.20260826000000000000000000000000003'];
  template.dict['0020000E'].Value = ['2.25.20260826000000000000000000000000002'];
  template.dict['00180015'] = { vr: 'CS', Value: ['CHEST'] };
  for (const tag of ['00080020', '00080030', '00100030', '00101000', '00101010', '00102160']) {
    delete template.dict[tag];
  }
  template.dict['00280002'] = { vr: 'US', Value: [1] };
  template.dict['00280004'] = { vr: 'CS', Value: ['MONOCHROME2'] };
  template.dict['00280008'] = { vr: 'IS', Value: [frames] };
  template.dict['00280010'] = { vr: 'US', Value: [rows] };
  template.dict['00280011'] = { vr: 'US', Value: [columns] };
  template.dict['00280100'] = { vr: 'US', Value: [16] };
  template.dict['00280101'] = { vr: 'US', Value: [16] };
  template.dict['00280102'] = { vr: 'US', Value: [15] };
  template.dict['00280103'] = { vr: 'US', Value: [1] };
  template.dict['00280030'] = {
    vr: 'DS',
    Value: [vectorLength(volume.directions[1]) * 2, vectorLength(volume.directions[0]) * 2],
  };
  template.dict['00180050'] = { vr: 'DS', Value: [vectorLength(volume.directions[2])] };
  template.dict['00281050'] = { vr: 'DS', Value: [-600] };
  template.dict['00281051'] = { vr: 'DS', Value: [1500] };
  template.dict['00281052'] = { vr: 'DS', Value: [0] };
  template.dict['00281053'] = { vr: 'DS', Value: [1] };
  template.dict['7FE00010'] = { vr: 'OW', Value: [pixels.buffer] };
  await Bun.write(ctPath, template.write());
  return frames;
}

async function writeMri(source) {
  const volume = parseNrrd(source);
  assert(volume.fields.get('type') === 'short', 'Expected signed 16-bit MRI pixels.');
  assert(volume.fields.get('endian') === 'little', 'Expected little-endian MRI pixels.');
  const [width, height, slices] = volume.sizes;
  assert(volume.data.byteLength === width * height * slices * 2, 'Invalid MRI pixels.');
  const values = new Int16Array(volume.data.slice().buffer);
  const frameSize = width * height;
  assert(
    new Set(
      Array.from({ length: slices }, (_, slice) => frameHash(values, slice * frameSize, frameSize)),
    ).size > 10,
    'MRI source does not contain distinct slices.',
  );

  const headerBytes = 352;
  const output = new Uint8Array(headerBytes + volume.data.byteLength);
  const view = new DataView(output.buffer);
  view.setInt32(0, 348, true);
  view.setInt16(40, 3, true);
  view.setInt16(42, width, true);
  view.setInt16(44, height, true);
  view.setInt16(46, slices, true);
  view.setInt16(48, 1, true);
  view.setInt16(70, 4, true);
  view.setInt16(72, 16, true);
  view.setFloat32(76, 1, true);
  for (let index = 0; index < 3; index += 1) {
    view.setFloat32(80 + index * 4, vectorLength(volume.directions[index]), true);
  }
  view.setFloat32(108, headerBytes, true);
  view.setFloat32(112, 1, true);
  view.setInt16(254, 1, true);
  const lpsToRas = [-1, -1, 1];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      view.setFloat32(
        280 + row * 16 + column * 4,
        volume.directions[column][row] * lpsToRas[row],
        true,
      );
    }
    view.setFloat32(292 + row * 16, volume.origin[row] * lpsToRas[row], true);
  }
  output.set(new TextEncoder().encode('3D Slicer MRHead sample'), 148);
  output.set([110, 43, 49, 0], 344);
  output.set(volume.data, headerBytes);
  await Bun.write(mriPath, output);
  return slices;
}

const [ctSource, mriSource] = await Promise.all([download(sources.ct), download(sources.mri)]);
const [ctSlices, mriSlices] = await Promise.all([writeCt(ctSource), writeMri(mriSource)]);
console.log(`Generated real anonymized samples: CT ${ctSlices} slices, MRI ${mriSlices} slices.`);
