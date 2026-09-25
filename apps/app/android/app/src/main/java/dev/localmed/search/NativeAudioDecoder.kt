package dev.localmed.search

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.File
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

internal data class DecodedAudio(
    val samples: FloatArray,
    val sampleRate: Int,
    val durationMs: Long,
)

internal object NativeAudioDecoder {
    private const val TARGET_SAMPLE_RATE = 16_000
    private const val MAX_DURATION_MS = 75L * 60L * 1_000L
    private const val DEQUEUE_TIMEOUT_US = 10_000L

    fun decode(
        file: File,
        onProgress: (completed: Int, total: Int) -> Unit = { _, _ -> },
    ): DecodedAudio {
        if (!file.isFile || file.length() == 0L) throw IOException("Audio file is absent or empty.")

        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
        try {
            extractor.setDataSource(file.absolutePath)
            val trackIndex =
                (0 until extractor.trackCount).firstOrNull { index ->
                    extractor.getTrackFormat(index)
                        .getString(MediaFormat.KEY_MIME)
                        ?.startsWith("audio/") == true
                } ?: throw IOException("Audio track is missing.")
            extractor.selectTrack(trackIndex)
            val inputFormat = extractor.getTrackFormat(trackIndex)
            val mime =
                inputFormat.getString(MediaFormat.KEY_MIME)
                    ?: throw IOException("Audio MIME type is missing.")
            val durationUs =
                if (inputFormat.containsKey(MediaFormat.KEY_DURATION)) {
                    inputFormat.getLong(MediaFormat.KEY_DURATION)
                } else {
                    0L
                }
            if (durationUs > MAX_DURATION_MS * 1_000L) {
                throw IOException("Audio recording is longer than 75 minutes.")
            }

            val expectedSamples =
                if (durationUs > 0L) {
                    min(
                            (durationUs / 1_000_000.0 * TARGET_SAMPLE_RATE).toLong() +
                                TARGET_SAMPLE_RATE,
                            Int.MAX_VALUE.toLong(),
                        )
                        .toInt()
                } else {
                    TARGET_SAMPLE_RATE * 60
                }
            val collector = ResampledFloatCollector(expectedSamples)

            codec = MediaCodec.createDecoderByType(mime)
            codec.configure(inputFormat, null, null, 0)
            codec.start()

            val info = MediaCodec.BufferInfo()
            var inputEnded = false
            var outputEnded = false
            var outputFormat: MediaFormat = inputFormat

            while (!outputEnded) {
                if (!inputEnded) {
                    val inputIndex = codec.dequeueInputBuffer(DEQUEUE_TIMEOUT_US)
                    if (inputIndex >= 0) {
                        val input = codec.getInputBuffer(inputIndex)
                            ?: throw IOException("Decoder input buffer is unavailable.")
                        input.clear()
                        val size = extractor.readSampleData(input, 0)
                        if (size < 0) {
                            codec.queueInputBuffer(
                                inputIndex,
                                0,
                                0,
                                0L,
                                MediaCodec.BUFFER_FLAG_END_OF_STREAM,
                            )
                            inputEnded = true
                        } else {
                            codec.queueInputBuffer(
                                inputIndex,
                                0,
                                size,
                                max(0L, extractor.sampleTime),
                                0,
                            )
                            extractor.advance()
                        }
                    }
                }

                when (val outputIndex = codec.dequeueOutputBuffer(info, DEQUEUE_TIMEOUT_US)) {
                    MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
                    MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> outputFormat = codec.outputFormat
                    else -> {
                        if (outputIndex >= 0) {
                            if (info.size > 0) {
                                val output =
                                    codec.getOutputBuffer(outputIndex)
                                        ?: throw IOException("Decoder output buffer is unavailable.")
                                output.position(info.offset)
                                output.limit(info.offset + info.size)
                                appendDecodedPcm(output.slice(), outputFormat, collector)
                                if (collector.size > TARGET_SAMPLE_RATE * 60L * 75L) {
                                    throw IOException("Decoded recording exceeds the memory limit.")
                                }
                                val total = 1_000
                                val completed =
                                    if (durationUs > 0L) {
                                        ((max(0L, info.presentationTimeUs).toDouble() /
                                                durationUs.toDouble()) *
                                                total)
                                            .toInt()
                                            .coerceIn(0, total)
                                    } else {
                                        0
                                    }
                                onProgress(completed, total)
                            }
                            outputEnded =
                                info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                            codec.releaseOutputBuffer(outputIndex, false)
                        }
                    }
                }
            }

            val samples = collector.toFloatArray()
            if (samples.isEmpty()) throw IOException("Decoded audio is empty.")
            val durationMs = (samples.size.toLong() * 1_000L) / TARGET_SAMPLE_RATE
            onProgress(1_000, 1_000)
            return DecodedAudio(samples, TARGET_SAMPLE_RATE, durationMs)
        } finally {
            try {
                codec?.stop()
            } catch (_: Exception) {
                // Decoder failure is reported by the original exception; release still has to run.
            }
            codec?.release()
            extractor.release()
        }
    }

