# Оценка интеграции GigaAM v3 как локального ASR

Дата оценки: 2026-08-26.

## Вывод

GigaAM v3 потенциально полезнее Whisper Base/Small для русских голосовых заметок, но добавлять
его сейчас как готовую пользовательскую модель рано. Официальные результаты сильны на русском,
включая естественную, нарушенную речь, звонки и голосовые сообщения, однако медицинского набора в
опубликованной оценке нет. Данных о скорости, памяти и точности GigaAM v3 в браузере также нет.

Рекомендуемый следующий шаг — не продуктовая интеграция, а ограниченный технический spike
`v3_ctc`: экспортировать официальный checkpoint в ONNX, получить воспроизводимый quantized artifact,
реализовать точный log-mel preprocessor и greedy CTC decoder, затем измерить его против уже
работающих Whisper Base/Small на одном закрытом MiniMed-наборе. Включать GigaAM в UI и делать
рекомендуемой моделью следует только после прохождения критериев в конце документа.

## Текущий путь MiniMed

Сейчас поток устроен так:

```text
Blob записи
  -> Web Audio decode/resample в mono Float32 PCM 16 kHz
  -> ASR worker
  -> transformers.js pipeline("automatic-speech-recognition", modelId)
  -> текст
  -> редактор заметки / очередь расшифровки
```

- Контракт UI и приложения уже достаточно общий: `asr-models.ts` передаёт worker'у PCM 16 кГц и
  ожидает строку. Поэтому `AsrSettings`, выбор модели, очередь и вставку текста менять существенно не
  требуется.
- Конкретный runtime находится в `asr.worker.ts`: модель обязана загружаться стандартным
  `@huggingface/transformers` ASR pipeline и возвращать его стандартный результат `{ text }`.
