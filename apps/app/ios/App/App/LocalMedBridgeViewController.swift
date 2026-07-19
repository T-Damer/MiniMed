import Capacitor

@objc(LocalMedBridgeViewController)
final class LocalMedBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LocalMedDatabasePlugin())
    }
}
