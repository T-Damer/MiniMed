# Direct-image CNN для ЭКГ — проверка на 2026-09-01

## Вывод

Direct-image классификация работает, но готовой модели одновременно с хорошим качеством на
телефонных фото, открытыми весами и ясной разрешительной лицензией не найдено.

Основной практический путь для MiniMed — Digitalizer → подтверждённые измерения → правила и
числовой HGB-классификатор. Собственный компактный image-классификатор имеет смысл только как
независимая исследовательская ветка: обучать его на размеченных сигналах PTB-XL, отрисованных в
поддерживаемом приложением формате, а реальные фото оставлять для внешнего теста. Интегрировать
такую модель до этого теста нельзя.

## Модели, которые действительно стоит учитывать

### AIMED: ConvNeXt, победитель PhysioNet Challenge 2024

[Статья](https://www.cinc.org/archives/2024/pdf/CinC2024-398.pdf) описывает ансамбль из пяти
ConvNeXt-моделей для 11 классов: NORM, Acute MI, Old MI, STTC, CD, HYP, PAC, PVC, AFIB/AFL,
TACHY и BRADY. Модель предварительно обучали на ECG-изображениях CODE-15 и закрытых InCor-наборах,
затем дообучали на PTB-XL.

- общий hidden-test macro-F1: **0.817**;
- чистые телефонные фото: **0.644**;
- фото испачканной бумаги: **0.636**;
- фото испорченной бумаги: **0.711**;
- внутренний F1 для Acute MI: **0.409**, то есть даже лучший общий результат не означает надёжное
  распознавание инфаркта.

Это лучший подтверждённый ориентир, но Challenge checkpoint и лицензия весов не опубликованы.
[Публичный ConvNeXt-Tiny checkpoint](https://huggingface.co/fmenegui/pretrained_image_ecg_doc)
той же исследовательской группы имеет другой набор из 13 emergency-классов, один fold, карточку без
лицензии и без полного preprocessing-контракта. Его можно проверить локально как research baseline,
но нельзя считать готовой моделью AIMED или распространять с приложением.

### Inventec AIC: EfficientNet-B0

[Статья](https://cinc.org/archives/2024/pdf/CinC2024-224.pdf) описывает EfficientNet-B0, обученный
на 336 тысячах синтетических изображений разных форматов. Общий hidden-test macro-F1 — **0.742**.
При этом на телефонных фото он оказался лучше AIMED: 0.697 на чистой, 0.694 на испачканной и 0.739
на испорченной бумаге. Публичных воспроизводимых весов и репозитория не найдено. Архитектура полезна
как ориентир для компактной локальной модели.

### DSAIL: InceptionV3

[Код и checkpoint](https://github.com/Antony-gitau/physionet-challenge-2024-dsail) доступны под
BSD-3-Clause, поэтому это единственный простой permissive baseline, который уже можно запускать.
Но официальный macro-F1 — 0.429, а на трёх телефонных сценариях — только **0.072–0.080**. Наш
предыдущий локальный тест также показал некалиброванные и клинически ненадёжные ответы. Для продукта
модель не подходит.

## Датасеты

| Источник | Direct-image diagnosis | Photo→waveform | Numeric solver | Лицензия / ограничения |
|---|---|---|---|---|
| [PTB-XL 1.0.3](https://physionet.org/content/ptb-xl/1.0.3/) + [PTB-XL+](https://physionet.org/content/ptb-xl-plus/1.0.1/) | **Train/validation/test:** 21 799 10-секундных 12-канальных ECG, 18 869 пациентов, 71 SCP-statement, patient-level folds; PTB-XL+ добавляет вычисленные признаки и 12SL-разметки | Не фото; waveform можно отрисовать синтетически. Это основной источник clinical labels и numeric features | **Основной источник** для обучения/проверки solver; использовать folds 1–8/9/10 и не смешивать записи пациента между split | CC BY 4.0. Сильные labels, но старые приборы/популяция и synthetic-image domain gap |
| [PhysioNet Challenge 2024](https://moody-challenge.physionet.org/2024/) | **Benchmark:** 11-классовая схема; public train основан на PTB-XL, hidden data содержит scans, clean/stained/deteriorated paper photos и monitor photos | **Benchmark:** отдельная digitization-задача с SNR | **External benchmark:** classification either from image or extracted waveform; metric macro-F1 | Не отдельный датасет для свободного обучения; лучший опубликованный protocol и независимый hidden-test ориентир |
| [ECG-Image-Database](https://www.kaggle.com/datasets/physionet/ecg-image-database/) | **External validation/adaptation:** paired images↔waveforms, scans и реальные phone photos с чистой/испачканной/повреждённой бумагой; заявлено 37 191 image из 2 243 ECG | **Лучший внешний photo-domain тест** для digitalizer; waveform ground truth позволяет считать SNR/ошибки интервалов | Можно оценивать downstream solver по восстановленному сигналу, но diagnosis labels не являются главным содержимым | Kaggle указывает CC BY-ND 4.0; перед обучением/публикацией производных весов юридически проверить ND. Не смешивать исходные ECG с train (leakage) |
| [PM-ECG-ID](https://zenodo.org/records/13617673) | **Validation only:** 6 000 изображений/вариантов, включая mobile photos, bends, scans и monitor photos, но только 100 исходных PTB-XL ECG | Хороший стресс-тест фото-to-waveform с соответствующим signal ground truth | Можно проверить solver после digitization, но 100 base ECG недостаточно для обучения или независимого клинического теста | Метаданные Zenodo указывают GPL-3.0-or-later; последствия для распространения набора и производных весов нужно проверить отдельно |
| [Open-ECG Digitizer Development Dataset](https://huggingface.co/datasets/Ahus-AIM/Open-ECG-Digitizer-Development-Dataset) | Не содержит полноценной diagnostic-label задачи | **Train/validation:** 4 112 train + 217 validation, image, waveform и segmentation masks; 75 GB | Не подходит для solver training, но подходит для segmentation/digitization pretraining | Apache-2.0; лицензия пригодна для кода/данных по условиям карточки |
| [SynthECG / ECG Image and Signal Dataset](https://doi.org/10.5281/zenodo.15484519) | Не клиническая diagnostic cohort | **Pretraining/validation:** paired image↔signal, lead detection и segmentation для разных раскладок | Не является clinical-label corpus | CC BY 4.0; вспомогательный набор, не замена real-phone test |

Range-запрос к ZIP PM-ECG-ID позволил проверить один и тот же лист 3×4+1R без скачивания всего
архива. После обрезки полей по предсказанной маске сетки все три телефона дали 9/12 отведений и
81–83% ритм-строки; до обрезки iPhone давал 9/12 и 75%, Samsung/Doogee — 6/12 и 72%. Появились RR
drafts, но все три случая корректно остались в `review` из-за несовпадения повторного II. Это полезный
тест устройства/геометрии, но не фиксированный 50 mm/s holdout: скорость на листах не напечатана, а
три фото происходят из одной исходной ECG.

### Профиль записи — это часть входа

[AHA/ACCF/HRS Part I](https://www.ahajournals.org/doi/10.1161/CIRCULATIONAHA.106.180200)
описывает обычную компоновку 3×4 как четыре последовательные колонки по 2,5 секунды именно при
25 mm/s. Российский
[ГОСТ Р МЭК 60601-2-25-2016](https://meganorm.ru/mega_doc/norm/gost-r_gosudarstvennyj-standart/14/gost_r_mek_60601-2-25-2016_natsionalnyy_standart_rossiyskoy.html)
требует от электрокардиографа как минимум скорости 25 и 50 mm/s; он не превращает 3×4 при 50 mm/s
в единственный стандарт. Поэтому MiniMed не должен определять скорость только по сетке: разумные
первые профили — 3×4+1R при 25 mm/s и отдельный 12×1 примерно на 5 секунд при 50 mm/s. В каждом
случае скорость и 10 mm/mV должны быть напечатаны на записи или подтверждены пользователем до
переноса автоматических временных/амплитудных измерений в Solver.

### Что считать leakage

Генерация нескольких изображений из одной waveform допустима только внутри одного split. Нельзя
помещать одну и ту же исходную ECG (или пациента) в train и photo-test: это даст высокие цифры за
счёт запоминания формы, а не устойчивости к камере. PM-ECG-ID особенно опасен для такой ошибки,
поскольку все 6 000 вариантов происходят из 100 PTB-XL записей. ECG-Image-Database также нельзя
использовать одновременно для adaptation и внешней оценки без заранее зафиксированного split по
исходной ECG.

### Пригодность по задачам

| Задача | Решение | Почему |
|---|---|---|
| Обучить direct-image диагноз | PTB-XL labels → ECG-Image-Kit/собственный renderer; затем отдельный real-photo holdout | Много независимых пациентов и воспроизводимые labels; реальные фотографии нужны для проверки domain gap |
| Обучить digitalizer | Open-ECG-Digitizer + SynthECG; затем ECG-Image-Database/PM-ECG-ID | Есть pixel-level masks и waveform ground truth; диагнозы здесь вторичны |
| Обучить numeric solver | PTB-XL + PTB-XL+ | Есть SCP labels, patient folds и числовые признаки; изображения в этом контуре не нужны |
| Проверить production workflow | Необучающий внешний набор из ECG-Image-Database/PM-ECG-ID + собственные consented phone photos | Проверяет камеру, бумагу, раскладку и ошибку solver после digitization |

Не использовать как основу без повторной проверки: PTB-XL-Image-17K — заявленные GitHub и Zenodo
адреса на дату проверки возвращают 404; MEETI наследует credentialed-ограничения MIMIC и содержит
LLM-generated interpretations.

## Минимальный честный эксперимент

1. Сформировать метки ровно по официальному Challenge-скрипту из PTB-XL/PTB-XL+ и сохранить
   patient-level split: folds 1–8 train, 9 validation, 10 test.
2. Сгенерировать по несколько изображений каждого ECG в точном формате MiniMed: 50 mm/s,
   10 mm/mV и только поддерживаемые раскладки. Перспектива, тени, blur, JPEG, сгибы и экспозиция
   должны меняться, форма сигнала — нет.
3. Сравнить один ConvNeXt-Tiny и один EfficientNet-B0. Для локального приложения предпочтителен
   EfficientNet-B0, если качество не хуже: он существенно компактнее ансамбля победителя.
4. Выбирать модель только по macro-F1 каждого класса на **реальных телефонных фото**, а не по
   AUROC на синтетических рендерах. Отдельно считать calibration error и coverage после отказа при
   низком качестве изображения.
5. Сначала ограничиться взрослыми ECG. Педиатрический режим требует отдельной выборки и модели.

## Решение для MiniMed

**Основной production-путь: Digitalizer → подтверждённые измерения → правила + числовой
HGB-классификатор.** Он сохраняет объяснимость: каждое число можно показать врачу и вручную
исправить. **Direct-image CNN — только второй, независимый advisory branch**, обученный на тех же
11 классах и включаемый после quality gate; её вероятности не должны заменять измерения или
подтверждение.

**Минимальные benchmark gates до интеграции:** (1) split по пациенту и исходной ECG; (2) digitalizer
SNR и ошибка PR/QRS/QTc на real-photo holdout; (3) solver macro-F1/чувствительность по классам; (4)
image-CNN macro-F1 и calibration/abstention отдельно на чистых, stained и deteriorated photos; (5)
ручная проверка 20–30 случаев каждого класса. Если direct CNN не улучшает recall при фиксированной
частоте опасных false negative, оставляем её только исследовательской.
