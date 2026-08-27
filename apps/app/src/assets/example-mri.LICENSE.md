# Example MRI volume provenance

`example-mri.nii` is generated from the real, anonymized `MR-head.nrrd` volume in the official
[3D Slicer Sample Data](https://github.com/Slicer/Slicer/blob/main/Modules/Scripted/SampleData/SampleData.py)
collection. The source SHA-256 is
`cc211f0dfd9a05ca3841ce1141b292898b2dd2d3f08286affadf823a7e58df93`.

3D Slicer's acknowledgement states that MRHead was donated by the person visible in the images for
use without restrictions. The generator converts the source to NIfTI-1 without synthetic pixels and
preserves all 130 distinct slices, 1×1×1.3 mm spacing, and the source spatial transform.
