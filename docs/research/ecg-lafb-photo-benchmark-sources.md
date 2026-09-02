# LAFB photo benchmark: первичные источники и воспроизводимый smoke-набор

Проверено 31 августа 2026 г. Вывод: открытые данные позволяют собрать фиксированный
15-case инженерный smoke test для цепочки `waveform → render/photo → digitization → LAFB rule`,
но не позволяют честно назвать его клинически валидированным LAFB photo benchmark. Публичные
фото PhysioNet Challenge 2024 синтетические, скрытые реальные фото не опубликованы, а PTB-XL
labels не доказывают наличие каждого отдельного морфологического критерия AHA на каждом снимке.

## Взрослое правило и границы применения

Основной источник — таблица определений в
[2018 ACC/AHA/HRS Bradycardia and Conduction Delay Guideline](https://www.ahajournals.org/doi/10.1161/CIR.0000000000000628).
Для взрослого LAFB одновременно нужны:

1. QRS `<120 ms`;
2. frontal QRS axis от `−45°` до `−90°` включительно;
3. `qR` в aVL;
4. R-peak time в aVL `≥45 ms`;
5. `rS` в II, III и aVF.

Предшествующее
[AHA/ACCF/HRS Part III statement (2009)](https://www.jacc.org/doi/10.1016/j.jacc.2008.12.013)
перечисляет первые четыре критерия и прямо говорит, что они не применимы к пациентам с
врождённым пороком сердца, если отклонение оси влево присутствует с младенчества. Поэтому для
MiniMed безопасная взрослая ветка должна требовать полный более поздний пятикомпонентный набор,
а расхождение версий хранить в provenance, не скрывать.

### Suppressions и abstention

Следующие случаи не должны давать автоматический результат `compatible-with-lafb`:

- возраст `<18` или неизвестен — эта ветка проектируется как adult-only;
- врождённый порок с LAD с младенчества — явное исключение Part III;
- желудочковая стимуляция, желудочковое происхождение анализируемого комплекса или
  pre-excitation — это операционные исключения MiniMed, потому что определения Part III относятся
  к нарушениям проведения наджелудочкового импульса; это не отдельные пять критериев AHA;
- отсутствует хотя бы одно из II/III/aVF/aVL, не подтверждён порядок отведений, нет калибровки,
  или качество не позволяет надёжно различить начальные q/r и последующий R/S;
- неопределённость QRS, оси или R-peak пересекает соответствующую границу (`120 ms`, `−45°`,
  `−90°`, `45 ms`);
- morphology сохранена как `unknown`; `unknown` нельзя превращать в `absent`.

Ось сама по себе недостаточна. QRS `≥120 ms` не является «почти LAFB»: он не проходит
определение и требует отдельной оценки широкого QRS. RBBB, напротив, не следует автоматически
подавлять: LAFB может сосуществовать с RBBB; Part III рекомендует описывать отдельные дефекты, а
не заменять их неоднозначным общим термином `bifascicular block`.

Пользовательский результат должен быть сформулирован как `pattern compatible with LAFB`, с
`reviewRequired=true`, перечислением выполненных критериев и без числовой «вероятности диагноза».

## Что действительно дают открытые datasets

| Источник | Waveform | Labels/statements | Measurements | Images | Лицензия и роль |
|---|---|---|---|---|---|
| [PTB-XL 1.0.3](https://physionet.org/content/ptb-xl/1.0.3/) | 21 799 десятисекундных 12-lead ECG; 500 Hz и копии 100 Hz | `scp_codes`, `report`, `heart_axis`, `validated_by_human`; `LAFB` определён в [официальном `scp_statements.csv`](https://physionet.org/files/ptb-xl/1.0.3/scp_statements.csv) как diagnostic `CD`, subclass `LAFB/LPFB` | детальных per-lead measurements нет | статического photo corpus нет | [CC BY 4.0](https://physionet.org/content/ptb-xl/view-license/1.0.3/): можно распространять исходные/производные файлы с attribution и отметкой изменений. Основной источник стабильных `ecg_id` и waveform truth |
| [PTB-XL+ 1.0.1](https://physionet.org/content/ptb-xl-plus/1.0.1/) | median beats Uni-G/12SL, привязанные к PTB-XL ID | human PTB-XL и automatic 12SL statements разделены; Uni-G statements отсутствуют из-за usage restrictions | Uni-G, 12SL и ECGDeli tables; официальный [feature dictionary](https://physionet.org/files/ptb-xl-plus/1.0.1/features/feature_description.csv) содержит global QRS axis/duration, per-lead Q/R/S amplitudes/durations и Uni-G `QRS_IntDefl_X` | нет | [CC BY 4.0](https://physionet.org/content/ptb-xl-plus/view-license/1.0.1/). Это joined derivative PTB-XL, не независимые cases и не ручная morphology truth |
| [MIMIC-IV-ECG 1.0](https://physionet.org/content/mimic-iv-ecg/1.0/) | около 800 000 десятисекундных 12-lead ECG, 500 Hz | `report_0..report_17` — machine-generated reports; cardiologist text в v1.0 не включён, есть только links к отдельному MIMIC-IV-Note | только global machine measures: RR, P/QRS/T boundaries и P/QRS/T axes; per-lead measures ещё не опубликованы, см. [dictionary](https://physionet.org/files/mimic-iv-ecg/1.0/machine_measurements_data_dictionary.csv) | нет | v1.0 открыт под [ODbL 1.0](https://physionet.org/content/mimic-iv-ecg/view-license/1.0/), в отличие от старых credentialed версий. Derivative database требует share-alike; публичный rendered Produced Work — notice. Годится для discovery/масштаба, не как LAFB gold truth |
| [LUDB 1.0.1](https://physionet.org/content/ludb/1.0.1/) | 200 десятисекундных 12-lead ECG, 500 Hz | diagnosis, axis, pacing и другие состояния в [официальном `ludb.csv`](https://physionet.org/files/ludb/1.0.1/ludb.csv) | кардиологи вручную отметили P/T/QRS peaks и boundaries отдельно в каждом отведении | нет | [ODC Attribution 1.0](https://physionet.org/content/ludb/view-license/1.0.1/). Лучший независимый delineation smoke, но patient uniqueness явно не гарантирована |
| [PhysioNet Challenge 2024](https://moody-challenge.physionet.org/2024/) | public training использует PTB-XL waveform | image class `CD` объединяет conduction disturbances и не сохраняет LAFB как отдельный класс | waveform остаётся эталоном digitization | public training images синтетические; hidden validation/test содержали реальные scans/photos, но остаются закрытыми | [ECG-Image-Kit](https://github.com/alphanumericslab/ecg-image-kit) — BSD-3-Clause; лицензия исходного PTB-XL продолжает определять права на данные/производные изображения |
| [LearnECG examples](https://learnecg.ru/ecg_example/ecg_example_menu.php) | нет download API | вторичная учебная интерпретация | нет machine-readable measurements | изображения собраны «из разных источников», страницы дают source links | bulk license и стабильные machine IDs не найдены. Только link-only discovery; картинку можно брать лишь у её первичного источника после отдельной проверки прав |

LUDB сообщает 16 записей с literal label `Left anterior hemiblock`: `21, 26, 46, 51, 55,
60, 65, 82, 83, 84, 97, 108, 125, 126, 138, 164`. Из них `51` и `83` одновременно
имеют complete LBBB, а `60, 82, 97, 125, 126` — incomplete RBBB, `108` — complete RBBB.
Это полезные сочетания, но не основание считать все 16 независимой ручной проверкой современного
пятикомпонентного определения.

## Фиксированный 15-case substitute smoke

Ниже — доказуемый, patient-distinct manifest из
[официального `ptbxl_database.csv`](https://physionet.org/files/ptb-xl/1.0.3/ptbxl_database.csv).
Все записи adult, `strat_fold=10`, `validated_by_human=True`, имеют разные `patient_id`; waveform
берётся из указанного `filename_hr` при 500 Hz. `ALAD` означает abnormal/extreme LAD, а `LAD` —
left axis deviation по metadata PTB-XL. Likelihood `0` у PTB-XL означает «не задан», поэтому
`SR: 0` нельзя трактовать как оценку вероятности.

| Группа | `ecg_id` | `patient_id` | Возраст | `heart_axis` | Literal `scp_codes` | `filename_hr` |
|---|---:|---:|---:|---|---|---|
| LAFB positive | 448 | 12306 | 62 | ALAD | `LAFB:100, SR:0` | `records500/00000/00448_hr` |
| LAFB positive | 789 | 8997 | 70 | ALAD | `LAFB:100, SR:0` | `records500/00000/00789_hr` |
| LAFB positive | 3356 | 14447 | 32 | ALAD | `LAFB:100, SR:0` | `records500/03000/03356_hr` |
| LAFB positive | 3699 | 17339 | 76 | ALAD | `LAFB:100, SR:0` | `records500/03000/03699_hr` |
| LAFB positive | 4220 | 16204 | 58 | ALAD | `LAFB:100, SR:0` | `records500/04000/04220_hr` |
| axis trap | 1491 | 16837 | 70 | LAD | `NORM:100, SR:0` | `records500/01000/01491_hr` |
| axis trap | 3712 | 12929 | 66 | LAD | `NORM:100, SR:0` | `records500/03000/03712_hr` |
| axis trap | 5067 | 16979 | 38 | LAD | `NORM:100, SR:0` | `records500/05000/05067_hr` |
| axis trap | 5383 | 8881 | 52 | LAD | `NORM:100, SR:0` | `records500/05000/05383_hr` |
| axis trap | 7892 | 18257 | 51 | LAD | `NORM:100, SR:0` | `records500/07000/07892_hr` |
| clean NORM | 9 | 18792 | 55 | — | `NORM:100, SR:0` | `records500/00000/00009_hr` |
| clean NORM | 38 | 17076 | 40 | — | `NORM:100, SR:0` | `records500/00000/00038_hr` |
| clean NORM | 57 | 16063 | 26 | — | `NORM:100, SR:0` | `records500/00000/00057_hr` |
| clean NORM | 59 | 19475 | 54 | — | `NORM:100, SR:0` | `records500/00000/00059_hr` |
| clean NORM | 75 | 18502 | 31 | — | `NORM:100, SR:0` | `records500/00000/00075_hr` |

Это ровно `5/5/5`: label-positive, axis-only hard negative, clean normal. Manifest пригоден для
регрессии и проверки, что `LAD → LAFB` не происходит. Он не является оценкой
sensitivity/specificity: PTB-XL label — human-reviewed statement, но не опубликованная ручная
разметка всех пяти LAFB criteria.

### Numeric preflight до рендера

Полный пятикомпонентный критерий отдельно применён к автоматическим 12SL measurements на взрослом
`strat_fold=10`: 2 156 записей с полным набором полей, включая 158 human-validated `LAFB` и 1 998
без этой метки. Получено `TP=16`, `FP=0`, `FN=142`, `TN=1998`: sensitivity `0,101`, specificity
`1,000`, PPV `1,000` внутри этого зависимого PTB-XL/PTB-XL+ сравнения. Это не внешняя клиническая
оценка и не переносимые метрики продукта.

Результат запрещает использовать правило как бинарный классификатор: несрабатывание почти ничего
не исключает. Допустим только положительный вывод `pattern compatible with LAFB`, если все пять
измерений подтверждены. На фиксированных пяти label-positive records из manifest 12SL не подтвердил
полный паттерн ни разу — главным образом из-за оси выше `−45°` и R-peak time ниже `45 ms`. Это ещё
раз показывает, почему общий statement нельзя подменять synthetic truth отдельных критериев.

## Render/photo protocol

1. Pin PTB-XL `1.0.3`, PTB-XL+ `1.0.1` и ECG-Image-Kit commit
   [`27b90f56896c9fc78b05a83ca14844ea2637aa0b`](https://github.com/alphanumericslab/ecg-image-kit/tree/27b90f56896c9fc78b05a83ca14844ea2637aa0b).
2. Сначала прогнать digital waveform и сохранить reference outputs. Затем для каждого `ecg_id`
   создать один clean render и один детерминированный photo-like render; сохранить seed, полный
   generator config, layout, speed, gain, DPI, transform parameters и SHA-256 каждого изображения.
3. Layout/calibration должны совпадать с поддерживаемым входом MiniMed. Нельзя подменять speed/gain
   «типичными» значениями после генерации: R-peak `45 ms` — пограничное измерение.
4. Photo-like набор должен фиксированно покрыть rotation/perspective, uneven illumination/shadow,
   blur, grayscale/colour grid и crop, но не смешивать изменения: отдельно report по clean и каждой
   transform family.
5. Считать официальный Challenge SNR после допустимого выравнивания полезно для waveform fidelity,
   но [итоговая статья Challenge](https://moody-challenge.physionet.org/2024/papers/cinc_paper.pdf)
   прямо отмечает, что SNR не отражает клинические measurements. Поэтому дополнительно сохранять
   абсолютные ошибки QRS duration, QRS axis и aVL R-peak time, ошибки qR/rS morphology и coverage
   (`answered / 15`).
6. Для десяти negatives требуется `0` автоматических `compatible-with-lafb`; иначе это regression
   failure. Для пяти positives честно сообщать `matched / review / failed` и причину abstention, а не
   вычислять «чувствительность» на пяти случаях.
7. Любой итог photo-auto с неизвестной morphology или неопределённостью, пересекающей порог,
   обязан оставаться `review`/`insufficient-data`; низкий SNR не разрешает угадывать label.

### Фактический прогон текущего оцифровщика

Фиксированные 15 записей отрендерены из PTB-XL 1.0.3 в поддерживаемом layout `3×4+1R`:
5 секунд, `50 mm/s`, `10 mm/mV`, 8 px/mm. Для каждой записи создан clean PNG и один
детерминированный phone-like JPEG с перспективой, неравномерной экспозицией, blur и JPEG-сжатием.
Итого проверено 30 изображений. Использован тот же ONNX-пакет и тот же TypeScript postprocessor,
что и в приложении; SHA-256 release ZIP:
`4fd2344b7c2363e3587df85ba2dbd5f8c10b2e957b2f03c1d7124ab5e6619990`.

| Вариант | `usable / review / failed` | Медианная корреляция 12-lead waveform | Отведения с correlation ≥0,9 | Медианная amplitude RMSE | Ошибка ЧСС MAE / median AE | ЧСС в ±10 bpm |
|---|---:|---:|---:|---:|---:|---:|
| clean | `15 / 0 / 0` | 0,981 | 158/180 | 0,025 mV | 1,73 / 2,0 bpm | 15/15 |
| phone-like | `4 / 11 / 0` | 0,410 | 10/180 | 0,135 mV | 0,87 / 1,0 bpm | 15/15 |

Reference ЧСС рассчитана по исходному lead II при 500 Hz отдельным WFDB XQRS detector. Это не
клиническая валидация XQRS, но независимая проверка внутренней согласованности image pipeline.
После исправления максимальная абсолютная ошибка ЧСС составила 3 bpm на clean и 4 bpm на
phone-like изображении. До исправления amplitude/quality gate 29/30 изображений ошибочно получали
статус `usable`; теперь 11 phone-like вариантов с несогласованными строками требуют проверки.

Найденная причина clean amplitude bias была детерминирована кодом: вход 2000×800 растягивался до
1024×768, затем один горизонтальный `gridPixelsPerMillimeter` применялся и к вертикальной шкале.
После раздельной X/Y-калибровки медианный коэффициент извлечённой амплитуды к reference изменился с
1,772 до 0,945. Детектор RR переведён с амплитудных пиков на derivative-energy, поэтому широкие
T-волны больше не удваивают ЧСС на smoke-наборе. Перспективная phone-like трансформация всё ещё
разрушает amplitude/waveform fidelity: повторный lead II сверяется с началом rhythm-II, и correlation
ниже 0,85 переводит результат в `review`.

**Решение gate:** `quality=usable` теперь дополнительно требует внутреннего совпадения двух копий
lead II, но всё ещё не является клинической валидацией остальных отведений. Полный LAFB-критерий
нельзя оценить ни на одном из 15
случаев: runtime ещё не извлекает проверяемые QRS axis, QRS duration, aVL R-peak time и qR/rS
morphology. Поэтому photo-auto LAFB остаётся `answered=0/15`. Добавлено только ручное правило по
независимо подтверждённым пяти критериям и явным suppression-полям; автоматические числовые
черновики нельзя использовать для него без ручной проверки.

### Rectification preflight

Чтобы отделить предел сегментатора от геометрии фотографии, те же 15 phone-like изображений
выпрямлены двумя способами до неизменённого запуска ONNX:

| Rectification | `usable / review / failed` | Median lead correlation | Leads correlation ≥0,9 | Median RMSE | Median gain | HR MAE |
|---|---:|---:|---:|---:|---:|---:|
| oracle corners из сохранённой transform truth | `15 / 0 / 0` | 0,980 | 156/180 | 0,026 mV | 0,987 | 1,73 bpm |
| автоматические extrema красной сетки | `12 / 3 / 0` | 0,299 | 4/180 | 0,146 mV | 0,342 | 1,50 bpm среди 14 ответов |

Oracle полностью вернул clean-уровень waveform/amplitude, поэтому document rectification перед
сегментацией — доказанно полезный следующий слой. Но простая цветовая эвристика опасна: собственная
проверка повторного lead II пропустила повреждения других отведений и дала `usable` при низкой общей
fidelity. Она отклонена и не включена в runtime. Следующий implementation gate — либо corner detector,
проверенный также на grayscale и реальных фонах, либо явное подтверждение/коррекция четырёх углов
пользователем с повторной оцифровкой; одного красного порога недостаточно.

Реальные телефонные фотографии нужны отдельным следующим набором с письменным разрешением,
source waveform и слепой врачебной разметкой пяти criteria. Ни скрытый Challenge set, ни LearnECG
для такого распространяемого набора сейчас не подходят.

## Прямые первичные ссылки

- [AHA/ACC/HRS adult definitions, 2018](https://www.ahajournals.org/doi/10.1161/CIR.0000000000000628)
- [AHA/ACCF/HRS ECG Part III, 2009](https://www.jacc.org/doi/10.1016/j.jacc.2008.12.013)
- [PTB-XL 1.0.3](https://physionet.org/content/ptb-xl/1.0.3/)
- [PTB-XL+ 1.0.1](https://physionet.org/content/ptb-xl-plus/1.0.1/)
- [MIMIC-IV-ECG 1.0](https://physionet.org/content/mimic-iv-ecg/1.0/)
- [LUDB 1.0.1](https://physionet.org/content/ludb/1.0.1/)
- [PhysioNet Challenge 2024](https://moody-challenge.physionet.org/2024/)
- [ECG-Image-Kit official repository](https://github.com/alphanumericslab/ecg-image-kit)
