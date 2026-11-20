import ActivityKit
import Foundation

@available(iOS 16.1, *)
struct RecordingActivityAttributes: ActivityAttributes {
    let recordingId: String?

    struct ContentState: Codable, Hashable {
        // No conversation, patient, or recording identifiers are displayed on system surfaces.
        let startedAt: Date?
        let elapsedSeconds: Int
    }
}