    private fun appendDecodedPcm(
        buffer: ByteBuffer,
        format: MediaFormat,
        collector: ResampledFloatCollector,
    ) {
        val sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        val channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        if (sampleRate <= 0 || channels <= 0) throw IOException("Invalid decoded audio format.")
        val encoding =
            if (format.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
                format.getInteger(MediaFormat.KEY_PCM_ENCODING)
            } else {
                AudioFormat.ENCODING_PCM_16BIT
            }

        buffer.order(ByteOrder.LITTLE_ENDIAN)
        val bytesPerSample =
            when (encoding) {
                AudioFormat.ENCODING_PCM_16BIT -> 2
                AudioFormat.ENCODING_PCM_FLOAT -> 4
                else -> throw IOException("Unsupported decoded PCM encoding: $encoding")
            }
        val frameBytes = bytesPerSample * channels
        val frameCount = buffer.remaining() / frameBytes
        if (frameCount <= 0) return
        val mono = FloatArray(frameCount)
        for (frame in 0 until frameCount) {
            var sum = 0f
            repeat(channels) {
                sum +=
                    when (encoding) {
                        AudioFormat.ENCODING_PCM_FLOAT -> buffer.float.coerceIn(-1f, 1f)
                        else -> buffer.short / 32768f
                    }
            }
            mono[frame] = sum / channels.toFloat()
        }
        collector.append(mono, sampleRate)
    }

    private class ResampledFloatCollector(initialCapacity: Int) {
        private var values = FloatArray(max(TARGET_SAMPLE_RATE, initialCapacity))
        private var inputRate = 0
        private var inputFrames = 0L
        private var nextOutputPosition = 0.0
        private var previousSample = 0f
        private var hasPrevious = false

        var size: Int = 0
            private set

        fun append(input: FloatArray, sampleRate: Int) {
            if (input.isEmpty()) return
            if (inputRate == 0) inputRate = sampleRate
            if (inputRate != sampleRate) {
                throw IOException("Decoded audio sample rate changed during the file.")
            }
            val start = inputFrames
            val end = start + input.size - 1L
            val step = sampleRate.toDouble() / TARGET_SAMPLE_RATE.toDouble()

            while (nextOutputPosition <= end.toDouble()) {
                val leftIndex = floor(nextOutputPosition).toLong()
                val fraction = nextOutputPosition - leftIndex.toDouble()
                val rightIndex = if (fraction > 0.000_001) leftIndex + 1L else leftIndex
                if (rightIndex > end) break
                val left = sampleAt(leftIndex, start, input)
                val right = sampleAt(rightIndex, start, input)
                appendValue((left + ((right - left) * fraction)).toFloat())
                nextOutputPosition += step
            }

            previousSample = input.last()
            hasPrevious = true
            inputFrames += input.size
        }

        private fun sampleAt(index: Long, start: Long, input: FloatArray): Float {
            if (index == start - 1L && hasPrevious) return previousSample
            val local = index - start
            if (local < 0L || local >= input.size.toLong()) {
                throw IOException("Resampler requested an unavailable PCM frame.")
            }
            return input[local.toInt()]
        }

        private fun appendValue(value: Float) {
            if (size == values.size) {
                val nextSize =
                    min(
                        Int.MAX_VALUE.toLong(),
                        max(values.size.toLong() + TARGET_SAMPLE_RATE, values.size.toLong() * 3L / 2L),
                    )
                if (nextSize <= values.size) throw IOException("Decoded audio is too large.")
                values = values.copyOf(nextSize.toInt())
            }
            values[size] = value
            size += 1
        }

        fun toFloatArray(): FloatArray = values.copyOf(size)
    }
}
