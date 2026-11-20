import ActivityKit
import Foundation
import SwiftUI
import WidgetKit

@main
struct RecordingActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
            HStack {
                microphone
                Text(context.state.startedAt == nil ? "Запись на паузе" : "Запись беседы")
                Spacer()
                timer(context.state)
                stopControl(context.attributes.recordingId)
            }
            .padding()
            .privacySensitive()
            .widgetURL(recordingURL("open", context.attributes.recordingId))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { microphone }
                DynamicIslandExpandedRegion(.trailing) { timer(context.state) }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text(context.state.startedAt == nil ? "Запись на паузе" : "Запись беседы")
                        Spacer()
                        stopControl(context.attributes.recordingId)
                    }
                }
            } compactLeading: {
                microphone
            } compactTrailing: {
                timer(context.state)
                    .frame(maxWidth: 46)
            } minimal: {
                microphone
            }
            .widgetURL(recordingURL("open", context.attributes.recordingId))
        }
    }

    private func recordingURL(_ action: String, _ id: String?) -> URL? {
        var parts = URLComponents()
        parts.scheme = "minimed-recording"
        parts.host = action
        if let id { parts.queryItems = [URLQueryItem(name: "id", value: id)] }
        return parts.url
    }

    @ViewBuilder
    private func stopControl(_ id: String?) -> some View {
        if let id, let url = recordingURL("stop", id) {
            Link(destination: url) {
                Label("Остановить", systemImage: "stop.fill")
                    .labelStyle(.iconOnly)
                    .padding(8)
            }
            .accessibilityLabel("Остановить запись")
        }
    }

    private var microphone: some View {
        Image(systemName: "mic.fill")
            .foregroundStyle(.red)
            .accessibilityLabel("Запись беседы")
    }

    @ViewBuilder
    private func timer(_ state: RecordingActivityAttributes.ContentState) -> some View {
        if let startedAt = state.startedAt {
            Text(startedAt, style: .timer).monospacedDigit()
        } else {
            Text(String(format: "%d:%02d", state.elapsedSeconds / 60, state.elapsedSeconds % 60))
                .monospacedDigit()
                .accessibilityLabel("Запись на паузе")
        }
    }
}
