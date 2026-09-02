# Локальная диагностика по оцифрованной ЭКГ

Дата проверки: 31 августа 2026 г.

Этот документ сохраняет исследование **waveform/CNN**-кандидатов. В runtime они не включены.
Реализованный вероятностный слой работает только по 30 подтверждённым числовым признакам и описан
в [research/ecg-numeric-diagnostic-algorithms-2026.md](research/ecg-numeric-diagnostic-algorithms-2026.md).

## Решение

Для текущего контракта MiniMed нет готовой модели, которую можно одновременно честно назвать
воспроизводимой, свободно распространяемой и проверенной на результате
`фото → Open ECG Digitizer → 12 × Float32Array @ 100 Hz`.

- **Самый быстрый исследовательский baseline:** официальный PTB-XL XResNet1D-101. Авторы дают
  checkpoints и обучали сеть на 2,5-секундных окнах, поэтому она ближе всего к коротким фрагментам.
  В релиз MiniMed её пока не включать: код GPL-3.0, отдельная лицензия архива весов не указана,
  официального ONNX и проверки на оцифрованных фото нет.
- **Лучший кандидат для распространяемого модельного пакета:** XAND-ECG. Код Apache-2.0, вход
  точно совпадает с полным контрактом `12 × 1000 @ 100 Hz`, модель небольшая. Но pretrained-весов
  нет: четыре disease heads придётся воспроизвести или обучить самим, затем отдельно проверить и
  калибровать.
- **Сейчас в продукте:** детерминированный слой измерений и screening-признаков плюс отдельный
  adult-only HGB по подтверждённым интервалам/амплитудам. Он не принимает waveform или фото и не
  заменяет клиническую интерпретацию морфологии.

Любой ML-вывод должен называться «гипотезой для проверки», а не диагнозом или процентной
вероятностью заболевания. Опубликованный ROC-AUC не доказывает калибровку конкретного score.

## Сравнение

