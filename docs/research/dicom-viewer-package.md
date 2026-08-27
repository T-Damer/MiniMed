# Medical image viewer comparison

## Decision

Keep Cornerstone3D `5.8.2` as the lazy-loaded reader for DICOM files. Do not replace it with a
general neuroimaging viewer: Cornerstone has the strongest native DICOM pipeline, compressed pixel
decoders, metadata model, stack/series tools, and a path to volume rendering.

NiiVue `0.69.0` is the complementary lazy-loaded reader for NIfTI, NRRD, MIF, MGH/MGZ, MHD, AFNI,
Analyze, and NumPy volumes. Ordinary DICOM remains on Cornerstone: NiiVue's DICOM plug-in converts a
series to NIfTI with `dcm2niix` WASM before viewing, which adds work before the first image and changes
the document model from DICOM instances to a derived volume.

## Format coverage

| Viewer | DICOM | Other medical formats | Fit for MiniMed |
| --- | --- | --- | --- |
| **Cornerstone3D** | Native Part 10, multi-frame, DICOMweb, common compressed transfer syntaxes | Extensible loaders; no comparably broad built-in volume-format list | Best DICOM engine and current choice |
| **NiiVue** | Plug-in conversion through `dcm2niix` WASM | NIfTI, NRRD, MIF, AFNI, MGH/MGZ, MHD, ECAT7, DSI Studio plus mesh formats | Best complementary volume viewer |
| **AMI** | Native loading and common DICOM codecs | NIfTI, NRRD, MHD/RAW, MGH/MGZ | Broad coverage, but an older Three.js-based integration with less evidence for progressive loading |
| **Papaya** | Compressed and uncompressed DICOM through Daikon | NIfTI, GIFTI, VTK | Simple all-in-one viewer, but an older pure-JavaScript pipeline and narrower tooling |
| **DWV** | Strong local and remote DICOM support, MPR and editing tools | Primarily DICOM | Technically suitable, but GPL-3.0 is a distribution constraint |
| **OHIF** | Full DICOM workstation including SR, SEG, RT and microscopy extensions | DICOM-centric | Uses Cornerstone underneath; a React/PACS application, not a faster embedded renderer |
| **Orthanc Stone** | Full WebAssembly DICOM viewer | DICOM-centric | Optimized for an Orthanc/DICOMweb server, conflicting with the offline/no-backend invariant |

## Opening speed and memory

There is no comparable official cross-viewer benchmark, so package marketing numbers should not be
treated as a ranking. The relevant architectural differences are:

- **Cornerstone3D:** WebGL rendering, WASM codecs, workers, streaming volumes, metadata prefetch, and
  progressive retrieval. True byte-range/HTJ2K first-render gains require a compatible DICOMweb
  server; a local browser `Blob` is already fully present.
- **NiiVue:** efficient WebGL2 3D textures and GPU reslicing. It is likely the faster choice once a
  NIfTI-like volume is ready, but classic DICOM first has to be grouped and converted by the plug-in.
- **AMI and Papaya:** can cover DICOM and several volume formats in one package, but their primary
  documentation does not describe a modern progressive local-DICOM path comparable to Cornerstone.
- **OHIF and Orthanc Stone:** capable complete applications, but their extra application/server
  architecture cannot improve this embedded local-file startup path.

For MiniMed, the selected instance must render before sibling scanning, decoding, or volume
construction. A browser fault-injection check with 80 sibling instances and one delayed 120 MB
sibling improved selected-image readiness from about `3.3 s` to about `0.3 s` after moving series
discovery into the background. This is a higher-impact local-file optimization than swapping the
renderer.

## Minimal roadmap

1. Keep Cornerstone for `.dcm` and `.dicom`; render the selected instance immediately and enrich the
   stack in the background.
2. Load volume/MPR support only when the user requests it; prioritize the current and adjacent slices
   and cap concurrent decode work.
3. Keep NiiVue isolated to accepted native volume formats and lazy-load it with their reader.
4. Consider DICOMweb progressive retrieval only if MiniMed later gains an optional compatible source;
   it is not useful for the current offline `Blob` path.

## Primary sources

- [Cornerstone3D repository and capabilities](https://github.com/cornerstonejs/cornerstone3D)
- [Cornerstone image loaders](https://www.cornerstonejs.org/docs/concepts/cornerstone-core/imageloader/)
- [Cornerstone streaming volumes](https://www.cornerstonejs.org/docs/concepts/streaming-image-volume/streaming/)
- [Cornerstone progressive loading and benchmark](https://www.cornerstonejs.org/docs/concepts/progressive-loading/volumeprogressive/)
- [Cornerstone progressive-loading server requirements](https://www.cornerstonejs.org/docs/concepts/progressive-loading/requirements/)
- [NiiVue formats and architecture](https://github.com/niivue/niivue)
- [NiiVue DICOM conversion](https://niivue.com/docs/dicom/)
- [NiiVue loader plug-ins](https://niivue.com/docs/plugins/)
- [NiiVue WebGL performance design](https://niivue.com/docs/webgl/)
- [AMI formats and architecture](https://github.com/FNNDSC/ami)
- [Papaya formats](https://github.com/rii-mango/papaya)
- [DWV capabilities and license](https://github.com/ivmartel/dwv)
- [OHIF viewer architecture](https://github.com/OHIF/Viewers)
- [Orthanc viewer options](https://orthanc.uclouvain.be/book/faq/viewers.html)
