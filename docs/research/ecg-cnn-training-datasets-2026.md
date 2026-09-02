# Датасеты для собственной CNN ЭКГ (проверка на 31.08.2026)

## Короткий вывод

Обучить компактную диагностическую CNN реально. Оцифровщик с нуля обучать пока не нужно: для него уже опубликованы Open‑ECG‑Digitizer и его парный датасет. Наиболее защищаемый первый эксперимент — **фото → Open‑ECG → 12 отведений → компактная 1D CNN на PTB‑XL**, с отдельной проверкой на реальных телефонных фото. Смешивание записей одного пациента между train/test недопустимо.

## Проверка двух предложенных статей

- [Neurosity: Deep Learning for EEG](https://neurosity.co/guides/deep-learning-eeg-cnn-rnn-transformers) — обзорная статья компании, не peer‑reviewed исследование. Она разумно предлагает начинать с компактной CNN, применять RNN для непрерывных последовательностей, а transformer — только при больших данных или pretraining. Но статья посвящена **EEG**, а её числа по объёму данных, задержке и архитектуре EEGNet нельзя считать доказательством для ECG.
- [Rakhmatulin et al., 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10856895/) — peer‑reviewed обзор CNN для извлечения признаков из **EEG**. Полезны общие предупреждения о шуме, межсубъектной вариабельности, корректном preprocessing и переобучении; частотные диапазоны EEG, топология электродов и рассмотренные EEG‑метрики к ECG напрямую не переносятся.

Практический перенос для MiniMed ограничен: начать с компактной temporal/channel CNN, делить данные по пациентам и сравнивать модели на одном фиксированном benchmark. RNN и transformer для 10‑секундной 12‑канальной ECG на первом этапе не нужны. Для прямой классификации изображения нужна обычная 2D image CNN, а для оцифровки — segmentation/digitization pipeline; EEGNet не решает ни одну из этих задач «из коробки».

## A. Фото/скан → сигнал (парные ground truth)

| Источник | Что доступно | Доступ/лицензия | Вердикт |
|---|---|---|---|
| **Open‑ECG‑Digitizer Development Dataset** | 4 112 train + 217 validation примеров; парные `img`, `mask`, WFDB `dat/hea` и варианты `T0`. Размер загрузки около 75 GB. Набор сгенерирован ECG‑Image‑Kit и использован для обучения сегментационной сети Open‑ECG‑Digitizer. [карточка](https://huggingface.co/datasets/Ahus-AIM/Open-ECG-Digitizer-Development-Dataset/blob/main/README.md) | Apache‑2.0. Для реальной phone‑quality всё равно нужен отдельный hold‑out. | Лучший источник для воспроизведения или точечной донастройки уже проверенного digitizer; переобучение с нуля не является первым шагом. |
| **ECG‑Image‑Database / Moody Challenge 2024** | Задача специально включает digitization и classification изображений; public train основан на 21 799 PTB‑XL ECG, validation/test содержат реальные scans/photos; WFDB header + signal + image. Метки: NORM, acute/old MI, STTC, CD, HYP, PAC, PVC, AFIB/AFL, TACHY, BRADY. [официальная страница](https://moody-challenge.physionet.org/2024/) | Данные challenge скачиваются с PhysioNet; условия конкретных производных изображений нужно сверять с файлами релиза. | Лучший шаблон для внешней проверки, но hidden real test нельзя использовать для обучения. |
| **ECG‑Image‑and‑Signal Dataset (2025)** | На базе PTB‑XL опубликованы 2 000 пар для digitization, 2 000 для detection, 20 000 segmentation images и 102 overlapping examples; есть lead/name boxes и masks. Полный Zenodo‑релиз около 15.4 GB. [репозиторий/описание](https://github.com/rezakarbasi/ecg-image-and-signal-dataset), [Zenodo](https://doi.org/10.5281/zenodo.15484519) | Open access, CC BY 4.0. | Удобный небольшой источник для detector/segmenter и автоматической оценки digitization. |
| **PTB‑XL‑Image‑17K (2026)** | В preprint заявлены 17 271 синтетических 12‑lead изображений с image, mask, signal, YOLO boxes и metadata; 25/50 mm/s и 5/10 mm/mV. [preprint](https://arxiv.org/abs/2602.07446), [репозиторий](https://github.com/naqchoalimehdi/PTB-XL-Image-17K) | Указанный авторами DOI Zenodo `10.5281/zenodo.18197519` на дату проверки возвращает 404; лицензию и файлы релиза подтвердить не удалось. | Не использовать в плане обучения, пока официальный архив и лицензия не станут проверяемыми. |
| **ECG‑Image‑Kit** | Генерирует синтетические ECG images из time‑series с артефактами печати/съёмки: rotation, shift, crease, font и др. [PhysioNet Challenge](https://moody-challenge.physionet.org/2024/), [репозиторий](https://github.com/alphanumericslab/ecg-image-kit) | Проверить лицензию кода и исходного сигнала отдельно. | Практически лучший способ получить много пар image↔signal и контролировать 50 mm/s, но генератор не гарантирует перенос на реальные телефоны. |

## B. Сигнал/отрендеренная страница → многометочная классификация

| Источник | Факты | Ограничения |
|---|---|---|
| **PTB‑XL 1.0.3** | 21 799 ECG от 18 869 пациентов, 12 leads, 10 s; 500 Hz и downsampled 100 Hz; 71 SCP‑ECG statement и рекомендованные patient‑respecting folds. Superclasses: NORM 9 514, MI 5 469, STTC 5 235, CD 4 898, HYP 2 649. [PhysioNet](https://physionet.org/content/ptb-xl/1.0.3/) | CC BY 4.0; это сигналы, не фото. Для baseline использовать folds 1–8/9/10 как train/validation/test. |
| **PhysioNet Challenge 2021** | Public training summary: CPSC 6 877, CPSC‑extra 3 453, PTB 516, Georgia 10 344, Chapman‑Shaoxing 10 247, Ningbo 34 905 и др.; форматы WFDB, labels mapped to SNOMED‑CT; общий архив 12.6 GB. [PhysioNet](https://physionet.org/content/challenge-2021/1.0.3/) | CC BY 4.0 для файлов; источники неоднородны, записи бывают 5–144 s и 250/257/500/1000 Hz. Нужна нормализация и source‑held‑out оценка. |
| **Chapman‑Shaoxing/Ningbo** | 45 152 12‑lead ECG, 500 Hz, common rhythms and cardiovascular conditions, labels by professionals. [PhysioNet](https://physionet.org/content/ecg-arrhythmia/1.0.0/) | Хороший внешний источник аритмий, но нужно проверить patient identifiers/splits и исходные условия использования. |
| **LUDB** | 200 10‑s 12‑lead records, 500 Hz; cardiologist annotations for P/QRS/T boundaries and diagnosis; возраст 11–>89. [PhysioNet](https://physionet.org/content/ludb/1.0.0/) | Малый набор; лучше для delineation/регрессионных тестов, не для обучения широкой CNN. |
| **MIMIC‑IV‑ECG** | Около 800 000 10‑s 12‑lead ECG от почти 160 000 пациентов, 500 Hz; доступны machine measurements и cardiologist reports. [PhysioNet](https://physionet.org/content/mimic-iv-ecg/0.3/) | Credentialed PhysioNet license, research/education only; не подходит для продукта или публичной модели без отдельного разрешения. |
| **CODE‑15%** | Moody Challenge указывает 345 779 12‑lead recordings как дополнительный источник обучения. [Challenge](https://moody-challenge.physionet.org/2024/) | Нужна отдельная проверка Zenodo‑лицензии/условий и patient‑level split; для MiniMed не брать первым из‑за объёма и дисбаланса. |

Emory Paper ECG и PM‑ECG‑ID полезны для photo/scan validation, но перед планированием их надо сверить по официальной карточке релиза: наличие полного download, точные пары signal↔image и лицензия важнее заявленного числа изображений.

## Минимальный защищаемый эксперимент

1. **Digitizer:** зафиксировать Open‑ECG как baseline и не переобучать его до измеренного провала. Проверять отдельно оригинальный signal, синтетический render и реальные phone photos при 50 mm/s и 10 mm/mV.
2. **Diagnostic baseline:** compact 1D CNN на 10‑s/100‑Hz сигнале; пять независимых labels PTB‑XL (NORM, MI, STTC, CD, HYP). Сначала train folds 1–8, validation 9, test 10; затем без переобучения прогнать оцифрованные страницы. Выход — calibrated probabilities, а не диагноз.
3. **Metrics:** digitization MAE/SNR и доля полностью восстановленных lead; classification macro‑AUROC, macro‑AUPRC, sensitivity at fixed specificity и calibration (Brier/ECE). Оценивать исходный signal и signal, восстановленный из изображения отдельно.
4. **Внешняя проверка:** untouched real scans/photos из Moody/ECG‑Image‑Database; source‑held‑out Chapman/Georgia. Не смешивать синтетические варианты одной записи между split; все рендеры одного patient_id должны оставаться в одном split.
5. **Ресурсы (оценка):** 5k страниц 2481×3507 px потребуют порядка 20–60 GB в PNG; хранить JPEG/маски и генерировать on‑the‑fly. Compact 1D CNN на 1–2 GPU с 8–16 GB VRAM — часы, digitizer U‑Net — обычно десятки часов; точные сроки зависят от batch size и реализации.

## Решение для MiniMed

Не обучать новый digitizer до измеренного провала Open‑ECG. Если проверять собственную CNN, то обучить один компактный 1D diagnostic baseline на PTB‑XL и сравнить его с существующим numeric solver на исходных и оцифрованных сигналах. Прямую image CNN, RNN и transformer отложить до результата этого эксперимента. MIMIC‑IV‑ECG и наборы с неясной лицензией не включать в веса или релиз.

> Факты о количестве, длительности, частоте, labels и доступе приведены по ссылкам первичных источников; оценки объёма/времени и рекомендации — инженерный вывод, а не опубликованные benchmark results.