| Кандидат | Факты авторов | Веса и лицензия | Пригодность MiniMed |
|---|---|---|---|
| **XAND-ECG** | Четыре независимых binary classifier: MI, STTC, CD, HYP; вход `12 × 1000`, 100 Hz, 10 s; около 3 млн параметров на модель. Обязательны global и затем per-lead normalization. [Конфигурация и метод](https://github.com/XOREngine/xand-ecg/blob/a3986d184a1e2fc0eb8652452d4840577949a895/README.md#L116-L143), [preprocessing](https://github.com/XOREngine/xand-ecg/blob/a3986d184a1e2fc0eb8652452d4840577949a895/src/data/ecgDataset.py#L49-L76) | Код Apache-2.0. Releases и tags пусты; `.pt/.pth` исключены, quickstart описывает только самостоятельное создание checkpoints. [Лицензия](https://github.com/XOREngine/xand-ecg/blob/a3986d184a1e2fc0eb8652452d4840577949a895/LICENSE), [checkpoints](https://github.com/XOREngine/xand-ecg/blob/a3986d184a1e2fc0eb8652452d4840577949a895/QUICKSTART.md#L205-L213), [gitignore](https://github.com/XOREngine/xand-ecg/blob/a3986d184a1e2fc0eb8652452d4840577949a895/.gitignore#L11-L17) | Архитектура состоит из обычных Conv1d/BatchNorm/ReLU/pooling/Linear и реалистична для ONNX Runtime Web. Это **наша техническая оценка**: авторы не публиковали ONNX/export/parity-тесты. Главный blocker — отсутствие весов. |
| **PTB-XL XResNet1D-101** | Официальный benchmark использует 100 Hz и окна 2,5 s (`250 × 12`), для validation разбивает запись на окна с шагом 1,25 s и агрегирует score максимумом. [Параметры окон](https://github.com/helme/ecg_ptbxl_benchmarking/blob/cdbf4e66d7e57d9b6a2657b6024716212b8d0afa/code/models/fastai_model.py#L159-L180), [dataset/aggregation](https://github.com/helme/ecg_ptbxl_benchmarking/blob/cdbf4e66d7e57d9b6a2657b6024716212b8d0afa/code/models/fastai_model.py#L300-L314) | Авторы дают архив обученных models, predictions и preprocessing artifacts. Репозиторий GPL-3.0; README не задаёт отдельную лицензию checkpoints. [Архив](https://github.com/helme/ecg_ptbxl_benchmarking/blob/cdbf4e66d7e57d9b6a2657b6024716212b8d0afa/README.md#L30-L42), [GPL-3.0](https://github.com/helme/ecg_ptbxl_benchmarking/blob/cdbf4e66d7e57d9b6a2657b6024716212b8d0afa/LICENSE) | Лучший готовый локальный baseline для коротких окон. Официального ONNX нет; потребуется вынести `nn.Module`, scaler и window aggregation из старого fastai runtime и проверить численное совпадение PyTorch ↔ ONNX. До прояснения лицензии — только локальный эксперимент, не каталог модели. |
| **Детерминированные правила** | BRAVEHEART обрабатывает 12-lead ECG, выделяет fiducials и измерения; исходники требуют MATLAB R2022a+ и toolboxes, есть desktop executables. Это исследовательский измерительный пакет, не широкий browser diagnosis engine. [Назначение и runtime](https://github.com/BIVectors/BRAVEHEART/blob/9b2e03be0ef403bf1701fae2c20e9f7b867425b3/README.md#L16-L39), [форматы](https://github.com/BIVectors/BRAVEHEART/blob/9b2e03be0ef403bf1701fae2c20e9f7b867425b3/README.md#L57-L84) | GPL-3.0. | Не встраивать. Использовать как reference при проверке собственных RR/PR/QRS/QT/fiducials. Правила MiniMed могут безопасно расширять только те признаки, для которых digitizer действительно дал измерения и прошёл QC. |

## Что именно заявили авторы

### XAND-ECG

Авторы сообщают test ROC-AUC на epoch лучшего validation AUC: MI `0,9700`, STTC `0,9332`,
CD `0,9175`, HYP `0,8846`. На внешних данных показатели ниже: Chapman — MI `0,9527`,
STTC `0,8669`, CD `0,8533`, HYP `0,7660`; Georgia — STTC `0,8336`, CD `0,8609`,
HYP `0,6992`, а MI исключён из-за семи positive cases. Это результаты авторов на цифровых ECG,
не результат MiniMed и не проверка цепочки из фото. [PTB-XL protocol и метрики](https://github.com/XOREngine/xand-ecg/blob/a3986d184a1e2fc0eb8652452d4840577949a895/README.md#L16-L51),
[external validation](https://github.com/XOREngine/xand-ecg/blob/a3986d184a1e2fc0eb8652452d4840577949a895/docs/FINDINGS.md#L250-L274).

Репозиторий не публикует confidence intervals, sensitivity/specificity, calibration curve или
рабочий threshold. Код считает ROC-AUC и average precision после sigmoid. Поэтому sigmoid score
нельзя подписывать как «вероятность инфаркта». [Расчёт метрик](https://github.com/XOREngine/xand-ecg/blob/a3986d184a1e2fc0eb8652452d4840577949a895/src/utils/aucMetrics.py#L14-L30).
Авторы также прямо называют проект research-grade и не предназначенным для clinical use.
[Ограничение назначения](https://github.com/XOREngine/xand-ecg/blob/a3986d184a1e2fc0eb8652452d4840577949a895/README.md#L9-L12).

### PTB-XL/XResNet

Авторы benchmark сообщают macro ROC-AUC `0,925` для XResNet1D-101 по всем SCP statements и
`0,937` по diagnostic statements. Это test fold 10; folds 1–8 использованы для обучения, fold 9
для validation. Это агрегированный результат на исходных 10-секундных цифровых PTB-XL, хотя
сама сеть видит окна по 2,5 s. Это не метрика одного короткого окна и не метрика после photo
digitization. [Метод разделения](https://github.com/helme/ecg_ptbxl_benchmarking/blob/cdbf4e66d7e57d9b6a2657b6024716212b8d0afa/README.md#L102-L105),
[таблицы результатов](https://github.com/helme/ecg_ptbxl_benchmarking/blob/cdbf4e66d7e57d9b6a2657b6024716212b8d0afa/README.md#L107-L125).

PTB-XL содержит 21 799 десятисекундных 12-lead ECG, 71 SCP statement и варианты 100/500 Hz;
данные доступны по CC BY 4.0. Это позволяет MiniMed независимо обучить и опубликовать собственный
checkpoint при атрибуции, не заимствуя GPL-код XResNet. [Карточка PTB-XL v1.0.3](https://physionet.org/content/ptb-xl/1.0.3/).

## Что допустимо при записи короче 10 секунд

1. **XAND-ECG:** не запускать. Подтверждённый protocol — ровно 10 s. Adaptive pooling технически
   примет другую длину, но это свойство кода, а не опубликованная валидация. Повторение, дополнение
   нулями или растяжение 5 s до 10 s создаёт неподтверждённый вход.
2. **PTB-XL/XResNet:** технически можно сформировать одно или несколько полных окон 2,5 s. Но
   опубликованная итоговая метрика относится к агрегации окон исходной 10-секундной записи. Для
   5–9,9 s результат допустим только как помеченный research output до собственного benchmark.
3. **Правила:** можно считать HR/RR и интервалы только при достаточном числе качественно найденных
   комплексов и показывать число анализированных циклов. Нельзя молча экстраполировать
   нерегулярность короткого фрагмента на диагноз ритма.
4. **Стандартный лист 3×4:** отведения из разных колонок сняты в разные моменты. Сборка их как
   синхронного `12 × T` — дополнительный domain shift относительно цифрового PTB-XL. Пока это не
   проверено отдельно, MI/STTC/CD/HYP должен блокировать quality gate либо сопровождать явный
   признак `non_simultaneous_leads`.

Пункты выше — **наша инженерно-клиническая политика**, а не заявление авторов моделей.

## Возможный исследовательский follow-up (не runtime roadmap)

1. Локально скачать официальный PTB-XL/XResNet archive, не публикуя его в каталоге; воспроизвести
   inference на исходном PTB-XL test fold и экспортировать только диагностическую модель в ONNX.
2. Проверить численную parity PyTorch ↔ ONNX и затем сравнить три входа одного record: исходные
   10 s, его 2,5/5 s crop и waveform после генерации изображения + Open ECG Digitizer. Отдельно
   тестировать обычный 3×4 non-simultaneous layout.
3. Если деградация приемлема, использовать XResNet только для исследовательского UX. Для
   распространяемой модели обучить Apache-совместимый XAND-like classifier на PTB-XL с явно
   включёнными 2,5/5/10-секундными окнами и искажениями digitizer; сохранить patient-level folds.
4. Публиковать лишь label scores с порогами, выбранными на validation set, и собственной
   calibration/operating-point таблицей. Возраст до 18 лет и `quality != usable` должны полностью
   блокировать взрослый classifier.

Итого: **не подключать diagnostic CNN**. Если направление когда-нибудь вернётся в roadmap, сначала
нужен отдельный XResNet parity/robustness spike и ясная лицензия весов либо собственные
Apache-совместимые checkpoints. Детерминированные RR/P/PR/QRS/QT/QTc и числовой HGB остаются
независимыми слоями; их выводы не усредняются с waveform score.
