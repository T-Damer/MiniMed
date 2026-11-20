import ActivityKit
import Capacitor
import Foundation
import UIKit

@available(iOS 16.2, *)
@objc(LocalMedRecordingActivityPlugin)
final class LocalMedRecordingActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "LocalMedRecordingActivityPlugin"
    let jsName = "LocalMedRecordingActivity"
    let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise)]

    @MainActor private var activity: Activity<RecordingActivityAttributes>?
    @MainActor private var observer: Task<Void, Never>?
    @MainActor private var dismissed = false

    @objc func update(_ call: CAPPluginCall) {
        guard let state = call.getString("state"), ["recording", "paused", "ended"].contains(state) else {
            call.reject("Invalid recording state")
            return
        }
        let elapsed = max(0, call.getInt("elapsedMs") ?? 0)
        let recordingId = call.getString("recordingId")
        Task { @MainActor in
            if state == "ended" {
                dismissed = false
                activity = nil
                observer?.cancel()
                observer = nil
                for current in Activity<RecordingActivityAttributes>.activities {
                    await current.end(nil, dismissalPolicy: .immediate)
                }
                call.resolve(["presented": false])
                return
            }
            guard Self.supportsDynamicIsland, ActivityAuthorizationInfo().areActivitiesEnabled, !dismissed else {
                call.resolve(["presented": false])
                return
            }
            let content = ActivityContent(
                state: RecordingActivityAttributes.ContentState(
                    startedAt: state == "paused" ? nil : Date().addingTimeInterval(-Double(elapsed) / 1000),
                    elapsedSeconds: elapsed / 1000
                ),
                staleDate: Date().addingTimeInterval(8 * 60 * 60)
            )
            do {
                if let current = activity {
                    await current.update(content)
                } else {
                    // A killed app may have left a stale activity. One recording has one activity.
                    for previous in Activity<RecordingActivityAttributes>.activities {
                        await previous.end(nil, dismissalPolicy: .immediate)
                    }
                    let current = try Activity.request(
                        attributes: RecordingActivityAttributes(recordingId: recordingId), content: content
                    )
                    activity = current
                    observer = Task { [weak self] in
                        for await state in current.activityStateUpdates {
                            if Task.isCancelled { return }
                            if state == .dismissed || state == .ended || state == .stale {
                                self?.dismissed = true
                                self?.notifyListeners("presentationChanged", data: ["presented": false])
                                return
                            }
                        }
                    }
                }
                call.resolve(["presented": activity?.activityState == .active])
            } catch {
                call.reject("Unable to show the recording activity", nil, error)
            }
        }
    }

    // ActivityKit also runs on phones with a Lock Screen only. Apple does not expose a public
    // Dynamic Island capability lookup. Unknown hardware keeps the in-app controls.
    private static var supportsDynamicIsland: Bool {
        var system = utsname()
        uname(&system)
        let machine = withUnsafeBytes(of: &system.machine) { bytes in
            String(decoding: bytes.prefix { $0 != 0 }, as: UTF8.self)
        }
        let model = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] ?? machine
        return [
            "iPhone15,2", "iPhone15,3", "iPhone15,4", "iPhone15,5",
            "iPhone16,1", "iPhone16,2",
            "iPhone17,1", "iPhone17,2", "iPhone17,3", "iPhone17,4",
            "iPhone18,1", "iPhone18,2", "iPhone18,3", "iPhone18,4",
            "iPhone19,2", "iPhone19,3", "iPhone19,4", "iPhone19,7",
        ].contains(model)
    }
}
