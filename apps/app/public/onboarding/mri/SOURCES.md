# Head MRI slices for onboarding

- Files: `slice-1.webp` to `slice-4.webp` (axial T1-weighted head MRI, one subject, consecutive levels from the basal ganglia upward)
- Title: Balloon Analog Risk-taking Task, OpenNeuro dataset ds000001 v1.0.0, file `sub-01/anat/sub-01_T1w.nii.gz`
- Authors: Tom Schonberg, Christopher Trepel, Craig Fox, Russell A. Poldrack
- URL: https://openneuro.org/datasets/ds000001/versions/1.0.0 (DOI 10.18112/openneuro.ds000001.v1.0.0)
- Licence: CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/), as declared in the dataset's `dataset_description.json`. The dataset README additionally cites the Open Data Commons PDDL 1.0. Both are public-domain dedications; attribution is not legally required but is given here.
- Reference to cite: Schonberg TS, Fox CR, Mumford JA, Congdon E, Trepel C, Poldrack RA (2012). Decreasing ventromedial prefrontal cortex activity during sequential risk-taking: An fMRI investigation of the Balloon Analogue Risk Task. Frontiers in Decision Neuroscience, 6:80. doi:10.3389/fnins.2012.00080
- De-identification: research volunteer data, anonymised by the dataset authors; the facial region is removed (defaced) in the volume; no text, names, IDs or dates are present in the images.

## Modifications

Four axial slices (voxel indices 98, 103, 108, 113, about 6.7 mm apart) were extracted from the volume reoriented to RAS, resampled to isotropic pixels, cropped and centred on a 512x512 canvas, contrast-clipped at the 99.7th percentile with a mild gamma, the background outside the head (residual defacing artefacts) set to black, and saved as grayscale WebP. No anatomical content was added or removed.
