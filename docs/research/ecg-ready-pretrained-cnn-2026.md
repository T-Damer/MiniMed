# Готовые CNN для цифровой 12-отведённой ЭКГ (2026-08-31)

## Короткий вывод

Да, готовые модели есть. Лучший действительно скачиваемый CNN baseline — **Ribeiro et al. (2020)**: код и pretrained weights опубликованы отдельно, вход — 12 отведений, 4096 отсчётов при 400 Гц. **XAND-ECG** лучше совпадает с выходом Open-ECG по формату 12×1000/100 Гц, но на дату проверки публикует только код обучения: checkpoints отсутствуют в дереве репозитория и GitHub Releases.

## Кандидаты

| Кандидат | Код/веса | Вход | Выход | Практическая оценка |
|---|---|---|---|---|
| [Ribeiro et al.](https://github.com/antonior92/automatic-ecg-diagnosis) | Код MIT; [pretrained weights](https://doi.org/10.5281/zenodo.3625017) открыты под CC BY 4.0 | `(N, 4096, 12)`, 400 Гц, около 10 с | 1st-degree AV block, RBBB, LBBB, sinus bradycardia, AF, sinus tachycardia | Лучший готовый компактный CNN baseline; зрелая публикация Nature Communications 2020, но TensorFlow/Keras и только шесть состояний |
| [XAND-ECG](https://github.com/XOREngine/xand-ecg) | Код Apache-2.0; опубликованных checkpoints или releases нет | 12×1000, 100 Гц, 10 с | MI, STTC, CD, HYP; независимые binary classifiers | Хороший рецепт для собственного обучения: около 3M параметров и точное совпадение с 100 Гц, но не plug-and-play модель |
| [ECGFounder](https://github.com/PKUDigitalHealth/ECGFounder) | Код и Hugging Face model card — MIT; доступны 12-lead и 1-lead checkpoints примерно по 370 MB | 12×5000, 500 Гц × 10 с; глобальный z-score и preprocessing из `dataset.py` | 150 PTB-XL text labels и foundation encoder для fine-tuning | Самый широкий готовый выход, но тяжёлый; ранее показал плохой результат на коротких/несинхронных 3×4 сегментах |
| [torch_ecg](https://github.com/DeepPSP/torch_ecg) | MIT; библиотека и архитектуры открыты, универсального официального диагностического checkpoint нет | Конфигурируемо: 12 leads, разные частоты и длительности | ECG_CRNN, seq-labelling, wave delineation и CNN backbones | Отличный конструктор для собственного обучения; не готовый диагноз «из коробки» |
| [ECG PTB-XL benchmark](https://github.com/helme/ecg_ptbxl_benchmarking) | Код открыт; pretrained weights не являются стабильным официальным артефактом проекта | PTB-XL, зависит от baseline | multi-label PTB-XL classes | Полезен как воспроизводимый benchmark, но не как поставляемая модель |
| [PTB-XL diagnostic CNN example](https://github.com/AndrewLucenko/ptb-xl-ecg-classification) | Код и baseline открыты; статус и лицензия весов требуют проверки | PTB-XL 10-секундные сигналы | multi-label classification | Подходит для обучения своей модели, но нельзя считать клинически валидированным готовым интерпретатором |

## Совместимость с MiniMed

Для Ribeiro результат Open-ECG нужно привести к 400 Гц и 4096 отсчётам, сохранив порядок и амплитуду отведений. Для XAND-ECG формат совпадает, но сначала придётся воспроизвести обучение на PTB-XL. Для ECGFounder потребуется 500 Гц/5000 отсчётов и точное повторение его нормализации.

2.5-секундный фрагмент и несинхронная страница 3×4 не являются тем же входом, что 10-секундная синхронная запись. Нельзя просто дополнить фрагмент нулями и считать результат валидным. Минимальный безопасный режим: показывать «недостаточно данных», а экспериментальный режим — делать только на benchmark с явной маркировкой.

## Локальная проверка Ribeiro

Официальный commit [`4039348`](https://github.com/antonior92/automatic-ecg-diagnosis/commit/403934867cea25a85b54faca025ac65b1ac18a45) и Zenodo archive `model.zip` были загружены локально; MD5 `82cdf807d3ed9dbdf664a66466fb4589` совпал с карточкой релиза. Проверены опубликованный `model_1.hdf5` и среднее вероятностей десяти опубликованных seed-моделей с исходными порогами авторов.

На официальном test set из 827 ECG опубликованная seed-модель воспроизвела macro precision `0.924`, recall `0.935`, F1 `0.925`, specificity `0.997`, AUROC `0.998`, average precision `0.944`, Brier `0.0087`. Простое среднее десяти моделей подняло average precision до `0.947` и слегка улучшило Brier до `0.0083`, но без повторной калибровки снизило macro-F1 до `0.900`. Поэтому одинаковые CNN нельзя объединять простым средним с прежними thresholds.

На существующем MiniMed smoke set из 20 PTB-XL ECG только три положительных target-label пригодны для Ribeiro: две sinus bradycardia и одна atrial fibrillation. На исходных 500 Hz signals модель нашла обе bradycardia без false positives, но пропустила AF. После перехода к 100 Hz источнику, используемому ECG-Image-Kit, потеряны все три положительных случая. Из 20 результатов Open-ECG quality gate принял 18; на корректно размещённых 2.5-секундных фрагментах Ribeiro и mean-of-10 не нашли ни одного из трёх положительных случаев. Повторение коротких фрагментов дало лишь `1/2` bradycardia и `0/1` AF; одиночная seed-модель дополнительно дала один false-positive 1dAVb, который среднее десяти моделей убрало.

Это малый и несбалансированный photo smoke, а не общая sensitivity estimate. Но он достаточен для решения о совместимости: Ribeiro силён на своём 400 Hz/10 s домене и непригоден как готовая голова после текущего 100 Hz/3×4 digitizer. Ансамбль одинаковых CNN shared upstream/domain error не исправляет.

## Что брать

1. Не подключать Ribeiro к текущему digitizer и не использовать mean-of-10 как исправление domain shift.
2. Сохранить Ribeiro только как контроль качества на полных синхронных 400 Hz/10 s signals.
3. Для photo path обучать или дообучать модель на том же 100 Hz/3×4 representation с patient-level folds; deterministic measurements остаются основной веткой.

Любые вероятности должны называться исследовательскими оценками, а не диагнозом; фото-ошибки оцифровки и domain shift требуют отдельного holdout-теста.

## Источники данных для обучения

- [PTB-XL v1.0.3](https://physionet.org/content/ptb-xl/1.0.3/) — 21 799 ECG, 18 869 пациентов, 10 секунд, 12 отведений, CC BY 4.0; лучший старт для собственного классификатора.
- [Open-ECG Development Dataset](https://huggingface.co/datasets/Ahus-AIM/Open-ECG-Digitizer-Development-Dataset) — 4 112 train + 217 validation пар изображение/маска/сигнал, Apache-2.0; нужен для оцифровщика, не для диагностического классификатора.
- [ECG-Image-and-Signal Dataset](https://github.com/rezakarbasi/ecg-image-and-signal-dataset) — синтетические пары image/signal, layouts 3×4 и другие, CC BY 4.0 по [Zenodo](https://doi.org/10.5281/zenodo.15484519); полезен для domain-specific проверки digitizer.
- [PM-ECG-ID](https://zenodo.org/records/13617673) — 6 000 фото/сканов из 100 PTB-XL записей; лицензию для повторного обучения/распространения нужно уточнить, поэтому пока только validation.

## Ограничения доказательств

Наличие репозитория не означает наличие клинически пригодного продукта. XAND-ECG и ECGFounder рассчитаны на research; опубликованные AUC нельзя переносить на телефонное фото без отдельной валидации. Для MiniMed разумнее оставить numeric solver основным результатом, а CNN — независимым вероятностным second opinion.
