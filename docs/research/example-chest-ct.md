# Пример КТ грудной клетки для MiniMed

## Выбор

Официальный **3D Slicer CTChest** (`CT-chest.nrrd`) подходит текущему генератору.

- URL: <https://github.com/Slicer/SlicerTestingData/releases/download/SHA256/4507b664690840abb6cb9af2d919377ffc4ef75b167cb6fd0f747befdb12e38e>
- SHA-256: `4507b664690840abb6cb9af2d919377ffc4ef75b167cb6fd0f747befdb12e38e`
- Размер: `42 189 103` байта (`40,23 MiB`).
- Геометрия: `512 × 512 × 139`, 139 аксиальных срезов; spacing
  `0,7617189884 × 0,7617189884 × 2,5 мм`; signed 32-bit little-endian NRRD, gzip.
- При текущем 2× downsampling: `256 × 256 × 139`, около `17,38 MiB` несжатых 16-bit pixels.

URL и checksum закреплены в официальном
[`SampleData.py`](https://github.com/Slicer/Slicer/blob/368b0f5f814d5d7bb1bac5313c6298116d7315d0/Modules/Scripted/SampleData/SampleData.py#L682-L686).
Размер и геометрия проверены по HTTP-заголовкам и NRRD-заголовку release-asset; полный том и DICOM
не скачивались.

## Условия использования и acknowledgement

Сопровождающий 3D Slicer подтвердил именно для CTChest: старый набор полностью анонимен, сведений о
пациенте нет, а использование регулирует
[Slicer License](https://discourse.slicer.org/t/origin-of-ct-chest-sample-data/37731/3).
Сама лицензия распространяется на загружаемые из Slicer software **и data** и разрешает создание и
распространение производных работ. Для bundle необходимо:

1. включить полный текст Part B и требуемую им вводную формулировку в копию и пользовательскую
   документацию;
2. сохранить attribution, copyright notices и licenses;
3. явно пометить DICOM MiniMed как модифицированную производную;
4. сохранить оговорку «research only / not approved for clinical use» и проверить возможные права
   третьих лиц.

Первичный текст: [область действия](https://github.com/Slicer/Slicer/blob/68ff0ae7114e4378322740f117643d7513a71110/License.txt#L9-L28),
[de-identification](https://github.com/Slicer/Slicer/blob/68ff0ae7114e4378322740f117643d7513a71110/License.txt#L43-L64),
[Part B](https://github.com/Slicer/Slicer/blob/68ff0ae7114e4378322740f117643d7513a71110/License.txt#L89-L149).
В acknowledgement модуля нет отдельной лицензии или донора CTChest; фраза `without restrictions`
относится к другим перечисленным наборам. Не переносить её на CTChest:
[`SampleData.py`, строки 84–96](https://github.com/Slicer/Slicer/blob/368b0f5f814d5d7bb1bac5313c6298116d7315d0/Modules/Scripted/SampleData/SampleData.py#L84-L96).

Рекомендуемая подпись:

> Derived and downsampled from the anonymized CTChest sample distributed by the 3D Slicer project;
> source SHA-256: 4507b664690840abb6cb9af2d919377ffc4ef75b167cb6fd0f747befdb12e38e.
> Modified for MiniMed; research and demonstration only, not for clinical use. Distributed under
> the applicable 3D Slicer Software License terms.
