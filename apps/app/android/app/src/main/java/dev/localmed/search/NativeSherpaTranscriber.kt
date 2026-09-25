package dev.localmed.search

import com.k2fsa.sherpa.onnx.FastClusteringConfig
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineNemoEncDecCtcModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerDiarization
import com.k2fsa.sherpa.onnx.OfflineSpeakerDiarizationConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerSegmentationModelConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerSegmentationPyannoteModelConfig
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractorConfig
import java.io.File
import java.io.IOException
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

internal data class NativeSpeakerSegment(
    val speakerId: String,
    val startMs: Long,
    val endMs: Long,
    val text: String,
)

internal object NativeSherpaTranscriber {
    private const val SAMPLE_RATE = 16_000
    private const val FEATURE_DIM = 64
    private const val MAX_ASR_WINDOW_SECONDS = 180
    private const val NUM_THREADS = 2

    fun transcribe(
        audio: DecodedAudio,
        modelDirectory: File,
        onDiarizationProgress: (completed: Int, total: Int) -> Unit,
        onTranscriptionProgress: (completed: Int, total: Int) -> Unit,
    ): List<NativeSpeakerSegment> {
        if (audio.sampleRate != SAMPLE_RATE) {
            throw IOException("Sherpa input must be 16 kHz.")
        }
        val asrModel = requiredModel(modelDirectory, "gigaam-v3-punct.int8.onnx")
        val tokens = requiredModel(modelDirectory, "gigaam-v3-punct.tokens.txt")
        val segmentation = requiredModel(modelDirectory, "pyannote-segmentation-3.0.int8.onnx")
        val embedding = requiredModel(modelDirectory, "campplus-voxceleb-16k.onnx")

        val diarizer =
            OfflineSpeakerDiarization(
                config =
                    OfflineSpeakerDiarizationConfig(
                        segmentation =
                            OfflineSpeakerSegmentationModelConfig(
                                pyannote =
                                    OfflineSpeakerSegmentationPyannoteModelConfig(
                                        model = segmentation.absolutePath,
                                        windowShiftRatio = 0.1f,
                                    ),
                                numThreads = NUM_THREADS,
                            ),
                        embedding =
                            SpeakerEmbeddingExtractorConfig(
                                model = embedding.absolutePath,
                                numThreads = NUM_THREADS,
                            ),
                        clustering =
                            FastClusteringConfig(
                                numClusters = -1,
                                threshold = 0.5f,
                                computeConfidence = true,
                            ),
                        minDurationOn = 0.2f,
                        minDurationOff = 0.5f,
                    ),
            )

        val recognizer =
            OfflineRecognizer(
                config =
                    OfflineRecognizerConfig(
                        featConfig =
                            FeatureConfig(
                                sampleRate = SAMPLE_RATE,
                                featureDim = FEATURE_DIM,
                                dither = 0f,
                            ),
                        modelConfig =
                            OfflineModelConfig(
                                nemo =
                                    OfflineNemoEncDecCtcModelConfig(
                                        model = asrModel.absolutePath,
                                    ),
                                numThreads = NUM_THREADS,
                                tokens = tokens.absolutePath,
                            ),
                        decodingMethod = "greedy_search",
                    ),
            )

        try {
            val diarized =
                diarizer.processWithCallback(audio.samples) { completed, total, _ ->
                    onDiarizationProgress(max(0, completed), max(1, total))
                    if (Thread.currentThread().isInterrupted) 1 else 0
                }
            if (diarized.isEmpty()) {
                val text = recognizeWindowed(recognizer, audio.samples)
                onTranscriptionProgress(1, 1)
                return if (text.isBlank()) {
                    emptyList()
                } else {
                    listOf(
                        NativeSpeakerSegment(
                            speakerId = "speaker-1",
                            startMs = 0L,
                            endMs = audio.durationMs,
                            text = text,
                        ),
                    )
                }
            }

            val results = ArrayList<NativeSpeakerSegment>(diarized.size)
            for ((index, segment) in diarized.withIndex()) {
                val startFrame =
                    floor(segment.start.toDouble() * SAMPLE_RATE)
                        .toLong()
                        .coerceIn(0L, audio.samples.size.toLong())
                        .toInt()
                val endFrame =
                    ceil(segment.end.toDouble() * SAMPLE_RATE)
                        .toLong()
                        .coerceIn(startFrame.toLong(), audio.samples.size.toLong())
                        .toInt()
                if (endFrame <= startFrame) {
                    onTranscriptionProgress(index + 1, diarized.size)
                    continue
                }
                val text =
                    recognizeWindowed(
                        recognizer,
                        audio.samples.copyOfRange(startFrame, endFrame),
                    )
                if (text.isNotBlank()) {
                    results.add(
                        NativeSpeakerSegment(
                            speakerId = "speaker-" + (segment.speaker + 1),
                            startMs = (startFrame.toLong() * 1_000L) / SAMPLE_RATE,
                            endMs = (endFrame.toLong() * 1_000L) / SAMPLE_RATE,
                            text = text,
                        ),
                    )
                }
                onTranscriptionProgress(index + 1, diarized.size)
            }
            return results
        } finally {
            recognizer.release()
            diarizer.release()
        }
    }

    private fun recognizeWindowed(recognizer: OfflineRecognizer, samples: FloatArray): String {
        val maxWindowFrames = SAMPLE_RATE * MAX_ASR_WINDOW_SECONDS
        if (samples.size <= maxWindowFrames) return recognize(recognizer, samples)

        val parts = ArrayList<String>()
        var start = 0
        while (start < samples.size) {
            val end = min(samples.size, start + maxWindowFrames)
            val text = recognize(recognizer, samples.copyOfRange(start, end))
            if (text.isNotBlank()) parts.add(text)
            start = end
        }
        return parts.joinToString(" ").replace(Regex("\\s+"), " ").trim()
    }

    private fun recognize(recognizer: OfflineRecognizer, samples: FloatArray): String {
        if (samples.isEmpty()) return ""
        val stream = recognizer.createStream()
        try {
            stream.acceptWaveform(samples, SAMPLE_RATE)
            recognizer.decode(stream)
            return recognizer.getResult(stream).text.trim()
        } finally {
            stream.release()
        }
    }

    private fun requiredModel(directory: File, fileName: String): File {
        val file = File(directory, fileName)
        if (!file.isFile || file.length() == 0L) {
            throw IOException("Required transcription model is absent: " + fileName)
        }
        return file
    }
}