- Whisper-файлы загружаются и кэшируются самим Transformers.js. В браузере его Cache API включён по
  умолчанию, когда доступен ([официальная документация Transformers.js](https://huggingface.co/docs/transformers.js/custom_usage)).
- В проекте уже есть более подходящий для собственного артефакта транспорт:
  `features/network/download-retry.ts` умеет возобновлять загрузку и сообщать прогресс, а каталог
  локальных LLM хранит размер, SHA-256, upstream и собственное зеркало. Его низкоуровневую загрузку
  можно переиспользовать, не связывая ASR с LLM-контроллером.

## 1. Что представляет собой GigaAM v3

### Данные из официальных источников

- GigaAM v3 — семейство Conformer-моделей на 220–240 млн параметров, предварительно обученных на
  700 000 часов русской речи; доступны SSL, CTC, RNN-T, end-to-end CTC и end-to-end RNN-T варианты.
  End-to-end варианты дополнительно выдают пунктуацию и нормализованный текст
  ([официальная model card](https://huggingface.co/ai-sage/GigaAM-v3/blob/ec1dc1f01d0d627ab2c0d3acc1e235702300d95e/README.md)).
- Общий энкодер имеет 16 Conformer-слоёв, hidden size 768, 16 attention heads и subsampling factor 4.
  Вход — mono 16 кГц, преобразованный в 64 log-mel признака с окном 320 samples, шагом 160,
  `n_fft=320`, HTK mel scale и `center=false`
  ([прикреплённый config `v3_ctc`](https://huggingface.co/ai-sage/GigaAM-v3/blob/15ef3b5a88da78f93134b3cb7f015c70aefa8946/config.json)).
- Официальный preprocessor использует `torchaudio.transforms.MelSpectrogram`, затем ограничивает
  значения снизу `1e-9` и применяет натуральный логарифм
  ([исходный код preprocessing](https://github.com/salute-developers/GigaAM/blob/7447938d791c4f3e643386ee22c33777004293a5/gigaam/preprocess.py)).
- Обычный `v3_ctc` имеет 34 класса и посимвольный словарь; greedy decoding удаляет blank, повторные
  соседние токены и элементы за пределами фактической длины
  ([конфигурация](https://huggingface.co/ai-sage/GigaAM-v3/blob/15ef3b5a88da78f93134b3cb7f015c70aefa8946/config.json),
  [декодер](https://github.com/salute-developers/GigaAM/blob/7447938d791c4f3e643386ee22c33777004293a5/gigaam/decoding.py)).
- `v3_e2e_ctc` использует SentencePiece-модель вместо простого char vocabulary. RNN-T варианты
  требуют predictor LSTM, joint graph, состояния декодера и итеративного greedy loop до десяти
  символов на один encoder step
  ([`e2e_ctc` config](https://huggingface.co/ai-sage/GigaAM-v3/blob/cec030b4c4f35d928e4a9044a3bdb29ebd499fac/config.json),
  [официальный RNN-T decoder](https://github.com/salute-developers/GigaAM/blob/7447938d791c4f3e643386ee22c33777004293a5/gigaam/decoding.py)).
- Короткая официальная `.transcribe` ограничена 25 секундами. Для длинных файлов официальный путь
  использует отдельную сегментацию `pyannote.audio`; её setup требует HF token и принятия условий
  gated-модели `pyannote/segmentation-3.0`
  ([официальный README](https://github.com/salute-developers/GigaAM/blob/7447938d791c4f3e643386ee22c33777004293a5/README.md),
  [проверка длины в model.py](https://github.com/salute-developers/GigaAM/blob/7447938d791c4f3e643386ee22c33777004293a5/gigaam/model.py)).

### Runtime, который предоставляет команда GigaAM

- Основной runtime — Python 3.10+, PyTorch/torchaudio либо Python ONNX Runtime. Пакет также зависит от
  Hydra, OmegaConf, NumPy, soundfile и SentencePiece; загрузка аудиофайла использует ffmpeg
  ([официальный `pyproject.toml`](https://github.com/salute-developers/GigaAM/blob/7447938d791c4f3e643386ee22c33777004293a5/pyproject.toml),
  [официальный README](https://github.com/salute-developers/GigaAM/blob/7447938d791c4f3e643386ee22c33777004293a5/README.md)).
- Официальный `to_onnx` экспортирует opset 17. Для CTC получается один graph с encoder и CTC head;
  для RNN-T — отдельные encoder, decoder и joint graphs. Preprocessor и text decoder в ONNX graph не
  входят
  ([экспорт модели](https://github.com/salute-developers/GigaAM/blob/7447938d791c4f3e643386ee22c33777004293a5/gigaam/model.py),
  [ONNX inference](https://github.com/salute-developers/GigaAM/blob/7447938d791c4f3e643386ee22c33777004293a5/gigaam/onnx_utils.py),
  [общий ONNX exporter](https://github.com/salute-developers/GigaAM/blob/7447938d791c4f3e643386ee22c33777004293a5/gigaam/utils.py)).
- Экспорт по умолчанию fp32; fp16 команда рекомендует для GPU, поскольку он быстрее и использует
  меньше VRAM. Официального готового браузерного ONNX/quantized checkpoint в репозитории модели нет:
  опубликованы PyTorch weights и custom Python code
  ([официальная инструкция ONNX](https://github.com/salute-developers/GigaAM/blob/7447938d791c4f3e643386ee22c33777004293a5/README.md),
  [состав ветки `ctc`](https://huggingface.co/ai-sage/GigaAM-v3/tree/15ef3b5a88da78f93134b3cb7f015c70aefa8946)).

## 2. Почему нельзя просто подставить model id

1. HF-репозиторий объявляет `model_type: "gigaam"` и загружает `AutoModel` через
   `trust_remote_code=True`; remote code — Python-класс `modeling_gigaam.GigaAMModel`
   ([официальный config](https://huggingface.co/ai-sage/GigaAM-v3/blob/15ef3b5a88da78f93134b3cb7f015c70aefa8946/config.json),
   [официальный пример загрузки](https://huggingface.co/ai-sage/GigaAM-v3/blob/ec1dc1f01d0d627ab2c0d3acc1e235702300d95e/README.md)).
   Браузерный Transformers.js не исполняет этот Python-код.
2. В списке поддерживаемых Transformers.js speech-архитектур есть Whisper, Wav2Vec2 и HuBERT, но
   нет GigaAM/Conformer GigaAM. Наличие общего ASR task не означает поддержку произвольной
   архитектуры ([официальный список архитектур](https://huggingface.co/buckets/huggingface/skills/tree/skills/transformers-js/references/MODEL_ARCHITECTURES.md),
   [инструкция для custom ONNX models](https://huggingface.co/docs/transformers.js/custom_usage)).
3. Даже официальный ONNX graph ожидает `features` и `feature_lengths`, а MiniMed передаёт raw PCM.
   Официальный Python ONNX path сначала выполняет внешний `FeatureExtractor`, затем session, затем
   внешний CTC/RNN-T decoder
   ([официальный `infer_onnx`](https://github.com/salute-developers/GigaAM/blob/7447938d791c4f3e643386ee22c33777004293a5/gigaam/onnx_utils.py)).
4. `pipeline()` также ожидает Hugging Face processor/tokenizer metadata и известный JS model class.
   Простое размещение `.onnx` рядом с `config.json` не добавляет отсутствующие pre/postprocessing и
   регистрацию архитектуры ([официальная документация custom models](https://huggingface.co/docs/transformers.js/custom_usage)).

Следствие: для MiniMed нужен либо полноценный upstream-порт GigaAM в Transformers.js, либо отдельный
GigaAM adapter поверх `onnxruntime-web`. Второй путь меньше и не затрагивает Whisper.

## 3. Минимальная реализация

Для первого spike следует выбрать **`v3_ctc`, не RNN-T и не e2e**. Это один ONNX graph, простой
char decoder без SentencePiece и лучший опубликованный WER среди CTC-вариантов без добавочной
нормализации. RNN-T даёт меньший WER, но требует три session и stateful autoregressive loop;
e2e-варианты добавляют tokenizer и могут менять представление чисел.

Минимально необходимы:

1. **Воспроизводимый release artifact.** Скрипт/CI с закреплёнными версиями официального GigaAM
   экспортирует `v3_ctc` в ONNX opset 17, затем создаёт и проверяет CPU/WASM-совместимую
   квантизацию. Результат публикуется в собственном MiniMed GitHub Release с точным размером,
   SHA-256, лицензией MIT и ссылкой на исходный checkpoint. HF token для этого checkpoint не нужен;
   официальный GigaAM loader использует публичный Sber CDN и сверяет checksum
   ([loader и checksum](https://github.com/salute-developers/GigaAM/blob/7447938d791c4f3e643386ee22c33777004293a5/gigaam/__init__.py),
   [MIT license](https://github.com/salute-developers/GigaAM/blob/7447938d791c4f3e643386ee22c33777004293a5/LICENSE)).
2. **Artifact manifest и загрузка.** Для ASR нужны URL зеркала, размер и SHA-256. Следует
   переиспользовать `downloadWithRetry`/resumable storage, но не переносить весь LLM catalog и
   controller в ASR.
3. **Точный feature extractor в worker.** Из PCM 16 кГц получить power mel spectrogram, 64 HTK mel
   bins, Hann window 320, hop 160, `center=false`, затем `ln(clamp(x, 1e-9))`. У уже установленного
   Transformers.js есть внутренние primitives для mel/spectrogram, но они не являются публичным
   top-level API; поэтому допустимы два небольших пути: предложить upstream `GigaAMFeatureExtractor`
   либо держать минимальный проверенный DSP-код локально. Проверка должна побитово/с допуском
   сравнивать features с официальным Python preprocessor на фиксированном WAV.
4. **ONNX session adapter.** Прямой `onnxruntime-web` session принимает `features` и
   `feature_lengths`, возвращает `log_probs` и `encoded_lengths`. WASM — обязательный baseline;
   WebGPU допустим только после проверки graph compatibility и численной эквивалентности.
5. **Greedy CTC decoder.** Argmax по классам, удаление blank и соседних повторов, отображение через
   зафиксированный официальный vocabulary. Это около одного небольшого чистого модуля и должно быть
   проверено теми же logits против официального decoder.
6. **Ограничение длины.** Первый spike принимает записи не длиннее 25 секунд. Для продукта нужна
   собственная offline-сегментация/overlap stitching; официальный long-form path с gated pyannote и
   HF token противоречит требованию автономной дистрибуции. Фиксированные окна без теста на границах
   слов нельзя считать завершённой поддержкой голосовых заметок.
7. **Жизненный цикл.** Сохранить текущие worker messages (`loading`, `ready`, `result`, ошибки),
   cancellation через terminate и один загруженный ASR за раз. UI может остаться без нового
   абстрактного слоя: worker выбирает существующий Whisper pipeline либо GigaAM adapter по model id.
8. **Benchmark.** Минимум: feature parity, decoder parity, реальная Chrome/WASM загрузка,
   транскрипция 5/15/25 секунд, повторный offline запуск из cache, low-memory failure без падения UI,
   затем WER/CER и клинически значимые ошибки на закрытом MiniMed-наборе.

## 4. Размер, скорость, память и браузерные ограничения

### Опубликованные данные

- Официальный `v3_ctc` checkpoint занимает 441 719 299 bytes, а model card указывает 220–240 млн
  параметров ([файл checkpoint](https://huggingface.co/ai-sage/GigaAM-v3/blob/15ef3b5a88da78f93134b3cb7f015c70aefa8946/pytorch_model.bin),
  [model card](https://huggingface.co/ai-sage/GigaAM-v3/blob/ec1dc1f01d0d627ab2c0d3acc1e235702300d95e/README.md)).
- Для сравнения, OpenAI указывает 74 млн параметров для Whisper Base и 244 млн для Whisper Small;
  относительная скорость в таблице OpenAI — примерно 16x и 6x относительно Whisper Large,
  соответственно. Эти числа зависят от hardware и не являются браузерными измерениями
  ([официальный Whisper README](https://github.com/openai/whisper/blob/5f86d1d86363843179951550570367b37c5d6f78/README.md#available-models-and-languages)).
- Опубликованная пара quantized ONNX graphs MiniMed Whisper Base занимает примерно 76.9 MB
  (encoder 23.2 MB + merged decoder 53.7 MB), Whisper Small — примерно 249.1 MB
  (92.3 MB + 156.8 MB)
  ([Base encoder](https://huggingface.co/onnx-community/whisper-base/blob/1846881b6b3a3024392c1eea3ad983695bc23925/onnx/encoder_model_quantized.onnx),
  [Base decoder](https://huggingface.co/onnx-community/whisper-base/blob/1846881b6b3a3024392c1eea3ad983695bc23925/onnx/decoder_model_merged_quantized.onnx),
  [Small encoder](https://huggingface.co/onnx-community/whisper-small/blob/36050c46d777d46dc4b5f43f6d90574fc38f8732/onnx/encoder_model_quantized.onnx),
  [Small decoder](https://huggingface.co/onnx-community/whisper-small/blob/36050c46d777d46dc4b5f43f6d90574fc38f8732/onnx/decoder_model_merged_quantized.onnx)).
- Официальный GigaAM benchmark публикует CUDA-время для attention/encoder, но не сообщает браузерный
  WASM/WebGPU RTF, peak memory или результаты quantized v3. Эти CUDA-числа нельзя переносить на
  MiniMed ([официальная evaluation](https://github.com/salute-developers/GigaAM/blob/7447938d791c4f3e643386ee22c33777004293a5/evaluation.md)).
- ONNX Runtime Web поддерживает WASM во всех основных перечисленных браузерах, тогда как WebGPU в
  его стабильной support matrix отсутствует на Safari/iOS и Firefox. Значит, offline-first MiniMed
  не может считать WebGPU единственным runtime
  ([официальная support matrix ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript/web.html)).
- WASM multithreading работает только при поддержке browser'ом и включённой cross-origin isolation;
  иначе выполнение будет однопоточным. ONNX Runtime отдельно предупреждает, что большие/сложные
  модели могут быть неэффективны на слабом hardware, а fp16 не подходит CPU/WASM
  ([официальные env flags](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html),
  [performance guidance](https://onnxruntime.ai/docs/tutorials/web/performance-diagnosis.html),
  [float16 guidance](https://onnxruntime.ai/docs/performance/model-optimizations/float16.html)).
- ONNX Runtime подчёркивает, что quantization может ухудшить точность и требует сравнения с fp32;
  ускорение зависит от hardware и на старых устройствах иногда отсутствует
  ([официальная документация quantization](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html)).

### Инженерные оценки, не опубликованные результаты

- **Размер:** fp32 ONNX для 220–240 млн параметров ожидаемо будет порядка 0.9 GB только по весам;
  int8 — порядка 0.22–0.25 GB до graph overhead. Это расчёт по числу параметров, не измеренный
  GigaAM artifact. Реальный размер нужно получить экспортом.
- **Память:** загрузчик MiniMed сначала материализует скачанный `Uint8Array`, затем ONNX Runtime
  создаёт session и рабочие tensors. Поэтому peak memory будет заметно выше размера файла. Без
  browser measurement нельзя назначать честный `minimumMemoryGb`.
- **Скорость:** CTC должен иметь преимущество перед autoregressive Whisper decoder, потому что делает
  один encoder+head pass и простой argmax. Это архитектурное ожидание, не доказанный browser
  benchmark; крупный Conformer и неподдержанный/неоптимальный WebGPU graph могут его отменить.
- **Практический риск:** quantized GigaAM по download size вероятно окажется близок к Whisper Small,
  а не Base. Если он на типичном телефоне не укладывается в память или работает медленнее real time,
  его преимущество по русскому WER не оправдает product cost.

## 5. Ожидаемая польза для русских медицинских заметок

### Что подтверждено

- В официальной русской таблице средний WER составляет 9.1 для v3 CTC и 8.3 для v3 RNN-T против
  21.0 в колонке Whisper. GigaAM лучше на всех десяти перечисленных наборах, включая Natural Speech,
  Disordered Speech, Callcenter и OpenSTT Phone Calls
  ([официальная таблица](https://github.com/salute-developers/GigaAM/blob/7447938d791c4f3e643386ee22c33777004293a5/evaluation.md)).
- Эта таблица не называет точный Whisper checkpoint. Поэтому её нельзя превращать в численное
  обещание преимущества над конкретными MiniMed Whisper Base/Small.
- Отдельное сравнение e2e-моделей в official model card проведено против Whisper-large-v3 и даёт
  среднюю победу 70:30 по LLM-as-a-Judge. Это не WER, не Base/Small и не медицинский benchmark
  ([официальная model card](https://huggingface.co/ai-sage/GigaAM-v3/blob/ec1dc1f01d0d627ab2c0d3acc1e235702300d95e/README.md)).
- Опубликованные домены не включают медицинскую диктовку, названия препаратов, дозировки,
  сокращения, латиницу внутри русского текста или числовые назначения
  ([перечень официальных наборов](https://github.com/salute-developers/GigaAM/blob/7447938d791c4f3e643386ee22c33777004293a5/evaluation.md)).

### Обоснованные предположения

- Русскоязычная специализация и данные voice messages/natural speech делают GigaAM сильным
  кандидатом для разговорных заметок врача, особенно при шуме и нетипичной речи.
- Это не гарантирует лучшего распознавания медицинской терминологии. Ошибка в названии препарата,
  дозе, отрицании или единице измерения важнее среднего WER; нужен отдельный weighted error набор.
- `v3_e2e_ctc` может дать более читаемый текст с пунктуацией, но автоматическая нормализация чисел
  должна отдельно проверяться на дозировках. До этого безопаснее spike обычного `v3_ctc`, который
  проще сопоставить с исходной речью.
- GigaAM не заменяет модель «свободный запрос -> JSON» и не является embedding-моделью. Это только
  ASR-слой перед последующим локальным разбором запроса/поиском.

## 6. Решение и критерии оправданности

### Решение сейчас

**Не добавлять GigaAM v3 в релизный UI как рабочую модель. Сделать отдельный time-boxed spike
`v3_ctc` и оставить Whisper Base рекомендуемым, Whisper Small — точным fallback.**

Spike оправдан, потому что официальный русский результат достаточно сильный, а CTC adapter локален
и не требует переделки UI/очереди. Полная продуктовая интеграция до измерений не оправдана: она
добавляет собственный model export, DSP parity, artifact supply chain, ONNX runtime path, long-form
segmentation и новый класс мобильных memory failures.

### Сделать модель доступной вручную, если spike докажет всё ниже

1. Quantized CTC совпадает с официальным fp32/Python результатом на контрольном наборе в пределах
   заранее установленного допуска и не даёт критических подмен чисел/отрицаний.
2. На репрезентативном закрытом наборе русских медицинских voice notes GigaAM выигрывает у Whisper
   Base существенно, а у Whisper Small — хотя бы по взвешенной клинической метрике либо по
   latency/size при сопоставимом качестве.
3. Chrome/Android WASM обрабатывает 25 секунд быстрее real time на минимально поддерживаемом
   устройстве; peak memory не убивает вкладку/Capacitor WebView. Safari/iOS либо проходит тот же gate,
   либо UI явно не предлагает модель там.
4. Повторный запуск полностью offline работает из проверенного cache; зеркало MiniMed, SHA-256,
   cancel/resume и повреждённый download проверены.
5. Для записей длиннее 25 секунд реализовано и проверено offline chunking/VAD со stitching, без
   gated pyannote и токенов.

### Сделать GigaAM рекомендуемой моделью, только если

- она побеждает Whisper Small на целевой клинической метрике не на единичных примерах, а на
  зафиксированном benchmark;
- проходит memory/latency gate минимум на Android и desktop WASM;
- регрессии проверяются тем же набором при каждом новом export/quantization;
- цена загрузки и хранения приемлема для продукта.

Если GigaAM выигрывает только у Whisper Base, но не у Small, разумный гибрид — оставить Base
компактным default, GigaAM ручной русской «повышенной точностью», а Small удалить лишь после
подтверждения, что GigaAM покрывает его noisy/multilingual сценарии. Если browser spike не проходит
memory/latency gate, работу следует остановить: native adapter имеет смысл только когда MiniMed
перейдёт к отдельной подтверждённой native ASR-потребности.
