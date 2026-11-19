import ActivityKit
import Foundation
import SwiftUI
import WidgetKit

@main
struct RecordingActivityWidget: Widget {
    private let openRecorder = URL(string: "minimed-recording://open")

    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
            HStack {
                microphone
                Text(context.state.startedAt == nil ? "Запись на паузе" : "Запись беседы")
                Spacer()
                timer(context.state)
            }
            .padding()
            .privacySensitive()
            .widgetURL(openRecorder)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { microphone }
                DynamicIslandExpandedRegion(.trailing) { timer(context.state) }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.state.startedAt == nil ? "Запись на паузе" : "Запись беседы")
                }
            } compactLeading: {
                microphone
            } compactTrailing: {
                timer(context.state)
                    .frame(maxWidth: 46)
            } minimal: {
                microphone
            }
            .widgetURL(openRecorder)
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
