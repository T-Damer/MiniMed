# Sagittal head-MRI frames for the onboarding and the feature tour

- Files: `sagittal-1.webp` … `sagittal-6.webp`, sagittal slices 50, 58, 66 (midline), 74, 82 and 92
  of 130.
- What they are: screenshots of MiniMed's own image viewer (sagittal mode, crosshair as drawn by
  the viewer) with the downloadable MRI example `apps/app/src/assets/example-mri.nii` open. That
  example is the real, anonymised `MR-head.nrrd` of the
  [3D Slicer Sample Data](https://github.com/Slicer/Slicer/blob/main/Modules/Scripted/SampleData/SampleData.py)
  converted to NIfTI without synthetic pixels; provenance and licence in
  `apps/app/src/assets/example-mri.LICENSE.md`. 3D Slicer's acknowledgement states that MRHead was
  donated by the person visible in the images for use without restrictions.
- Capture (2026-10-05): headless Chromium at 375×844, device scale 2, built app; the canvas area of
  the volume was cropped, padded to a square on black, resized to 640 px and stored as grayscale
  WebP. Nothing in the images was drawn or edited.
