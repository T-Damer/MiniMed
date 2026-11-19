import Capacitor

@objc(LocalMedBridgeViewController)
final class LocalMedBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LocalMedDatabasePlugin())
        bridge?.registerPluginInstance(LocalMedPatientVaultPlugin())
        if #available(iOS 16.2, *) {
            bridge?.registerPluginInstance(LocalMedRecordingActivityPlugin())
        }
    }
}
