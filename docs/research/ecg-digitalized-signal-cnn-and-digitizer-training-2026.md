# Оцифрованный сигнал → 1D CNN и обучение digitizer — 2026-09-02

## Вердикт

**Да, это лучший следующий CNN-эксперимент, но не прямая замена текущему Solver.** Сначала следует
обучить одну компактную 1D CNN на сигнале, который точно повторяет контракт MiniMed
`12 leads × 5 s × 100 Hz`, и отдельно измерить потерю качества в цепочке
`исходный PTB-XL → render 12×1/50 mm/s → digitizer → та же CNN`.

Готовую модель, обученную на полном `12 × 10 s`, нельзя честно кормить текущим примерно
пятисекундным результатом через zero-padding, растяжение или повтор сигнала. Переобучать digitizer
сразу тоже не нужно: его U-Net стоит дообучать только тогда, когда парный benchmark локализует
ошибку именно в segmentation, а не в масштабе сетки, layout, perspective correction или
signal extraction.

В документе **«факт»** означает прямое утверждение официального источника; **«вывод»** — инженерное
решение для MiniMed.

## Контракт входа

| Ограничение | Факт источника | Вывод для MiniMed |
|---|---|---|
| Длительность | [PTB-XL 1.0.3](https://physionet.org/content/ptb-xl/1.0.3/) содержит 21 799 десятисекундных 12-lead ECG от 18 869 пациентов, в 500 и 100 Hz. Официальный [PTB-XL benchmark](https://github.com/helme/ecg_ptbxl_benchmarking) использует folds 1–8/9/10 и обычно читает 100-Hz `filename_lr`, то есть полный вход имеет 1 000 отсчётов на lead. | У 1D CNN нет универсальной допустимой длины: она задаётся обучением. Текущий MiniMed-профиль печатает 250 mm по времени при 50 mm/s, то есть **5 s = 500 samples/lead при 100 Hz** ([текущее состояние](../CURRENT_STATE.md)). Первый classifier должен учиться именно на `12 × 500`, а не имитировать отсутствующие пять секунд. |
| Layout | Open-ECG хранит layouts отдельно; официальный [Challenge layout](https://github.com/Ahus-AIM/Open-ECG-Digitizer/blob/97a15087d4abcda843da8c58ee74b1d8f47e6f9a/src/config/lead_layouts_george-moody-2024.yml) описывает последовательные колонки 3×4 и отдельный rhythm lead. [Challenge 2024](https://moody-challenge.physionet.org/2024/) разрешает классификацию как из изображения, так и из извлечённого time series. | Нельзя смешивать 3×4, 3×4+rhythm и 12×1 в одном неявном тензоре. Первый опыт принимает только подтверждённый 12×1, где все 12 leads покрывают один пятисекундный временной интервал. |
| Единицы и порядок | Open-ECG сообщает output в µV; PTB-XL публикует 1 µV/LSB и стандартные 12 leads. | Перед CNN фиксировать порядок `I, II, III, aVR, aVL, aVF, V1…V6`, перевод µV→mV, 100 Hz, длину 500 и отсутствие NaN. Не делать per-record нормализацию, уничтожающую абсолютную амплитуду. |
| Пропуски | Open-ECG прямо предупреждает, что [signal extractor](https://github.com/Ahus-AIM/Open-ECG-Digitizer/blob/97a15087d4abcda843da8c58ee74b1d8f47e6f9a/src/model/signal_extractor.py) может ставить NaN при пересечении сигналов. | Самый дешёвый v0 не импутирует: любое неполное lead/order/length/finite-value условие означает abstain до CNN. Masked-input модель нужна только если это заметно режет coverage. |

Пятисекундный опыт разумно ограничить текущими `NORM`, `MI`, `STTC`, `CD`, `HYP`: их PTB-XL
агрегаты опубликованы официально, а краткий crop не создаёт столь очевидной label-noise проблемы,
как для эпизодических PAC/PVC/AF. Это **вывод**, не доказательство клинической достаточности 5 s.

## Можно ли улучшить сам digitizer обучением

**Факт.** [Open-ECG-Digitizer](https://github.com/Ahus-AIM/Open-ECG-Digitizer/tree/97a15087d4abcda843da8c58ee74b1d8f47e6f9a)
использует обучаемый четырёхклассовый U-Net для segmentation trace/grid/background, но perspective,
crop, pixel-size estimation, lead-layout matching и segmentation→signal conversion являются
отдельными стадиями. README прямо предлагает retrain/fine-tune через `src/train.py`, изменение
TRAIN/VAL/TEST путей в [`unet.yml`](https://github.com/Ahus-AIM/Open-ECG-Digitizer/blob/97a15087d4abcda843da8c58ee74b1d8f47e6f9a/src/config/unet.yml)
и адаптацию on-the-fly transforms. Конфиг использует 1024×1024 crops, saturation/contrast, lighting,
JPEG, zoom и другие искажения.

**Факт.** Официальный [Development Dataset](https://huggingface.co/datasets/Ahus-AIM/Open-ECG-Digitizer-Development-Dataset/blob/main/README.md)
содержит 4 112 train и 217 validation примеров с `img`, `mask`, WFDB `dat/hea` и вариантами `T0`;
он сгенерирован fork-версией ECG-Image-Kit и использован для обучения segmentation network.
[ECG-Image-Kit](https://github.com/alphanumericslab/ecg-image-kit) генерирует парные synthetic
изображения с perspective, crease, wrinkle, текстовыми и другими артефактами.

**Вывод.** Обучение поможет только сегментационной части. Если benchmark показывает неверные
50 mm/s, 10 mm/mV, порядок leads или layout при хорошей маске, исправлять надо соответствующий
детерминированный модуль/конфиг. Если же на целевых 12×1 фото маска систематически теряет тонкую или
цветную кривую, минимальный следующий шаг — fine-tune существующий U-Net на небольшом dev-наборе
`photo + pixel mask`, не обучение нового end-to-end digitizer.

## Данные, splits и лицензии

| Источник | Разрешённая роль | Лицензия по официальной карточке/файлу |
|---|---|---|
| [PTB-XL 1.0.3](https://physionet.org/content/ptb-xl/1.0.3/) | Labels и native waveform для 1D CNN; folds 1–8 train, 9 validation, 10 test. Официальные folds сохраняют пациента целиком в одном fold. | CC BY 4.0. |
| [Open-ECG Development Dataset](https://huggingface.co/datasets/Ahus-AIM/Open-ECG-Digitizer-Development-Dataset/blob/main/README.md) | Воспроизведение/fine-tune U-Net на парных image/mask/waveform. | Apache-2.0 на dataset card. Карточка не доказывает patient/base-ECG-disjoint split. |
| [ECG-Image-Kit](https://github.com/alphanumericslab/ecg-image-kit) | Генерация render-вариантов только внутри уже назначенного split. | [BSD-3-Clause](https://github.com/alphanumericslab/ecg-image-kit/blob/27b90f56896c9fc78b05a83ca14844ea2637aa0b/LICENSE) для кода; права исходных waveform проверяются отдельно. |
| [Open-ECG-Digitizer code/weights](https://github.com/Ahus-AIM/Open-ECG-Digitizer/blob/97a15087d4abcda843da8c58ee74b1d8f47e6f9a/LICENSE) | Baseline и возможный fine-tune. | Репозиторий на зафиксированной ревизии содержит **CC BY-SA 4.0**, не Apache-2.0. Распространение изменённого/квантованного artifact требует отдельной лицензионной проверки. |
| [PhysioNet Challenge 2024](https://moody-challenge.physionet.org/2024/) | Protocol: paired public train; hidden real-image test; digitization SNR и classification macro-F1. | Не единая свободная train-лицензия для всех источников; соблюдать лицензию каждого исходного набора. Hidden test не является материалом для обучения. |
| [Официальный PTB-XL benchmark code](https://github.com/helme/ecg_ptbxl_benchmarking) | Reference preprocessing/architectures, не обязательная runtime dependency. | GPL-3.0; для продукта проще написать минимальную модель самостоятельно, не копируя код. |

Split назначается **до** render/scan/photo augmentation. Все изображения, `T0`-варианты и
оцифровки одного `ecg_id` наследуют patient fold. Минимум — base-ECG-disjoint; при наличии
`patient_id` обязателен patient-disjoint. Нельзя одновременно дообучаться и отчитываться на разных
фотографиях одного исходного ECG.

## Как ошибка digitizer переходит в CNN

- Неверные 50 mm/s масштабируют частоту и интервалы; неверные 10 mm/mV — амплитуды и признаки HYP.
- Перестановка/потеря lead и перспектива искажают ось, conduction и региональную MI/ST-T morphology.
- Сглаживание тонких QRS/ST/T, NaN и интерполяция могут менять сам диагностический признак.
- Пять секунд могут не содержать событие, по которому размечена полная десятисекундная запись.
- Synthetic render→digitizer создаёт свой domain shift; обучение CNN только на чистом PTB-XL не
  измеряет устойчивость к нему.

Поэтому SNR из Challenge нужен, но недостаточен. Для каждой одной и той же base ECG надо сравнить
`CNN(native 5 s)` и `CNN(digitized 5 s)`: delta вероятностей/решения, macro-F1/AUROC, calibration и
abstention coverage. Низкое качество digitizer никогда не должно компенсироваться высокой
уверенностью CNN.

## Самый дешёвый честный эксперимент

1. Взять PTB-XL `records100`, пять labels и официальные patient folds 1–8/9/10. Использовать один
   детерминированный пятисекундный crop (`12 × 500`) для validation/test; train-crops менять только
   внутри той же записи/fold.
2. Обучить одну компактную 1D CNN собственной минимальной реализацией. Это baseline только для
   сигнала; не менять digitizer и не арендовать большой GPU.
3. Из той же fold-10 выборки отрисовать поддерживаемый MiniMed `12×1, 50 mm/s, 10 mm/mV`, прогнать
   текущий browser/WASM digitizer и ту же замороженную CNN. Сначала clean render, затем dev
   phone-like/физические фото; immutable test не использовать для настройки.
4. Отчёт состоит из трёх строк: native CNN; render→digitizer→CNN; reject rate. Отдельно сохранить
   Challenge-style shifted SNR, lead coverage и delta каждого класса.
5. Только если downstream loss совпадает с плохой trace-mask локализацией, разметить небольшой
   **dev-only** набор целевых 12×1 фото и fine-tune U-Net. Если маска хорошая — чинить масштаб/layout,
   а не добавлять обучение.

**Go** для research prototype; **no-go** для runtime/клинических обещаний, пока нет независимого
реального phone holdout точного профиля 12×1/50 mm/s/10 mm/mV и не показана ошибка всей цепочки,
а не только CNN на чистом PTB-XL.
